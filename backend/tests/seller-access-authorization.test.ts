/**
 * Seller access — the ONE rule, enforced server-side and mirrored fail-closed in the UI.
 *
 *     sellerAccess = true   ⇔   sellers.status = 'approved'
 *
 * Everything else — no application, `pending`, `under_review`, `needs_correction`,
 * `rejected`, `suspended` — is a refusal, both for the seller tab bar and for the
 * seller-dashboard APIs. `users.role` is a cached promotion, never the check; the
 * client's userId/role/approved flags are never read.
 *
 * Three layers are covered here:
 *   1. the shared decision helpers the UI gates on — executed, fail-closed;
 *   2. static guards that the velseller tab bar cannot render without the
 *      approval and that the revision flow prefills data + documents;
 *   3. DB-gated HTTP tests over the REAL routes and a disposable PostgreSQL:
 *      the five statuses against `GET /api/seller/status`,
 *      `GET /api/seller/profile` and `PATCH /api/seller/shop`, plus ownership
 *      isolation between two accounts.
 *
 * Nothing here invents endpoints, schema, or statuses: the status list is the
 * `sellers.status` CHECK constraint from `db/schema.sql`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { join } from "path";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import {
  SELLER_APPLICATION_STATUSES,
  isSellerApproved,
  sellerAccessFromStatusResponse,
  shouldShowSellerTab,
} from "../../packages/shared/src/lib/seller-access.ts";
import { query } from "../db/index.js";
import { setupSellerRoutes } from "../routes/seller.js";
import { registerVerificationRoutes } from "../routes/verification.js";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const root = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

/** The five statuses that must never grant access (everything but `approved`). */
const NON_APPROVED = SELLER_APPLICATION_STATUSES.filter((s) => s !== "approved");

