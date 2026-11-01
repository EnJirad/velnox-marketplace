# ThaiMart reference analysis → VelShop mapping (2026-11-02)

Source: the two owner-supplied screenshots (home feed, scrolled). This is the **primary** visual reference.
Brand palette is **not** copied: VelShop keeps Velnox mint/green as its accent.

## 1. Anatomy extracted from the screenshots

| Region | Reference spec (measured visually) | VelShop today | Action |
|---|---|---|---|
| Brand bar | Solid brand colour, ~56 px, logo mark 32 px + **search pill** (white, fully rounded, 40 px, search icon right) + cart with badge + chat icon; sticks to the top of the content area | `ShopHeader` was one white bar; mobile had no pill, no cart badge cluster, no chat | **done (§142)** — mobile bar at `#10B981`, 56 px; pill 40 px; cart real count; chat → `/chat` |
| Category rail | Horizontal scroll, 6+ items, 56 px circular icon chip + 11 px two-line label, active item tinted | category chips (text) | convert to icon circles + labels |
| Content | White cards on `#F8FAFC`-ish page, 12–16 px radius, 1 px border, 16 px side margins | similar tokens exist | unify radius/margins |
| Promo strip | Thin bordered card with dashed divider + big number | absent | optional, only with real campaign |
| Section heading | 18 px bold with a small brand dot, plus 12 px muted subtitle | mixed sizes | adopt 18/12 pattern |
| LIVE row | 1.1-card-wide 4:5 tiles, red LIVE pill, eye-count pill | absent | needs real live data — skip unless source exists |
| Product grid | 2 columns, gap 12 px, image 1:1, price bold, seller/caption 11 px | exists | tighten to 2-col with 12 px gap and 1:1 images |
| Bottom nav | Fixed, 4 items (หน้าแรก · คำสั่งซื้อ · การแจ้งเตือน · โปรไฟล์), 24 px icon + 11 px label, active = brand colour | shared `MobileTabBar` already mounted, but **5** items (home · products · cart · orders · profile) | **done (§141)** — reduced to the 4 reference tabs |
| Footer | none | removed | keep removed |

## 2. Design tokens to reuse (no new system)

`bg: #F8FAFC` · surface `#FFFFFF` · border `#E2E8F0` · text `#0F172A` / muted `#64748B` ·
accent `#10B981` (Velnox) with `#065F46` for pressed states · radius card 16, chip 12, pill full ·
type: 18/600 section, 14/600 row, 12/400 muted, 11/500 label · spacing 4/8/12/16/24 · icons 20 (rail chips 24).

## 3. Order of work (phased, each independently verifiable)

1. **Bottom tab bar** — **done (§141)**: reused the existing shared `MobileTabBar`, item set reduced from 5
to the reference 4 (home · orders · notifications · profile). No new component was needed.
2. **Header brand bar** — **done (§142)**: mobile `ShopHeader` is a 56 px solid `#10B981` bar (mark 32 ·
white pill 40 with magnifier right · language · cart real count · chat). Search reuses `/products?q=`;
desktop bar unchanged. Measured 360–492 px; ≥768 px evidenced at rule level only (NOT MEASURED).
3. Category rail as icon circles.
4. Product grid tightening (2-col, 1:1, 12 px gap).
5. Profile page alignment with the same tokens (already partly done).
6. Remaining screens (listing, PDP, cart, checkout, orders, account, help).

## 4. Hard constraints carried over

No invented member ids, order counts, bank data, contact details, campaigns or LIVE data. Everything uses existing
routes/APIs. i18n keys go straight into the base `th/en/my` locale objects. No footer anywhere.

## 5. Status

Analysis: **done** (from real screenshots). Implementation: **steps 1–2 landed** (§141 bottom nav 4 tabs,
§142 mobile header brand bar); steps 3–6 remain (category rail, grid, profile, other screens).
Visual verification of both steps is **NOT VERIFIED** — the harness screenshot surface is still blocked
(§137); desktop widths ≥768 px not measured for the same reason.
