/**
 * V-badge removal (P1-F) — visual only, security preserved.
 *
 * The marketplace no longer advertises a green "V" on seller/shop surfaces:
 * every seller that is allowed to sell has already passed approval, so the
 * badge adds no information. Verification itself is a SECURITY state and must
 * remain enforced server-side. These contracts pin both halves of that rule.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function walk(dir: string): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(rel);
  }
  return out;
}

const userFacingSources = [...walk("apps/velseller/src"), ...walk("apps/velshop/src")];

describe("no user-facing V badge is rendered", () => {
  test("seller and shop sources never render the VBadge component", () => {
    const offenders = userFacingSources.filter((file) => /<VBadge\b/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  test("seller and shop sources never call the old badge helper", () => {
    const offenders = userFacingSources.filter((file) => /isProductVerified\s*\(/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  test("the shop storefront no longer imports the badge module", () => {
    const offenders = walk("apps/velshop/src").filter((file) =>
      read(file).includes('components/VBadge"'),
    );
    expect(offenders).toEqual([]);
  });

  test("the seller shop surface shows status text, not a V glyph", () => {
    // Part 1 split the page into `components/shop/*`; the invariant is about the
    // whole seller-shop surface, so it is asserted over the surface, not one file.
    const shopSurface = ["apps/velseller/src/pages/MyShop.tsx", ...walk("apps/velseller/src/components/shop")]
      .map(read)
      .join("\n");
    expect(shopSurface).not.toMatch(/>\s*V\s*</);
    // Business status is still surfaced as text.
    expect(shopSurface).toContain("VerificationStatusLabel");
  });
});

describe("verification remains a security state, not a decoration", () => {
  test("the shared module still exports the verification business logic", () => {
    const badgeModule = read("packages/shared/src/components/VBadge.tsx");
    expect(badgeModule).toContain("export function isProductVerified");
    expect(badgeModule).toContain("export function VerificationStatusLabel");
  });

  test("selling still requires an approved seller", () => {
    const products = read("backend/routes/products.ts");
    expect(products).toContain('seller.status !== "approved"');
  });

  test("the approval middleware still exists and is exported", () => {
    const middleware = read("backend/middleware/seller.ts");
    expect(middleware).toContain("export async function requireApprovedSeller");
  });

  test("verification review endpoints still exist", () => {
    const route = read("backend/routes/verification.ts");
    expect(route.length).toBeGreaterThan(1000);
  });
});
