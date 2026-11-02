# Task Brief — VelShop banner system, VelCenter "Marketing", VelCenter responsive pass

TASK BRIEF MARKETING-RESPONSIVE-01
Branch `main`, HEAD `31f03a2`, working tree clean at authoring time. Investigation was
static (read-only); no build, test or dev server was run in Phase A. Every claim below
carries `file:line` from this HEAD.

---

## REQUEST

1. **VelShop homepage banner system.** Admin-managed banners. Three content modes are all
   valid — image-only, text-only, image+text. Neither is ever mandatory. No fabricated
   placeholder content. An empty banner is rejected. Conceptual fields: title, subtitle,
   image, optional CTA (label + destination), active flag, display order, optional
   scheduling, placement, promotion type. Homepage shows admin-managed marketing content;
   it is managed from VelCenter.
2. **VelCenter "Marketing" management section** — its own section, NOT inside Settings.
   Banner CRUD, enable/disable, reorder, preview, image upload through the EXISTING R2
   flow, text-only support, optional CTA. Promotions/ads share the same architecture.
3. **VelCenter Settings responsive redesign** — content overflows the right edge on
   mobile. Fix the layout (no global horizontal scrollbar). Stacked on mobile,
   sidebar/panel on desktop. Marketing is separated out of the Settings IA.
4. **VelCenter-wide responsive audit** — enumerate concrete defects per page, fix shared
   layout primitives first, keep 44 px targets, no unrelated rewrites.

---

## CURRENT ARCHITECTURE (evidence, HEAD `31f03a2`)

### A. Announcement infrastructure that already exists — EXTEND IT

The pipeline exists end to end and works in production (§147, §152):

| Piece | Where | State |
|---|---|---|
| Storage | `platform_settings` row, key `shop_announcements`, JSON array | `backend/routes/announcements.ts:21` |
| Table | `platform_settings (key TEXT PK, value TEXT NOT NULL, description, updated_at, updated_by)` | `db/schema.sql:685-691` |
| Public read | `GET /api/announcements` — active only, sorted, **never 500s** (catch → `[]`) | `backend/routes/announcements.ts:93-102` |
| Admin read | `GET /api/admin/announcements` — `settings.manage` | `:105-123` (`:108` the gate) |
| Admin write | `PUT /api/admin/announcements` — `settings.manage`, replace-the-list, 20 000-byte cap | `:125-165` (`:128` gate, `:138` cap) |
| Validation | `normaliseAnnouncements()` / `normaliseItem()` — currently **requires a title** | `:59-83` (`:62-63`) |
| Item shape v1 | `{id, title, description, imageUrl, linkUrl, active, sortOrder}`, max 10 | `:25-33`, `:22-23` |
| Image upload | purpose `announcement` → key `announcements/{userId}/{uuid}.webp`; presign gated by `settings.manage`; ownership enforced at confirm | `backend/routes/upload.ts:53`, `:84-85`, `:170-172`, `:345-354` |
| Confirm side-effect | `media` row only; the URL is stored on the banner itself | `backend/routes/upload.ts:483` |
| VelCenter editor | `AnnouncementSettings` card, rendered **inside the Settings tab** | `apps/velcenter/src/components/AnnouncementSettings.tsx`, mounted at `apps/velcenter/src/pages/Center.tsx:2379` |
| VelShop consumer | `AnnouncementCarousel` (fixed 136/168 px stage, autoplay, swipe, dots, arrows, aria-live) | `apps/velshop/src/components/shop/AnnouncementCarousel.tsx` |
| VelShop data | `GET /api/announcements` via `useCommerceData`, mapped to `Announcement[]`, honest platform-fact fallback when empty | `apps/velshop/src/pages/ShopHome.tsx:238-293` |
| Client routes | 3 entries already registered | `packages/shared/src/lib/api-routes.ts:339-342` |
| Audit | **none** for announcement saves (unlike `PATCH /api/admin/settings`, `backend/routes/admin.ts:228-231`) | — |
| Tests | **none** for announcements; `upload-security.test.ts:117-123` pins the purpose allowlist and key shape | `backend/tests/announcements*` does not exist |

Blocking gaps against the request, all inside `normaliseItem` (`announcements.ts:59-74`):

- **image-only is rejected** — `if (!title) return null;` (`:62-63`).
- So is a subtitle-only item.
- No `subtitle` (the v1 name is `description`), no CTA **label** (`linkUrl` is the
  destination only), no `placement`, no promotion `type`, no `startsAt`/`endsAt`.
- An invalid item is silently dropped (`:80`) — the admin gets no error, so "empty banner
  rejected" is currently "empty banner silently disappears".
- The carousel always renders a text column and its CTA label is the hard-coded
  `t("home.bannerCta")` (`AnnouncementCarousel.tsx:191`, `:174-179`) — an image-only slide
  cannot be expressed even if the API allowed it.

### B. VelShop homepage render slot

`ShopHome.tsx:341-345` — one `<section bg-white>` between `ShopHeader` and the category
rail, `mx-auto max-w-6xl px-4 sm:px-6`, containing `<AnnouncementCarousel items={announcements} />`.
The memo at `:251-293` maps remote rows and falls back to real platform facts
(welcome / live listing count / live verified count) only when nothing is published.
Categories section ends at `:378`; rails follow. That is the whole insertion surface.

### C. R2 upload flow (reuse, do not rebuild)

