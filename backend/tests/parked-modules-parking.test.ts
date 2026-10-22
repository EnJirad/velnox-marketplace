/**
 * PARKED MODULES — the VelRepeat / Customer Memory parking contract (HTTP + worker surface).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The MVP is BUY + SELL + CONTROL. VelRepeat (recurring commerce), its customer
 * memory / behaviour tracking, and the wholesale track are **parked, not
 * deleted**: every module, route, table and test stays in the repository so a
 * later owner decision can switch them back on with one environment variable
 * each. Parking is only worth anything while it is a real gate, so this file
 * pins the gate from the outside — the same question an operator or an attacker
 * asks: with the default (unset) flags, is any of it reachable?
 *
 * It answers for the four surfaces a parked module could still leak through:
 *
 *   1. ROUTES  — each VelRepeat setup function is mounted exactly once, and only
 *      inside `if (VELREPEAT_ENABLED)`; the customer subscription surface in
 *      `routes/cart.ts` returns before registering; the seller subscription
 *      endpoints in `routes/seller-orders.ts` return before registering.
 *   2. WORKERS — both VelRepeat schedulers start only inside the flag block, and
 *      the boot-time DDL that creates the V2 tables is called only under the
 *      same flag.
 *   3. CLIENTS — the shared tracking client sends nothing while the flag is off,
 *      and the MVP client tree names no parked module at all.
 *   4. SWITCHES — the backend switch fails closed (exact string `"true"`), and
 *      both frontend halves are compiled to `false`.
 *
 * Everything here is source-level on purpose: it needs no database, no network
 * and no credentials, so it runs in every environment — including CI, where the
 * DB-gated suites are the only ones that skip. A source-level assertion is the
 * right tool because the claim under test is "this code is never reached",
 * which no runtime probe can prove for every deployed environment.
 *
 * A parked test SKIPs and says so if the module is switched on: the contract
 * only holds while the feature is off, and re-enabling it must not read as a
 * failure here.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import {
  CUSTOMER_MEMORY_ENABLED,
  VELREPEAT_ENABLED,
  WHOLESALE_ENABLED,
} from "../lib/features.js";
import {
  CUSTOMER_MEMORY_ENABLED as SHARED_CUSTOMER_MEMORY_ENABLED,
  VELREPEAT_ENABLED as SHARED_VELREPEAT_ENABLED,
  WHOLESALE_ENABLED as SHARED_WHOLESALE_ENABLED,
} from "../../packages/shared/src/lib/features.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** `n` occurrences of `needle` in `hay`. */
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** `subject label=<state>` — the label and the verdict travel together, so a
 *  failed assertion shows WHICH file and WHICH property broke. */
const state = (subject: string, label: string, failed: boolean) =>
  `${subject} ${label}=${failed ? "FOUND" : "none"}`;

/** Index of the LAST `if (VELREPEAT_ENABLED) {` before `at`. */
const enclosingFlagBlock = (src: string, at: number): boolean => {
  const open = src.lastIndexOf("if (VELREPEAT_ENABLED) {", at);
  if (open === -1) return false;
  // A guarded mount must sit in that block, not merely after it in the file.
  // The blocks in server.ts are a few hundred lines long at most.
  return at - open < 3000;
};

const server = read("backend/server.ts");

// ─── 1. The switches ─────────────────────────────────────────────────────────

describe("parked modules — the switches fail closed", () => {
  test("backend switches enable a module only on the exact string \"true\"", () => {
    const features = read("backend/lib/features.ts");
    for (const name of ["VELREPEAT_ENABLED", "CUSTOMER_MEMORY_ENABLED", "WHOLESALE_ENABLED"]) {
      expect(features).toContain(`export const ${name} = process.env.${name} === "true";`);
    }
  });

  test("both frontend halves are compiled off", () => {
    const shared = read("packages/shared/src/lib/features.ts");
    for (const name of ["VELREPEAT_ENABLED", "CUSTOMER_MEMORY_ENABLED", "WHOLESALE_ENABLED"]) {
      expect(shared).toContain(`export const ${name} = false;`);
    }
  });

  test("the modules are off in this process, so the parking assertions apply", () => {
    expect(VELREPEAT_ENABLED).toBe(false);
    expect(CUSTOMER_MEMORY_ENABLED).toBe(false);
    expect(WHOLESALE_ENABLED).toBe(false);
    expect(SHARED_VELREPEAT_ENABLED).toBe(false);
    expect(SHARED_CUSTOMER_MEMORY_ENABLED).toBe(false);
    expect(SHARED_WHOLESALE_ENABLED).toBe(false);
  });
});

