# §90. OAuth config read at use time (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-10-31 to keep the live handoff
> under this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §90. OAuth config read at use time — the 11 red CI cases (2026-10-31) — COMPLETE

**Symptom.** `main` failed 11/1439 on every push since §87: each `oauth-route.test.ts` case got `302` to
`…/auth?error=google_not_configured`, and the same file passed when run alone.

**Root cause (reproduced with bun 1.4.4).** `routes/auth.ts` snapshotted its four secrets into module-level
`const`s, while `routes/center.ts`, `routes/seller.ts` and `routes/upload.ts` import it only for
`invalidateCachedProfile`. Any test that imported one of those first evaluated `auth.ts` with no Google
env and froze `""` for the run; the OAuth tests' later env write + dynamic import could not undo it.

**Fix.** `googleClientId()`, `googleClientSecret()`, `googleRedirectUri()`, `jwtSecret()` read
`process.env` at use time. No assertion weakened, no CI env added, production contract unchanged.

**Verified.** Device: `1087 pass / 360 skip / 8 fail` (the 8 are Termux-only isolation probes; the 11 OAuth
cases green); backend typecheck PASS; CI on the fix commit is the confirmation.

---

