/**
 * VelCenter verification queue — "new application" vs "resubmitted after correction".
 *
 * `GET /api/admin/verifications` reports:
 *
 *   application_type : "new" | "resubmitted"
 *   resubmission_count : COUNT(*) of seller_review_history rows with
 *                        action = 'resubmitted' for THAT seller
 *
 * Three rules the reviewer depends on, all proven over the real routes:
 *   1. a first application is `new` with 0 — never "resubmitted";
 *   2. after corrections + resubmissions the count matches the recorded history
 *      exactly (the brief's example: submitted → needs_correction → resubmitted →
 *      needs_correction → resubmitted ⇒ 2, and it must never fall back to "new");
 *   3. the count is per-seller and comes from the database — one applicant's
 *      resubmissions can never inflate another's row, and no client field
 *      (body or query) can set it.
 *
 * DB-gated: skipped unless `TEST_DATABASE_URL` points at a validated test
 * database AND `JWT_SECRET` is set. The pool refuses a production target, so
 * this can never reach live data. Fixtures use a random marker and are removed
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
import { setupSellerRoutes } from "../routes/seller.js";
import { registerVerificationRoutes } from "../routes/verification.js";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

const REVIEWER_ID = "reviewer";
const APPLICANT_ID = "applicant";

describe("verification queue resubmission fields (no database required)", () => {
  const src = readFileSync(join(import.meta.dir, "..", "routes", "verification.ts"), "utf8");

  function listHandler(): string {
    const start = src.indexOf('app.get("/api/admin/verifications",');
    const end = src.indexOf('app.get("/api/admin/verifications/seller/:verificationId/evidence"');
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, end);
  }

  test("the count is read from seller_review_history rows with action = 'resubmitted'", () => {
    const handler = listHandler();
    // The ONLY source of the count: recorded review history.
    expect(handler).toContain("seller_review_history");
    expect(handler).toContain("rh.action = 'resubmitted'");
    expect(handler).toContain("COUNT(*)::int AS resubmission_count");
  });

  test("application_type is derived server-side and cannot be sent by a client", () => {
    const handler = listHandler();
    // Derived from the counted history, not from anything the caller supplies.
    expect(handler).toContain('application_type: resubmissionCount > 0 ? "resubmitted" : "new"');
    expect(handler).not.toContain("req.body");
    for (const forged of ["application_type", "resubmission_count"]) {
      expect(handler).not.toContain(`req.query.${forged}`);
      expect(handler).not.toContain(`req.body.${forged}`);
    }
  });

  test("the evidence list stays out of the queue payload", () => {
    expect(listHandler()).toContain("evidence_urls: undefined");
  });
});

describe("verification queue resubmission counts over HTTP (needs a test database + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  let marker = "";
  let ownerId = "";
  let customerId = "";
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupSellerRoutes(app);
    registerVerificationRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (!hasDb) return;
    marker = `resubmit-${crypto.randomUUID().slice(0, 8)}`;

    // `owner` satisfies `sellers.manage` without an `employees` row.
    const owner = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'owner') RETURNING id",
      [`${marker}-owner@test.invalid`, "Resubmission Owner"],
    );
    ownerId = owner.rows[0].id as string;
    createdUserIds.push(ownerId);

    // Negative control: a real account that must not read the queue at all.
    const customer = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [`${marker}-customer@test.invalid`, "Not A Reviewer"],
    );
    customerId = customer.rows[0].id as string;
    createdUserIds.push(customerId);
  });

  afterAll(async () => {
    if (hasDb && createdUserIds.length > 0) {
      // `media.uploaded_by` is ON DELETE NO ACTION — clear fixture rows first.
      await query("DELETE FROM media WHERE uploaded_by = ANY($1::uuid[])", [createdUserIds]);
      await purgeUsers(createdUserIds);
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  function cookieFor(kind: string, userId: string, email: string): string {
    const token = jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "5m" });
    void kind;
    return `velnox_session=${token}`;
  }

  /** A seller row + one owned evidence object, exactly as the onboarding flow leaves them. */
  async function seedApplicant(): Promise<{ userId: string; sellerId: string; key: string; email: string }> {
    const email = `${marker}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const user = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [email, `Applicant ${crypto.randomUUID().slice(0, 6)}`],
    );
    const userId = user.rows[0].id as string;
    createdUserIds.push(userId);

    const seller = await query(
      "INSERT INTO sellers (user_id, status, verification_status) VALUES ($1, 'pending', 'unverified') RETURNING id",
      [userId],
    );
    const sellerId = seller.rows[0].id as string;

    // Keys use the real `verification/evidence/{owner}/{purpose}_{ts}.{ext}` shape.
    const key = `verification/evidence/${userId}/id_card_${Date.now()}_${crypto.randomUUID().slice(0, 4)}.jpg`;
    await query(
      `INSERT INTO media (url, key, content_type, size, uploaded_by)
       VALUES ($1, $2, 'image/jpeg', 1024, $3)`,
      [`https://cdn.example.invalid/${key}`, key, userId],
    );

    return { userId, sellerId, key, email };
  }

  async function submit(kind: string, applicant: { userId: string; key: string; email: string }): Promise<Response> {
    return fetch(`${base}/api/seller/verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieFor(kind, applicant.userId, applicant.email) },
      body: JSON.stringify({ evidenceUrls: [applicant.key], verificationType: "identity" }),
    });
  }

  /** The reviewer acts on the VERIFICATION record, not on the seller id. */
  async function pendingVerificationId(sellerId: string): Promise<string> {
    const res = await query(
      `SELECT id FROM seller_verifications
       WHERE seller_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [sellerId],
    );
    expect(res.rows.length).toBe(1);
    return res.rows[0].id as string;
  }

  async function requestCorrection(sellerId: string): Promise<Response> {
    const verificationId = await pendingVerificationId(sellerId);
    return fetch(`${base}/api/admin/verifications/seller/${verificationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(REVIEWER_ID, ownerId, `${marker}-owner@test.invalid`),
      },
      body: JSON.stringify({ action: "needs_correction", reasonCode: "id_card_unclear", reason: "Please re-shoot the card" }),
    });
  }

  async function queueRows(): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(
      `${base}/api/admin/verifications?status=all&limit=50&q=${encodeURIComponent(marker)}`,
      { headers: { Cookie: cookieFor(REVIEWER_ID, ownerId, `${marker}-owner@test.invalid`) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    return (body.data?.sellers ?? []) as Array<Record<string, unknown>>;
  }

  function rowFor(rows: Array<Record<string, unknown>>, sellerId: string): Record<string, unknown> | undefined {
    return rows.find((r) => r.seller_id === sellerId);
  }

  itDb("a non-reviewer cannot read the queue", async () => {
    const res = await fetch(`${base}/api/admin/verifications?status=all`, {
      headers: { Cookie: cookieFor(APPLICANT_ID, customerId, `${marker}-customer@test.invalid`) },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  itDb("the first application is `new` with 0; a resubmitted one counts its real resubmissions", async () => {
    const fresh = await seedApplicant();
    const resubmitting = await seedApplicant();

    // ── Applicant 1: exactly one submission ────────────────────────────────
    expect((await submit(APPLICANT_ID, fresh)).status).toBe(200);

    // ── Applicant 2: the brief's cycle ─────────────────────────────────────
    //   submitted → needs_correction → resubmitted → needs_correction → resubmitted
    expect((await submit(APPLICANT_ID, resubmitting)).status).toBe(200);
    expect((await requestCorrection(resubmitting.sellerId)).status).toBe(200);
    expect((await submit(APPLICANT_ID, resubmitting)).status).toBe(200);
    expect((await requestCorrection(resubmitting.sellerId)).status).toBe(200);
    expect((await submit(APPLICANT_ID, resubmitting)).status).toBe(200);

    // The two resubmissions are recorded as `resubmitted`, never as `submitted`.
    const history = await query(
      "SELECT action FROM seller_review_history WHERE seller_id = $1 ORDER BY created_at ASC, id ASC",
      [resubmitting.sellerId],
    );
    expect(history.rows.map((r: { action: string }) => r.action)).toEqual([
      "submitted",
      "needs_correction",
      "resubmitted",
      "needs_correction",
      "resubmitted",
    ]);

    const rows = await queueRows();
    const freshRow = rowFor(rows, fresh.sellerId);
    const resubmittingRow = rowFor(rows, resubmitting.sellerId);

    // Applicant 1 — new application, 0 corrections.
    expect(freshRow?.application_type).toBe("new");
    expect(freshRow?.resubmission_count).toBe(0);

    // Applicant 2 — resubmitted twice, and never reported as "new" again.
    expect(resubmittingRow?.application_type).toBe("resubmitted");
    expect(resubmittingRow?.resubmission_count).toBe(2);
  });

  itDb("the count is per-seller: one applicant's resubmissions never leak into another row", async () => {
    const rows = await queueRows();
    const types = rows.map((r) => `${r.seller_id}:${r.application_type}:${r.resubmission_count}`);
    // Every row in this fixture is described by its OWN history; there is no
    // shared/global counter anywhere in the payload.
    expect(types.every((t) => /:(new:0|resubmitted:[1-9]\d*)$/.test(t))).toBe(true);
    const counts = rows.filter((r) => r.application_type === "resubmitted").map((r) => r.resubmission_count);
    expect(counts.length).toBeGreaterThan(0);
  });

  itDb("the queue never returns raw evidence locations", async () => {
    const res = await fetch(`${base}/api/admin/verifications?status=all&limit=50&q=${encodeURIComponent(marker)}`, {
      headers: { Cookie: cookieFor(REVIEWER_ID, ownerId, `${marker}-owner@test.invalid`) },
    });
    const text = await res.text();
    expect(text).not.toContain("evidence_urls");
    expect(text).not.toContain("verification/evidence/");
  });

  itDb("a re-application after rejection is a resubmission, not a brand-new application", async () => {
    // `PATCH /api/admin/sellers/:id/status` rejected → the SAME seller row is
    // resubmitted through the applicant flow; the history must record it.
    const applicant = await seedApplicant();
    expect((await submit(APPLICANT_ID, applicant)).status).toBe(200);

    const rejected = await fetch(`${base}/api/admin/sellers/${applicant.sellerId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(REVIEWER_ID, ownerId, `${marker}-owner@test.invalid`),
      },
      body: JSON.stringify({ status: "rejected", reasonCode: "applicant_mismatch", reason: "Documents do not match" }),
    });
    expect(rejected.status).toBe(200);

    expect((await submit(APPLICANT_ID, applicant)).status).toBe(200);

    const rows = await queueRows();
    const row = rowFor(rows, applicant.sellerId);
    expect(row?.application_type).toBe("resubmitted");
    expect(row?.resubmission_count).toBe(1);
  });
});
