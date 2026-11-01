---
name: local-browser-testing
description: "Use whenever you create or change a frontend page, layout, style, component or frontend bug fix in this repo. Launches the app locally with shell_background, opens it in the Android Harness browser, verifies render/DOM, tests interactions, reads console errors, and reports honest evidence. Never for production URLs."
category: general
---

# Local browser testing (Android Harness tools only)

Read `.ai/testing/LOCAL_UI_TESTING.md` first — it is the canonical procedure. This skill is the trigger + the
non-negotiable evidence rules. Do not duplicate the workflow here.

## When this skill applies

Any task that adds or edits UI: pages, layouts, styles, components, dialogs, forms, frontend bug fixes,
responsive/spacing/typography work, onboarding/empty states.

It does **not** apply to backend-only, schema, payment-logic, auth or infra tasks.

## Non-negotiables

1. **Never** use a production URL for UI verification. `localhost` or `127.0.0.1` only.
2. **Never** use `nohup … &`; a child started that way is reaped when the shell call ends (verified 2026-11-02).
   Use `shell_background` and record the job id.
3. **HTTP 200 ≠ rendered.** Always prove render with `browser_eval`:
   `{ title, readyState, hasBody: !!document.body, textLen: document.body?.innerText.length, vw: innerWidth, sw: document.documentElement?.scrollWidth }`.
4. **Harness failure ≠ app defect.** If `readyState` stays `"loading"`, `document.body` is null, or the console
   shows `__harnessUpdateScroll is not a function` / `appendChild` of null, stop and report a Harness failure
   (see §137 of the handoff). Do not "fix" the app for it.
5. **Screenshot needs a visible preview.** If capture fails, write **NOT CAPTURED** — never infer visuals.
6. **No network verification.** `browser_get_logs` is console-only.
7. **No responsive claims.** The viewport is not controllable (measured 492 px, once 980 px). Do not claim
   mobile/tablet/desktop coverage.
8. **No production cookies**, no real payments, no destructive writes, no fake test data.

## Workflow (short form)

1. Inspect the page source and its route; note expected elements and interactions.
2. Build if a preview needs `dist` (e.g. `VITE_API_URL=… bun --filter '@velnox/<app>' build`).
3. `shell_background`: `cd apps/<app> && bunx vite preview --port <p> --host 127.0.0.1 --strictPort`.
4. Readiness: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<p>/` → expect `200` (repeat a few times).
5. `browser_navigate` the exact URL, then run the render probe from rule 3.
6. `browser_get_dom` for structure; `browser_eval` for `getBoundingClientRect()` and overflow
   (`scrollWidth > innerWidth`).
7. Interact: `browser_click` / `browser_type` / `browser_scroll`, then re-measure.
8. `browser_get_logs(level="ERROR")`; attribute each error to app vs injected harness code by its source URL.
9. `browser_screenshot` only with the preview visible; otherwise NOT CAPTURED.
10. `bg_kill(<job>)` + a final `curl` proving the port is closed.

## Reporting template

Separate, never merged: source-code inspection · DOM inspection · screenshot inspection · interaction ·
responsive · network. Each is PASS / FAIL / NOT VERIFIED / NOT CAPTURED with the evidence that produced it.

## Related skills

- `impeccable` — design judgement (`references/critique.md`, `references/audit.md`); its CLI is unavailable, so
  label every run `⚠️ DEGRADED`.
- `verification-before-completion` (Superpowers) — run before any "done" claim.