// ════════════════════════════════════════════════════════════════════════════
// 1. The shared decision — fail closed, no case games
// ════════════════════════════════════════════════════════════════════════════
describe("seller access decision (shared) — approved is the ONLY true", () => {
  test("every status in the schema maps to the right verdict", () => {
    for (const status of SELLER_APPLICATION_STATUSES) {
      expect(isSellerApproved(status)).toBe(status === "approved");
      expect(sellerAccessFromStatusResponse({ sellerAccess: status === "approved", data: { status } }))
        .toBe(status === "approved");
    }
  });

  test("unknown, missing, cased, or malformed input is denied", () => {
    expect(isSellerApproved(null)).toBe(false);
    expect(isSellerApproved(undefined)).toBe(false);
    expect(isSellerApproved("")).toBe(false);
    expect(isSellerApproved("APPROVED")).toBe(false); // the DB stores lowercase
    expect(isSellerApproved("verified")).toBe(false);
    expect(isSellerApproved("needs_correction")).toBe(false);
    expect(isSellerApproved("under_review")).toBe(false);
  });

  test("seller tab visibility: visible ONLY for an approved, loaded, error-free state", () => {
    // The whole matrix the UI must satisfy — nothing but APPROVED shows the tab.
    expect(shouldShowSellerTab({ sellerAccess: false, loading: false, error: null })).toBe(false); // no application / pending / revision / rejected
    expect(shouldShowSellerTab({ sellerAccess: true, loading: false, error: null })).toBe(true); // approved
    expect(shouldShowSellerTab({ sellerAccess: true, loading: true, error: null })).toBe(false); // still loading
    expect(shouldShowSellerTab({ sellerAccess: true, loading: false, error: "SELLER_STATUS_UNAVAILABLE" })).toBe(false); // API error
    expect(shouldShowSellerTab({})).toBe(false); // nothing known → hidden

    for (const status of SELLER_APPLICATION_STATUSES) {
      const approved = isSellerApproved(status);
      expect(shouldShowSellerTab({ sellerAccess: approved, loading: false, error: null })).toBe(approved);
    }
  });

  test("the server's explicit verdict wins, and absence falls back to the status", () => {
    // An explicit false is never overridden by a status that looks approved.
    expect(sellerAccessFromStatusResponse({ sellerAccess: false, data: { status: "approved" } })).toBe(false);
    expect(sellerAccessFromStatusResponse({ sellerAccess: true })).toBe(true);
    // Older payload without the boolean still derives from the application status.
    expect(sellerAccessFromStatusResponse({ data: { status: "approved" } })).toBe(true);
    expect(sellerAccessFromStatusResponse({ data: { status: "pending" } })).toBe(false);
    expect(sellerAccessFromStatusResponse({ data: null })).toBe(false);
    expect(sellerAccessFromStatusResponse({})).toBe(false);
    expect(sellerAccessFromStatusResponse(null)).toBe(false);
    expect(sellerAccessFromStatusResponse(undefined)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Static guards — the tab bar cannot render unapproved, revision prefills
// ════════════════════════════════════════════════════════════════════════════
describe("seller tab bar and revision flow — fail-closed wiring", () => {
  test("the velseller tab bar is gated on the server verdict", () => {
    const src = read("apps/velseller/src/main.tsx");
    expect(src).toContain("useSellerApplication");
    expect(src).toContain("function SellerTabBar()");
    expect(src).toContain("shouldShowSellerTab({ sellerAccess, loading, error })");

    // Exactly one tab-bar render, and it sits AFTER the guard: an unapproved
    // (or still-loading, or failed) status can only return null.
    const renders = src.split("<MobileTabBar items={SELLER_TABS} />").length - 1;
    expect(renders).toBe(1);
    const guardAt = src.indexOf("if (!shouldShowSellerTab({ sellerAccess, loading, error })) return null;");
    const renderAt = src.indexOf("<MobileTabBar items={SELLER_TABS} />");
    expect(guardAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(guardAt);
    // The old static mount is gone: no unconditional bar outside the gate.
    expect(src).not.toMatch(/<MobileTabBar items=\{SELLER_TABS\} \/>\s*<\/div>/);
  });

  test("the status hook denies on error/loading and never trusts a client flag", () => {
    const src = read("packages/shared/src/hooks/use-seller-application.ts");
    expect(src).toContain("sellerAccessFromStatusResponse");
    expect(src).toContain("setSellerAccess(false)"); // loading + catch → denied
    expect(src).toContain('credentials: "include"');
    expect(src).toContain('window.addEventListener("focus"'); // refetch, no re-login
    expect(src).toContain('document.addEventListener("visibilitychange"');
    // No role-based decision anywhere in the gate path.
    expect(src).not.toContain("role");
  });

  test("every seller-dashboard route the app exposes carries the approved-only guard", () => {
    const sellerSrc = read("backend/routes/seller.ts");
    expect(sellerSrc).toContain('app.get("/api/seller/profile", requireAuth, requireApprovedSeller');
    expect(sellerSrc).toContain('app.patch("/api/seller/shop", requireAuth, requireApprovedSeller');
    // The application flow stays open on purpose: it is how an application is
    // created, corrected and resubmitted — never approval-gated.
    expect(sellerSrc).toContain('app.post("/api/seller/apply", requireAuth,');
    expect(sellerSrc).toContain('app.get("/api/seller/status", requireAuth,');

    const velrepeatSrc = read("backend/routes/velrepeat.ts");
    expect(velrepeatSrc).toContain('app.get("/api/seller/velrepeat/deliveries", requireAuth, requireApprovedSeller');
    expect(velrepeatSrc).toContain('app.patch("/api/seller/velrepeat/deliveries/:deliveryId", requireAuth, requireApprovedSeller');

    const plansSrc = read("backend/routes/velrepeat-plans.ts");
    expect(plansSrc).toContain('app.get("/api/seller/velrepeat/overview", requireAuth, requireApprovedSeller');

    // Product option management resolves the seller through an approved-only lookup.
    const optionsSrc = read("backend/routes/product-options.ts");
    expect(optionsSrc).toContain("SELECT id, status FROM sellers WHERE user_id = $1 AND status = 'approved'");

    // The guard is the ONLY decision point for the backend rule.
    const guardSrc = read("backend/middleware/seller.ts");
    expect(guardSrc).toContain('sellerAccess: row?.status === "approved"');
    expect(guardSrc).toContain('res.status(403).json');
  });

  test("the revision flow reloads the previous application and its documents", () => {
    const src = read("packages/shared/src/components/RequireRole.tsx");
    expect(src).toContain("prefillFromApplication");
    expect(src).toContain("hydrateIdentityDocuments");
    expect(src).toContain("/seller/evidence");
    expect(src).toContain('app.status === "needs_correction"');
    // Previously entered values are only filled when still empty — a value the
    // applicant just edited is never overwritten by a status refetch.
    expect(src).toContain("prev || value");
    // A hydrated document must display as uploaded, not as "pick a file".
    const uploader = read("packages/shared/src/components/seller/IdentityDocumentUploader.tsx");
    expect(uploader).toContain('setStatus("uploaded")');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Executed HTTP authorization against the real routes
// ════════════════════════════════════════════════════════════════════════════
describe("seller access over HTTP (needs a test database + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  let marker = "";
  let slugCounter = 0;
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
    marker = `seller-access-${crypto.randomUUID().slice(0, 8)}`;
  });

  afterAll(async () => {
    if (hasDb && createdUserIds.length > 0) {
      await query("DELETE FROM media WHERE uploaded_by = ANY($1::uuid[])", [createdUserIds]);
      await purgeUsers(createdUserIds);
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  async function seedUser(): Promise<{ userId: string; email: string }> {
    const email = `${marker}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const res = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [email, "Access Fixture"],
    );
    const userId = res.rows[0].id as string;
    createdUserIds.push(userId);
    return { userId, email };
  }

  /** A real application row: `sellers.status` is the authoritative field. */
  async function seedApplication(
    userId: string,
    status: string,
    opts: { shop?: boolean; settings?: Record<string, unknown> } = {},
  ): Promise<string> {
    const res = await query(
      "INSERT INTO sellers (user_id, status) VALUES ($1, $2) RETURNING id",
      [userId, status],
    );
    const sellerId = res.rows[0].id as string;
    if (opts.shop) {
      slugCounter += 1;
      await query(
        `INSERT INTO shops (seller_id, name, slug, description, category,
           address_line1, district, city, postal_code, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          sellerId,
          `Access Shop ${slugCounter}`,
          `${marker}-shop-${slugCounter}`,
          "คำอธิบายร้านเดิม",
          "แฟชั่น",
          "99/1 ถนนทดสอบ",
          "เขตเดิม",
          "กรุงเทพมหานคร",
          "10110",
          "0899999999",
        ],
      );
    }
    if (opts.settings) {
      await query(
        "INSERT INTO seller_settings (seller_id, settings) VALUES ($1, $2::jsonb)",
        [sellerId, JSON.stringify(opts.settings)],
      );
    }
    return sellerId;
  }

  function cookie(userId: string, email: string): string {
    // No `jti` → no revocation lookup; identity comes from the session only.
    return `velnox_session=${jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "5m" })}`;
  }

  async function get(path: string, userId: string, email: string) {
    return fetch(`${base}${path}`, { headers: { Cookie: cookie(userId, email) } });
  }

  async function patch(path: string, userId: string, email: string, body: unknown) {
    return fetch(`${base}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie(userId, email) },
      body: JSON.stringify(body),
    });
  }

  itDb("no application → sellerAccess false and data null", async () => {
    const { userId, email } = await seedUser();
    const res = await get("/api/seller/status", userId, email);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sellerAccess).toBe(false);
    expect(body.data).toBeNull();
  });

  itDb("pending, under_review, needs_correction, rejected and suspended → sellerAccess false", async () => {
    for (const status of NON_APPROVED) {
      const { userId, email } = await seedUser();
      await seedApplication(userId, status);

      const res = await get("/api/seller/status", userId, email);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sellerAccess).toBe(false);
      expect(body.data?.status).toBe(status);
    }
  });

  itDb("approved → sellerAccess true", async () => {
    const { userId, email } = await seedUser();
    await seedApplication(userId, "approved", { shop: true });

    const res = await get("/api/seller/status", userId, email);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sellerAccess).toBe(true);
    expect(body.data?.status).toBe("approved");
  });

  itDb("needs_correction returns the previous application so it can be corrected, not re-entered", async () => {
    const { userId, email } = await seedUser();
    await seedApplication(userId, "needs_correction", {
      shop: true,
      settings: {
        firstName: "สมชาย",
        lastName: "เดิม",
        phone: "0811111111",
        idNumber: "1-2345-67890-12-3",
      },
    });

    const res = await get("/api/seller/status", userId, email);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sellerAccess).toBe(false);
    expect(body.data?.shop?.description).toBe("คำอธิบายร้านเดิม");
    expect(body.data?.shop?.category).toBe("แฟชั่น");
    expect(body.data?.shop?.address?.line1).toBe("99/1 ถนนทดสอบ");
    expect(body.data?.applicantInfo?.firstName).toBe("สมชาย");
    expect(body.data?.applicantInfo?.idNumber).toBe("1-2345-67890-12-3");
  });

  itDb("every non-approved status is refused by the seller dashboard APIs", async () => {
    for (const status of NON_APPROVED) {
      const { userId, email } = await seedUser();
      await seedApplication(userId, status, { shop: true });

      const profile = await get("/api/seller/profile", userId, email);
      const profileBody = await profile.json();
      expect(profile.status).toBe(403);
      expect(profileBody.error?.code).toBe("SELLER_NOT_APPROVED");

      const shopUpdate = await patch("/api/seller/shop", userId, email, { name: "ชื่อที่ต้องไม่ถูกบันทึก" });
      const shopBody = await shopUpdate.json();
      expect(shopUpdate.status).toBe(403);
      expect(shopBody.error?.code).toBe("SELLER_NOT_APPROVED");

      // The refusal is real: the shop was not touched.
      const rows = await query(
        `SELECT sh.name FROM shops sh JOIN sellers s ON s.id = sh.seller_id WHERE s.user_id = $1`,
        [userId],
      );
      expect(rows.rows[0]?.name).not.toBe("ชื่อที่ต้องไม่ถูกบันทึก");
    }
  });

  itDb("an approved seller reaches the same APIs", async () => {
    const { userId, email } = await seedUser();
    await seedApplication(userId, "approved", { shop: true });

    const profile = await get("/api/seller/profile", userId, email);
    const profileBody = await profile.json();
    expect(profile.status).toBe(200);
    expect(profileBody.data?.seller?.status).toBe("approved");
    expect(profileBody.data?.shops?.length).toBe(1);

    const shopUpdate = await patch("/api/seller/shop", userId, email, { description: "แก้ไขได้" });
    expect(shopUpdate.status).toBe(200);

    const rows = await query(
      `SELECT sh.description FROM shops sh JOIN sellers s ON s.id = sh.seller_id WHERE s.user_id = $1`,
      [userId],
    );
    expect(rows.rows[0]?.description).toBe("แก้ไขได้");
  });

  itDb("client-supplied role/approved/userId cannot grant access", async () => {
    const approved = await seedUser();
    await seedApplication(approved.userId, "approved", { shop: true });

    const applicant = await seedUser();
    await seedApplication(applicant.userId, "pending", { shop: true });

    // Everything a client could try to inject — including another account's id.
    const res = await patch("/api/seller/shop", applicant.userId, applicant.email, {
      name: "ยกระดับตัวเอง",
      approved: true,
      sellerAccess: true,
      status: "approved",
      role: "seller",
      userId: approved.userId,
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("SELLER_NOT_APPROVED");
  });

  itDb("an applicant never reads another account's application or documents", async () => {
    const approved = await seedUser();
    await seedApplication(approved.userId, "approved", { shop: true });
    await query(
      `INSERT INTO media (url, key, content_type, size, uploaded_by)
       VALUES ($1, $2, 'image/jpeg', 1024, $3)`,
      [
        `https://cdn.example.invalid/verification/evidence/${approved.userId}/id_card_1758000000000.jpg`,
        `verification/evidence/${approved.userId}/id_card_1758000000000.jpg`,
        approved.userId,
      ],
    );

    const applicant = await seedUser();
    await seedApplication(applicant.userId, "pending", { shop: true });

    // Own application only — never the approved account's.
    const status = await get("/api/seller/status", applicant.userId, applicant.email);
    const statusBody = await status.json();
    expect(statusBody.data?.status).toBe("pending");
    expect(statusBody.sellerAccess).toBe(false);
    expect(statusBody.data?.shop?.slug).not.toContain(approved.userId);

    // The approved account is not a key that unlocks the applicant's access.
    const profile = await get("/api/seller/profile", applicant.userId, applicant.email);
    expect(profile.status).toBe(403);

    // Evidence listing is owned-by-caller: the other account's document is absent.
    const evidence = await get("/api/seller/evidence", applicant.userId, applicant.email);
    const evidenceBody = await evidence.json();
    expect(evidence.status).toBe(200);
    const keys: string[] = (evidenceBody.data ?? []).map((r: { key: string }) => r.key);
    expect(keys.some((k) => k.includes(approved.userId))).toBe(false);

    const ownEvidence = await get("/api/seller/evidence", approved.userId, approved.email);
    const ownBody = await ownEvidence.json();
    expect((ownBody.data ?? []).length).toBe(1);
    expect((ownBody.data ?? [])[0].purpose).toBe("id_card");
  });
});
