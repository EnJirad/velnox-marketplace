/**
 * Realtime WebSocket & Presence HTTP Endpoints
 * Cloudflare Workers Hono routes with Durable Object coordination.
 */

import { Hono } from "hono";
import { parseCookies } from "../core/security/cookies.js";
import { verifyJwt } from "../core/security/jwt.js";
import { RealtimeHubDO } from "../realtime/realtime-hub-do.js";
import type { Bindings, Variables } from "../types.js";
import { SESSION_COOKIE_NAME } from "@velnox/config";

export const realtimeRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Fallback in-process RealtimeHubDO for tests or development environments without DO binding
let inProcessHubInstance: RealtimeHubDO | null = null;

export function getInProcessRealtimeHub(env: Bindings): RealtimeHubDO {
  if (!inProcessHubInstance) {
    inProcessHubInstance = new RealtimeHubDO(null, env);
  }
  return inProcessHubInstance;
}

export function setTestRealtimeHub(hub: RealtimeHubDO | null) {
  inProcessHubInstance = hub;
}

/**
 * Helper to extract user identity from WebSocket upgrade request (Cookie, Query, or Bearer)
 */
async function resolveWebSocketUser(
  req: Request,
  jwtSecret: string,
): Promise<{ userId: string; role: string }> {
  const url = new URL(req.url);

  // 1. Check Query parameter (?token=...)
  let token = url.searchParams.get("token");

  // 2. Check Cookie (velnox_session=...)
  if (!token) {
    const cookies = parseCookies(req.headers.get("Cookie"));
    token = cookies[SESSION_COOKIE_NAME] || null;
  }

  // 3. Check Authorization header
  if (!token) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
  }

  if (token) {
    try {
      const payload = await verifyJwt(token, jwtSecret);
      return { userId: payload.sub, role: payload.role || "customer" };
    } catch {
      // Invalid token falls back to anonymous
    }
  }

  return { userId: "anonymous", role: "customer" };
}

/**
 * GET /ws or /api/v1/realtime/ws — WebSocket Connection Upgrade
 */
async function handleWebSocketRequest(c: any): Promise<Response> {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  const secret = c.env?.JWT_SECRET || "velnox-default-development-jwt-secret-at-least-32-chars";
  const { userId, role } = await resolveWebSocketUser(c.req.raw, secret);

  // If Cloudflare Durable Object binding is available, delegate to it
  if (c.env?.REALTIME_HUB) {
    const id = c.env.REALTIME_HUB.idFromName("global-hub");
    const stub = c.env.REALTIME_HUB.get(id);

    const targetUrl = new URL(c.req.url);
    targetUrl.searchParams.set("userId", userId);
    targetUrl.searchParams.set("role", role);

    return stub.fetch(new Request(targetUrl.toString(), c.req.raw));
  }

  // Fallback to in-process hub for local test runs
  const fallbackHub = getInProcessRealtimeHub(c.env || {});
  const targetUrl = new URL(c.req.url);
  targetUrl.searchParams.set("userId", userId);
  targetUrl.searchParams.set("role", role);

  return fallbackHub.fetch(new Request(targetUrl.toString(), c.req.raw));
}

realtimeRoutes.get("/ws", handleWebSocketRequest);

/**
 * POST /api/v1/realtime/publish — Internal Event Broadcast
 */
realtimeRoutes.post("/publish", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  if (!body || !body.type) {
    return c.json({ success: false, error: "Missing type in body" }, 400);
  }

  if (c.env?.REALTIME_HUB) {
    const id = c.env.REALTIME_HUB.idFromName("global-hub");
    const stub = c.env.REALTIME_HUB.get(id);
    const res = await stub.fetch("http://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    return c.json(data);
  }

  const fallbackHub = getInProcessRealtimeHub(c.env || {});
  const res = await fallbackHub.fetch(
    new Request("http://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const data = (await res.json()) as any;
  return c.json(data);
});

/**
 * GET /api/v1/realtime/presence/:userId — Multi-tab Presence Query
 */
realtimeRoutes.get("/presence/:userId", async (c) => {
  const userId = c.req.param("userId");

  if (c.env?.REALTIME_HUB) {
    const id = c.env.REALTIME_HUB.idFromName("global-hub");
    const stub = c.env.REALTIME_HUB.get(id);
    const res = await stub.fetch(`http://internal/presence/${userId}`);
    const data = (await res.json()) as any;
    return c.json({ success: true, data });
  }

  const fallbackHub = getInProcessRealtimeHub(c.env || {});
  const res = await fallbackHub.fetch(new Request(`http://internal/presence/${userId}`));
  const data = (await res.json()) as any;
  return c.json({ success: true, data });
});
