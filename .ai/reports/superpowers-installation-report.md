# Superpowers installation report (obra/superpowers → Android Harness)

**Installed:** 2026-11-02 · **Source:** `https://github.com/obra/superpowers` (`git clone --depth 1`)
**Target:** `/data/user/0/…/files/skills/` (user skills)

## 1. Summary

All **15** upstream skills were flattened into the Harness layout (one top-level directory per skill, because the
loader discovers `skills/<name>/SKILL.md`; the nested `superpowers/<skill>/` shape would not be discoverable).
Frontmatter already carried `name` + `description`; `category: general` was added where missing. No file was
edited beyond that line. `impeccable` was **not touched**.

## 2. Installed skills (all `general`, all verified by `skills_list`)

brainstorming · diagnosing-superpowers · dispatching-parallel-agents · executing-plans ·
finishing-a-development-branch · receiving-code-review · requesting-code-review ·
subagent-driven-development · systematic-debugging · test-driven-development · using-git-worktrees ·
using-superpowers · verification-before-completion · writing-plans · writing-skills

Each directory contains the upstream `SKILL.md` plus whatever it shipped alongside (references, templates) —
the copy is a full `copytree`, nothing was trimmed.

## 3. Compatibility

| Capability | Harness | Notes |
|---|---|---|
| Skills discovery | ✅ | `skills_list` shows all 15 immediately after install |
| `skill_view(name)` / `skill_view(name, file_path)` | ✅ | resolves `references/`, `scripts/`, `templates/`, `assets/` |
| Shell execution | ✅ | `shell` / `shell_background` |
| Subagents | ✅ | `task` tool (own context, read-only by default) |
| Parallel agents | ✅ | several `task` calls in one message run concurrently |
| Git worktrees | ◐ | git is available, but the workspace is a single app-owned clone; worktrees work but are not isolated |
| Session-start hooks | ❌ | no hook mechanism; `using-superpowers` must be loaded manually (it is auto-offered by description match) |
| Skill auto-activation | ◐ | description matching only — no trigger registry |
| Task tracking | ✅ | `todo_write` |
| CLI/binary helpers | ❌ | any upstream npm/binary tooling (hooks, detectors) is not installed |

**Name collisions:** `systematic-debugging`, `test-driven-development` and (near) `writing-plans` already existed
as **bundled** skills; the user copies now take precedence. This shadows the bundled text but keeps behaviour
(the upstream wording is the original source). Report, do not act, if the bundled variants were preferred.

## 4. Validation executed

- `find … -name SKILL.md | wc -l` → 15 upstream skills, all copied
- `skills_list(category="general")` → 16 entries (15 new + impeccable), no duplicates in the user tier
- Directory listing confirms every installed skill has a `SKILL.md`
- No existing skill directory was overwritten (target dirs did not exist beforehand except `impeccable`)

## 5. Known gaps / remaining work

1. Upstream `hooks/`, `scripts/`, `index.js`, `package.json` (the Node installer) were **not** installed — they
   implement session hooks and skill sync, neither of which the Harness supports.
2. Some skills reference CLI helpers that do not exist here (`dispatching-parallel-agents` assumes real parallel
   process isolation; `using-git-worktrees` assumes a repo root the agent may create worktrees in).
3. `using-superpowers` describes an always-on startup protocol; in this Harness it only runs when the model
   chooses to load it (description match). No silent substitution is claimed.
4. License/attribution: upstream `LICENSE` was not copied into each skill directory — see the upstream repo for
   terms; a single copy could be added to `skills/superpowers-LICENSE` if desired.

## 6. Workflow mapping (no code needed)

brainstorm → `brainstorming`; design/plan → `writing-plans`; execute → `executing-plans` /
`subagent-driven-development`; TDD → `test-driven-development`; debugging → `systematic-debugging`; review →
`requesting-code-review` / `receiving-code-review`; finish → `verification-before-completion` /
`finishing-a-development-branch`.
