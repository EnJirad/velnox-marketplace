# WORKFLOW — Git, Preview, Deploy

## Git

- Default branch: `main`. Feature branches: `fix/…`, `feat/…`. Open PRs only when asked; no PR template.
- Before commit: `git diff --check` clean. Commit style: `fix(velshop): …`, `feat(db): …`, `docs: …`.
- Never `git push --force` without owner instruction. On conflicts, understand both sides; preserve newer functionality.
- Every completed task: `git add` → `git commit -m "..."` → `git push` → verify `git status` clean.

## Freebuff / Vly Managed Push

When `git push/pull` is blocked, Freebuff injects a short-lived GitHub App credential automatically. Do not paste PATs, rewire remotes, or use stale-cache fallbacks. Run git normally; if minting fails, ask user to reconnect the repo / update App permissions.

If you must use REST (only in Vly-style blocked envs):

1. `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` → `head_sha`
2. `GET /git/trees/{head_sha}?recursive=1` → remote blob map
3. Walk local tree (skip `node_modules/`, `.git/`, `dist/`, `cache/`, `.env*`, `*.local`); blob SHA = `sha1("blob {len}\\0"+content)`
4. `POST /git/blobs` per changed file
5. `POST /git/trees` with `base_tree:head_sha` + all blobs
6. `POST /git/commits` (parents: [head_sha])
7. `PATCH /git/refs/heads/{branch}` — force only if clearly needed

Never rebuild `main` from a stale checkout with this recipe (would delete newer commits). Use feature branches.

## Preview (Freebuff)

- Bind dev servers to `0.0.0.0`; Freebuff injects `PORT`. Save commands with `freebuff-preview set-install "<cmd>"`, `freebuff-preview set "<cmd>" <port>`, `freebuff-preview set-build "<cmd>"`.
- Start/verify: `freebuff-preview start` (or `restart`); diagnose with `freebuff-preview status` / `logs`. Do not manage `vite`/`bun run dev` manually.
- Keep install/build scripts minimal and in `package.json`.

## Production Deploy (Freebuff-managed hosting)

- Hosting runs install then build on a clean Node image. For Vite, build must emit `dist/` and exit (not start a server). No `uv/pip/python/apt/cargo` in install/build; invoke scripts as `sh ./scripts/foo.sh`.
- Python in prod belongs in `api/*.py` + `requirements.txt`.
- Before deploying: `freebuff-deploy check`. After: `freebuff-deploy status` / `logs`; `freebuff-deploy start` for redeploys.
- Prod env vars are separate: `freebuff-deploy env list` / `env set '{"KEY":"value"}'` / `env unset KEY`. Never read/print secrets; use `freebuff-env set --file .env.local '{"KEY":"value"}'`.
- Also: Vercel (4 frontends) + Render (backend: `bun run api:start` on `PORT`) + Neon (run `db/run-sqleditor.sql` once).

## Handoff Rule

Changes panel owns Save/Share/commits/PRs. Stage only files for the current request; never `reset --hard`/`clean` without explicit ask.
