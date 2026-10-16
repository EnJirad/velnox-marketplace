# Archived from .ai/AI_HANDOFF.md (2026-10-16)

Moved out verbatim to keep the handoff under the ~55 KB edit-tool ceiling. Superseded by
§76 (selling units built) as far as the Phase-2 design block is concerned; the parking
contract in the first half is still the live rule.

---

## §75. MVP repositioned: buy & sell — VelRepeat + Customer Memory PARKED (2026-10-14)

**Full plan / brief:** [`.ai/tasks/active/mvp-marketplace-restructure-2026-10-14.md`](tasks/active/mvp-marketplace-restructure-2026-10-14.md)
— **§5 is what SHIPPED; §6–§9 are PROPOSED DESIGN and implement nothing.**

**The decision.** The owner re-scoped Velnox: a normal marketplace first (ordinary customers buy and
pay normally), plus a **second buyer track for community / village shops** — order by line item, buy
**per piece or per pack**, and pay **less per unit** on a pack, so a weekly restock of only the items
that ran out is a normal order. Velnox does not build its own branch network; it connects shops to
real sellers. **VelRepeat and Customer Memory are out of the product for now and return later.**

**Shipped (Phase 1) — parking, not deletion.** Two fail-closed switches per module:
`packages/shared/src/lib/features.ts` (const) and `backend/lib/features.ts` (env, only the literal
`"true"` enables) — `VELREPEAT_ENABLED`, `CUSTOMER_MEMORY_ENABLED`. With them off: the **6 VelRepeat
route modules are not mounted** (404), **both VelRepeat schedulers do not start**,
`ensureVelRepeatV2Tables()` does not run, `/api/events/{track,merge}` and `/api/memory/insights`
answer 404 through `parkedModule()`, `useTracking()` is a no-op (no event, no anonymous id), the two
velShop VelRepeat routes are unregistered, and every VelRepeat / memory rail, button, dialog, footer
link, help category, seller authoring section and VelCenter card is hidden behind the flag.
**Every table, migration, route, job, page, component, test and i18n key remains in the repository.**

**Captions rewritten (th/en/my values only, parity intact):** `footer.tagline`,
`footer.shopDesc`, `cartDrawer.tagline`, `home.seoDesc` → "ซื้อขายของจริง · ปลีกและส่ง ในที่เดียว";
the whole corporate site (`CorporateHome.tsx` rewritten, `corporate/content.ts`, `CorporateLayout.tsx`)
now tells the retail + community-shop wholesale story, and its wholesale illustration is labelled
**ตัวอย่าง (example)** so no marketing block reads as live storefront data.

**Verified this pass (no DB available — see below):** `bun run typecheck` 4/4 exit 0 ·
`bunx tsc --noEmit -p backend/tsconfig.json` exit 0 · `bun run i18n:check` →
**th=1496 en=1496 my=1496, all locales at parity** · `bun run build:apps` 4/4 exit 0 ·
`bun test backend/tests` → **1715 pass / 382 skip / 1 fail**, the one failure being
`ECONNREFUSED 127.0.0.1:5432` in `checkout-group-payment-visibility.test.ts`'s DB-backed `describe`
(**pre-existing gap: that describe is not gated on `hasTestDatabase()`**; nothing listens on 5432
here and the file imports only untouched modules). **No browser E2E ran; `bun run lint` is not
configured.**

**NOT built (do not describe as working):** the wholesale buyer track itself — pack pricing, shop
accounts, MOQ, restock lists. Today a shop can only order the same retail lines as anyone else.
Phase 2's model is specified in the brief (§6): `product_pack_sizes` + `cart_items`/`order_items`
(`pack_size_id`, `pack_pieces`, `pack_name`), where `quantity` = **selling units**, the pack price is
authoritative, the per-unit price is **derived for display only**, and inventory sees only
`quantity * pack_pieces` — one inventory authority, one `sold_count` authority, legacy rows
bit-identical at `pack_pieces = 1`. **§9 of the brief lists the owner decisions that must be answered
before that code is written.**

---

**Note on this file's size:** it is ~61 KB, PAST the ~55 KB edit-tool ceiling — the next append to
this file will fail. Move a section to `history/archive/` with a pointer BEFORE appending
(`## 9.4–9.6` is the oldest still-live block; §5/§8/§10–§22/§37–§72 are already pointers or
archived). The 2026-10-14 pass could only append because the tail it matched was itself the size note.
