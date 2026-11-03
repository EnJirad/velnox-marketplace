/**
 * Seller performance surface — static contracts for P1-A of SELLER-PHASE-1.
 *
 * The goals dashboard is a frontend surface whose correctness depends on things
 * a unit test cannot execute here (no Neon, no browser): which endpoints it
 * reads, whether it can fabricate numbers, whether the copy is localized and
 * whether the controls meet the 44px touch target. Those ARE verifiable from
 * the source, so they are pinned here — the same approach as
 * `marketing-surface.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const page = read("apps/velseller/src/pages/SellerGoals.tsx");
const card = read("packages/shared/src/components/goals/GoalCard.tsx");
const dictionaries = ["th", "en", "my"].map((lang) =>
  read(`packages/shared/src/lib/i18n/locales/${lang}.ts`),
);

/** Emoji ranges (pictographic + misc symbols + dingbats). */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
/** Thai script — must not appear as a literal label inside the localized card. */
const THAI = /[\u0E00-\u0E7F]/;

describe("seller performance page reads real seller endpoints only", () => {
  test("goals + income come from the existing authenticated APIs", () => {
    expect(page).toContain("api.goals.list");
    expect(page).toContain("api.commerce.sellerIncomeReport");
  });

  test("no mock data and no hard-coded money/count literals", () => {
    // Strip comments: the rule is about code and copy, not prose.
    const code = page.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(code.toLowerCase()).not.toContain("mock");
    expect(code.toLowerCase()).not.toContain("fake");
    // A hard-coded price would look like "฿1,200"; a hard-coded metric like `sales: 42`.
    expect(code).not.toMatch(/[\u0E3F$]\s?\d/);
    expect(code).not.toMatch(/\b(sales|revenue)\s*:\s*\d/);
  });

  test("failures render a retry path instead of a fabricated zero", () => {
    expect(page).toContain("setFailed(true)");
    expect(page).toContain("sellerPerf.loadFailed");
    expect(page).toContain("role=\"alert\"");
    // Unavailable metrics render an em dash, never 0.
    expect(page).toContain('?? "—"');
  });

  test("loading state exists before data arrives", () => {
    expect(page).toContain("animate-pulse");
  });

  test("primary controls meet the 44px touch target", () => {
    const pageTargets = page.match(/h-11|size-11/g) ?? [];
    expect(pageTargets.length).toBeGreaterThanOrEqual(5);
    const cardTargets = card.match(/h-11|size-11/g) ?? [];
    expect(cardTargets.length).toBeGreaterThanOrEqual(4);
  });

  test("responsive grid stacks on phones and widens on desktop", () => {
    expect(page).toContain("grid-cols-2");
    expect(page).toContain("xl:grid-cols-3");
  });
});

describe("seller UI copy carries no emoji", () => {
  test("page and goal card contain no emoji character", () => {
    expect(EMOJI.test(page)).toBe(false);
    expect(EMOJI.test(card)).toBe(false);
  });

  test("the dashboard greeting in every dictionary is emoji-free", () => {
    for (const dictionary of dictionaries) {
      const greeting = dictionary.match(/greeting:\s*"[^"]*"/)?.[0] ?? "";
      expect(greeting).not.toBe("");
      expect(EMOJI.test(greeting)).toBe(false);
    }
  });
});

describe("goal card is localized, not Thai-only", () => {
  test("it resolves copy through the i18n hook", () => {
    expect(card).toContain("useLanguage");
    expect(card).toContain('t("sellerDash.goals.');
  });

  test("no Thai literal remains inside the component", () => {
    const withoutComments = card.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(THAI.test(withoutComments)).toBe(false);
  });
});
