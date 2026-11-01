# Session summary — payments, UI shell, skills, local testing (2026-11-02)

Scope of this report: everything done in the long working session that produced this file. Every line below is
backed by a commit or a tool result; anything unproven is marked **NOT VERIFIED**.

## 1. Payments (sandbox, Stripe test mode)

| Item | Result |
|---|---|
| Real PromptPay sandbox payment | **PASS** — order `88e51b37…`, 100.00 THB, PI `pi_3UWrqaKp…`, `orders.status=paid`, 4 `payment_events` processed |
| Earlier card-sandbox evidence | `pi_3UWgrNKp…` 419.30 THB paid, events processed |
| Defect: rail switch dead-end (`409 DUPLICATE_PAYMENT_IN_PROGRESS`) | fixed — `f4e8bb1` |
| Defect: expired session blocked retries forever | fixed — `3e2afff` |
| Defect: cleanup could retire a `complete+paid` session | fixed — `1ccc00c` |
| Refund + duplicate-webhook replay tests | added, **green in CI** — `c247869`, `136465b`; Tests #250 success, Production DB Verify #66 success |
| Flaky order-number bound (CI red on an unrelated test) | de-flaked — `277a2b7` |
| Not tested | real dashboard refund, partial refunds, out-of-order refund webhook, Connect payouts, card entry in a browser (needs a human) |

## 2. VelCenter / VelSeller

- `LanguageProvider` was missing in both apps → wired (`63f48ed`).
- Shared `LanguageSwitcher` (TH/EN/MY) added and mounted in VelCenter's header (`015407d`).
- Desktop vertical rail for the existing tabs (`b472b40`).
- Mobile drawer: `max-md:*` arbitrary classes were not applied on device → plain wrapper with `hidden md:block` /
  `fixed inset-y-0 left-0 z-50` (`b32dae7`). Measured at 492 px: closed → `display:none`; open → overlay + all
  sections; selecting a section closes it; no horizontal overflow.
- Shell copy (nav/title/realtime/queue) translated to th/en/my (`5d7996c`).
- **Not done:** the panels' own body copy is still Thai-only; viewport matrix 360–1920 not measured.

## 3. VelShop

- Marketing footer removed centrally — `ShopFooter` returns `null` (`1015e74`).
- Profile: cookie-policy row (`c0e5e50`), four-tile order-status card (`f31e4fa`), external terms/privacy rows with
  a real `<a>` variant of `ProfileRow` (`d47240d`).
- **Not done:** tile counts (no aggregate/status API), the reference's compact header with member id (not
  exposed), group renaming, contact e-mail/phone (no real values supplied), promo banner (no campaign source).

## 4. Skills installed into the Harness

- **impeccable**: full upstream skill (`SKILL.md` + 42 `references/` + 11 `scripts/`); `reference/` renamed to
  `references/` and 66 paths rewritten so the loader resolves them. `skill_view` verified. CLI binary is not in
  the git checkout → `hooks`, `pin`, `doctor`, `live`, `generate` are **not executable**; every critique run must be
  labelled `⚠️ DEGRADED`.
- **superpowers**: all 15 skills installed, `category: general` added, discoverable via `skills_list`. Harness has
  shell, subagents, parallel tasks and `todo_write`; it does **not** have session hooks, the Node installer or
  auto-activation triggers.
- **local-browser-testing** (workspace skill): trigger + evidence rules for the built-in browser, mirrored into
  `.harness/skills/` so it is discovered; the procedure lives in `.ai/testing/LOCAL_UI_TESTING.md`.

## 5. Local UI testing

- Documented workflow `.ai/testing/LOCAL_UI_TESTING.md` — `shell_background` server, `curl` readiness, browser
  render probe, DOM/geometry, console, optional screenshot, `bg_kill`.
- Validated on a scratch fixture (`127.0.0.1:4180`): navigation + render probe OK, screenshot **NOT CAPTURED**
  (preview hidden), cleanup verified (`000`).
- `/profile` against a real velShop preview: server 200 and navigation OK, **page never rendered**
  (`readyState:"loading"`, `document.body === null`) with console errors from the Harness's own injected script
  (`__harnessUpdateScroll`, `appendChild` of null). Classified as a **Harness instrumentation failure**, not a
  Velnox defect. The host app's source is not in this workspace, so a fix cannot be made or verified here.

## 6. Repository state

- `HEAD == origin/main` at the time of writing, working tree clean, no force-push at any point.
- CI: Tests workflow green on the payment commits; Production DB Verify green on `277a2b7`.
- `.ai/AI_HANDOFF.md` is **above its soft size ceiling** (~70 KB, limit ~55 KB): archive closed sections before
  adding the next one.
