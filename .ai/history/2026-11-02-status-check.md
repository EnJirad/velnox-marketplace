# Status check before continuing VelShop app-shell work (2026-11-02)

**HEAD:** `1015e74` == `origin/main` · working tree **clean**.

## What is on main right now (verified)

| Item | State |
|---|---|
| VelShop marketing footer | **removed centrally** — `ShopFooter` returns `null`, every page footer-free (`1015e74`) |
| VelCenter mobile drawer | **fixed** (`b32dae7`) — plain wrapper, `hidden md:block` / `fixed inset-y-0 left-0 z-50` |
| VelCenter shell copy | Thai/English/Burmese keys for nav, title, subtitle, realtime, queue error (`5d7996c`) |
| LanguageSwitcher | shared component, mounted in VelCenter + VelSeller; TH/EN/MY |
| VelSeller / VelShop languages | provider present in both apps |

## Checks executed now

- `bun run i18n:check` → **OK th=1294 en=1294 my=1294**
- `bun run typecheck` → **4/4**
- `@velnox/velshop` build → **success** · `@velnox/velcenter` build → **success**
- `bun test backend/tests` → 1529 tests, the 8 documented Termux-only `database guard` probes fail (baseline)
- `git diff --check` → clean · tree clean

## Attempted and reverted in the previous step

Adding a "นโยบายคุกกี้" row to the phone profile plus `profile.cookies*` keys failed typecheck
(`TS1117 duplicate property`, and the `profile` namespace type lost keys) because the locale merges used object
spread over an existing namespace. **Reverted**, repo green again. The correct route is editing the base locale
objects for th/en/my directly, not layering a patch object.

## Remaining work (in order)

1. Profile: cookie-policy row + 4-tile order status card (data from the existing `MyOrders` API; no new endpoint).
2. Contact card — blocked on real LINE/email/phone values from the owner (must not be invented).
3. i18n sweep across all four apps (`center.*`, `seller.*`, remaining `shop.*`); `i18n:check` after each batch.
4. Local harness (`:5173` velcenter + proxy `:8899`) is transient: if the app restarts, both jobs die and the
   browser shows `ERR_CONNECTION_REFUSED`. Restart with the two commands recorded in §13 of
   `2026-11-02-velcenter-local-auth-harness.md`.

## Not verified

No browser/viewport pass was run in this check; the last real browser evidence remains the drawer measurement
(closed → `display:none`, opened → overlay + sections, selection closes it, 492 px).
