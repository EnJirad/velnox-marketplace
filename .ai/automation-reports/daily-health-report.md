# Velnox Market — Daily Development Health Report

**Date:** 2026-11-02 (Asia/Bangkok) · **Workspace:** `velnox-marketplace-81f20048`
**Branch:** `main` · **HEAD:** `1e51ff0` · **Overall:** 🟡 one test-suite failure, environmental — no code defect found

Read-only inspection. No source file, configuration, dependency, database row or deployment was touched.

---

## 1. Git status

| Check | Result |
|---|---|
| Current branch | `main` |
| Local HEAD | `1e51ff0f7888f889cf829d86efe93715e56c00a7` |
| `origin/main` | `1e51ff0f7888f889cf829d86efe93715e56c00a7` |
| Ahead / behind | `0` / `0` — **in sync** |
| Working tree | clean — no staged, unstaged or untracked files |
| Working tree after builds | still clean (`dist/` is gitignored) |
| `git diff --check` | clean, exit 0 |

Sync protocol from `.ai/AI_RULES.md` §0 applied: `git fetch origin`, then local SHA compared with `origin/main`. Case = **in sync**, so no pull and no divergence stop.

**Latest commit:** `1e51ff0` — `fix(products): guard draft upload keys and stored image size`

Recent history: `68dd372` fix(velseller) stop repeat saves from duplicating product images · `7396a4a` fix(velseller) restore existing product images in the editor · `b11779f` feat(velseller) language-aware seller nav and 44px primary actions · `1c39a20` fix(velseller) use the Velnox accent for primary actions.

**Uncommitted changes:** none.

## 2. Documentation inspected

- `AGENTS.md` — protocol, context-loading policy, safety rules.
- `.ai/README.md` — startup protocol, context map, "read the smallest useful set".
- `.ai/AI_RULES.md` §0 — remote-is-the-source-of-truth synchronization table.
- `.ai/AI_HANDOFF.md` — current state; latest recorded pass is §158. File is 105 KB / 1614 lines.
- `.ai/context/testing.md` — the only legitimate source of test commands and the `TEST_DATABASE_URL` / never-`DATABASE_URL` rule.
- `.ai/context/architecture.md` — 4 frontends → 1 Express backend → Neon + R2; source-of-truth invariants.
- `.github/workflows/test.yml` — CI definition for typecheck and the suite.

## 3. Build status — PASS

| Command | Result |
|---|---|
| `bun run build:apps` | **exit 0** — vel shop, velseller, velcenter, velnox all built with vite 7.3.6 |
| `bun run build:velcenter` | **exit 0**, no warnings emitted |
| `bun run build:velnox` | **exit 0**, no warnings emitted |
| `bun run typecheck` (4 apps) | **exit 0** — all four workspace packages exited 0 |
| `bun --filter @velnox/backend typecheck` | **exit 0** |
| `bunx tsc --noEmit` in `backend/` | **exit 0**, no diagnostics |
| `bun run lint` | **not a real gate** — script is `echo 'Lint not yet configured'`, exit 0 |
| `bun run i18n:check` | **exit 0** — `th=1346 en=1346 my=1346 keys, all locales at parity` |

No TypeScript errors anywhere. Build artefacts: velseller `index-C0g_ZvaC.js` 671.59 kB, velcenter `index-CYbL6pt9.js` 701.13 kB (informational only — Vite emitted no chunk-size warning in this configuration).

**There is no lint stage in this repository.** `lint` and `format` are echo placeholders. A "lint passed" line must therefore be read as "lint not configured", never as evidence of code quality.

## 4. Test status — 1 file fails

| Metric | Value |
|---|---|
| Command | `bun run test` → `bun test backend/tests` |
| Files / tests | 82 / 1545 |
| Passed | 1155 |
| Skipped | 382 |
| **Failed** | **8** |
| `expect()` calls | 11807 |
| Duration | 3.22 s |
| Exit code | **1** |

All 8 failures are in one file, one `describe` block: `backend/tests/test-database-isolation.test.ts` → `test database guard — a real test process fails closed` (line 232). Running that file alone: **31 pass / 8 fail / 39 tests** — the other seven blocks in the file (behaviour, pool-factory, sslmode, source-level scan, CI-workflow checks) all pass.

Failing assertions:

1. production `DATABASE_URL` → non-zero exit with the refusal message
2. production `DATABASE_URL` → the pool factory itself refuses
3. `RENDER=true` → refused
4. a disposable database → allowed, exit 0
5. no database configured → allowed to skip, exit 0
6. CI-shaped env: safe `TEST_DATABASE_URL` + production `DATABASE_URL` → accepted
7. Neon branch + documented opt-in accepted, production endpoint still refused
8. the same Neon branch without the opt-in is refused

## 5. Root cause analysis

**Environmental. The guard is not broken and no application code regressed.**

The helper that every failing assertion routes through:

```ts
// backend/tests/test-database-isolation.test.ts ~line 236
function runBunProbe(script: string, databaseEnv: Record<string, string>) {
  return Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
```

