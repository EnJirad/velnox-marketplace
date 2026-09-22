# WORKFLOW — AI Git Lifecycle, Preview, Deploy

## Default Branch

`main`. Feature branches: `fix/…`, `feat/…`. Open PRs only when asked or when the repository policy requires them.

---

## AI Completion Lifecycle (Mandatory)

Every successful repository-changing task MUST end with:

```
Implementation complete
→ Validation passed (typecheck / tests / diff --check)
→ Commit created
→ Commit pushed to GitHub via Git CLI
→ Remote verified (local SHA == remote SHA)
→ AI_Handoff.md updated when required
→ Working tree clean
```

This is not optional. See **AGENTS.md** *Default Completion State* and **AI_RULES.md** §14.

---

## Step-by-Step Flow

### 1. Inspect and Scope

```bash
git branch --show-current   # know the branch
git remote -v               # know the remote
git status                  # clean baseline?
```

### 2. Implement

Make the required code/doc changes. Minimal, correct, no duplicate systems.

### 3. Validate

Run the appropriate checks for the affected subsystem:

- TypeScript: `bun run typecheck` (all apps) or per-app.
- Backend tests: `cd backend && bun test tests`.
- Lint: if configured.
- `git diff --check` — whitespace clean.
- For database changes: verify `db/schema.sql` ↔ `db/run-sqleditor.sql` sync.

Do not proceed to commit if validation fails. Fix first.

### 4. Stage Targeted Changes

```bash
git status          # identify which files changed
git diff            # confirm changes belong to this task ONLY
git add <files>     # stage only task-related files
```

**Never use `git add .`** when the working tree contains unrelated changes. Separate them.

### 5. Commit

```bash
git commit -m "<type>(<scope>): <description>"
```

Style: `fix(velshop): …`, `feat(db): …`, `docs(ai): …`. No vague messages (`update`, `fix stuff`, `changes`).

### 6. Push (Git CLI Only)

```bash
git push origin <branch>
```

This happens **immediately after commit**. Do not require the user to say "push".

**Push method is always Git CLI.** Never use GitHub REST API, Git Data API, or any other API-based mechanism to create commits or push refs. If Git CLI auth fails, report the failure — do not fabricate an alternative push path.

### 7. Verify Remote

```bash
git fetch origin
git rev-parse HEAD           # local SHA
git rev-parse origin/<branch>  # remote SHA
```

Both must match. Report `PUSH VERIFIED` only after this check succeeds.

If SHA mismatch persists after fetch, investigate before reporting.

### 8. Update AI_Handoff.md

If the task warrants a handoff update:

1. Edit `AI_Handoff.md` — current state + remaining gaps, appended at the bottom.
   Keep it small: the file-edit tools stop matching past roughly 55 KB, so move
   superseded sections to `AI_Handoff_Archive.md` (dated index) and long-form text
   to `docs/ai/history/archive/`. Never let `AI_Handoff.md` approach 40 KB.
2. `git add AI_Handoff.md`.
3. Commit with a docs message: `docs(ai): update handoff — <topic>`.
4. Push.
5. Verify remote SHA again.

Final state must always be: working tree clean, HEAD == origin/branch.

### 9. Final Report

Report completion only when every item in the lifecycle is confirmed:

```
DONE =
  code completed
+ validation passed
+ commit created
+ commit pushed via git CLI
+ GitHub remote verified
+ handoff synchronized
+ working tree clean
```

---

## Git CLI Push Only

Normal `git push origin <branch>` is the only push method. The Freebuff/Vly environment injects a short-lived GitHub App credential automatically for each command. Run git normally; do not paste PATs or rewire remotes.

If `git push` fails:
1. Diagnose the exact Git error (authentication, non-fast-forward, protected branch, network).
2. For authentication failure: the credential may need refreshing. Report `NOT PUSHED — AUTHENTICATION UNAVAILABLE` with the exact error.
3. For non-fast-forward: see *Non-Fast-Forward Resolution* below.
4. **Never** use GitHub REST API, Git Data API, or any other API-based mechanism as a push fallback.
5. **Never** hardcode, echo, or expose tokens.