Four call sites implement the same presign → PUT → confirm sequence:
`apps/velshop/src/components/shop/ImageUpload.tsx:73`, `apps/velseller/src/pages/SellerProfile.tsx:67`,
`apps/velcenter/src/components/AnnouncementSettings.tsx:83-124`,
`packages/shared/src/lib/chat-attachment.ts:53`. The VelCenter one is the pattern for
Marketing: `compressImage()` → `POST /api/upload/presign {purpose:"announcement"}` →
`PUT` to R2 → `POST /api/upload/confirm {objectKey}` → returned URL saved on the banner.
Deleting `AnnouncementSettings.tsx` and adding the editor keeps the copy count at four —
no new duplication, and no refactor of the other three apps (scope).

### D. VelCenter navigation and Settings

`Center.tsx` is a single 2 666-line page: one Radix `Tabs` (`:1172-1280`) where the tab list
doubles as the desktop rail (`md:grid md:grid-cols-[15rem_minmax(0,1fr)]`, `:1178-1180`)
and as the mobile drawer (`:1185`, `fixed … top-16 w-72`). Tabs are URL-driven
(`?tab=…`, `:302-313`), so a new tab needs no router change. Tab visibility is
`canSeeTab()` (`:181-240`); Settings is `:2339-2659`.

### E. Settings overflow — what is actually there

* The Settings body is already `grid gap-5 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]`
  (`:2353`) with a `min-w-0` content column (`:2378`) — the desktop sidebar and the mobile
  stack are correct in principle.
* The **section nav is a horizontal scroller**: `flex gap-2 overflow-x-auto` (`:2356`),
  buttons `shrink-0` (`:2366`) with `whitespace-nowrap` labels (`:2371`). Six Thai labels
  are wider than a 360 px content column, so the last chip is cut off at the right edge
  with no scrollbar affordance. **This is the only statically provable clip on the page.**
* `AnnouncementSettings` is mounted unconditionally at `:2379` — above *every* Settings
  section — and its row is a rigid three-column flex (`w-24 shrink-0` thumb, `min-w-0`
  fields, `shrink-0` control stack: `AnnouncementSettings.tsx:188-252`). At 360 px the
  field column is ~100 px wide. Not a clip, but the densest block on the page.
* **Root cause of the reported symptom class:** `packages/shared/src/index.css:128-141`
  puts `overflow-x: hidden` on `html`, `body` and `#root`. Any too-wide descendant is
  therefore **clipped, not scrollable** — the user sees "content cut off at the right
  edge" and can never scroll to it. That is why the fix must remove the offending width
  and must not add a page-level scroller.
* No other Settings child is statically wider than 360 px, so the exact offender must be
  **measured** before it is "fixed" (see STEPS step 1 and TEST CASES T10-T12).

### F. Permissions

`backend/lib/permissions.ts` — 8 codes, owner/admin implicit, deny-by-default; VelCenter
mirrors it in the browser through `roleHoldsPermission()` (`packages/shared/src/lib/api-client.ts:45-52`).
`settings.manage` is what both announcement endpoints and the `announcement` upload
presign already enforce (`announcements.ts:108,128`; `upload.ts:347-351`).

**Decision: no new permission code.** `marketing.manage` would have to be added to
`PERMISSION_CATALOG` *and* to `routeSources` in `backend/tests/center-rbac.test.ts:34-56`
(announcements routes are deliberately absent from that map), or the guard at `:223-233`
("every catalog code is enforced by an endpoint") fails. Marketing mirrors the endpoint at
the UI layer with `case "marketing": return holds("settings.manage");` — the exact code the
API enforces, no new catalog entry, no new checkbox, no test surgery.

### F2. Existing tests touching this area

`backend/tests/upload-security.test.ts:117-123` (purpose allowlist + key shape — unchanged
by this task). `backend/tests/center-rbac.test.ts` reads `Center.tsx` as source and asserts
`holds("settings.manage")` is present (`:216`) — an added `case "marketing"` is additive.
No announcement test exists.

### G. i18n constraints (measured)

`announceAdmin.*` — 17 keys — sits at `th.ts:503` (byte 36 446), `en.ts:468` (19 469),
`my.ts:409` (33 380): all **inside** the ~55 KB edit window.
`announce.*` (12 public keys) is at `th.ts:488`, `en.ts:453`, `my.ts:394` — also inside.
The `center` namespace is *not* in the locale files at all: it is a patch object in
`packages/shared/src/lib/i18n/locales/index.ts:1210-1230`, which starts at byte 77 000+
of an 82 881-byte file (`thCenterUi` begins at byte 78 100) — **outside the match
window**. Therefore the Marketing nav label must NOT be added to `center.nav`; it goes in
the new `marketing` namespace next to `announceAdmin`.

---

## SCHEMA DECISION

**No schema change. Extend the JSON contract inside the existing `platform_settings` row.**

Why (≤10 lines):

- `platform_settings.value` is `TEXT` (`db/schema.sql:685-691`); the banner list is 10
  objects, already stored, already served, already written by a tested production path
  (§152 verified presign → PUT → confirm → public API → rendered slide).
- A `banners` table buys nothing the request needs: no joins, no per-row permissions, no
  FK, no cross-entity reference. It would cost two canonical SQL files, the reconciler
  parity test (`db-run-sqleditor-reconciler.test.ts`), `db/verify-reconciler.sh` and a
  production migration run — for ≤10 owner-managed slides.
- Lowest value/highest risk: a new table needs production DDL before deploy, and this
  sandbox cannot run the reconciler (§151: `db/verify-reconciler.sh` BLOCKED).
- The four new concepts (placement, type, schedule, CTA label) are *fields of a banner*,
  not relations; they belong in the JSON object.
- Rollback is a no-op: the change is backward compatible on read (see below), so a
  rollback is a code revert with the stored JSON still readable by v1.
- Keep the key `shop_announcements` — renaming it would orphan whatever the owner has
  published and requires a data migration.
- Do NOT touch `db/schema.sql`, `db/run-sqleditor.sql`, `db/run-update.sql`.

