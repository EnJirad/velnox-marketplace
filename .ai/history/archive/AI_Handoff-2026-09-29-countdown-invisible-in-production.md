# AI Handoff archive — countdown invisible in production (2026-09-28)

Superseded in `.ai/AI_HANDOFF.md` by its own pointer now that §42 landed; the diagnosis below is kept
verbatim, and the owner action (apply migration 048) is restated in §37 and in
`.ai/context/payment.md`.

---

## 40. Countdown invisible in production — migration 048 never applied (2026-09-28)

**Root cause: production Neon has no `orders.payment_expires_at`.** Three migration runs died on
`exceeded the quota` (02:57Z, 14:38Z, 16:56Z); last success 2026-09-25, before 048 existed. The write
is then skipped by the deploy-order guard, `SELECT o.*` maps the absent column to
`paymentExpiresAt: null`, phase `none`, both pages render nothing — silent by design (§37's net).
Logic, API mapping and
deploy ruled out (the bundle carries the code); CI `d7282bb` green with the regression tests. Full
trace + owner check: `.ai/context/payment.md` → *Countdown not visible in production*.

**Shipped anyway:** the tier UI (`8261152`) — GREEN >15:00, YELLOW ≤15:00, RED ≤5:00, dark expired —
plus a bar measured against `orders.reservation_policy.reservationMinutes` (now on both read routes),
never a hard-coded 30; deployed on Vercel (chunks carry `reservationMinutes`/`progressbar`/
`criticalNote`).

**Owner action:** clear the quota → apply 048 (re-queued as `d7282bb`, comment-only, still failing)
→ place a NEW order. Rows created earlier keep `NULL` by design and will never show a countdown.