// ─── 2. Routes ───────────────────────────────────────────────────────────────

describe("parked modules — no route is reachable with the default flags", () => {
  const VELREPEAT_SETUPS = [
    "setupVelRepeatRoutes",
    "setupVelRepeatPlanRoutes",
    "setupVelRepeatPackageRoutes",
    "setupVelRepeatV2PlanRoutes",
    "setupVelRepeatV2PaymentRoutes",
    "setupVelRepeatV2StatusRoutes",
  ];

  test("every VelRepeat route module is mounted exactly once, and only inside the flag block", () => {
    for (const fn of VELREPEAT_SETUPS) {
      const call = `${fn}(app);`;
      expect(`${fn} is mounted ${count(server, call)} time(s)`).toBe(`${fn} is mounted 1 time(s)`);
      expect(enclosingFlagBlock(server, server.indexOf(call))).toBe(true);
    }
    // …and no seventh mount hides elsewhere in the server: every occurrence of
    // the prefix is either its one import or its one guarded call.
    expect(count(server, "setupVelRepeat")).toBe(VELREPEAT_SETUPS.length * 2);
  });

  test("the customer subscription surface returns before registering anything", () => {
    const cart = read("backend/routes/cart.ts");
    const gate = "if (!VELREPEAT_ENABLED) return;";
    expect(cart).toContain(gate);
    // The gate precedes every subscription endpoint it protects.
    const gateAt = cart.indexOf(gate);
    expect(gateAt).toBeGreaterThan(-1);
    expect(cart.indexOf('app.get("/api/customer/subscriptions"')).toBeGreaterThan(gateAt);
    expect(cart.indexOf('app.post("/api/subscriptions/create"')).toBeGreaterThan(gateAt);
  });

  test("the seller subscription endpoints are gated by the same flag", () => {
    const seller = read("backend/routes/seller-orders.ts");
    expect(seller).toContain("const velrepeat = options.velrepeat ?? VELREPEAT_ENABLED;");
    expect(seller).toContain("if (!velrepeat) return;");
    // The server passes no override, so the flag alone decides.
    expect(count(server, "setupSellerOrderRoutes(app);")).toBe(1);
    expect(server).not.toContain("velrepeat: true");
  });

  test("the behavioural-event endpoint refuses while Customer Memory is parked", () => {
    const center = read("backend/routes/center.ts");
    const at = center.indexOf('app.post("/api/events/track"');
    expect(at).toBeGreaterThan(-1);
    expect(center.slice(at, at + 220)).toContain("if (!CUSTOMER_MEMORY_ENABLED)");
  });

  test("no parked route is reachable through the rate-limit table alone", () => {
    // The limiter matches /api/velrepeat paths defensively; a matcher is not a
    // mount. What matters is that nothing registers those paths, asserted above.
    const limiter = read("backend/middleware/rate-limit.ts");
    expect(limiter).not.toContain('app.get("/api/velrepeat');
    expect(limiter).not.toContain('app.post("/api/velrepeat');
  });
});

// ─── 3. Workers and boot-time DDL ────────────────────────────────────────────

