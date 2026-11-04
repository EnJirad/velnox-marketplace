/**
 * Seller My Shop — source contracts for Part 1.1.
 *
 * These pin the parts of the backend contract a frontend refactor can silently
 * break. They are source assertions on purpose: the repository has no browser
 * harness, and each rule below was already violated once.
 *
 *  1. `POST /api/seller/apply` validates `firstName`/`lastName`/`phone`,
 *     `shopName` and the purposes `id_card`, `id_card_back`, `selfie_id`
 *     (backend/routes/seller.ts:121, :130). A form that collects fewer fields
 *     400s on every submission — which is exactly what shipped in Part 1.
 *  2. `PATCH /api/seller/shop` writes name/description/phone/category/address and
 *     resolves the shop from the session, so no client id may be sent.
 *  3. Shop media goes through `POST /api/upload/presign` with the purposes
 *     `shop-logo` / `shop-cover` + the caller's own shopId, then
 *     `POST /api/upload/confirm` — never a second upload system.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const page = read("apps/velseller/src/pages/MyShop.tsx");
const onboarding = read("apps/velseller/src/components/shop/ShopOnboarding.tsx");
const identity = read("apps/velseller/src/components/shop/ShopIdentityCard.tsx");
const verification = read("apps/velseller/src/components/shop/ShopVerificationDialog.tsx");
const media = read("apps/velseller/src/components/shop/ShopMediaField.tsx");
const apiRoutes = read("packages/shared/src/lib/api-routes.ts");

describe("seller application mirrors POST /api/seller/apply", () => {
  test("the form sends every field the endpoint validates", () => {
    for (const field of ["shopName", "shopAddress", "firstName", "lastName", "phone"]) {
      expect(onboarding).toContain(field);
    }
  });

  test("all three identity purposes are collected before submitting", () => {
    for (const purpose of ["id_card", "id_card_back", "selfie_id"]) {
      expect(onboarding).toContain(`purpose="${purpose}"`);
    }
    // Required set is declared once and drives the submit guard.
    expect(onboarding).toContain('const REQUIRED_PURPOSES = ["id_card", "id_card_back", "selfie_id"]');
  });

  test("evidence is persisted through the shared confirm endpoint", () => {
    expect(onboarding).toContain("api.seller.evidenceConfirm");
    expect(onboarding).toContain("objectKey: info.objectKey");
  });
});

describe("shop identity edits stay inside the session's shop", () => {
  test("the update payload carries the shop fields the endpoint accepts", () => {
    for (const field of ["name", "description", "phone", "category", "address"]) {
      expect(identity).toContain(field);
    }
  });

  test("no shop or seller id is sent with the update", () => {
    // The endpoint derives the shop from sellers.user_id. Sending an id would be
    // an IDOR surface the backend does not even read.
    expect(identity).not.toMatch(/updateShop\(\{[^}]*shopId/s);
    expect(identity).not.toMatch(/updateShop\(\{[^}]*sellerId/s);
  });

  test("a rejected save keeps the dialog open with the typed values", () => {
    // setEditing(false) only runs after the await succeeds.
    const successIndex = identity.indexOf("toast.success(t(\"sellerDash.shop.savedToast\"))");
    const closeIndex = identity.indexOf("setEditing(false)");
    expect(successIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(successIndex);
  });
});

describe("shop media uses the existing R2 pipeline", () => {
  test("presign is called with a server-checked purpose and the own shopId", () => {
    for (const purpose of ["shop-logo", "shop-cover"]) {
      expect(media).toContain(purpose);
    }
    expect(media).toContain("shopId");
    expect(media).toContain("api.seller.uploadPresign");
    expect(media).toContain("api.seller.uploadConfirm");
  });

  test("the .webp key is only written with real WebP bytes", () => {
    expect(media).toContain("compressImage");
    expect(media).toContain('optimized.type !== "image/webp"');
  });

  test("no second upload system and no Cloudinary", () => {
    for (const source of [page, identity, media]) {
      expect(source).not.toContain("cloudinary");
      expect(source).not.toContain("/api/upload/presign?");
    }
    // exactly one binding for each upload route
    expect(apiRoutes.split('"/api/upload/presign"').length - 1).toBe(1);
    expect(apiRoutes.split('"/api/upload/confirm"').length - 1).toBe(1);
  });
});

describe("verification asks for the full identity set", () => {
  test("the dialog collects front, back and selfie", () => {
    for (const purpose of ["id_card", "id_card_back", "selfie_id"]) {
      expect(verification).toContain(`purpose="${purpose}"`);
    }
  });

  test("submitting requires all three, not just one file", () => {
    expect(verification).toContain(
      'const REQUIRED_PURPOSES = ["id_card", "id_card_back", "selfie_id"]',
    );
    expect(verification).toContain("missingPurposes.length === 0");
  });
});
