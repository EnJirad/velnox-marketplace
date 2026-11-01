# Vercel deployment diagnosis — no build failure found (2026-11-02)

**HEAD at inspection:** `0524f46` (== `origin/main`), working tree clean.

## Reported vs actual

Reported: VelShop, Velseller, Velnox deployments failing; VelCenter fine.

Actual, from the Vercel API (`list_deployments`, `state` filter):

| Project | Latest deployment (0524f46) | Earlier (1ccc00c) | ERROR-state deploys |
|---|---|---|---|
| velshop `prj_HKsS…` | `dpl_4Bxe5u2u…` **READY** | `dpl_A6A7doSq…` **CANCELED** | **0** |
| velseller `prj_0rpRQ…` | `dpl_6nyrhFC4…` **READY** | `dpl_CBguHRrA…` **CANCELED** | **0** |
| velnox `prj_20hpT…` | `dpl_FRmmuSa8…` **READY** | `dpl_7yoFTcKg…` **CANCELED** | **0** |
| velcenter `prj_TSN2h…` | `dpl_GjhMtn8Z…` **READY** | `dpl_CtwyY2Ah…` **READY** | — |

**Root cause (not a build error):** the three projects were still building commit `1ccc00c` when the next
push (`0524f46`, a docs-only handoff-archive commit) arrived. Vercel cancels an in-flight build that is
superseded by a newer commit for the same branch — that is the `CANCELED` state. VelCenter had already
finished, so it kept a `READY` deployment for both commits, which is why it looked like the only healthy app.

No `ERROR` deployment exists for any of the three projects, so there was no TypeScript, dependency, config
or environment-variable failure to fix.

## Live evidence

| Domain | HTTP |
|---|---|
| `https://velshop.vercel.app/` | 200 |
| `https://velseller.vercel.app/` | 200 |
| `https://velcenter.vercel.app/` | 200 |
| `https://velnox-theta.vercel.app/` (the `velnox` project's actual domain) | 200 |

Deployment URLs (`*-mnsens-projects.vercel.app`) answer **302 to `vercel.com/sso-api`** — that is Vercel
Deployment Protection on the immutable URL, not an application error; the public production domains above
serve 200.

## Local validation (no code change made)

- `bun install --frozen-lockfile` → exit 0
- `bun run typecheck` → 4/4 · `bun run build:apps` → 4/4
- `bun test backend/tests` → 8 failures, all the documented Termux-only `test database guard` probes
- `git diff --check` → clean

## Why no fix was committed

There was no confirmed deployment defect: no ERROR build, no missing env var, no type/bundler failure. The
only artifact was a superseded build. Changing code or CI to "fix" it would have been a guess and is out of
scope.

## Recommendations (owner-facing, not applied)

1. If a red/canceled status is noisy, wait for the previous deploy to finish before pushing again, or let
   Vercel skip redundant builds (`commandForIgnoringBuildStep`) — a config decision, not applied here.
2. `velnox.com` does **not** resolve (curl exit 000). If the corporate site is supposed to live there, that
   is a DNS/domain task separate from these deployments; the project currently answers on
   `velnox-theta.vercel.app`.
