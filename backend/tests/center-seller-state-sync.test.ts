/**
 * VelCenter ⇄ VelSeller state synchronization.
 *
 * The bug this locks down: a mutation succeeded (toast said "done") while the
 * screen kept rendering the PREVIOUS body, because the shared GET cache in
 * `packages/shared/src/lib/api-routes.ts` was only invalidated by `apiPost` —
 * every `apiPatch` / `apiPut` / `apiDelete` left up to 60s of stale reads that
 * the mutation's own `refetch()` happily replayed. Turning a category off was
 * the visible case: PATCH succeeded, `loadCategories()` returned the cached
 * tree, the category stayed "open" until a reload.
 *
 * Two layers, both real:
 *   1. EXECUTED behaviour — the cache helper is driven with a stubbed `fetch`
 *      and the network calls are counted: GET is cached, a mutation (any verb)
 *      makes the next GET a real request again, and a FAILED mutation never
 *      reports success while still leaving the next read fresh.
 *   2. wiring contracts — the existing WebSocket/event chain stays the only
 *      realtime system, and every mutation that changes the current screen
 *      refetches authoritative data.
 *
 * No new socket, channel, endpoint, or mock API is introduced by any guard
 * here — the assertions fail if one appears.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const verificationSrc = read("backend/routes/verification.ts");
const sellerSrc = read("backend/routes/seller.ts");
const serverSrc = read("backend/server.ts");
const centerSrc = read("apps/velcenter/src/pages/Center.tsx");
const queueSrc = read("apps/velcenter/src/components/SellerVerificationQueue.tsx");
const categoriesSrc = read("apps/velcenter/src/components/CategoriesManagement.tsx");
const apiRoutesSrc = read("packages/shared/src/lib/api-routes.ts");
const sellerHookSrc = read("packages/shared/src/hooks/use-seller-application.ts");

/** Every `.ts`/`.tsx` under a directory (recursive), excluding build output. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ─── 1. Executed: the GET cache is invalidated by EVERY mutation verb ────────

describe("shared GET cache — a mutation must make the next read authoritative", () => {
  const calls: Array<{ method: string; url: string }> = [];
  let nextCategoryPayload: unknown = { categories: [{ id: "cat-1", is_active: true }] };
  let failNextMutation = false;

  const realFetch = globalThis.fetch;

  function installStub() {
    (globalThis as { fetch: unknown }).fetch = (async (input: unknown, init?: { method?: string }) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url: String(input) });
      if (method !== "GET" && failNextMutation) {
        return new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "nope" } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, data: nextCategoryPayload }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }

  afterAll(() => {
    (globalThis as { fetch: unknown }).fetch = realFetch;
  });

  test("GET → cached; PATCH → refetch hits the network and returns the new state", async () => {
    process.env.VITE_API_URL = "http://api.test.invalid";
    installStub();
    const { api } = await import("../../packages/shared/src/lib/api-routes.ts");

    // Warm the cache.
    const before = await api.centerAdmin.categoryList();
    expect((before as { categories: Array<{ is_active: boolean }> }).categories[0].is_active).toBe(true);
    const getsAfterFirstRead = calls.filter((c) => c.method === "GET").length;

    // A second read inside the TTL is served from memory — that is the cache's job.
    await api.centerAdmin.categoryList();
    expect(calls.filter((c) => c.method === "GET").length).toBe(getsAfterFirstRead);

    // The mutation: this used to leave the cached body in place, which is what
    // made the category tree (and the review queue) look frozen.
    nextCategoryPayload = { categories: [{ id: "cat-1", is_active: false }] };
    await api.centerAdmin.updateCategory({ categoryId: "cat-1", is_active: false });
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);

    const after = await api.centerAdmin.categoryList();
    expect(calls.filter((c) => c.method === "GET").length).toBe(getsAfterFirstRead + 1);
    // The screen now shows the server's post-mutation state, not a replay.
    expect((after as { categories: Array<{ is_active: boolean }> }).categories[0].is_active).toBe(false);
  });

  test("DELETE and PUT invalidate too — no verb is exempt", async () => {
    const beforeDelete = calls.length;
    const { api } = await import("../../packages/shared/src/lib/api-routes.ts");

    await api.centerAdmin.categoryList();
    await api.centerAdmin.deleteCategory({ categoryId: "cat-1" });
    const deletes = calls.slice(beforeDelete).filter((c) => c.method === "DELETE").length;
    expect(deletes).toBe(1);

    const getsBefore = calls.filter((c) => c.method === "GET").length;
    await api.centerAdmin.categoryList();
    expect(calls.filter((c) => c.method === "GET").length).toBe(getsBefore + 1);
  });

  test("a FAILED mutation never reports success and still leaves the next read fresh", async () => {
    const { api } = await import("../../packages/shared/src/lib/api-routes.ts");
    failNextMutation = true;

    await expect(
      api.centerAdmin.updateCategory({ categoryId: "cat-1", is_active: true }),
    ).rejects.toThrow();

    // Rejected write → the UI must reconcile against the server, so the next
    // read is a real request rather than the pre-mutation cache entry.
    failNextMutation = false;
    const getsBefore = calls.filter((c) => c.method === "GET").length;
    await api.centerAdmin.categoryList();
    expect(calls.filter((c) => c.method === "GET").length).toBe(getsBefore + 1);
  });
});

// ─── 2. Wiring contracts: cache invalidation + the event chain ──────────────

describe("the cache layer invalidates on every mutation helper", () => {
  test("apiPost / apiPut / apiPatch / apiDelete each clear the cache", () => {
    for (const helper of ["apiPost", "apiPut", "apiPatch", "apiDelete"]) {
      const start = apiRoutesSrc.indexOf(`async function ${helper}(`);
      expect(start).toBeGreaterThan(-1);
      const body = apiRoutesSrc.slice(start, start + 400);
      expect(body).toContain("invalidateGetCache()");
    }
    // …from ONE helper: no duplicate cache implementations.
    expect(countOccurrences(apiRoutesSrc, "const _getCache = new Map")).toBe(1);
    expect(countOccurrences(apiRoutesSrc, "function invalidateGetCache")).toBe(1);
  });

  test("mounted useQuery readers re-read after a mutation", () => {
    expect(apiRoutesSrc).toContain("_invalidationListeners");
    const start = apiRoutesSrc.indexOf("export function useQuery(");
    const body = apiRoutesSrc.slice(start, start + 1400);
    expect(body).toContain("_invalidationListeners.add(listener)");
    // The re-run is driven by the version bump, not by a manual refetch call.
    expect(body).toContain("[routeKeyOrFn, version]");
  });
});

describe("review + config mutations refetch authoritative data", () => {
  test("the review queue refetches after a decision and after a revoke", () => {
    expect(queueSrc).toContain('onCenterEvent("sellers"');
    for (const handler of ["handleDecision", "handleRevoke"]) {
      const start = queueSrc.indexOf(`const ${handler} = useCallback(`);
      expect(start).toBeGreaterThan(-1);
      const body = queueSrc.slice(start, start + 1500);
      expect(body).toContain("void loadVerifications()");
      // Refetch only after the API confirmed — the await comes first.
      expect(body.indexOf("await ")).toBeLessThan(body.indexOf("void loadVerifications()"));
      // …and a rejected mutation lands in the catch, never in the success path.
      expect(body).toContain("toast.error");
    }
  });

  test("every category mutation refetches the tree, and the config event re-reads it", () => {
    expect(categoriesSrc).toContain('onCenterEvent("config"');
    for (const call of [
      "api.centerAdmin.updateCategory({ categoryId: editingCategory.id, ...payload })",
      "api.centerAdmin.createCategory(payload)",
      "api.centerAdmin.deleteCategory({ categoryId: deleteConfirm.id })",
      "api.centerAdmin.updateCategory({\n        categoryId: cat.id,\n        is_active: !cat.is_active,\n      })",
    ]) {
      expect(categoriesSrc).toContain(call);
    }
    // One refetch per mutation handler (the tree is re-read, not patched locally).
    expect(countOccurrences(categoriesSrc, "void loadCategories()")).toBeGreaterThanOrEqual(5);
    // The toggle does NOT just flip local state — that was the reported symptom.
    expect(categoriesSrc).not.toContain("setCategories((prev)");
  });
});

describe("backend publishes the signals the UI listens to", () => {
  test("a reviewer decision broadcasts seller:updated after the commit", () => {
    expect(verificationSrc).toContain('broadcast(CHANNELS.SELLER_UPDATED, "seller:status-changed"');
    const start = verificationSrc.indexOf('app.patch("/api/admin/verifications/seller/:verificationId"');
    const body = verificationSrc.slice(start, start + 12000);
    expect(body.indexOf('await client.query("COMMIT")')).toBeLessThan(
      body.indexOf('broadcast(CHANNELS.SELLER_UPDATED'),
    );
  });

  test("a submitted / resubmitted application announces itself too", () => {
    // Applicant flow → VelCenter queue.
    expect(sellerSrc).toContain('broadcast(CHANNELS.SELLER_UPDATED, "seller:status-changed"');
    expect(sellerSrc).toContain('previousStatus === "none" ? "submitted" : "resubmitted"');
    // Verification submit (MyShop) → same channel, and the history action is the
    // real one so a resubmission can never be counted as a first submission.
    expect(verificationSrc).toContain('broadcast(CHANNELS.SELLER_UPDATED, "seller:status-changed"');
    expect(verificationSrc).toContain('priorRes.rows[0]?.has_prior ? "resubmitted" : "submitted"');
  });

  test("config changes are announced from the one choke point, on success only", () => {
    expect(serverSrc).toContain('broadcast(CHANNELS.CONFIG_UPDATED, "config:updated"');
    const start = serverSrc.indexOf("const CONFIG_SCOPES");
    const body = serverSrc.slice(start, start + 1400);
    expect(body).toContain('["/api/admin/categories", "categories"]');
    expect(body).toContain('["/api/admin/settings", "settings"]');
    // Failed writes publish nothing.
    expect(body).toContain("if (res.statusCode >= 200 && res.statusCode < 300)");
  });
});

describe("VelCenter keeps ONE socket and fans events out to refetches", () => {
  test("the Center page owns the socket and maps events to queue refetches", () => {
    expect(centerSrc).toContain('ws?.send(JSON.stringify({ type: "subscribe", channel: "seller:updated" }))');
    expect(centerSrc).toContain('ws?.send(JSON.stringify({ type: "subscribe", channel: "config:updated" }))');
    expect(centerSrc).toContain('msg.type === "seller:status-changed" || msg.type === "verification:status-changed"');
    expect(centerSrc).toContain('emitCenterEvent("sellers")');
    expect(centerSrc).toContain('emitCenterEvent("config")');
    // The event is a signal: the page re-reads, it does not render the payload.
    expect(centerSrc).toContain("void reloadVerifications();");
    expect(centerSrc).toContain("void reloadSellers();");
  });

  test("VelCenter opens exactly one WebSocket, in the Center page", () => {
    let sockets = 0;
    for (const file of sourceFiles("apps/velcenter/src")) {
      sockets += countOccurrences(read(file), "new WebSocket(");
    }
    expect(sockets).toBe(1);
    expect(countOccurrences(centerSrc, "new WebSocket(")).toBe(1);
  });
});

describe("VelSeller listens on the existing per-user channel", () => {
  test("a reviewer decision reaches an open seller session without a new socket", () => {
    expect(sellerHookSrc).toContain('onChatEvent("notification:created"');
    expect(sellerHookSrc).toContain("connectChatSocket(userId)");
    expect(sellerHookSrc).toContain('type.startsWith("seller")');
    expect(sellerHookSrc).toContain("void refetch()");
    // Reuses the shared module — no second connection implementation.
    expect(sellerHookSrc).not.toContain("new WebSocket(");
  });

  test("the seller app never opens its own socket", () => {
    let sockets = 0;
    for (const file of sourceFiles("apps/velseller/src")) {
      sockets += countOccurrences(read(file), "new WebSocket(");
    }
    expect(sockets).toBe(0);
  });

  test("the chat socket module stays the only client connection factory", () => {
    const chatSrc = read("packages/shared/src/lib/chat-socket.ts");
    expect(countOccurrences(chatSrc, "new WebSocket(")).toBe(1);
    expect(chatSrc).toContain("`user:${socketUserId}`");
  });
});