---

## Non-Fast-Forward Resolution

If push fails with non-fast-forward:

1. **Do not force-push.**
2. Stop the automatic push.
3. `git fetch origin` and compare: `git log HEAD..origin/<branch>`.
4. If the remote has commits not present locally, merge or rebase:
   - `git merge origin/<branch>` (preserves history) or
   - `git rebase origin/<branch>` (linear history, cleaner).
5. Resolve any conflicts.
6. Re-run validation.
7. Push again.
8. Verify SHA.

If divergence is ambiguous or could overwrite another contributor's work, stop and report `NOT PUSHED — REMOTE CONFLICT` with exact details.

---

## Protected Branch

If the target branch requires pull requests and rejects direct pushes:

1. Commit locally.
2. Push to a feature branch instead.
3. Open a PR (only when asked or when repo policy requires it).
4. Report `NOT PUSHED DIRECTLY — PR REQUIRED`.

---

## Unrelated Changes

Before staging, always inspect `git status` and `git diff` for unrelated modifications.

- Stage only files belonging to the current task.
- Never use `git add .` when unrelated changes exist.
- If the user has unrelated changes and the task is complete, do not commit those changes.

---

## Verification Statuses

| Status | Meaning |
|--------|---------|
| `PUSH VERIFIED` | Commit pushed, remote SHA matches local SHA, working tree clean. |
| `NOT PUSHED — USER REQUEST` | User explicitly said not to commit/push. |
| `NOT PUSHED — VALIDATION FAILED` | Typecheck/tests/diff-check failed; fixes pending. |
| `NOT PUSHED — AUTHENTICATION UNAVAILABLE` | Git CLI auth failed; no credential available. Report the exact error. |
| `NOT PUSHED — REMOTE CONFLICT` | Non-fast-forward; requires manual reconciliation. |
| `NOT PUSHED — PROTECTED BRANCH` | Branch rejects direct push; PR required. |

Never report `PUSH VERIFIED` unless the remote SHA was actually confirmed.

Never use vague wording: `git issue`, `push problem`, `probably pushed`.

---

## Branch Policy

- Default branch: `main`.
- Do not push directly to `main` if the repository requires PRs.
- Do not create unnecessary feature branches.
- Do not create a PR unless asked or unless repository policy requires it.
- Never rewrite shared branch history.

---

## Commit Message Style

Conventional-ish:

```
fix(velshop): fix product image rendering
feat(categories): improve category hierarchy
docs(ai): update agent workflow
fix(auth): resolve session redirect
```

No meaningless messages: `update`, `changes`, `fix stuff`, `AI changes`.

Always `git diff --check` clean before commit.

---

## When NOT to Commit/Push

Skip commit/push and report the exact reason when:

1. User explicitly says *do not commit* / *do not push* / *keep changes local*.
2. Task is analysis-only — no repository changes made.
3. Required validation fails and is unresolved.
4. Security or data-loss risk is discovered.
5. Branch is protected and PR policy applies.
6. No authenticated push path is available.

---

## Preview (Freebuff)

- Bind dev servers to `0.0.0.0`; Freebuff injects `PORT`.
- Save commands: `freebuff-preview set-install`, `freebuff-preview set`, `freebuff-preview set-build`.
- Start/verify: `freebuff-preview start` or `restart`. Diagnose: `freebuff-preview status` / `logs`.
- Do not manage `vite`/`bun run dev` manually.

---

## Production Deploy (Freebuff-managed hosting)

- Install then build on a clean Node image. For Vite: build emits `dist/` and exits (no server). No `uv/pip/python/apt/cargo` in install/build.
- Before deploy: `freebuff-deploy check`. After: `freebuff-deploy status` / `logs`.
- Prod env vars are separate: `freebuff-deploy env list` / `set` / `unset`. Never read/print secrets.

---

## Handoff Rule

Changes panel owns Save/Share/commits/PRs. Stage only files for the current request; never `reset --hard`/`clean` without explicit ask.
