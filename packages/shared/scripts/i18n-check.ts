/**
 * i18n parity check — run with: bun run i18n:check
 *
 * Validates that every locale dictionary (th / en / my) has:
 *   1. The exact same set of translation keys (locale parity).
 *   2. The same interpolation variables per key (e.g. {count} must exist
 *      in all three translations of "cartPage.itemsCount").
 *
 * Thai (th) is the source of truth for the key shape (Dict type).
 * This script imports the *merged* runtime dictionaries, so keys supplied
 * via patches in locales/index.ts (myAuthPatch / myShopPatch) are included.
 *
 * Exit code 1 if any problem is found — safe to wire into CI.
 */
import { translations } from "../src/lib/i18n/locales/index";

type Dict = Record<string, unknown>;

/** Flatten a nested dictionary into "a.b.c" -> string entries. */
function flat(dict: unknown, prefix = ""): [string, string][] {
  if (typeof dict !== "object" || dict === null) return [];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(dict as Dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) out.push(...flat(v, key));
    else out.push([key, String(v)]);
  }
  return out;
}

/** Interpolation variables used by a string, e.g. "{count}" -> ["count"]. */
function vars(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

const dicts: Array<[string, Map<string, string>]> = (
  Object.entries(translations) as Array<[string, unknown]>
).map(([lang, dict]) => [lang, new Map(flat(dict))]);

const [sourceLang, source] = dicts[0];
const sourceKeys = new Set(source.keys());
let failed = false;

// 1. Locale parity — every language must have the same key set.
for (const [lang, map] of dicts.slice(1)) {
  const missing = [...sourceKeys].filter((k) => !map.has(k)).sort();
  const extra = [...map.keys()].filter((k) => !sourceKeys.has(k)).sort();
  if (missing.length) {
    failed = true;
    console.error(`[${lang}] missing ${missing.length} key(s): ${missing.join(", ")}`);
  }
  if (extra.length) {
    failed = true;
    console.error(`[${lang}] has ${extra.length} key(s) not in ${sourceLang}: ${extra.join(", ")}`);
  }
}

// 2. Interpolation parity — variables must match across languages.
const dictMap = new Map(dicts);
for (const [key, value] of source) {
  const expected = vars(value).join(",");
  for (const [lang, map] of dicts.slice(1)) {
    const actual = vars(map.get(key) ?? "").join(",");
    if (actual !== expected) {
      failed = true;
      console.error(
        `[${lang}] ${key} interpolation mismatch — ${sourceLang}=[${expected}] ${lang}=[${actual}]`
      );
    }
  }
}

if (failed) {
  console.error("\ni18n:check FAILED — see problems above.");
  process.exit(1);
} else {
  const counts = dicts.map(([l, m]) => `${l}=${m.size}`).join(" ");
  console.log(`i18n:check OK — ${counts} keys, all locales at parity.`);
}
