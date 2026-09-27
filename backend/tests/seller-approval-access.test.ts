/**
 * Approving a seller application — ONE decision, one authoritative state.
 *
 * Two VelCenter buttons decide the same application (the verification queue's
 * Approve and the seller-status Approve), and the application, its verification
 * record and its identity documents all come from one submission
 * (`POST /api/seller/apply`). They used to write different halves of the state:
 *
 *   verification queue approve → seller_verifications='verified',
 *                                sellers.verification_status='verified'
 *                                … and `sellers.status` left at 'pending'
 *   seller status approve      → sellers.status='approved'
 *                                … and the verification record left 'pending'
 *
 * So a seller the reviewer had approved still got `status: "pending"` from
 * `GET /api/seller/status` (RequireRole rendered the "1-3 business days" screen
 * and `sellerAccess` stayed false), and the pending-review badge kept counting
 * them. These tests drive the REAL routes over a real (disposable) PostgreSQL and
 * assert what the database, the applicant-visible API and the reviewer counters
 * say afterwards — nothing is mocked, and `sellerAccess` is never faked.
 *
 * DB-gated — skipped unless `TEST_DATABASE_URL` points at a validated test
 * database AND `JWT_SECRET` is set. Fixtures use a random marker and are removed
 * in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { join } from "path";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { setupCenterRoutes } from "../routes/center.js";
import { setupSellerRoutes } from "../routes/seller.js";
import { registerVerificationRoutes } from "../routes/verification.js";
import { isSellerApproved, shouldShowSellerTab } from "../../packages/shared/src/lib/seller-access.ts";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("seller approval → access (needs a test database + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  let marker = "";
  let ownerId = "";
  let ownerEmail = "";
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupSellerRoutes(app);
    registerVerificationRoutes(app);
    setupCenterRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (!hasDb) return;
    marker = `approve-${crypto.randomUUID().slice(0, 8)}`;

    const owner = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'owner') RETURNING id",
      [`${marker}-owner@test.invalid`, "Approval Owner"],
    );
    ownerId = owner.rows[0].id as string;
    ownerEmail = `${marker}-owner@test.invalid`;
    createdUserIds.push(ownerId);
  });

  afterAll(async () => {
    if (hasDb && createdUserIds.length > 0) {
      await query("DELETE FROM media WHERE uploaded_by = ANY($1::uuid[])", [createdUserIds]);
      await purgeUsers(createdUserIds);
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  function cookie(userId: string, email: string): string {
    const token = jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "5m" });
    return `velnox_session=${token}`;
  }

  const ownerCookie = () => cookie(ownerId, ownerEmail);

  /** A real applicant: user + pending seller + pending verification + owned evidence. */
  async function seedApplicant(options: { sellerStatus?: string; verificationStatus?: string } = {}) {
    const email = `${marker}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const user = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [email, "Approval Applicant"],
    );
    const userId = user.rows[0].id as string;
    createdUserIds.push(userId);

    const seller = await query(
      `INSERT INTO sellers (user_id, status, verification_status)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, options.sellerStatus ?? "pending", options.verificationStatus ?? "pending"],
    );
    const sellerId = seller.rows[0].id as string;

    const key = `verification/evidence/${userId}/id_card_${Date.now()}_${crypto.randomUUID().slice(0, 4)}.jpg`;
    await query(
      `INSERT INTO media (url, key, content_type, size, uploaded_by)
       VALUES ($1, $2, 'image/jpeg', 2048, $3)`,
      [`https://cdn.example.invalid/${key}`, key, userId],
    );

    await query(
      `INSERT INTO seller_verifications (seller_id, status, verification_type, evidence_urls, submitted_at)
       VALUES ($1, $2, 'identity', $3::jsonb, NOW())`,
      [sellerId, options.verificationStatus ?? "pending", JSON.stringify([key])],
    );
    await query(
      `INSERT INTO seller_review_history (seller_id, previous_status, new_status, action, reviewer_id)
       VALUES ($1, 'none', 'pending', 'submitted', $2)`,
      [sellerId, userId],
    );

    return { userId, email, sellerId, key };
  }

  interface Applicant {
    userId: string;
    email: string;
    sellerId: string;
    key: string;
  }

  /** The reviewer decision the VelCenter verification queue performs. */
  async function reviewVerification(sellerId: string, action: string, extra: Record<string, unknown> = {}) {
    const ver = await query(
      "SELECT id FROM seller_verifications WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1",
      [sellerId],
    );
    expect(ver.rows.length).toBe(1);
    return fetch(`${base}/api/admin/verifications/seller/${ver.rows[0].id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie() },
      body: JSON.stringify({ action, ...extra }),
    });
  }

  /** The reviewer decision the VelCenter Sellers tab performs. */
  function setSellerStatus(sellerId: string, status: string, extra: Record<string, unknown> = {}) {
    return fetch(`${base}/api/admin/sellers/${sellerId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie() },
      body: JSON.stringify({ status, ...extra }),
    });
  }

  async function statusOf(applicant: Applicant) {
    const res = await fetch(`${base}/api/seller/status`, {
      headers: { Cookie: cookie(applicant.userId, applicant.email) },
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<{ sellerAccess: boolean; data: { status: string } | null }>;
  }

  function sellerProfile(applicant: Applicant) {
    return fetch(`${base}/api/seller/profile`, {
      headers: { Cookie: cookie(applicant.userId, applicant.email) },
    });
  }

  async function counts() {
    const res = await fetch(`${base}/api/admin/dashboard/counts`, { headers: { Cookie: ownerCookie() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    return body.data as {
      pendingSellers: number;
      underReviewSellers: number;
      pendingReviewSellers: number;
      pendingVerifications: number;
    };
  }

  /**
   * The badge predicate, evaluated on this suite's own fixtures only (the list
   * search is server-side, so another suite's rows can never move these
   * numbers).
   */
  async function reviewerWorkStatus(sellerId: string): Promise<string | undefined> {
    const res = await fetch(
      `${base}/api/admin/sellers?status=all&limit=100&q=${encodeURIComponent(marker)}`,
      { headers: { Cookie: ownerCookie() } },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()).data.sellers as Array<{ id: string; status: string }>;
    return rows.find((r) => r.id === sellerId)?.status;
  }

  // ── Case A + D: pending applicant ─────────────────────────────────────────
  itDb("PENDING: no seller access, protected seller API refused, counted as reviewer work", async () => {
    const before = await counts();
    const applicant = await seedApplicant();

    const status = await statusOf(applicant);
    expect(status.data?.status).toBe("pending");
    expect(status.sellerAccess).toBe(false);
    // The shared rule the tab bar uses, driven by the SERVER's verdict.
    expect(shouldShowSellerTab({ sellerAccess: status.sellerAccess, loading: false, error: null })).toBe(false);

    const profile = await sellerProfile(applicant);
    expect(profile.status).toBe(403);
    expect((await profile.json()).error.code).toBe("SELLER_NOT_APPROVED");

    const now = await counts();
    expect(now.pendingSellers).toBe(before.pendingSellers + 1);
    expect(now.pendingReviewSellers).toBeGreaterThanOrEqual(before.pendingReviewSellers + 1);
    // The badge counter is exactly the two statuses that still need a decision —
    // read from ONE response, so the identity cannot drift between reads.
    expect(now.pendingReviewSellers).toBe(now.pendingSellers + now.underReviewSellers);
    expect(await reviewerWorkStatus(applicant.sellerId)).toBe("pending");
  });

  // ── Case B + C + G: approve in the verification queue ─────────────────────
  itDb("verification-queue APPROVE approves the ACCOUNT: access on, badge excludes it, workspace reachable", async () => {
    const applicant = await seedApplicant();
    const before = await counts();

    const res = await reviewVerification(applicant.sellerId, "approve");
    expect(res.status).toBe(200);

    // ── Database: both halves of the one decision ──────────────────────────
    const seller = await query(
      "SELECT status, verification_status, verified_at FROM sellers WHERE id = $1",
      [applicant.sellerId],
    );
    expect(seller.rows[0].status).toBe("approved");
    expect(seller.rows[0].verification_status).toBe("verified");
    expect(seller.rows[0].verified_at).not.toBeNull();

    const verification = await query("SELECT status, reviewed_at FROM seller_verifications WHERE seller_id = $1", [
      applicant.sellerId,
    ]);
    expect(verification.rows[0].status).toBe("verified");
    expect(verification.rows[0].reviewed_at).not.toBeNull();

    const user = await query("SELECT role FROM users WHERE id = $1", [applicant.userId]);
    expect(user.rows[0].role).toBe("seller");

    // ── Applicant-visible status: approved + access, no pending screen ─────
    const status = await statusOf(applicant);
    expect(status.data?.status).toBe("approved");
    expect(status.sellerAccess).toBe(true);
    expect(isSellerApproved(status.data?.status)).toBe(true);
    expect(shouldShowSellerTab({ sellerAccess: status.sellerAccess, loading: false, error: null })).toBe(true);

    // The seller workspace is REACHABLE (the guard is what the gates use).
    const profile = await sellerProfile(applicant);
    expect(profile.status).toBe(200);

    // ── Reviewer counters: approved is not reviewer work ───────────────────
    const after = await counts();
    expect(after.pendingSellers).toBe(before.pendingSellers - 1);
    expect(after.pendingReviewSellers).toBe(before.pendingReviewSellers - 1);
    expect(after.pendingVerifications).toBe(before.pendingVerifications - 1);
    expect(after.pendingReviewSellers).toBe(after.pendingSellers + after.underReviewSellers);
    expect(await reviewerWorkStatus(applicant.sellerId)).toBe("approved");

    // The badge number IS the database count — no cached or derived figure.
    const direct = await query("SELECT COUNT(*)::int AS c FROM sellers WHERE status IN ('pending','under_review')");
    expect(after.pendingReviewSellers).toBe(direct.rows[0].c);
  });

  itDb("the approved seller is gone from the pending verification queue", async () => {
    const applicant = await seedApplicant();
    await reviewVerification(applicant.sellerId, "approve");

    const res = await fetch(
      `${base}/api/admin/verifications?status=pending&limit=100&q=${encodeURIComponent(marker)}`,
      { headers: { Cookie: ownerCookie() } },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()).data.sellers as Array<{ seller_id: string }>;
    expect(rows.some((r) => r.seller_id === applicant.sellerId)).toBe(false);
  });

  // ── Case E + F: revision / rejected stay locked out ──────────────────────
  itDb("REVISION_REQUIRED (needs_correction) and REJECTED keep seller access off", async () => {
    const revision = await seedApplicant();
    // The account state machine only allows a correction from review.
    expect((await setSellerStatus(revision.sellerId, "under_review")).status).toBe(200);
    const correction = await setSellerStatus(revision.sellerId, "needs_correction", {
      reasonCode: "id_card_unclear",
      reason: "Please re-shoot the card",
    });
    expect(correction.status).toBe(200);

    const revisionStatus = await statusOf(revision);
    expect(revisionStatus.data?.status).toBe("needs_correction");
    expect(revisionStatus.sellerAccess).toBe(false);
    expect((await sellerProfile(revision)).status).toBe(403);

    const rejected = await seedApplicant();
    const rejection = await setSellerStatus(rejected.sellerId, "rejected", {
      reasonCode: "applicant_mismatch",
      reason: "Documents do not match",
    });
    expect(rejection.status).toBe(200);

    const rejectedStatus = await statusOf(rejected);
    expect(rejectedStatus.data?.status).toBe("rejected");
    expect(rejectedStatus.sellerAccess).toBe(false);
    expect((await sellerProfile(rejected)).status).toBe(403);
  });

  itDb("a suspended account cannot be approved through the verification queue", async () => {
    const applicant = await seedApplicant({ sellerStatus: "suspended", verificationStatus: "pending" });

    const res = await reviewVerification(applicant.sellerId, "approve");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_TRANSITION");

    // Refused before any write: nothing half-approved.
    const seller = await query("SELECT status, verification_status FROM sellers WHERE id = $1", [
      applicant.sellerId,
    ]);
    expect(seller.rows[0].status).toBe("suspended");
    expect(seller.rows[0].verification_status).toBe("pending");
    expect((await statusOf(applicant)).sellerAccess).toBe(false);
  });

  // ── The other button must reach the same state ───────────────────────────
  itDb("seller-status APPROVE also resolves the verification record (no stuck pending row)", async () => {
    const applicant = await seedApplicant();
    // The account path only allows `under_review → approved`.
    expect((await setSellerStatus(applicant.sellerId, "under_review")).status).toBe(200);
    const before = await counts();

    const res = await setSellerStatus(applicant.sellerId, "approved");
    expect(res.status).toBe(200);

    const verification = await query("SELECT status, reviewed_at FROM seller_verifications WHERE seller_id = $1", [
      applicant.sellerId,
    ]);
    expect(verification.rows[0].status).toBe("verified");
    expect(verification.rows[0].reviewed_at).not.toBeNull();

    const seller = await query("SELECT status, verification_status, verified_at FROM sellers WHERE id = $1", [
      applicant.sellerId,
    ]);
    expect(seller.rows[0].status).toBe("approved");
    expect(seller.rows[0].verification_status).toBe("verified");
    expect(seller.rows[0].verified_at).not.toBeNull();

    const status = await statusOf(applicant);
    expect(status.data?.status).toBe("approved");
    expect(status.sellerAccess).toBe(true);

    const after = await counts();
    expect(after.pendingVerifications).toBe(before.pendingVerifications - 1);
    expect(await reviewerWorkStatus(applicant.sellerId)).toBe("approved");

    // The verification queue no longer offers a decision a reviewer already made.
    const queueRes = await fetch(
      `${base}/api/admin/verifications?status=pending&limit=100&q=${encodeURIComponent(marker)}`,
      { headers: { Cookie: ownerCookie() } },
    );
    const queueRows = (await queueRes.json()).data.sellers as Array<{ seller_id: string }>;
    expect(queueRows.some((r) => r.seller_id === applicant.sellerId)).toBe(false);
  });

  // ── The badge count is a database count with reviewer-work semantics ─────
  itDb("the reviewer-work count excludes approved / rejected / needs_correction sellers", async () => {
    const before = await counts();

    const approved = await seedApplicant();
    await reviewVerification(approved.sellerId, "approve");

    const rejected = await seedApplicant();
    await setSellerStatus(rejected.sellerId, "rejected", { reasonCode: "policy_violation", reason: "Policy" });

    const correction = await seedApplicant();
    await setSellerStatus(correction.sellerId, "under_review");
    await setSellerStatus(correction.sellerId, "needs_correction", {
      reasonCode: "contact_incomplete",
      reason: "Add a phone number",
    });

    const underReview = await seedApplicant();
    await setSellerStatus(underReview.sellerId, "under_review");

    const after = await counts();
    // Only `under_review` (still waiting for a decision) is new reviewer work:
    // the approved / rejected / corrected fixtures did not add to the badge.
    expect(after.pendingReviewSellers).toBe(before.pendingReviewSellers + 1);
    expect(after.pendingSellers + after.underReviewSellers).toBe(after.pendingReviewSellers);
    for (const [fixture, expected] of [
      [approved.sellerId, "approved"],
      [rejected.sellerId, "rejected"],
      [correction.sellerId, "needs_correction"],
      [underReview.sellerId, "under_review"],
    ] as const) {
      expect(await reviewerWorkStatus(fixture)).toBe(expected);
    }
  });
});

// ── Always-on wiring contracts (no database) ────────────────────────────────
describe("the badge is event-driven, never decremented by hand", () => {
  const read = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", rel), "utf8");

  test("the Center badge reads the server's reviewer-work count", async () => {
    const center = await read("apps/velcenter/src/pages/Center.tsx");
    expect(center).toContain("counts?.pendingReviewSellers");
    // The old per-queue read (status=pending) is gone from the badge path…
    expect(center).not.toContain('sellerListAction({ status: "pending"');
    // …and no local decrement is used anywhere.
    expect(center).not.toContain("pendingSellers - 1");
    expect(center).not.toContain("setPendingSellers((prev");
  });

  test("a reviewer decision raises the shared event; the page and the queue both re-read", async () => {
    const queue = await read("apps/velcenter/src/components/SellerVerificationQueue.tsx");
    // Emitted once per confirmed decision — and only after the API said so.
    expect(queue.split('emitCenterEvent("sellers")').length - 1).toBe(2);
    expect(queue).toContain('onCenterEvent("sellers"');
    // No local state flip: the row list is always re-read from the API.
    expect(queue).not.toContain("setRows((prev)");

    const center = await read("apps/velcenter/src/pages/Center.tsx");
    expect(center).toContain('onCenterEvent("sellers"');
    expect(center).toContain("void reloadSellers();");
  });

  test("approval pushes the seller's own channel so VelSeller re-reads its status", async () => {
    const verification = await read("backend/routes/verification.ts");
    expect(verification).toContain("sendToUser(targetUserId, \"\", CHANNELS.NOTIFICATION_CREATED");
    // The applicant-facing payload carries no access flag — the status API decides.
    expect(verification).toContain('res.json({ success: true, data: verRes.rows[0] });');
  });
});
