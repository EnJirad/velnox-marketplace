/**
 * POST /api/seller/apply — identity evidence validation, EXECUTED.
 *
 * Production 2026-09-27: an applicant presigned and uploaded all three identity
 * documents (`purpose=id_card|id_card_back|selfie_id`), each producing a `media`
 * row, then submitted the application and was told
 * `Missing required identity documents: id_card, id_card_back, selfie_id`.
 *
 * Root cause: the submit handler recovered the purpose from the object key
 * filename with `filename.split("_")[0]`. Evidence keys are minted as
 * `verification/evidence/{owner}/{purpose}_{timestamp}.{ext}`, so an underscore
 * purpose parsed to its first fragment — `id_card_back_1758000000000.jpg` →
 * `"id"` — and none of the three requirements were ever seen as satisfied.
 *
 * These tests run the real route over HTTP against a real (disposable)
 * PostgreSQL: the three required documents uploaded through the real evidence
 * architecture must submit successfully, and a genuinely missing document must
 * still be rejected. The validation must NOT be weakened.
 *
 * DB-gated — skipped unless `TEST_DATABASE_URL` points at a validated test
 * database AND `JWT_SECRET` is set (see `helpers/test-db.ts`). Fixtures use a
 * random suffix and are removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { evidencePurposeFromKey } from "../lib/evidence-purpose.js";
import { setupSellerRoutes } from "../routes/seller.js";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

/** The exact key shape `POST /api/seller/evidence/upload-intent` mints. */
function evidenceKey(ownerSegment: string, purpose: string, ext = "jpg"): string {
  return `verification/evidence/${ownerSegment}/${purpose}_1758000000000.${ext}`;
}

const REQUIRED = ["id_card", "id_card_back", "selfie_id"];

describe("evidencePurposeFromKey — underscore purposes survive the parse", () => {
  test("every purpose containing an underscore parses whole", () => {
    for (const purpose of ["id_card", "id_card_back", "selfie_id", "product_photo", "supplier_doc", "business_doc"]) {
      expect(evidencePurposeFromKey(evidenceKey("owner-id", purpose))).toBe(purpose);
      expect(evidencePurposeFromKey(evidenceKey("owner-id", purpose, "jpeg"))).toBe(purpose);
    }
  });

  test("a key without a timestamp falls back to the leading segment, never crashes", () => {
    // Nothing in the system mints these (every minted key carries `_{Date.now()}`),
    // so the fallback only has to stay defined and side-effect free — returning ""
    // or throwing would blank the reviewer UI for a stray key.
    expect(evidencePurposeFromKey("verification/evidence/owner/photo.jpg")).toBe("photo");
    expect(evidencePurposeFromKey("verification/evidence/owner/id_card.jpg")).toBe("id");
    expect(evidencePurposeFromKey("")).toBe("other");
  });
});

describe("POST /api/seller/apply identity evidence over HTTP (needs a test database + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  let marker = "";
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupSellerRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (!hasDb) return;
    marker = `apply-evidence-${crypto.randomUUID().slice(0, 8)}`;
  });

  afterAll(async () => {
    if (hasDb && createdUserIds.length > 0) {
      // `media.uploaded_by` is ON DELETE NO ACTION — clear the fixture rows first.
      await query("DELETE FROM media WHERE uploaded_by = ANY($1::uuid[])", [createdUserIds]);
      await purgeUsers(createdUserIds);
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  /** A real applicant account plus the media rows its evidence uploads created. */
  async function seedApplicant(purposes: string[]): Promise<{ userId: string; email: string; keys: string[] }> {
    const email = `${marker}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const user = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [email, "Identity Applicant"],
    );
    const userId: string = user.rows[0].id;
    createdUserIds.push(userId);

    const keys = purposes.map((p) => evidenceKey(userId, p));
    for (const key of keys) {
      // Exactly what `POST /api/seller/evidence/confirm` writes after the R2 PUT.
      await query(
        `INSERT INTO media (url, key, content_type, size, uploaded_by)
         VALUES ($1, $2, 'image/jpeg', 1024, $3)`,
        [`https://cdn.example.invalid/${key}`, key, userId],
      );
    }
    return { userId, email, keys };
  }

  function session(userId: string, email: string): string {
    return `velnox_session=${jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "5m" })}`;
  }

  function applyBody(keys: string[]) {
    return {
      shopName: `Identity Shop ${crypto.randomUUID().slice(0, 8)}`,
      firstName: "สมชาย",
      lastName: "ทดสอบ",
      phone: "0812345678",
      idCardFrontUrl: keys[0],
      idCardBackUrl: keys[1],
      selfieUrl: keys[2],
      identityEvidence: keys,
    };
  }

  async function postApply(userId: string, email: string, body: unknown) {
    return fetch(`${base}/api/seller/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session(userId, email) },
      body: JSON.stringify(body),
    });
  }

  itDb("submits successfully when all three documents were uploaded through the evidence flow", async () => {
    const { userId, email, keys } = await seedApplicant(REQUIRED);

    const res = await postApply(userId, email, applyBody(keys));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.seller?.status).toBe("pending");
    expect(body.data?.seller?.evidenceCount).toBe(3);

    // The submission is only real if the evidence landed in the verification row.
    const seller = await query("SELECT id, status, verification_status FROM sellers WHERE user_id = $1", [userId]);
    expect(seller.rows.length).toBe(1);
    expect(seller.rows[0].status).toBe("pending");
    expect(seller.rows[0].verification_status).toBe("pending");

    const verification = await query(
      "SELECT status, evidence_urls FROM seller_verifications WHERE seller_id = $1",
      [seller.rows[0].id],
    );
    expect(verification.rows.length).toBe(1);
    expect(verification.rows[0].status).toBe("pending");
    const stored = verification.rows[0].evidence_urls as string[];
    expect([...stored].sort()).toEqual([...keys].sort());

    const settings = await query("SELECT settings FROM seller_settings WHERE seller_id = $1", [seller.rows[0].id]);
    expect(settings.rows[0].settings.identityEvidence).toEqual(keys);
  });

  itDb("still rejects an application that is genuinely missing one document", async () => {
    const { userId, email, keys } = await seedApplicant(["id_card", "id_card_back"]);

    const res = await postApply(userId, email, { ...applyBody(keys), selfieUrl: undefined, identityEvidence: keys });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("IDENTITY_EVIDENCE_REQUIRED");
    expect(body.error?.message).toBe("Missing required identity documents: selfie_id");

    // Rejected BEFORE any seller row exists — no half-submitted application.
    const seller = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
    expect(seller.rows.length).toBe(0);
  });

  itDb("still rejects an application with no documents at all", async () => {
    const { userId, email } = await seedApplicant([]);

    const res = await postApply(userId, email, {
      shopName: `Empty Shop ${crypto.randomUUID().slice(0, 8)}`,
      firstName: "สมชาย",
      lastName: "ทดสอบ",
      phone: "0812345678",
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("IDENTITY_EVIDENCE_REQUIRED");
    expect(body.error?.message).toBe("Missing required identity documents: id_card, id_card_back, selfie_id");
  });

  itDb("still rejects evidence keys that belong to another account", async () => {
    const { userId, email } = await seedApplicant(REQUIRED);
    const foreign = await seedApplicant(REQUIRED);

    const res = await postApply(userId, email, applyBody(foreign.keys));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");

    const seller = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
    expect(seller.rows.length).toBe(0);
  });
});