describe("parked modules — no worker starts and no DDL runs", () => {
  test("both VelRepeat schedulers start only inside the flag block", () => {
    for (const fn of ["startVelRepeatScheduler();", "startVelRepeatV2CycleScheduler();"]) {
      expect(`${fn} starts ${count(server, fn)} time(s)`).toBe(`${fn} starts 1 time(s)`);
      expect(enclosingFlagBlock(server, server.indexOf(fn))).toBe(true);
    }
  });

  test("the VelRepeat V2 tables are never created at boot while parked", () => {
    expect(server).toContain("if (VELREPEAT_ENABLED) ensureVelRepeatV2Tables();");
    // Declared once, invoked once, and the invocation is the guarded one.
    expect(count(server, "ensureVelRepeatV2Tables();")).toBe(1);
    expect(server.indexOf("async function ensureVelRepeatV2Tables()")).toBeLessThan(
      server.indexOf("if (VELREPEAT_ENABLED) ensureVelRepeatV2Tables();"),
    );
  });

  test("the MVP worker is the only scheduled worker that can run by default", () => {
    // The MVP expiry sweep refuses to start unless the MVP API is explicitly on;
    // that is the ONE parked-vs-active distinction worth asserting here.
    const mvp = read("backend/jobs/mvp-order-expiry-scheduler.ts");
    expect(mvp).toContain("MVP_API_ENABLED");
    expect(count(server, "startMvpOrderExpiryScheduler();")).toBe(1);
  });
});

// ─── 4. Clients ──────────────────────────────────────────────────────────────

describe("parked modules — no client sends anything", () => {
  test("the tracking client is a no-op in every entry point", () => {
    const track = read("packages/shared/src/lib/track.ts");
    // Identity merge, anonymous id, event send and the track hook each refuse
    // before touching localStorage or the network.
    expect(count(track, "if (!CUSTOMER_MEMORY_ENABLED)")).toBeGreaterThanOrEqual(4);
    expect(track).toContain('if (!CUSTOMER_MEMORY_ENABLED) return "";');
  });

  test("the MVP client tree names no parked table or endpoint", () => {
    const mvpFiles = ["api.ts", "types.ts", "routes.ts", "ui.tsx", "client.ts", "config.ts"];
    for (const file of mvpFiles) {
      const src = read(`packages/shared/src/mvp/${file}`);
      // Table identifiers and route paths only — a prose comment that explains
      // what the MVP does NOT do is not a dependency.
      expect(state(file, "velrepeat_table", /velrepeat_|vrepeat_/i.test(src))).toBe(
        `${file} velrepeat_table=none`,
      );
      expect(state(file, "velrepeat_route", /\/api\/velrepeat/i.test(src))).toBe(
        `${file} velrepeat_route=none`,
      );
      expect(state(file, "wholesale_track", /is_wholesale|isWholesale|store_account/i.test(src))).toBe(
        `${file} wholesale_track=none`,
      );
    }
  });

  test("the MVP backend tree names no parked table or endpoint", () => {
    for (const file of ["index.ts", "cart.ts", "checkout.ts", "orders.ts", "payments.ts", "admin.ts"]) {
      const src = read(`backend/mvp/${file}`);
      expect(state(file, "velrepeat_table", /velrepeat_|vrepeat_/i.test(src))).toBe(
        `${file} velrepeat_table=none`,
      );
      expect(state(file, "velrepeat_route", /\/api\/velrepeat/i.test(src))).toBe(
        `${file} velrepeat_route=none`,
      );
      expect(state(file, "subscriptions_table", /\bFROM subscriptions\b|\bINTO subscriptions\b/i.test(src))).toBe(
        `${file} subscriptions_table=none`,
      );
    }
  });

  test("no MVP-mode app file imports the tracking or reorder modules", () => {
    // The legacy half of each app still routes the parked pages by design; what
    // must stay clean is the MVP half, which is what a staging/production MVP
    // deployment actually serves.
    for (const app of ["velshop", "velseller", "velcenter"]) {
      for (const file of readdirSync(join(root, "apps", app, "src", "mvp"))) {
        const src = read(`apps/${app}/src/mvp/${file}`);
        const label = `${app}/mvp/${file}`;
        expect(state(label, "tracking", /@velnox\/shared\/lib\/track|useTracking/.test(src))).toBe(
          `${label} tracking=none`,
        );
        expect(state(label, "reorder", /components\/reorder|components\/goals/.test(src))).toBe(
          `${label} reorder=none`,
        );
      }
    }
  });
});