**Banner contract v2** (stored in `platform_settings.shop_announcements`, array, max 10):

```json
{
  "id": "a1",
  "type": "announcement" | "promotion" | "ad",
  "placement": "home_hero" | "home_strip",
  "title": "",
  "subtitle": "",
  "imageUrl": null,
  "ctaLabel": "",
  "ctaUrl": null,
  "active": true,
  "sortOrder": 0,
  "startsAt": null,
  "endsAt": null
}
```

Rules, enforced in **one pure module** so they are unit-testable without a database:

| Rule | Detail |
|---|---|
| content | at least one of `title`, `subtitle`, `imageUrl` non-empty after trim — otherwise the item is REJECTED with its index |
| lengths | `title` ≤120, `subtitle` ≤240, `ctaLabel` ≤32, `imageUrl`/`ctaUrl` ≤1000 (existing `asUrl` rules: `/…` or `http(s)://…) |
| enums | unknown `type` or `placement` → REJECTED (explicit, not coerced) |
| schedule | `startsAt`/`endsAt` must parse; `endsAt > startsAt`; both normalised to ISO-8601 UTC; `null` = unbounded |
| visibility | `active === true && (now >= startsAt OR startsAt null) && (now <= endsAt OR endsAt null)` |
| order | sorted by `sortOrder`, ties by `id` |
| legacy read | `description`→`subtitle`, `linkUrl`→`ctaUrl`, missing `type`→`announcement`, missing `placement`→`home_hero`, missing schedule→`null`. A v1 row with a title stays valid. |

`PUT` behaviour change: an item that violates a rule makes the request fail
`400 {code:"VALIDATION_ERROR", message:"banner <n>: <reason>"}` instead of being silently
dropped. The editor pre-validates, so the 400 is a backstop, not the UX.

---

## APPROACH

Extend, do not duplicate:

1. Move the banner rules out of the route into `backend/lib/banners.ts` (pure, no `db`
   import) and have `routes/announcements.ts` do only IO. Same paths, same permission,
   same key, same response envelope.
2. Rename `AnnouncementSettings.tsx` → `MarketingBanners.tsx` (delete the old file) and
   move it from Settings into a new `marketing` tab. One destination for banner content,
   one editor, one endpoint set.
3. Extend `AnnouncementCarousel` for the three content modes and a real CTA label; add a
   second, small render slot (`home_strip`) so `placement` is a real capability and not a
   decorative field. Both slots read the ONE existing fetch.
4. Settings layout pass: replace the horizontally-scrolling section strip with a wrapping
   grid on mobile and keep the sticky 240 px sidebar on `lg`; drop the announcement card
   from Settings; relabel the unrelated `store_announcement` field so Settings stops
   looking like the banner home.
5. Fix the two other genuine shell/responsive defects found in the audit (collapsed rail
   label overflow, sub-44 px nav rows) inside the same shell pass, and leave the rest
   documented as deferred. No new shared component: the shared UI kit is already
   responsive — `DialogContent` is `w-full max-w-[calc(100%-2rem)] sm:max-w-lg`
   (`packages/shared/src/components/ui/dialog.tsx:61`), `Table` wraps itself in
   `overflow-x-auto` (`packages/shared/src/components/ui/table.tsx:5-18`), selects are
   popper-positioned (§146). The VelCenter shell *is* the shared layout primitive for this
   app, and it lives in `Center.tsx`.

---

## AFFECTED FILES

New:
- `backend/lib/banners.ts` — the v2 contract: types, allowlists, `normaliseBanners()`,
  `isBannerVisible()`, back-compat mapping. No `db` import.
- `backend/tests/banners.test.ts` — pure unit tests of that module.
- `backend/tests/marketing-surface.test.ts` — source contracts (routes + VelCenter IA +
  no duplicate editor + Settings no longer hosts it). Pattern: `center-rbac.test.ts:34-56`.
- `apps/velcenter/src/components/MarketingBanners.tsx` — the Marketing editor (derived
  from `AnnouncementSettings.tsx`).
- `apps/velshop/src/components/shop/HomePromoStrip.tsx` — the `home_strip` slot.

Modified:
- `backend/routes/announcements.ts` — delegate to `lib/banners.ts`; 400 on invalid items;
  visibility filter on the public read; keep paths, permission, key, cap. (Optional,
  non-blocking: one `writeAuditLog` call, `backend/lib/audit-log.ts:55`.)
- `apps/velcenter/src/pages/Center.tsx` — `Tab` union `:114`; `canSeeTab` `:181-240`;
  nav trigger next to `:1273-1277`; `<TabsContent value="marketing">`; remove
  `<AnnouncementSettings />` `:2379`; Settings section nav `:2355-2376`; label of
  `settings-announcement` `:2424`; collapsed-rail label handling `:1204-1278`.
- `apps/velshop/src/components/shop/AnnouncementCarousel.tsx` — `Announcement` interface
  `:7-17`; image-only layout; `ctaLabel`; eyebrow from data; alt derivation.
- `apps/velshop/src/pages/ShopHome.tsx` — mapping `:251-293` (v2 fields + placement split);
  strip slot after the categories section (`:378`). Fallback block stays byte-equivalent.
- `packages/shared/src/lib/i18n/locales/th.ts`, `en.ts`, `my.ts` — rename
  `announceAdmin` → `marketing` in place (same block position) and extend; add
  `announce.typeAnnouncement` / `typePromotion` / `typeAd`.
- `packages/shared/src/lib/api-routes.ts:339` — comment only (the paths do not change).

Deleted:
- `apps/velcenter/src/components/AnnouncementSettings.tsx` — replaced by
  `MarketingBanners.tsx`. No second editor may survive.

Not touched (see SCOPE LIMITS): `db/*.sql`, `backend/routes/upload.ts`,
`backend/lib/permissions.ts`, `backend/routes/admin.ts`, `backend/tests/upload-security.test.ts`,
`packages/shared/src/index.css`, `packages/shared/src/components/ui/*`,
`apps/velshop/src/pages/ShopDetail.tsx`, `apps/velseller/**`, `apps/velnox/**`.

---

## STEPS

1. **Measure before editing (P0).** Start the authenticated VelCenter harness (§149):
   `HARNESS_ROLE=center HARNESS_PORT=5192 python3 .harness/proxy.py` and
   `VITE_API_URL=http://127.0.0.1:5192 bun run dev:velcenter -- --port 5193`.
   For every tab (`overview, chat, orders, intel, products, sellers, categories, staff,
   audit, incidents, settings`) at **360, 390, 430** px record
   `document.documentElement.scrollWidth`, `innerWidth`, and every element whose
   `getBoundingClientRect().right` exceeds `innerWidth` (query + class). Record the
   offenders in the pass record. **Do not press Save anywhere** — the proxy writes to the
   production API (§149).
2. Create `backend/lib/banners.ts` with the v2 contract above, exporting
   `BANNER_MAX_ITEMS`, `BANNER_TYPES`, `BANNER_PLACEMENTS`, `Banner`, `normaliseBanners`,
   `isBannerVisible`, and a `readBannerText()`/`primaryText()` helper used by both the API
   and (mirrored) the preview. Pure: no `db`, no `express`.
3. `backend/routes/announcements.ts`: replace `normaliseAnnouncements` with the lib call;
  400 + index on rejected items; public read filters `isBannerVisible(item, new Date())`;
  keep `SETTINGS_KEY`, `MAX_ITEMS`, the 20 000-byte guard, both permission gates and the
  "never 500" public catch. Do not change paths or the response envelope.
4. `backend/tests/banners.test.ts`: the cases in TEST CASES T6.
5. `packages/shared/src/lib/i18n/locales/{th,en,my}.ts`: rename the `announceAdmin`
   namespace to `marketing` in place and add the keys listed below, plus
   `announce.typeAnnouncement|typePromotion|typeAd` (the type labels are shared with the
   storefront, so they live in the public `announce` namespace, not twice). Identical key
   sets and identical interpolation placeholders in all three files. Do not touch
   `locales/index.ts`.

   `marketing` keys (35, exactly this set):
   `nav, title, desc, add, empty, save, saved, saveFailed, previewTitle, previewEmpty,
   fieldTitle, fieldSubtitle, fieldImage, fieldCtaLabel, fieldCtaUrl, fieldType,
   fieldPlacement, fieldStartsAt, fieldEndsAt, scheduleHint, scheduleNone, active,
   activeHint, upload, uploaded, uploadFailed, removeImage, up, down, remove, unsaved,
   placementHero, placementStrip, errorEmpty, errorSchedule`
   — reuse existing `common.loading` and `home.bannerCta`; do not duplicate them.
6. `apps/velcenter/src/components/MarketingBanners.tsx` (new, from `AnnouncementSettings.tsx`
   minus the v1 shape): a single ordered list; per-row preview + fields; add/remove/reorder;
   active toggle; type + placement selects (shared Radix `Select`, never native);
   `datetime-local` start/end converted with `new Date(local).toISOString()` and back;
   the existing presign → PUT → confirm upload (purpose `announcement`); Remove-image
   button that only clears the URL; one Save (`PUT`) with an unsaved indicator and a
   client-side validation that disables Save while any row is invalid. Layout:
   `flex flex-col gap-3 sm:flex-row` per row, every flex/grid child `min-w-0`, no fixed
   pixel column wider than `w-24` at `sm` and full-width above the fields on mobile.
   Interactive controls that are new: `min-h-11` / `size-11` (44 px).
7. Delete `apps/velcenter/src/components/AnnouncementSettings.tsx`.
8. `Center.tsx`: add `"marketing"` to `Tab` (`:114`); add
   `case "marketing": return holds("settings.manage");` to `canSeeTab`; add the
   `TabsTrigger value="marketing"` (`Megaphone` icon, label `t("marketing.nav")`) before
   the Settings trigger; add `<TabsContent value="marketing"><MarketingBanners /></TabsContent>`;
   import the new component; remove the `AnnouncementSettings` import and its render at
   `:2379`; relabel `settings-announcement` (`:2424`) to the shop-page notice (same
   `store_announcement` key, same behaviour).
8b. Settings layout (`:2355-2376`): replace the `overflow-x-auto` + `shrink-0` +
   `whitespace-nowrap` strip with a wrapping grid `grid grid-cols-2 gap-2 sm:grid-cols-3
   lg:flex lg:flex-col lg:gap-1`, buttons `min-h-11 items-start justify-start px-3 py-2.5
   text-left text-[13px] leading-4` and labels allowed to wrap (remove `whitespace-nowrap`).
   Keep `lg:sticky lg:top-24 lg:self-start` and the `minmax(0,…)` grid at `:2353`.
   Every settings card keeps `min-w-0`.
9. Shell/rail: wrap each nav label in `<span>` and add `data-collapsed={navCollapsed}` to
   the `TabsList` (`:1204`), so that collapsed mode is
   `[&[data-collapsed=true]_[role=tab]]:justify-center` +
   `[&[data-collapsed=true]_[role=tab]>span]:sr-only` (never `hidden` — the accessible
   name must survive). Nav rows get `min-h-11` in place of `py-2` (`:1207`).
10. `AnnouncementCarousel.tsx`: extend `Announcement` with `ctaLabel?`,
   `kind?`, `placement`; render **image-only** (image column `w-full`, no empty text
   column), **text-only** (today's layout) and both; CTA label = `item.ctaLabel ||
   t("home.bannerCta")`, CTA rendered only when `href` exists; eyebrow = the type label
   from data; `alt` = first non-empty of `title`/`subtitle`/`ctaLabel`, else `""` only
   when the slide also has no link (documented as decorative). Keep the fixed stage
   height, autoplay, swipe, dots, arrows, `aria-live`, `prefers-reduced-motion`.
11. `apps/velshop/src/components/shop/HomePromoStrip.tsx` (new, ≤80 lines): takes the
   already-fetched `home_strip` items, renders the first one as a compact band
   (thumb when `imageUrl`, title/subtitle clamped, CTA chip when `ctaUrl`); renders
   `null` when there is none; whole band is the link when `ctaUrl` exists; no autoplay,
   no invented copy.
12. `ShopHome.tsx`: map v2 fields (`subtitle`, `ctaLabel`, `ctaUrl`, `type`,
   `placement`) in the existing memo; split `hero = items.filter(placement === "home_hero")`
   and `strip = items.filter(placement === "home_strip")`; pass `hero` to the carousel
   (slot unchanged) and mount `<HomePromoStrip items={strip} />` right after the
   categories section (`:378`). Keep ONE fetch. Keep the fallback block exactly as it is.
13. `backend/tests/marketing-surface.test.ts`: the source-contract assertions in T7.
14. Run TEST CASES, fix what they surface, complete the measurement sweep from step 1 and
    put the numbers in the pass record.

---

## ACCEPTANCE CRITERIA

Criteria are numbered from the request. Each names its observable evidence.

### Banner system (BAN)

**BAN-01 — Admin-managed banners are the single content source.**
`grep -n "shop_announcements" backend/routes/` returns exactly one module
(`backend/routes/announcements.ts`); no second table, route family or store. VelCenter
reads/writes only `api.centerAdmin.getAnnouncements` / `saveAnnouncementsAction`
(`packages/shared/src/lib/api-routes.ts:340-341`).

**BAN-02 — image-only, text-only and image+text are all valid; neither is required.**
`backend/tests/banners.test.ts` passes a case for each of the three shapes, with the
*other* field empty, and asserts the item survives. Evidence: `bun test
backend/tests/banners.test.ts` exit 0. Also `grep -n "if (!title) return null" backend/`
→ no match.

**BAN-03 — no fabricated placeholder content.**
`MarketingBanners.tsx`, `HomePromoStrip.tsx` and the carousel contain no hard-coded slide
copy, no sample titles, no `example.com`/placeholder image URL; the preview renders an
empty hint (`marketing.previewEmpty`) rather than sample content. Grep evidence in T8.

**BAN-04 — an empty banner is rejected.**
Unit test: `normaliseBanners([{id:"a1"}])` → zero items and one rejection whose index is 0.
Runtime contract: `PUT` with an empty item returns `400` and body
`error.code === "VALIDATION_ERROR"` naming the index. UI: Save is `disabled` while any row
is invalid and the row shows `marketing.errorEmpty`.

**BAN-05 — the field set exists.**
`backend/lib/banners.ts` declares exactly `id, type, placement, title, subtitle, imageUrl,
ctaLabel, ctaUrl, active, sortOrder, startsAt, endsAt`; `AnnouncementCarousel` accepts and
renders `title`, `subtitle`, `imageUrl`, `ctaLabel`, `ctaUrl`.

**BAN-06 — active flag honoured.**
Unit test: `isBannerVisible({active:false}, now) === false`; `GET /api/announcements`
filters with it (`grep -n "isBannerVisible" backend/routes/announcements.ts`), and the
admin read still returns inactive rows.

**BAN-07 — display order honoured.**
Unit test: input in reversed `sortOrder` comes back ascending, ties broken by `id`.
Editor move ↑/↓ rewrites `sortOrder` for every row before save (visible in the payload).

**BAN-08 — optional scheduling.**
Unit tests at the boundaries: before `startsAt` → hidden; exactly at `startsAt` → visible;
at `endsAt` → visible; `endsAt + 1ms` → hidden; `null/null` → always visible. Invalid or
inverted dates → item rejected (BAN-04 path).

**BAN-09 — placement is real, not decorative.**
Exactly two placements exist and both render: `home_hero` → the existing carousel slot
(`ShopHome.tsx:341-345`), `home_strip` → `<HomePromoStrip />` mounted after the category
section. A banner saved with `placement:"home_strip"` does not appear in the carousel and
vice versa (unit test on the split + grep of both mount points).

**BAN-10 — promotion type.**
`BANNER_TYPES = ["announcement","promotion","ad"]`; the type drives the slide eyebrow from
`i18n` (`announce.typeAnnouncement|typePromotion|typeAd`), never a literal string; an
unknown type is rejected (unit test).

**BAN-11 — VelShop renders admin content, and the existing honest fallback is unchanged.**
`ShopHome.tsx` maps the v2 fields and splits by placement; the fallback array
(`ShopHome.tsx:265-292`) is functionally identical (welcome / live catalogue count / live
verified count) and only used when nothing is published. `git diff` on that block shows no
invented campaign, discount, countdown or percentage.

**BAN-12 — public contract stability.**
`GET /api/announcements` keeps its path and shape, still answers `200 {success:true,data:[]}`
when the settings row is missing or the read throws; a stored v1 array
(`{title, description, linkUrl, active, sortOrder}`) normalises to v2 without loss (unit
test "legacy shape").

### VelCenter Marketing + responsive (VC)

**VC-01 — Marketing is its own section, not Settings.**
`Center.tsx` contains `case "marketing":`, a `TabsTrigger value="marketing"` and a
`TabsContent value="marketing"`; `?tab=marketing` is reachable and deep-linkable (URL-driven
tabs, `:302-313`); `grep -rn "AnnouncementSettings" apps/` → no match, and `Center.tsx`
contains no `<MarketingBanners` inside the `settings` panel (it is outside `:2339-2659`).

**VC-02 — CRUD.**
Add (append a row), edit (any field), delete (remove a row) all work in local state and
persist through one `PUT`; the payload posted equals the rendered order.

**VC-03 — enable/disable.**
Each row has an active control (`role="switch"` or a labelled checkbox, ≥44 px) that maps
to the `active` field; disabling keeps the row in the admin list and removes it from the
public list (BAN-06).

**VC-04 — reorder.**
Each row has up/down buttons with `aria-label` (`marketing.up` / `marketing.down`), disabled
at the ends, that swap rows and renumber `sortOrder`.

**VC-03..05 must be operable with one thumb at 360 px** — every new control
`min-h-11`/`size-11` and inside the row's `min-w-0` container.

**VC-05 — preview.**
Each row renders a live preview of the real slide from the current local values, in all
three content modes, with no sample content: text-only shows text, image-only shows the
image, both shows both, empty shows `marketing.previewEmpty`. Evidence: source + a rendered
row created locally (never saved against production).

**VC-06 — image upload goes through the EXISTING R2 flow.**
`MarketingBanners.tsx` calls `POST /api/upload/presign {purpose:"announcement"}`, `PUT` to
the returned URL, then `POST /api/upload/confirm` — same three calls as
`AnnouncementSettings.tsx:83-124`. `backend/routes/upload.ts` is unchanged
(`git diff` on that file is empty), and `backend/tests/upload-security.test.ts` still
passes.

**VC-07 — text-only supported.**
Saving a banner with no image is a normal path: no placeholder thumbnail is rendered in
the editor or on the storefront, and the carousel renders the text-only layout.

**VC-08 — optional CTA.**
`ctaLabel` + `ctaUrl` are independent optional fields. No `ctaUrl` → no CTA rendered and
the slide is not a link; `ctaUrl` only → CTA label falls back to `home.bannerCta`.
`javascript:`/`data:` destinations are refused by the existing `asUrl` rule.

**VC-09 — promotions/ads share the architecture.**
One store, one endpoint pair, one editor component, one VelShop slide renderer; `type` is
the only discriminator. `grep -rn "promotions\|/api/admin/promotions" backend apps` → no
second system.

**VC-10 — Settings layout is responsive and nothing is clipped.**
At 360, 390 and 430 px, on `?tab=settings`: `document.documentElement.scrollWidth ===
document.documentElement.clientWidth` **and** no element has
`getBoundingClientRect().right > innerWidth + 0.5`. The section navigation is a wrapping
grid on mobile (no `overflow-x-auto`, no `whitespace-nowrap`) and a sticky sidebar at `lg`;
section buttons are ≥44 px tall.

**VC-11 — Marketing is out of the Settings IA.**
Settings renders company / marketplace / commission / localization / media / access only
(`SETTINGS_SECTIONS`, `:140-147`) and no banner editor; the `store_announcement` field is
relabelled as the shop-page notice (`:2424`) with its key and behaviour unchanged.

**VC-12 — VelCenter-wide audit, shared-first, bounded.**
The RESPONSIVE-AUDIT TABLE below is reproduced in the pass record with a verdict per row
(fixed / deferred + reason). Every "fixed" row is fixed by changing the VelCenter shell or
a component's own container — no `overflow-x: hidden` added anywhere, no `!important`, no
`transform: scale`. `packages/shared/src/index.css` and `packages/shared/src/components/ui/*`
are unchanged. No touched control ends up below 44 px. No file outside AFFECTED FILES
changes.

---

## RESPONSIVE-AUDIT TABLE

Measured/derived at HEAD `31f03a2`. "Fix level" = shared (applies to every VelCenter page
through the shell) or local. "Verdict" is the required outcome.

| # | Surface | Defect (evidence) | Fix level | Verdict |
|---|---|---|---|---|
| R1 | Global shell | `html, body, #root { overflow-x: hidden }` (`packages/shared/src/index.css:128-141`) turns any too-wide child into **clipped** content with no scrollbar — the reported "overflows right edge". | shared (policy) | **keep** — do not remove; the fix must eliminate the offending width, and acceptance measures `scrollWidth`, not a scrollbar. |
| R2 | Settings section nav | `flex gap-2 overflow-x-auto` + `shrink-0` + `whitespace-nowrap` (`Center.tsx:2356,2366,2371`) — 6 Thai labels exceed 360 px; last chip clipped, no affordance. | shared (VelCenter shell) | **fix** (step 8b) |
| R3 | Settings body | Announcement editor mounted above every section (`:2379`) — densest block on the page, wrong IA. | shared (IA) | **fix** — moved to Marketing (steps 6-8). |
| R4 | Collapsed rail | `navCollapsed` only changes the grid column to `4.5rem` (`:1179`); labels are never hidden and `TabsTrigger` is `whitespace-nowrap` (`ui/tabs.tsx:45`) → labels paint across the content column at md+ when collapsed. | shared (shell) | **fix** (step 9) |
| R5 | Nav rows | `[&_[role=tab]]:py-2` ≈ 36 px (`:1207`) — under the 44 px target on the primary navigation. | shared (shell) | **fix** — `min-h-11`. |
| R5b | Mobile drawer | `fixed inset-x-0 bottom-0 top-16 z-50 w-72` (`:1185`) — 288 px, fits 360; §148 offset preserved. | local (shell) | **keep as-is**. |
| R6 | Tables (orders / intel / staff / customer / audit / employees / moderation) | `hidden overflow-x-auto md:block` + `Table min-w-[760|820|560|620|880px]` (`Center.tsx:1408-1409,1605-1606,2008-2009,2262-2263`, `AuditLogTab.tsx:404-405`, `EmployeeManager.tsx:333-334`, `ProductModerationQueue.tsx:447`) — each has a mobile card/list sibling. | local (already correct) | **keep** — the pattern is the reference; new Marketing code must not add a table. |
| R7 | Incidents | `PaymentIncidentTab` renders a 7-column `Table` at every width with no mobile variant (`PaymentIncidentTab.tsx:214-…`); `Table` self-wraps in `overflow-x-auto` (`ui/table.tsx:5-18`), so it scrolls inside the card rather than clipping the page. | local | **defer** — usable, not clipped; a mobile card list is a new pattern, outside the smallest safe scope. Recorded as a known UX gap. |
| R8 | Chat header | status/assignee `SelectTrigger` fixed `w-[145px]`/`w-[190px]` (`ChatManagement.tsx:894,912`) inside `flex-wrap` (`:888`) — wraps, no clip; magic widths only. | local | **defer** (cosmetic). |
| R9 | Verification queue | `SelectTrigger w-[160px]` (no shrink) in `flex gap-2` (`SellerVerificationQueue.tsx:224-226`), row is `flex-col sm:flex-row` (`:214`) — fits 360. | local | **defer**. |
| R10 | Incidents filter | `min-w-[240px] flex-1` (`PaymentIncidentTab.tsx:167`) inside `flex flex-wrap` (`:166`) — fits. | local | **defer**. |
| R11 | Dialogs | Shared `DialogContent` is `w-full max-w-[calc(100%-2rem)] sm:max-w-lg` (`ui/dialog.tsx:61`); VelCenter already passes mobile-safe overrides (`VerificationReviewDialog.tsx:295`, `ProductModerationQueue.tsx:873`, `OrderShipDialog.tsx:131`). | shared (already correct) | **keep** — do not modify the primitive. |
| R12 | Shared `TabsList` | Default `h-9 w-fit` (`ui/tabs.tsx:29`) is overridden by VelCenter's `h-auto w-full` (`Center.tsx:1207`); changing the default would regress VelShop/VelSeller. | shared (risk) | **keep** — documented, not changed. |
| R13 | Marketing (new) | Must not repeat R2/R6: stacked rows, `min-w-0` on every child, no fixed column > `w-24`, no table, previews use `aspect` + `object-cover`. | local (new code) | **requirement** (steps 6, 11). |

---

## TEST CASES

Run from the repo root unless stated. Report real exit codes, never a claim.

| ID | Command | Expected |
|---|---|---|
| T1 | `bun run i18n:check` | exit 0; th/en/my key counts equal; report the number (was 1339 → new value). `marketing` present in all three with identical keys/placeholders. |
| T2 | `bun run typecheck` | exit 0 (4 apps). |
| T3 | `bun run build:velshop` | exit 0. |
| T4 | `bun run build:velcenter` | exit 0. |
| T5 | `cd backend && bun tsc --noEmit` | exit 0. |
| T6 | `bun test backend/tests/banners.test.ts` | all pass. Cases: image-only, text-only, both, empty rejected (index), unknown type rejected, unknown placement rejected, `javascript:` URL refused, schedule boundaries ×4, inactive hidden, order ascending + tie-break, legacy v1 shape mapped, cap 10, lengths truncated. |
| T7 | `bun test backend/tests/marketing-surface.test.ts` | all pass. Assertions: `announcements.ts` calls `normaliseBanners` + `isBannerVisible`; both gates are `"settings.manage"`; `Center.tsx` has `case "marketing"`, `value="marketing"`, and no `<AnnouncementSettings`; `MarketingBanners.tsx` contains `purpose: "announcement"` and `min-h-11`; the Settings section nav no longer contains `overflow-x-auto`. |
| T8 | `grep -rn "example.com\|lorem\|placeholder banner" apps/velcenter/src/components/MarketingBanners.tsx apps/velshop/src/components/shop/` | no match (BAN-03). |
| T9 | `git diff --stat -- db/ backend/routes/upload.ts backend/lib/permissions.ts packages/shared/src/components/ui packages/shared/src/index.css` | empty (no schema, upload, permission or shared-UI change). |
| T10 | VelCenter dev (harness, §149) + `mcp__chrome_devtools__emulate {viewport:"360x800x3,mobile,touch"}` → `evaluate_script` on `?tab=settings` | `scrollWidth === clientWidth`; offender list empty. Repeat at 390 and 430. |
| T11 | Same measurement on `?tab=marketing`, `?tab=overview`, `?tab=orders`, `?tab=intel`, `?tab=products`, `?tab=sellers`, `?tab=categories`, `?tab=staff`, `?tab=audit`, `?tab=incidents` | `scrollWidth === clientWidth`; offender list empty except a row already declared DEFERRED in the audit table (R7/R8/R9/R10 have no page-level offender). |
| T12 | Same, if `emulate` is unavailable | in-app browser at the only renderable width (492 px) + built-CSS grep for the new classes (`lg:flex-col`, `grid-cols-2`, `min-h-11`, `sr-only` variant). Then record 360/390/430 as **NOT VERIFIED**, never as pass. |
| T13 | VelShop dev (harness, port 5191) → `/` | carousel renders; with nothing published the honest fallback slides appear exactly as before; the strip slot is absent; `overflowX === 0`. |
| T14 | Editor preview without writing to production | open `?tab=marketing` through the proxy, click Add (local row only), fill title / subtitle / image URL text, confirm the preview changes and the three content modes render; **reload without pressing Save**. Then `curl` the public endpoint through the proxy and confirm it is unchanged. |
| T15 | `bun run test` | 0 **new** failures. The 8 `test-database-isolation` subprocess probes fail on this sandbox (§151/§153) — pre-existing, unchanged count, must be stated as such. |
| T16 | `git diff --check` | exit 0, no whitespace errors. |
| T17 | `git status --short` | only AFFECTED FILES (+ the pass record). |

Measurement snippet for T10/T11 (`evaluate_script`):

```js
() => {
  const vw = window.innerWidth;
  const offenders = [...document.querySelectorAll("body *")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 0.5; })
    .slice(0, 12)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`);
  return { vw, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, offenders };
}
```

---

## RISKS

1. **The local harness writes to production.** `.harness/proxy.py` forwards to
   `https://velnox-api.onrender.com` (§149), so pressing Save in the local VelCenter edits
   the real `platform_settings.shop_announcements`. Verification must stay read-only
   (T14), or a save must be reverted immediately.
2. **Last-write-wins.** `PUT` replaces the whole list; two admins editing at once clobber
   each other. Accepted (existing behaviour, ≤10 owner-managed items); do not add
   per-item endpoints this round.
3. **Behaviour change on invalid items.** v1 silently dropped them; v2 returns 400. If the
   owner's stored array already contains an invalid item, the first Save will fail until it
   is fixed — the editor must show it inline, not just toast.
4. **i18n rename blast radius.** Renaming `announceAdmin` → `marketing` edits three files
   at byte ~36 KB / 19 KB / 33 KB — inside the match window, but a wrong insertion point
   fails. `i18n:check` is the guard; a raw key on screen means a missing key.
5. **Image-only slide layout.** Removing the text column changes the visual balance of the
   fixed-stage carousel; dots and arrows are absolutely positioned over the slide, so an
   image-only slide must keep a bottom scrim/hit area clear.
6. **`sr-only` vs `hidden` on the collapsed rail.** `hidden` would delete the tab's
   accessible name; use `sr-only` only, and keep the `title`/`aria-label` behaviour intact.
7. **Legacy rows.** Back-compat mapping (`description`→`subtitle`, `linkUrl`→`ctaUrl`)
   must run on read AND on the next write, otherwise a save rewrites history as empty
   subtitles.
8. **Two fetches on the home page.** Both slots must derive from the existing single
   `useCommerceData` call (`ShopHome.tsx:241-249`); adding a second request doubles
   storefront latency for no reason.
9. **`overflow-x: hidden` tempts a "fix".** Adding another `overflow-x-hidden` somewhere
   hides the symptom and keeps the clipped content unreachable. T9/T10 exist to catch it.
10. **Test-suite noise.** `bun run test` already has 8 environment failures; a changed count
   or a new failing file is a real regression signal and must be investigated, not waived.

---

## SCOPE LIMITS (must NOT be touched)

- **No schema change.** `db/schema.sql`, `db/run-sqleditor.sql`, `db/run-update.sql`
  untouched; no new table; the settings key stays `shop_announcements`.
- **`backend/routes/upload.ts` unchanged** — purpose `announcement`, its key shape and its
  `settings.manage` gate stay exactly as they are (pinned by
  `backend/tests/upload-security.test.ts:117-123`).
- **`backend/lib/permissions.ts` unchanged** — no `marketing.manage`, no catalog edit, no
  change to `backend/tests/center-rbac.test.ts`.
- **`backend/routes/admin.ts` unchanged** — `store_announcement` keeps its key and
  behaviour; only its VelCenter label changes.
- **No shared-UI edits**: `packages/shared/src/components/ui/*` and
  `packages/shared/src/index.css` untouched; no new shared component, no second theme or
  component system.
- **No realtime change** — do not publish `config:updated` for banner saves, do not touch
  `apps/velcenter/src/lib/center-events.ts` or `backend/realtime/*`.
- **No R2 delete endpoint**, no media cleanup job; removing a banner clears the URL only
  (same limitation as §152's probe object).
- **Other apps untouched** — `apps/velseller/**`, `apps/velnox/**`,
  `apps/velshop/src/pages/ShopDetail.tsx` (per-shop `announcement`).
- **No per-page hacks for the responsive pass** — no `!important`, no `transform: scale`,
  no `overflow-x: hidden` additions, no per-page `max-w` patches; fix the shell or the
  component's own container, or defer with a reason in the audit table.
- No dependency installs, no lockfile change, no unrelated refactor of the four duplicated
  upload call sites, no commit from this brief's author.

---

## WHAT CANNOT BE VERIFIED HERE (declare, never fake)

- **Any live write path**: `PUT /api/admin/announcements` against a real Neon + the R2
  presign/PUT/confirm round trip need `DATABASE_URL`/R2 credentials and an authorized
  session. Local dev proxies to production, so exercising them mutates real content →
  **NOT VERIFIED by construction**; covered instead by the pure unit tests (T6) and the
  source contracts (T7).
- **Production rollout order**: no DDL is needed, so there is no migration step to verify —
  the backend can deploy before or after the frontend; the old client ignores unknown
  fields, the new client tolerates v1 rows (BAN-12).
- **Viewport sweep at 360/390/430** if `mcp__chrome_devtools__emulate` cannot resize on
  this device (previous sessions: CDP unavailable on android/arm64, §137/§152) → then
  record **NOT MEASURED**, with the built-CSS evidence only.
- **`db/verify-reconciler.sh` / `bun run db:verify`** stays BLOCKED (no disposable
  PostgreSQL); irrelevant this round because there is no schema change — do not run it as
  evidence of anything else.
```
