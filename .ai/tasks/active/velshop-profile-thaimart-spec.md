# VelShop profile — ThaiMart-style app screen (build spec for the next agent)

> Source of truth for the redesign the owner asked for. Reference: screenshots of the ThaiMart
> "บัญชีของฉัน" page (mobile). We copy the **structure and flow**, never the brand, colours or copy.

## 0. Intent

VelShop must feel like an **application**, not a website: no footer anywhere (already done — `ShopFooter`
returns `null`), and the account screen becomes the hub that used to be spread across the footer.

## 1. What the reference screen does (from the screenshots, top → bottom)

1. **Minimal top bar**: back chevron + the member reference (e.g. `THM…`) centred; nothing else.
2. **Card 1 — order status strip** (one card, four equal tiles, icon + caption): ที่ต้องชำระ · ที่ต้องจัดส่ง ·
   ที่ต้องได้รับ · สำเร็จ. Each tile is a shortcut into the corresponding order filter.
2. **Promo banner** (optional): a full-width coloured strip with one CTA button.
3. **Card group "เกี่ยวกับฉัน"** — rows with leading icon + label + chevron:
   ข้อมูลส่วนตัว · ที่อยู่ของฉัน · ข้อมูลบัญชีธนาคาร.
4. **Group "นโยบายและเงื่อนไข"** — ข้อกำหนดการใช้บริการ · นโยบายความเป็นส่วนตัว.
4. **Group "ติดต่อเรา"** — แชทกับแอดมิน · อีเมล · เบอร์โทร (each a row; e-mail/phone as `tel:`/`mailto:` links).
5. **Full-width destructive button** at the very bottom: ออกจากระบบ (confirm dialog first).
6. No tab bar inside the page, no marketing sections, compact cards, 16 px radius, 1 px borders.

## 2. How that maps onto VelShop (do not invent new APIs)

| Reference block | VelShop implementation |
|---|---|
| Header | existing `ShopHeader` + a compact back button and the member number (derive from `useAuth()` user id/member id if exposed; otherwise show the display name — **do not invent an ID format**) |
| Order tiles | counts from the existing customer orders API (`GET /api/customer/orders`, already used by `MyOrders`). Four tiles = 4 status filters. **No new endpoint.** |
| Promo banner | only render when a real campaign exists; otherwise omit the block entirely |
| เกี่ยวกับฉัน | existing routes: `/profile/account` (ข้อมูลส่วนตัว), `/addresses` (ที่อยู่) — bank details only if the API already returns them |
| นโยบาย | `/cookies` exists today; ข้อกำหนด/ความเป็นส่วนตัว currently live on `velnox-theta.vercel.app/terms|privacy` — link out **from the profile**, as an external row, and label it as such |
| ติดต่อ | `/help` (แชทกับแอดมิน) exists; e-mail/phone **must be supplied by the owner** — never fabricate |
| ออกจากระบบ | existing `signOutOpen` AlertDialog + `useAuth` sign-out |

## 3. Implementation notes (hard-won)

- File: `apps/velshop/src/pages/ShopProfile.tsx` (414 lines). Menu rows are data-driven
  (`{ to, labelKey, descKey, icon }` arrays at lines ~73–85) — **add rows there**, do not clone JSX.
- **Locale merging**: do **not** layer a patch object with object spread over an existing namespace —
  that produced `TS1117 duplicate property` and a narrowed `profile` type (attempted 2026-11-02, reverted).
  Edit the base `profile` object for `th`, `en` and `my` directly in
  `packages/shared/src/lib/i18n/locales/index.ts`, then run `bun run i18n:check` (must stay
  `th=en=my` count).
- Icons already imported: `Package, Heart, MapPin, MessageCircle, Bell, LifeBuoy, CircleUserRound, LogOut,
  ShieldCheck, ShoppingBag`. Reuse them; add only what is needed.
- Keep the page inside the existing `ShopHeader`/`main` shell; the footer is gone, so the page must end with the
  sign-out button (plus `pb-24` breathing room for the safe area if a bottom bar is ever added).

## 4. Ordered work items

1. **Order-status strip** — 4 tiles (reuse the order list query; derive counts client-side; hide tiles with 0
   only if the design requires it).
2. **Cookie/legal group** — add `/cookies` row + external ข้อกำหนด/ความเป็นส่วนตัว rows.
5. **Contact group** — `/help` row now; e-mail/phone rows once the owner supplies them.
4. **Sign-out** — keep the destructive button as the last element, full width.
5. Optional promo strip — only with a real campaign id.

## 4. i18n keys to add (th / en / my, complete sentences)

`profile.orderTiles.pendingPayment|toBeShipped|toReceive|completed`,
`profile.groupPolicy`, `profile.terms`, `profile.privacy`,
`profile.groupContact`, `profile.contactChat`, `profile.contactEmail`, `profile.contactPhone`.

Business terms stay as-is (คำสั่งซื้อ, ที่อยู่, คุกกี้) — do not re-word.

## 5. Acceptance / verification

1. `cd apps/velshop && bun run typecheck` → pass.
- `bun --filter '@velnox/velshop' build` → success.
- `bun run i18n:check` → parity unchanged (currently 1294 keys per locale).
2. Browser check via the local harness (proxy `:8899` + `vite preview` on the app's port, cookie set on
   `localhost` — see §13 of `2026-11-02-velcenter-local-auth-harness.md`):
   - page has **no footer**, ends with the sign-out button;
   - four tiles navigate to the right order filter;
   - rows navigate to the existing routes;
   - no horizontal overflow at 390–430 px;
   - language switch updates the labels immediately.
3. Record measurements (`getBoundingClientRect`) for the tile strip and the last button.

## 6. Do not

- Do not add a footer back, marketing sections, or a bottom tab bar inside this page.
- Do not invent support channels, promo campaigns, member-number formats or bank data.
- Do not add endpoints, tables or mock data.
- Do not touch payment, auth, RBAC or Velseller/VelCenter files.
