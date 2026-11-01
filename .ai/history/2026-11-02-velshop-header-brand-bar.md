# 2026-11-02 — VelShop header rebuilt as a brand bar (step 2)

## Start state

`LOCAL == REMOTE == 9ec1db6`, clean tree (step 1 landed as the 4-tab bottom bar).

## What existed

`apps/velshop/src/components/shop/ShopHeader.tsx` — one white sticky header used by every page:
logo + wordmark, desktop nav (home/products/categories), language (desktop full / mobile icon),
`NotificationBell` (real unread), cart button (`data-cart-icon`, opens `CartDrawer`, guests →
`/auth?returnTo=/`), profile link or login button. Search lived only on `/products`. No chat entry in
the header; `/chat` existed as a `RequireAuth` route rendering `ShopChat`.

## Change

`ShopHeader` now renders **two responsive presentations of the same component** — not a second
header system:

| | Mobile (<768 px) | Desktop (≥768 px) |
|---|---|---|
| Surface | solid `#10B981`, 56 px, no border | unchanged white/90 + `border-slate-200` |
| Left | `LogoMark` 32 px on a white rounded tile, links `/` | full `Logo` + wordmark |
| Middle | white pill search, 40 px, `rounded-full`, magnifier right | nav links (unchanged) |
| Right | language · cart (real count) · chat (real unread) | language · bell · cart · profile/login |

- Search is a `<form role="search">` that writes the existing `/products?q=` contract and drops
  `page`; on `/products` it preserves the other filter params and mirrors `q` from the URL. No second
  search implementation, no new API.
- Cart keeps `openCart()` (authenticated → `CartDrawer`, guest → `/auth?returnTo=/`) and the real
  `count`; badge is white with `#047857` text on the brand bar, hidden at 0.
- Chat uses the existing `/chat` route and `useChatUnread("customer")` (server-derived count, null while
  unknown → nothing rendered). No mock unread, no new transport.
- `LanguageSwitcher` gained `tone?: "default" | "brand"` (white trigger); default path classes unchanged.
- `CartFlyAnimation` now picks the **visible** `[data-cart-icon]` (each breakpoint renders one).
- i18n: `header.ariaChat` added to `th`/`en`/`my` (1305 keys each, parity OK).

## Verification (measured on the running app, 127.0.0.1 dev server)

Viewport 492 CSS px (the WebView's own width) — live DOM:

| Element | Measured |
|---|---|
| `header` | 492 × **56.0** px, `position: sticky`, `z-index 40` |
| brand bar background | `rgb(16, 185, 129)` = `#10B981` |
| logo link / mark | 36 px box / 32 px mark, `x=12` |
| search pill | 40 px high, `border-radius: 1.29e7px` (fully rounded), white, 13 px text |
| cart button | 36 × 36 at `x=400` |
| chat link | 36 × 36 at `x=444` (right edge 480 + 12 px padding) |
| search→cart gap | 56 px (language trigger + 2 × 8 px gap) |
| horizontal overflow | `scrollWidth - clientWidth = 0` |
| desktop bar | `display: none` at 492 |

Other widths measured with same-origin iframes (each loaded `http://127.0.0.1:5182/`):

| Width | header | pill | logo | cart | chat | overflow |
|---|---|---|---|---|---|---|
| 360 | 56 | 156 | 36 | 36 | 36 | 0 |
| 390 | 56 | 186 | 36 | 36 | 36 | 0 |
| 430 | 56 | 226 | 36 | 36 | 36 | 0 |
| 492 | 56 | 288 | 36 | 36 | 36 | 0 |

Functional checks on the same session:

- **Search** — typed `เสื้อผ้า` into the pill, submitted → `/products?q=%E0%B9%80%E0%B8%AA...`; the pill
  kept the value after navigation (state synced from `q`). Empty submit → `/products` (no `q`).
- **Cart** — guest click → `/auth?returnTo=/` (existing flow). Badge markup only renders when
  `count > 0`; the harness session had an empty cart, so a non-zero badge could not be observed without
  fabricating data.
- **Chat** — the icon is `<a href="/chat">`, aria-label `แชทของฉัน`; navigation reached `/chat` (route
  guarded by `RequireAuth`, logic untouched). Unread badge not observed: the session was a guest, so
  the server count is `null` by design.
- **Logo** — click → `/`.

## Blocked / not verified

- **Screenshots: NOT VERIFIED.** `browser_screenshot` returns "Browser preview is hidden or
  detached" (harness surface hidden, §137). Pixel comparison with the reference is therefore not
  claimed.
- **768 / 1024 / 1440 px: NOT MEASURED.** The preview surface is hidden, so iframe sub-documents stay
  in `readyState: "loading"` and never render; CDP resize is unavailable (the chrome-devtools MCP
  server cannot download its android/arm64 binary). Desktop behaviour is evidenced only at rule level:
  the built CSS carries `.md\:hidden{display:none}` and `.md\:block{display:block}` inside
  `@media(min-width:48rem)`, the desktop subtree markup is byte-identical to the previous header, and
  at 492 px it computes to `display: none` while the mobile bar is `flex`.
- Header is `sticky`, not `fixed`, so it stays in flow and cannot overlap page content; the mobile
  pages keep their existing `.site-app` bottom padding. Content offset was not separately measured —
  the page was reloaded into the broken-injection state (§137) before that probe ran.

## Deviations from the reference

The language trigger sits between the pill and the cart (reference has only logo · search · cart ·
chat). Removing it would have removed the only language switch on mobile, so it was kept as a 40 px
icon trigger. Everything else follows the reference proportions.
