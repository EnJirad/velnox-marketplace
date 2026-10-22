/**
 * Shared MVP React primitives.
 *
 * Every MVP surface (VelShop, VelSeller, VelCenter) needs the same four things
 * and nothing more:
 *
 *   • `useMvpQuery` — one loader with a loading flag, a typed error, an abort and
 *     a retry, so no page invents its own half-working state machine;
 *   • `MvpLoading` / `MvpErrorState` / `MvpEmpty` — one visual language for
 *     "still loading", "the server said no", "there is nothing here" and "this
 *     needs a retry" (Phase 3b requires all four explicitly);
 *   • `formatMoney` — display ONLY. The value always comes from the API as a
 *     `NUMERIC` string; the browser never recomputes a price or a total;
 *   • `MvpAuthPanel` — the original sign-in screen: Google first, email/password
 *     as the alternative (both end in the same httpOnly session cookie).
 *
 * These components are deliberately plain: they render the existing shadcn
 * tokens (`bg-background`, `text-muted-foreground`, slate borders) so the MVP
 * pages look like the rest of the product without restyling it.
 */
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { refetchCurrentUser } from "../lib/api-client.js";
import { getMvpApi, type MvpSellerSession } from "./api.js";
import { MvpApiError } from "./client.js";
import { getApiMode } from "./config.js";
import { MVP_ROUTES } from "./routes.js";
import type { MvpUser } from "./types.js";
import { AlertCircle, Loader2, PackageOpen, RefreshCw } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type FormEvent,
  type ReactNode,
} from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

// ─── Money ──────────────────────────────────────────────────────────────────

/**
 * Format a server-provided amount for display.
 *
 * The argument is whatever the API returned (`"1290.00"`), never a value this
 * module computed. `null` renders as an em dash so a missing amount is visibly
 * missing instead of looking like zero.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency = "THB",
  locale = "th-TH",
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** A short ISO date for order tables, or an em dash. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Anything thrown by a loader, normalised to the MVP error type. */
export function toMvpError(error: unknown): MvpApiError {
  if (error instanceof MvpApiError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new MvpApiError(0, "UNEXPECTED", message);
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

// ─── Query hook ─────────────────────────────────────────────────────────────

export interface MvpQueryResult<T> {
  data: T | null;
  error: MvpApiError | null;
  loading: boolean;
  /** Re-run the loader (the retry button in every error state). */
  reload: () => void;
}

/**
 * Load one API resource, abort it on unmount, and expose loading/error/retry.
 *
 * `loader` is read through a ref so a page can pass an inline arrow function
 * without re-fetching on every render; `deps` is what actually controls the
 * reload (route params, filters, …).
 */
export function useMvpQuery<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList = [],
): MvpQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<MvpApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    loaderRef.current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || isAbort(err)) return;
        setError(toMvpError(err));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

// ─── Session ────────────────────────────────────────────────────────────────

/** The seller summary `/auth/me` returns alongside the user (or `null`). */
export type MvpSessionSeller = MvpSellerSession["seller"];

export interface MvpSession {
  user: MvpUser | null;
  seller: MvpSessionSeller;
}

/**
 * The caller's MVP session, read from the server on every mount.
 *
 * `401` is not an error here — it is "signed out", which is a normal state the
 * pages render (`MvpAuthPanel` or a sign-in prompt).
 */
export function useMvpSession() {
  const query = useMvpQuery<MvpSession>(
    async (signal) => {
      try {
        const session = await getMvpApi().auth.me();
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return { user: session.user ?? null, seller: session.seller ?? null };
      } catch (error) {
        if (error instanceof MvpApiError && error.isUnauthenticated) {
          return { user: null, seller: null };
        }
        throw error;
      }
    },
    [],
  );
  return query;
}

// ─── Session context + guard ────────────────────────────────────────────────

interface MvpSessionContextValue {
  user: MvpUser | null;
  seller: MvpSessionSeller;
  loading: boolean;
  error: MvpApiError | null;
  reload: () => void;
}

const MvpSessionContext = createContext<MvpSessionContextValue | null>(null);

/**
 * Read the MVP session ONCE per app and share it.
 *
 * Without this, the header, the cart provider and a guarded page would each fire
 * their own `GET /auth/me` on mount and could briefly disagree about who is
 * signed in.
 */
export function MvpSessionProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useMvpSession();
  const value: MvpSessionContextValue = {
    user: data?.user ?? null,
    seller: data?.seller ?? null,
    loading,
    error,
    reload,
  };
  return <MvpSessionContext.Provider value={value}>{children}</MvpSessionContext.Provider>;
}

export function useMvpSessionContext(): MvpSessionContextValue {
  const value = useContext(MvpSessionContext);
  if (!value) throw new Error("useMvpSessionContext must be used inside <MvpSessionProvider>");
  return value;
}

/**
 * Gate a route on a real server session, preserving the intended destination.
 *
 * A transport/5xx failure is NOT treated as "signed out": the failure is shown
 * with a retry, because bouncing to the sign-in page would hide a server outage.
 */
export function MvpRequireSession({ children }: { children: ReactNode }) {
  const { user, loading, error, reload } = useMvpSessionContext();
  const location = useLocation();

  if (loading) return <MvpLoading label="Checking your session…" />;
  if (error && !user) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <MvpErrorState error={error} onRetry={reload} />
      </div>
    );
  }
  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <>{children}</>;
}

// ─── States ─────────────────────────────────────────────────────────────────

export function MvpLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
      <Loader2 className="size-6 animate-spin text-slate-400" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

