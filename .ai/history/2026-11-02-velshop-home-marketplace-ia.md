# 2026-11-02 — Home vs Marketplace information architecture (step 3)

## Start state

`LOCAL == REMOTE == 40d9632`, clean tree. Steps 1–2 (4-tab bar, brand-bar header) already landed.

## Architectural split

| Surface | Responsibility |
|---|---|
| Home `/` | Discovery only: real-data banner, compact categories, curated rails. Never the catalogue. |
| Market `/products` | The complete catalogue: search, category, seller, price range, availability, verified, sort, pagination. |
| Orders / Notifications / Profile | Untouched utility screens, now reachable as tabs 3–5. |

## What changed

**Header (route-aware search).** `ShopHeader` renders the pill only when `pathname === "/"`. Marketplace
keeps its own prominent search field (inside the page), so the mobile view never stacks two search boxes
and utility screens carry none. Submitting the pill still writes `/products?q=…` and now emits the same
`SEARCH` tracking event the Home hero form used to emit. Desktop nav label for `/products` is now
`nav.market`.

**Home.** Removed the old hero (title + duplicate search form). Added, in order:

1. **Discovery banner** — built from the category with the most published products (`popularCategories[0]`)
   and its real count; links to `/products?category=…`. No campaign/discount copy exists in this build,
   so none is shown.
2. **Compact categories** — 4 circular chips per row on mobile, 6 on ≥sm, 56 px icon circle + 11 px label,
   heading + "view all categories" → `/categories`.
3. **Trending** — unchanged real `soldCount` ranking, now 8 cards, "view all" → `/products?sort=popular`.
4. **New arrivals** — newest real `createdAt`, excluding ids already shown above, "view all" →
   `/products?sort=newest`.
5. Existing memory rails (reorder/regulars/recommendations) untouched; empty-state kept.

Home renders at most 8 + 8 product cards, so the catalogue is not dumped on the storefront.

**Market.** Added `Market` as tab 2 (`Store` icon, `/products`, `#10B981` active) → five tabs:
home · market · orders · notifications · profile.

**Marketplace.** Filters were already complete (category, seller/store via real `shops`, min/max price,
in-stock, verified, pagination, mobile `Sheet` with apply/reset, desktop sidebar). The one change was
correctness: the `rating` sort option was removed because `GET /api/products/catalog` only implements
`newest`, `price_asc`, `price_desc`, `popular` — exposing a sort the backend ignores would have been a
lie. Sorting now offers exactly those four.

## i18n

Added `nav.market`, `home.bannerEyebrow`, `home.bannerCta`, `home.newTitle`, `home.newDesc` to `th`,
`en`, `my` → **1310 keys per locale, parity OK**.

## Verification (measured at 492 CSS px, the WebView viewport)

| Check | Result |
|---|---|
| `/` header pill | present, 288 × 40 px, header 56 px |
| `/products` header pill | **absent**; page search field present (460 px wide) |
| `/help` header pill | **absent**; cart + chat still present |
| tab bar | 5 links: `/` `/products` `/orders` `/notifications` `/profile` |
| active state | `/` → `aria-current="page"` on home; `/products` → on market |
| filter button (mobile) | `ตัวกรอง` present |
| horizontal overflow | 0 on `/` and `/products` |

Home with data: **not observable** — the sandbox catalogue returns 0 published products, so the banner,
category rail and both curated rails correctly render nothing and the existing empty-state shows. No
mock data was inserted to fake a screenshot.

## Blocked / not verified

- **VISUAL VERIFICATION: NOT VERIFIED.** `browser_screenshot` still reports "Browser preview is hidden
  or detached" (§137). Several navigations also arrive as a harness-broken document
  (`readyState: interactive`, empty `<body>`); retrying navigation recovers it.
- **360 / 390 / 430 / 768 / 1024 / 1440 px:** iframe probes stay in `readyState: "loading"` while the
  preview surface is hidden, and CDP resize is unavailable on android/arm64. Breakpoints are evidenced
  only by utility rules (`grid-cols-4 sm:grid-cols-6`, `md:hidden`, `lg:grid-cols-3 xl:grid-cols-4`).
- **Backend tests:** `bun test backend/tests` → 1139 pass / 382 skip / **8 fail**, all eight in
  `test-database-isolation.test.ts` "a real test process fails closed" — they spawn `bun` subprocesses
  and assert on their output, which does not work in this sandbox. No backend file was modified by this
  change (diff touches `apps/velshop` + locale files only).
