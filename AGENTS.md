# AGENTS.md — Velnox Marketplace

Monorepo (bun workspaces: `apps/velshop|velseller|velcenter|velnox`, `backend`, `packages/shared`). Default branch: `main`.

## Version-control workflow (user standing instruction, 2026-09-07)

- When git commands are blocked by the hosting platform (Freebuff/Vly style), push exclusively via the **GitHub REST API** (Git Data API) — do not attempt `git push/pull/remote` in those environments.
- Always use the ambient `$GITHUB_TOKEN` — **never** hardcode/commit/echo tokens. Any token pasted in chat is potentially sensitive: do not copy it into files/commands;advise rotation if it may have leaked.



### REST push recipe (equivalent of `push_to_github.py`)
1. `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` → `object.sha` (head)
2. `GET /git/trees/{head_sha}?recursive=1` → map path→sha of remote blobs
3. Walk local tree (skip `node_modules/`,`.git/`,`dist/`,`cache/`,`.env*`;extension `.local`); blob SHA = `sha1(b"blob {len}\0"+content)`
4. `POST /git/blobs` (JSON `{"content": base64,…,"encoding":"base64"}`) per changed file
5sec. `POST /git/trees` with `base_tree:head_sha` + `[{path,mode:"100644",type:"blob",sha}]` (include **all** blobs,not just changed)
6. `POST /git/commits` (message,tree,parents:[head_sha])
7. `PATCH /git/refs/heads/{branch}` `{"sha":…}` (force only if clearly needed)​

⚠️ **Never blindly run this recipe against `main` from a stale checkout** —it rebuilds the tree from local,and would delete unrelated newer commits (e.g., wiping later `Comments & Chat` work on `main`). Push to feature branches only unless explicitly told otherwise.



## Repo conventions
- Feature branches: `fix/…`,`feat/…`; open PRs only when asked; no PR template in repo (use structured summary manually).
- `git diff --check` clean before commit; commit style: conventional-ish (`fix(velshop): …`).

## Current state (2026-09-07)
- `fix/velshop-selection-sheet-preview-details-order` @`5ec53b7` — preview fix (name/description into right details column;already merged to `main` via PR #9;`main` since diverged (`40cd36a` Comments & Chat ± layout moved name/description **out** of right column). Opening a PR from that branch now fails (422 "No commits between…").
- **Dependabot auto-merge GitHub Action** — requested 2026-09-07;implemented in `.github/workflows/dependabot-auto-merge.yml` (runs tests;auto-merges Dependabot PRs with `gh pr merge --auto --squash`). Pushed on the preview-details branch (no PR opened unless asked).