/**
 * Seller-verification self-action guard.
 *
 * `PATCH /api/admin/verifications/seller/:verificationId` is the ONLY backend
 * write that sets `sellers.verification_status = 'verified'` — i.e. the only way
 * a shop earns the green V — and it is reachable by any VelCenter reviewer
 * (`owner` | `admin` | `staff` with `sellers.manage`). A reviewer can also own a
 * shop, so the approval path has to refuse the reviewer who IS the applicant,
 * otherwise an owner/admin can grant themselves the trust badge.
 *
 * These tests cover two things:
 *   1. the rule itself, exhaustively, as a pure function (no DB, no session);
 *   2. the wiring that makes it real — the endpoint must resolve ownership from
 *      the database, call the guard BEFORE the write it protects, and the badge
 *      must stay grantable from that one guarded place.
 *
 * Unit + static assertions only — no database required.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { isSelfApproval } from "../lib/verification-guard.js";

const root = join(import.meta.dir, "..", "..");
const verificationSrc = readFileSync(join(root, "backend/routes/verification.ts"), "utf8");

const REVIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";

// ─── The rule ──────────────────────────────────────────────────────────────

describe("isSelfApproval", () => {
  test("blocks an approval when the reviewer owns the shop", () => {
    expect(isSelfApproval("approve", REVIEWER, REVIEWER)).toBe(true);
  });

  test("allows approving somebody else's shop", () => {
    expect(isSelfApproval("approve", REVIEWER, OTHER_OWNER)).toBe(false);
  });

  test("only `approve` is a self-approval — the other decisions cannot grant the badge", () => {
    // reject / suspend / needs_correction can only lower the reviewer's own
    // standing. Blocking them would change behaviour with no security gain, so
    // the scope is pinned here: anything that is not exactly `approve` is not a
    // self-approval, including near-misses that a looser check would accept.
    for (const action of ["reject", "suspend", "needs_correction", "", "APPROVE", "approve ", "approved", "Approved"]) {
      expect(isSelfApproval(action, REVIEWER, REVIEWER)).toBe(false);
    }
  });

  test("an unknown owner is not a match, so legitimate approvals still work", () => {
    // seller_verifications.seller_id is a foreign key to sellers, so an
    // ownerless record cannot exist; `sellers.user_id` being unset is the real
    // case. A reviewer who cannot be shown to own the record is judged like any
    // other reviewer.
    expect(isSelfApproval("approve", REVIEWER, null)).toBe(false);
    expect(isSelfApproval("approve", REVIEWER, undefined)).toBe(false);
    expect(isSelfApproval("approve", REVIEWER, "")).toBe(false);
    // …and a missing actor id is never a match either.
    expect(isSelfApproval("approve", "", REVIEWER)).toBe(false);
    expect(isSelfApproval("approve", null, null)).toBe(false);
    expect(isSelfApproval("approve", undefined, undefined)).toBe(false);
  });

  test("ids are compared as strings, so a type change cannot silently disable it", () => {
    // Both ids arrive as UUID strings today. Coercion means a driver change
    // (number, or a wrapper object) can never turn the guard into a no-op.
    expect(isSelfApproval("approve", 42 as unknown as string, "42")).toBe(true);
    expect(isSelfApproval("approve", "42", 42 as unknown as string)).toBe(true);
    expect(isSelfApproval("approve", 42 as unknown as string, 43 as unknown as string)).toBe(false);
  });

  test("similar-but-different ids are never a match", () => {
    // A prefix, a trailing space and a one-character change are all different
    // accounts and must all be allowed through as ordinary reviews.
    expect(isSelfApproval("approve", REVIEWER, REVIEWER.slice(0, -1))).toBe(false);
    expect(isSelfApproval("approve", `${REVIEWER} `, REVIEWER)).toBe(false);
    expect(isSelfApproval("approve", REVIEWER, "11111111-1111-4111-8111-111111111112")).toBe(false);
    expect(isSelfApproval("approve", "not-a-uuid", REVIEWER)).toBe(false);
  });
});

// ─── The endpoint wiring ───────────────────────────────────────────────────

describe("the seller verification review endpoint is wired to the guard", () => {
  const routeAt = verificationSrc.indexOf('app.patch("/api/admin/verifications/seller/:verificationId"');
  const guardCall = "isSelfApproval(action, userId, ownerRes.rows[0]?.user_id)";
  const guardAt = verificationSrc.indexOf(guardCall);
  const grantAt = verificationSrc.indexOf("SET verification_status = $1");

  test("the guard predicate is imported from its single home", () => {
    expect(verificationSrc).toContain('import { isSelfApproval } from "../lib/verification-guard.js"');
  });

  test("the decision calls the guard with the request action, session user and DB owner", () => {
    expect(routeAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    // Inside the review route, not somewhere else in the file.
    expect(guardAt).toBeGreaterThan(routeAt);
  });

  test("ownership is resolved from the database, never from the request body", () => {
    expect(verificationSrc).toContain("SELECT s.user_id FROM sellers s WHERE s.id = $1");
    // The actor id is the session's — a reviewer cannot name themselves.
    expect(verificationSrc).toContain("const userId = req.user!.userId;");
    expect(verificationSrc).not.toContain("req.body.userId");
  });

  test("the guard runs BEFORE the status write it protects", () => {
    // Ordering is the whole guard: the same check placed after the UPDATE would
    // already have granted the badge.
    expect(grantAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(grantAt);
  });

  test("a refused approval rolls back and answers 403 SELF_ACTION_FORBIDDEN", () => {
    const guardBlock = verificationSrc.slice(guardAt, grantAt);
    expect(guardBlock).toContain("await client.query(\"ROLLBACK\")");
    expect(guardBlock).toContain("SELF_ACTION_FORBIDDEN");
    expect(guardBlock).toContain("status(403)");
    expect(guardBlock).toContain("return;");
  });

  test("the badge is granted from exactly one place, behind that guard", () => {
    // A literal grant would bypass the parameterised, guarded update.
    const literalGrant = /SET\s+verification_status\s*=\s*'verified'/;
    const routes = readdirSync(join(root, "backend", "routes")).filter((f) => f.endsWith(".ts"));
    const grantingFiles = routes.filter((f) => literalGrant.test(readFileSync(join(root, "backend/routes", f), "utf8")));
    expect(grantingFiles).toEqual([]);

    // The parameterised setter exists only in the guarded route. (`products.ts`
    // reading `s.verification_status = 'verified'` inside an EXISTS subquery is
    // a read, and `product-lifecycle.test.ts` already pins that split.)
    const parameterised = routes.filter((f) =>
      readFileSync(join(root, "backend/routes", f), "utf8").includes("SET verification_status = $1"),
    );
    expect(parameterised).toEqual(["verification.ts"]);
    expect(grantAt).toBeGreaterThan(0);
  });
});
