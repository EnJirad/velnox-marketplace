# 2026-11-02 — Home storefront polish: image banner + density (step 4)

Start SHA `b3b2315` (equal to `origin/main` at start), clean tree.

## What changed

**1. Banner now carries a real product image.** Source chain, all real:

- category = the published category with the most products (`popularCategories[0]`, derived from
  `GET /api/products/catalog`)
- count = that category's live product count
- image = `primaryImage.displayUrl ?? primaryImage.url` of the first product in that category that has
  one (Cloudflare R2 CDN URL — `https://pub-…r2.dev/…`), `object-fit: cover`, `alt` = the real product name
- destination = `/products?category=<slug>` (no dead button)

No campaign table exists, so the banner still does not claim a sale. Yesterday's eyebrow "Popular
category" + "N products" + "Browse" copy is unchanged — every string is either a locale key or a real
number.

Composition: `h-[150px]` mobile / `md:h-[240px]`, `rounded-2xl`, mint `#ECFDF5` surface, text column
left with a 36 px icon chip, image column 38 % (42 % ≥sm) right, soft gradient seam over the image edge.
Falls back to the text-only banner when the category has no product image.

**2. Density.** Home rails now use `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` (was
`2 / md:3 / xl:4`), so tablets get 3 and desktop 4 columns inside the existing `max-w-6xl` container.
Category section vertical padding tightened (`py-4 sm:py-5`), chips keep `size-14` circles with 11 px
labels and 4-per-row mobile / 6-per-row ≥sm.

Unchanged on purpose: header, five-tab nav, route-aware search, Marketplace filters/sort, memory rails,
product card component (already 1:1 image, white surface, dominant price, no invented metadata).

## Verification

Live dev server (Vite) pointed at the production read-only API through a temporary local proxy in
`.harness/` (not committed, no app code, no secrets) so real catalogue data was visible.

| Check | Result |
|---|---|
| header | 56 px, pill present on `/` |
| banner | 460 × **150** px at 492 px viewport, y = 68 (below header) |
| banner image | 174 × 148, `object-fit: cover`, real R2 URL, natural 1280 × 1810, `alt` = product name |
| banner text | `หมวดหมู่ยอดนิยม · หูฟังและลำโพง · 1 สินค้า · เลือกดู` — all real |
| category chips | rendered from real categories (this catalogue exposes one) |
| cards | product card + PDP link present, no fake ratings/discounts added |
| horizontal overflow | 0 |
| typecheck | 4 apps exit 0 |
| build | `bun run build:velshop` exit 0 (8.26 s) |
| i18n | th/en/my **1310** each, parity OK |
| tests | 1139 pass / 382 skip / **8 fail** — all in `test-database-isolation.test.ts`, subprocess probes that cannot run in this sandbox |

## Blocked

- **VISUAL VERIFICATION: NOT VERIFIED** — `browser_screenshot` still returns "Browser preview is hidden
  or detached" (§137); no pixel comparison against the reference screenshot is claimed.
- **Desktop 768 / 1024 / 1440: NOT VERIFIED.** The preview surface cannot be resized (CDP unavailable
  on android/arm64) and iframe probes never leave `readyState: "loading"`. Desktop is evidenced only at
  rule level from the built stylesheet: `.md\:h-\[240px\]` inside `@media(min-width:48rem)`,
  `.sm\:grid-cols-3` inside `40rem`, `.lg\:grid-cols-4` inside `64rem`.

## Note on data size

The production catalogue currently exposes a single published product, so the Home page legitimately
shows one category chip and one card per rail. Nothing was padded or duplicated to look fuller.
