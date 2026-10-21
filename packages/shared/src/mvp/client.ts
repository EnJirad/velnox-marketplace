/**
 * MVP HTTP client — the ONLY place a frontend request may reach `/api/mvp`.
 *
 * It preserves the conventions the legacy client already established, so the
 * MVP surface never invents a second error model:
 *
 *   • the backend envelope is `{ success: true, data }` /
 *     `{ success: false, error: { code, message } }` and `data` is unwrapped;
 *   • the session is an httpOnly cookie, so every request sends
 *     `credentials: "include"` and no token is ever read or stored in JS;
 *   • every request is bounded by a timeout, so a hung staging API cannot leave
 *     a page spinning forever;
 *   • a failure is a typed `MvpApiError` carrying the HTTP status and the
 *     backend `code`, never a raw body or a server stack.
 *
 * The `fetch` implementation is injectable because the staging E2E script runs
 * in Bun (where `fetch` has no cookie jar) against the same client a browser
 * uses. Production and browser code never passes one.
 */
import { getApiMode } from "./config.js";

/** Default per-request deadline. Catalogue/checkout must not hang a UI. */
export const MVP_TIMEOUT_MS = 15_000;

/**
 * A failed MVP request.
 *
 * `status` is `0` for a transport failure (offline, DNS, abort) so a caller can
 * distinguish "the server said no" from "we never reached the server" without
 * string matching.
 */
export class MvpApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MvpApiError";
    this.status = status;
    this.code = code;
  }

  /** No usable session (401) — the caller should send the user to sign in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Authenticated but not allowed (403) — e.g. a pending seller. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Not found (404). Catalogue hides unpublished products this way. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** A refused state change (409) — out of stock, duplicate, wrong lifecycle. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export interface MvpHttpConfig {
  /**
   * Origin of the backend (no `/api`). The client appends `/api/mvp`, so a
   * caller can never accidentally double the namespace.
   */
  apiOrigin: string;
  /** Injected for tests / the Bun staging harness. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface MvpRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Overrides the client timeout for one call. */
  timeoutMs?: number;
  /** Caller-controlled cancellation (component unmount, navigation). */
  signal?: AbortSignal;
  /** Extra headers (never auth: the cookie is the credential). */
  headers?: Record<string, string>;
}

export interface MvpHttp {
  readonly baseUrl: string;
  request<T>(path: string, options?: MvpRequestOptions): Promise<T>;
}

interface ErrorEnvelope {
  success?: boolean;
  error?: { code?: unknown; message?: unknown } | string;
}

/** Extract `{code, message}` from any error body without trusting its shape. */
function readErrorEnvelope(body: unknown, status: number): { code: string; message: string } {
  const fallback = { code: `HTTP_${status}`, message: `Request failed (${status})` };
  if (typeof body !== "object" || body === null) return fallback;

  const envelope = body as ErrorEnvelope;
  if (typeof envelope.error === "string" && envelope.error.trim()) {
    return { code: fallback.code, message: envelope.error };
  }
  if (typeof envelope.error === "object" && envelope.error !== null) {
    const code = typeof envelope.error.code === "string" ? envelope.error.code : fallback.code;
    const message =
      typeof envelope.error.message === "string" && envelope.error.message.trim()
        ? envelope.error.message
        : fallback.message;
    return { code, message };
  }
  return fallback;
}

/** `{ success: true, data }` → `data`; an unwrapped body is passed through. */
function unwrapEnvelope<T>(body: unknown): T {
  if (typeof body === "object" && body !== null && "success" in body && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export function createMvpHttp(config: MvpHttpConfig): MvpHttp {
  const origin = config.apiOrigin.replace(/\/+$/, "");
  const baseUrl = `${origin}/api/mvp`;
  const timeoutMs = config.timeoutMs ?? MVP_TIMEOUT_MS;

  async function request<T>(path: string, options: MvpRequestOptions = {}): Promise<T> {
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const doFetch: typeof fetch = config.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function") {
      throw new MvpApiError(0, "NO_FETCH", "This environment has no fetch implementation");
    }

    const controller = new AbortController();
    const limit = options.timeoutMs ?? timeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limit);

    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);

    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    const hasBody = options.body !== undefined;
    if (hasBody) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await doFetch(url, {
        method: options.method ?? (hasBody ? "POST" : "GET"),
        // The session is an httpOnly cookie — this is not optional.
        credentials: "include",
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // A caller-initiated abort is propagated as-is so React effects can ignore
      // it; our own deadline becomes a readable TIMEOUT error.
      if (options.signal?.aborted && !timedOut) throw err;
      throw new MvpApiError(
        0,
        timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        timedOut
          ? `The server did not answer within ${limit}ms`
          : "Could not reach the server",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    if (response.status === 204) return undefined as T;

    let body: unknown = undefined;
    try {
      body = await response.json();
    } catch {
      if (!response.ok) {
        throw new MvpApiError(response.status, `HTTP_${response.status}`, "Request failed");
      }
      throw new MvpApiError(response.status, "INVALID_RESPONSE", "The server sent an unreadable response");
    }

    if (!response.ok) {
      const { code, message } = readErrorEnvelope(body, response.status);
      throw new MvpApiError(response.status, code, message);
    }

    return unwrapEnvelope<T>(body);
  }

  return { baseUrl, request };
}

/**
 * The client this build should use.
 *
 * Legacy builds still get an MVP client object: the MVP pages are only reachable
 * when MVP mode is on, but importing the module must never throw during a
 * legacy import (or a server-side render of a shared page).
 */
export function createMvpHttpFromEnv(fetchImpl?: typeof fetch): MvpHttp {
  return createMvpHttp({ apiOrigin: getApiMode().apiOrigin, fetchImpl });
}

export { unwrapEnvelope };
