# 2026-11-02 — VelShop banner system + VelCenter Marketing & responsive (§163)

**Branch:** `main` · **Baseline:** `31f03a2` · **Type:** feat(velshop,velcenter)

## What was built

The existing announcement system (platform_settings.shop_announcements JSON)
was EXTENDED to banner contract v2 — no schema change, no new table, no new
storage. v1 rows keep working; the Settings key is unchanged (QA r1 caught a
critical regression where the key had been overwritten with a redacted literal
copied from tool output — caught by fingerprinting against HEAD).

- Banner v2: type (announcement/promotion/ad), placement (home_hero/home_strip),
  optional title/subtitle/image/CTA/scheduling, active flag, ordering, cap 10,
  invalid items rejected with index + reason (never silently dropped)
- VelShop: carousel renders the three content modes cleanly (image-only fills,
  no empty text column; CTA label from banner; image-only CTA clickable);
  new HomePromoStrip for the home_strip placement
- VelCenter: dedicated Marketing tab (same settings.manage gate), MarketingBanners
  editor (CRUD, reorder, enable, real R2 upload flow, three-mode preview,
  unsaved indicator, client validation); Settings IA cleaned — shop announcement
  label clarified, banner management moved out
- Responsive: Settings section nav wrap-grid + min-h-11 (R2/R5), collapsed rail
  labels sr-only (R4), R7–R10 deferred with reasons in the audit table
- i18n: announceAdmin → marketing namespace (1583×3 parity)

## QA loop

R1 **FAIL** (16 findings, incl. the critical SETTINGS_KEY regression — found by
hash-fingerprinting, invisible to the eye because the harness redacts that
literal in tool output) → R2 **CONDITIONAL PASS** (D1–D16 verified fixed; 3 ship
conditions) → R3 **PASS · SHIP**. 3 of 5 correction rounds used.

## Evidence

i18n 1583×3 · typecheck 4/4 + backend exit 0 · banners.test 18 pass ·
marketing-surface 20 pass · full suite 1193/389/8 (isolation baseline only) ·
both builds exit 0 · diff --check clean. Reports under .ai/office/reviews/.

## Limits

Live Neon/R2 writes NOT VERIFIED by construction (harness proxies to
production); 360/390/430 viewport measurement NOT MEASURED (built-CSS + static
evidence only); CI must be observed green after push.