On Android/Termux, `process.execPath` is **not** the bun binary — it is the dynamic linker `/apex/com.android.runtime/bin/linker64` (`process.argv0` holds the real binary). So the child process becomes `linker64 -e <script>`, which aborts with `error: expected absolute path: "-e"` and exit 1, before any guard code runs.

Because the probe can never produce the expected result, **both** directions fail: the four cases expecting "non-zero exit + `REFUSING TEST AGAINST PRODUCTION DATABASE`" get exit 1 but no refusal text, and the four cases expecting exit 0 get exit 1. This is a single root cause, not eight independent defects.

A second, independent environment factor reinforces it: the test builds a stripped child env (`PATH`, `HOME`, `NODE_ENV` only). Invoking the real bun binary in that env fails with **126 Permission denied**, because the Termux loader needs `LD_LIBRARY_PATH` / `PREFIX`. Desktop Linux and GitHub Actions satisfy neither assumption.

**Proof the guard logic still works** — direct probes with the real interpreter, using only synthetic non-routable DSNs from the test file:

| Probe | Expected | Observed |
|---|---|---|
| production-looking `DATABASE_URL`, `NODE_ENV=test` | refuse | exit 1 + `REFUSING TEST AGAINST PRODUCTION DATABASE` |
| disposable `TEST_DATABASE_URL` | accept | exit 0 |
| `RENDER=true` + disposable | refuse | exit 1 |
| pool factory, disposable + production (`backend/db/index.ts`) | accept, silent | exit 0, empty output |

So `decideTestDatabase()` / `assertTestDatabaseIsSafe()` / `resolveConnectionString()` behave exactly as specified. The production-database safety net is intact.

The same file is expected to pass in CI: `.github/workflows/test.yml` runs `ubuntu-latest` with a disposable `postgres:16` service, `TEST_DATABASE_URL` set, and `process.execPath` pointing at a real bun/node binary.

**Coverage note:** 382 tests are skipped locally because `TEST_DATABASE_URL` is unset. They are not failures, but DB-gated integration behaviour is unverified in this run.

## 6. Detected problems and recommended fixes

### P1 — Guard test uses a non-portable executable lookup (blocks a green run here)

- **Severity:** medium — blocks a clean `bun run test` on Android/Termux; no production impact.
- **Location:** `backend/tests/test-database-isolation.test.ts:236` (`runBunProbe`).
- **Fix direction:** resolve the interpreter with a portable lookup — `Bun.which("bun")` / `process.argv0` falling back to `process.execPath` — and forward the loader variables the host needs (`LD_LIBRARY_PATH`, `PREFIX` on Termux). Where no runnable interpreter exists, skip the block with a clear message rather than failing.
- **Hard constraint:** do **not** relax the assertions. The refusal contract (`REFUSING TEST AGAINST PRODUCTION DATABASE` + non-zero exit) is the safety net that stops a stray `bun test` from seeding production Neon.
- **Requires human approval** — it is a test-file edit, and this pass is read-only.

### P2 — No lint or format gate

`lint` and `format` are placeholders. Recommendation: adopt ESLint + typescript-eslint (or Biome) and wire it into CI. Tool and rule-set choice is the owner's decision.

### P3 — 382 DB-gated tests skipped locally

Set a **disposable** `TEST_DATABASE_URL` (bootstrap with `db/run-sqleditor.sql`) to exercise them. Never point them at the production `DATABASE_URL`; the guard refuses it.

### P4 — `.ai/AI_HANDOFF.md` exceeds the edit-tool ceiling

105 KB / 1614 lines, above the ~55 KB limit documented in `AGENTS.md`. Its own policy already calls for archiving superseded sections into `.ai/history/archive/` and keeping current state plus remaining gaps. Recommendation: archive the older §s so automated edits keep matching. Documentation change, human-approved.

### P5 — Backend typecheck is not in the root `typecheck` script

`CI` runs `bun --filter @velnox/backend typecheck` separately, so a local `bun run typecheck` misses backend typing. Recommendation: add the backend filter to the root `typecheck` script. Configuration change — reported, not applied.

## 7. Recommended next actions

1. Fix P1 with approval, keeping every assertion intact.
2. Confirm the file is green on `ubuntu-latest` — that would definitively prove the local failure is environmental.
3. Add a real lint gate.
4. Run the skipped suite against a disposable database.
5. Archive older `AI_HANDOFF.md` sections back under the edit ceiling.
6. Align the `typecheck` scripts so local and CI cover the same surface.

---

## Appendix — commands actually executed

```
git status · git log · git fetch origin · git rev-parse HEAD · git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main · git diff --check
bun run typecheck
bunx tsc --noEmit            (cwd: backend/)
bun --filter @velnox/backend typecheck
bun run i18n:check
bun run test
bun test backend/tests/test-database-isolation.test.ts
bun run build:apps
bun run build:velcenter · bun run build:velnox
bun run lint
```

Environment notes: bun 1.4.4, node v26.12.1, dependencies already installed (root `node_modules`, `bun.lock` present). No package was installed or upgraded. `TEST_DATABASE_URL`, `DATABASE_URL`, `STRIPE_SECRET_KEY` and `R2_ACCOUNT_ID` were **unset**; only their presence was tested, never their values, and no secret was printed or stored.
