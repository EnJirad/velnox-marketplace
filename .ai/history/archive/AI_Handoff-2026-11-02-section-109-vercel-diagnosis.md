# §109. Vercel deployment diagnosis (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §109. Vercel deployments are healthy; the "failures" were superseded builds (2026-11-02)

**HEAD:** `0524f46`. **Report:**
[`.ai/history/2026-11-02-vercel-deployment-diagnosis.md`](./history/2026-11-02-vercel-deployment-diagnosis.md).

Audited the four Vercel projects through the API: latest deployment of `0524f46` is **READY** for velshop
(`dpl_4Bxe5u2u…`), velseller (`dpl_6nyrhFC4…`), velnox (`dpl_FRmmuSa8…`) and velcenter (`dpl_GjhMtn8Z…`).
The three that "failed" were `CANCELED` builds of the previous commit `1ccc00c`, cancelled when the newer
docs commit arrived mid-build; **zero ERROR deployments exist** for any project, so there was no
type/dependency/config failure. Production domains answer 200 (velnox's real domain is
`velnox-theta.vercel.app`; deployment URLs 302 to SSO by design). Local install/typecheck/build/tests green.
No code fix was warranted; `velnox.com` does not resolve and is a separate DNS question.

---