/**
 * A failed request.
 *
 * `401` gets a sign-in prompt rather than a retry: retrying an unauthenticated
 * request can never succeed. `403` explains that the server refused, so the page
 * never implies the user could fix it by clicking something.
 */
export function MvpErrorState({
  error,
  onRetry,
  title,
}: {
  error: MvpApiError;
  onRetry?: () => void;
  title?: string;
}) {
  const navigate = useNavigate();
  const heading =
    title ??
    (error.isUnauthenticated
      ? "Please sign in"
      : error.isForbidden
        ? "Not allowed"
        : error.code === "TIMEOUT" || error.code === "NETWORK_ERROR"
          ? "The server could not be reached"
          : "Something went wrong");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-rose-50">
        <AlertCircle className="size-5 text-rose-500" />
      </span>
      <h2 className="mt-3 text-base font-semibold text-slate-900">{heading}</h2>
      <p className="mt-1 text-sm text-slate-500">{error.message}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {error.code}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
        {error.isUnauthenticated ? (
          <Button
            className="bg-slate-900 text-white hover:bg-slate-800"
            onClick={() =>
              navigate(`/auth?returnTo=${encodeURIComponent(window.location.pathname)}`)
            }
          >
            Sign in
          </Button>
        ) : onRetry ? (
          <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={onRetry}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function MvpEmpty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-slate-100">
        <PackageOpen className="size-5 text-slate-400" />
      </span>
      <h2 className="mt-3 text-base font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

// ─── Auth ───────────────────────────────────────────────────────────────────

/**
 * Email/password sign-in and sign-up for the MVP API.
 *
 * On success it refreshes the shared auth singleton (`refetchCurrentUser`), which
 * in MVP mode reads `/api/mvp/auth/me`, so `RequireAuth` and every header see the
 * new session immediately without a reload.
 */
export function MvpAuthPanel({
  title = "Sign in to Velnox",
  description = "Sign in with Google, or use the email and password you registered with.",
  redirectAfterAuth = "/",
  oauthApp = "velshop",
}: {
  title?: string;
  description?: string;
  redirectAfterAuth?: string;
  /** Which frontend the backend should return to (allowlisted server-side). */
  oauthApp?: "velshop" | "velseller" | "velcenter" | "velnox";
}) {
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo")) ?? redirectAfterAuth;

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google is offered only when the SERVER says the client is configured; the
  // button is never a link to a fake flow.
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    getMvpApi()
      .auth.providers()
      .then((providers) => {
        if (active) setGoogleEnabled(Boolean(providers.google?.enabled));
      })
      .catch(() => {
        if (active) setGoogleEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // A refused Google round trip comes back as `?error=…` on this page.
  useEffect(() => {
    const code = searchParams.get("error");
    if (!code) return;
    const message =
      code === "google_not_configured"
        ? "Google sign-in is not configured on this server. Use email and password."
        : code === "google_denied"
          ? "Google sign-in was cancelled."
          : code === "google_email_unverified"
            ? "Google did not verify that email address."
            : code === "google_account_inactive"
              ? "This account is not active."
              : "Could not sign in with Google. Please try again.";
    setError(message);
  }, [searchParams]);

  const startGoogle = () => {
    const base = getApiMode().mvpBaseUrl;
    const params = new URLSearchParams({ returnTo, app: oauthApp });
    window.location.assign(`${base}${MVP_ROUTES.auth.googleStart}?${params}`);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const api = getMvpApi();
      if (mode === "signup") {
        await api.auth.signup({ email: email.trim(), password, name: name.trim() || undefined });
      } else {
        await api.auth.login({ email: email.trim(), password });
      }
      await refetchCurrentUser();
      // A HARD navigation, deliberately: the session is read once per app mount
      // (`MvpSessionProvider`), so a client-side route change would leave every
      // provider, guard and header on the pre-login snapshot. Reloading proves
      // the SERVER accepted the session and makes `/auth/me` the single source
      // of the user the pages render.
      window.location.assign(returnTo);
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.06)] sm:p-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>

      {googleEnabled && (
        <>
          <button
            type="button"
            onClick={startGoogle}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-slate-200 bg-white text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
          >
            <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continue with Google
          </button>
          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              or
            </span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(["login", "signup"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            {value === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 grid gap-3">
        {mode === "signup" && (
          <div className="grid gap-2">
            <Label htmlFor="mvp-name" className="text-xs font-medium text-slate-500">
              Name
            </Label>
            <Input
              id="mvp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="h-11 rounded-[10px] border-slate-200"
              disabled={busy}
            />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="mvp-email" className="text-xs font-medium text-slate-500">
            Email
          </Label>
          <Input
            id="mvp-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-11 rounded-[10px] border-slate-200"
            disabled={busy}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="mvp-password" className="text-xs font-medium text-slate-500">
            Password
          </Label>
          <Input
            id="mvp-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="h-11 rounded-[10px] border-slate-200"
            disabled={busy}
          />
        </div>

        {error && (
          <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="mt-1 h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
          disabled={busy || !email.trim() || password.length < 8}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Only same-origin paths are honoured as a post-login destination: an absolute
 * URL (or a protocol-relative `//host`) would turn the sign-in form into an open
 * redirect.
 */
function safeReturnTo(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

/** Sign out of the MVP session and return to the storefront. */
export async function mvpSignOut(): Promise<void> {
  try {
    await getMvpApi().auth.logout();
  } catch {
    // A failed logout still clears local state below.
  }
  await refetchCurrentUser();
}
