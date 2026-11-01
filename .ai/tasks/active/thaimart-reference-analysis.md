# ThaiMart reference analysis → VelShop mapping (2026-11-02)

Source: the two owner-supplied screenshots (home feed, scrolled). This is the **primary** visual reference.
Brand palette is **not** copied: VelShop keeps Velnox mint/green as its accent.

## 1. Anatomy extracted from the screenshots

| Region | Reference spec (measured visually) | VelShop today | Action |
|---|---|---|---|
| Brand bar | Solid brand colour, ~56 px, logo mark 32 px + **search pill** (white, fully rounded, 40 px, search icon right) + cart with badge + chat icon; sticks to the top of the content area | `ShopHeader` has logo + search but not the pill/badge/chat cluster | rebuild header as brand bar with pill search, cart badge, chat |
| Category rail | Horizontal scroll, 6+ items, 56 px circular icon chip + 11 px two-line label, active item tinted | category chips (text) | convert to icon circles + labels |
| Content | White cards on `#F8FAFC`-ish page, 12–16 px radius, 1 px border, 16 px side margins | similar tokens exist | unify radius/margins |
| Promo strip | Thin bordered card with dashed divider + big number | absent | optional, only with real campaign |
| Section heading | 18 px bold with a small brand dot, plus 12 px muted subtitle | mixed sizes | adopt 18/12 pattern |
| LIVE row | 1.1-card-wide 4:5 tiles, red LIVE pill, eye-count pill | absent | needs real live data — skip unless source exists |
| Product grid | 2 columns, gap 12 px, image 1:1, price bold, seller/caption 11 px | exists | tighten to 2-col with 12 px gap and 1:1 images |
| Bottom nav | Fixed, 4 items (หน้าแรก · คำสั่งซื้อ · การแจ้งเตือน · โปรไฟล์), 24 px icon + 11 px label, active = brand colour | none (footer was removed) | **add** fixed bottom tab bar, app-like |
| Footer | none | removed | keep removed |

## 2. Design tokens to reuse (no new system)

`bg: #F8FAFC` · surface `#FFFFFF` · border `#E2E8F0` · text `#0F172A` / muted `#64748B` ·
accent `#10B981` (Velnox) with `#065F46` for pressed states · radius card 16, chip 12, pill full ·
type: 18/600 section, 14/600 row, 12/400 muted, 11/500 label · spacing 4/8/12/16/24 · icons 20 (rail chips 24).

## 3. Order of work (phased, each independently verifiable)

1. **Bottom tab bar** (new shared component, mounted once in the velShop layout) — the single biggest
   "app not website" signal in the reference.
2. **Header brand bar**: pill search + cart badge + chat icon.
3. Category rail as icon circles.
4. Product grid tightening (2-col, 1:1, 12 px gap).
5. Profile page alignment with the same tokens (already partly done).
6. Remaining screens (listing, PDP, cart, checkout, orders, account, help).

## 4. Hard constraints carried over

No invented member ids, order counts, bank data, contact details, campaigns or LIVE data. Everything uses existing
routes/APIs. i18n keys go straight into the base `th/en/my` locale objects. No footer anywhere.

## 5. Status

Analysis: **done** (from real screenshots). Implementation: **not started** — the bottom tab bar is step 1 and is
the only change that should land in the next commit, followed by the header, each with a local browser check.
