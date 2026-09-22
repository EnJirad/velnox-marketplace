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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { join } from "path";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { isSelfApproval } from "../lib/verification-guard.js";
import { registerVerificationRoutes } from "../routes/verification.js";

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

// ─── Integration: the real endpoint over HTTP ──────────────────────────────
//
// The assertions above prove the guard is *written*; only a live request proves
// it *fires*. This block boots the real route on a throwaway HTTP listener,
// signs real session cookies for two VelCenter admins — one of whom owns the
// shop under review — and drives `PATCH /api/admin/verifications/seller/:id`,
// so the 403 comes from the same code path production runs, not a copy of it.
//
// The fixtures are built so that EVERY other precondition for an approval is
// satisfied (the reviewer holds `sellers.manage`, the verification is `pending`
// and carries evidence). A 403 here can therefore only come from the
// self-approval rule, and the second case is the negative control that proves
// it: the identical request from a reviewer who does NOT own the shop succeeds.
//
// Skipped without DATABASE_URL + JWT_SECRET (no database in the sandbox).
// Fixtures use a random suffix and are removed in afterAll, so re-running
// against the same database cannot collide — unlike the fixed-email seeds the
// handoff lists as a known gap.

const hasDb = Boolean(process.env.DATABASE_URL && process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("PATCH /api/admin/verifications/seller/:id over HTTP (needs DATABASE_URL + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  let ownerId = ""; // admin who ALSO owns the shop under review
  let otherReviewerId = ""; // admin with no stake in it
  let sellerId = "";
  let verificationId = "";

  beforeAll(async () => {
    // The listener needs no database, so it always starts: that keeps the
    // harness itself under test here rather than only where a DB exists.
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    registerVerificationRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (!hasDb) return;

    const suffix = crypto.randomUUID().slice(0, 8);
    const owner = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'admin') RETURNING id",
      [`self-approval-owner-${suffix}@test.invalid`, "Owner Reviewer"],
    );
    ownerId = owner.rows[0].id;
    const other = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'admin') RETURNING id",
      [`self-approval-other-${suffix}@test.invalid`, "Other Reviewer"],
    );
    otherReviewerId = other.rows[0].id;

    // `owner` / `admin` hold every code in the catalog, so `sellers.manage` is
    // satisfied without an `employees` row (see lib/permissions.ts).
    const seller = await query(
      "INSERT INTO sellers (user_id, status, verification_status) VALUES ($1, 'under_review', 'pending') RETURNING id",
      [ownerId],
    );
    sellerId = seller.rows[0].id;

    // `pending` is a permitted source state and the evidence list is non-empty,
    // so the approve path's own state machine is satisfied too.
    const verification = await query(
      `INSERT INTO seller_verifications (seller_id, status, evidence_urls, submitted_at)
       VALUES ($1, 'pending', $2::jsonb, NOW()) RETURNING id`,
      [sellerId, JSON.stringify([`verification/evidence/${ownerId}/id-card.jpg`])],
    );
    verificationId = verification.rows[0].id;
  });

  afterAll(async () => {
    if (hasDb && ownerId) {
      // `users` cascades to sellers → verifications / review history / seller
      // notifications. audit_logs is ON DELETE SET NULL, so clear it first.
      await query("DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])", [[ownerId, otherReviewerId]]);
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ownerId, otherReviewerId]]);
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  // No `jti` → `requireAuth` skips the revocation lookup, which would otherwise
  // need a `revoked_tokens` round trip.
  function sessionCookie(userId: string): string {
    const token = jwt.sign({ userId, email: `${userId}@test.invalid` }, process.env.JWT_SECRET!, { expiresIn: "5m" });
    return `velnox_session=${token}`;
  }

  function approveAs(userId: string): Promise<Response> {
    return fetch(`${base}/api/admin/verifications/seller/${verificationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sessionCookie(userId) },
      body: JSON.stringify({ action: "approve" }),
    });
  }

  test("reaches the real route: no session cookie is rejected before any review logic", async () => {
    // Runs without DATABASE_URL. It proves the harness is driving the actual
    // registered handler — a 401 from `requireAuth` can only come from inside
    // the route — so the cases below fail for review reasons, not plumbing ones.
    const res = await fetch(`${base}/api/admin/verifications/seller/${crypto.randomUUID()}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  itDb("returns 403 SELF_ACTION_FORBIDDEN for the admin who owns the shop, and writes nothing", async () => {
    const res = await approveAs(ownerId);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SELF_ACTION_FORBIDDEN");

    // The guard ROLLBACKs before any statement runs, so neither the verification
    // nor the seller may show a trace of the refused decision.
    const ver = await query("SELECT status, reviewed_by FROM seller_verifications WHERE id = $1", [verificationId]);
    expect(ver.rows[0].status).toBe("pending");
    expect(ver.rows[0].reviewed_by).toBeNull();
    const seller = await query("SELECT verification_status, verified_at FROM sellers WHERE id = $1", [sellerId]);
    expect(seller.rows[0].verification_status).toBe("pending");
    expect(seller.rows[0].verified_at).toBeNull();
    const history = await query("SELECT id FROM seller_review_history WHERE seller_id = $1", [sellerId]);
    expect(history.rows.length).toBe(0);
  });

  itDb("still approves the same verification for a reviewer who does not own it", async () => {
    // Negative control. Without it, a 403 caused by a broken fixture (a role that
    // cannot review at all, an empty evidence list) would look like a pass.
    const res = await approveAs(otherReviewerId);
    expect(res.status).toBe(200);

    const seller = await query("SELECT verification_status, verified_at FROM sellers WHERE id = $1", [sellerId]);
    expect(seller.rows[0].verification_status).toBe("verified");
    expect(seller.rows[0].verified_at).not.toBeNull();

    const ver = await query("SELECT status, reviewed_by FROM seller_verifications WHERE id = $1", [verificationId]);
    expect(ver.rows[0].status).toBe("verified");
    expect(ver.rows[0].reviewed_by).toBe(otherReviewerId);

    const history = await query("SELECT action, reviewer_id FROM seller_review_history WHERE seller_id = $1", [sellerId]);
    expect(history.rows.length).toBe(1);
    expect(history.rows[0].action).toBe("approved");
    expect(history.rows[0].reviewer_id).toBe(otherReviewerId);
  });
});
