/**
 * VelCenter navigation contract.
 *
 * The rail is URL-driven (`?tab=…`). Radix `TabsTrigger` activates on
 * `mousedown`, so a plain `click` — which assistive technology and automated
 * browsers dispatch — never changed the tab: `aria-selected` stayed on the old
 * item and the URL never moved. Each nav trigger now also carries an explicit
 * onClick that routes through the same `selectTab` used by `onValueChange`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const src = readFileSync(join(root, "apps", "velcenter", "src", "pages", "Center.tsx"), "utf8");

const NAV_TABS = [
  "overview",
  "chat",
  "orders",
  "products",
  "sellers",
  "categories",
  "staff",
  "audit",
  "incidents",
  "marketing",
  "settings",
];

describe("VelCenter nav rail", () => {
  test("every nav trigger responds to a plain click", () => {
    for (const tab of NAV_TABS) {
      const pattern = new RegExp(`<TabsTrigger value="${tab}" onClick=\\{\\(\\) => selectTab\\("${tab}"\\)\\}`);
      expect(src).toMatch(pattern);
    }
  });

  test("click and Radix activation share one selector", () => {
    expect(src).toContain("const selectTab = (next: Tab) =>");
    expect(src).toContain("onValueChange={(v) => selectTab(v as Tab)}");
    // no second navigation state: the tab still comes from the URL
    expect(src).toContain('searchParams.get("tab")');
    expect(src).toContain('params.set("tab", next)');
  });

  test("selection closes the drawer without inventing a second router", () => {
    const start = src.indexOf("const selectTab =");
    const body = src.slice(start, start + 140);
    expect(body).toContain("setTab(next)");
    expect(body).toContain("setNavOpen(false)");
  });

  test("the people-segment Tabs did not get the nav selector", () => {
    const marker = '<TabsTrigger value="staff" className="gap-1.5 rounded-md">';
    const at = src.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 120)).not.toContain("selectTab(");
  });
});
