# Plugin Ecosystem Audit — Velnox Marketplace

**Date:** 2026-11-08 · **Author:** AI 01 (tooling architect pass)
**Scope:** inventory + evaluation of installed plugins, skills, MCP servers; select only essential, high-value additions; no source-code or architecture changes.
**Head (verified):** `8becb0a` == `origin/main` (fetched, equal). Working tree had pre-existing unrelated edits (bun.lock, package.json, `packages/shared/src/lib/icons/`, `scripts/`) from another task — left untouched and unstaged.

## 1. Project architecture (context for every decision)

- **Monorepo** (bun workspaces): `apps/velshop` (buyer storefront), `apps/velseller` (seller console), `apps/velcenter` (admin center), `apps/velnox` (corporate site) — all React/Vite + TS on Vercel.
- **Backend:** Express + WebSocket on Render (`backend/`), TypeScript, JWT httpOnly cookies, Google OAuth.
- **Database:** Neon PostgreSQL (source of truth; `db/schema.sql` + `db/run-sqleditor.sql` double-booked). Cloudflare R2 for file uploads. Stripe + COD payments.
- **i18n:** th / en / my (2177 keys × 3, `bun run i18n:check`).
- **Workflow:** two-agent AI Office (AI 01 implements; AI 02 plans + QA), GitHub remote is truth, commit + push every repo-changing task.
- Hard blockers already documented (not plugin-fixable): no local PostgreSQL on Android (DB-gated test suites skip), Impeccable engine binary has `unexpected e_type: 2`.

## 2. Installed plugin & tool inventory

Plugin packages (`files/plugins/packages/` + `installed.json`):

| Plugin | Version | Origin | Scope | State |
|---|---|---|---|---|
| `ui-ux-pro-max` | 2.15.0 | nextlevelbuilder/ui-ux-pro-max-skill | global | enabled |
| `superpowers` | 7.0.2 | obra/superpowers | global | enabled |
| `42crunch-api-security-testing` | 1.5.5 | 42Crunch-AI/claude-plugins | global | enabled (needs platform token to run) |
| `chrome-devtools-mcp` | 1.11.0 | ChromeDevTools/chrome-devtools-mcp | global | installed.json: disabled — but the chrome-devtools MCP server is already connected at app MCP level and its tools are live |

User skills (app-level, load on demand): `impeccable` (4.8.0, external binary engine — **broken on Android**), `two-agent-dev`, `blunt-mode`, `androidharness-context-management`, plus superpowers-derived copies (`brainstorming`, `systematic-debugging`, `test-driven-development`, `writing-plans`, `verification-before-completion`, `using-superpowers`, …).

Bundled skills: caveman-* × 5, android-build/compose/crash, grill-me, design set (web-design, sketch, design-tokens, popular-web-designs, architecture-diagram), environment set, git, web-docs, doctor/asstest/review/plan/spike/simplify-code, browser, node-api, react-frontend.

MCP servers connected (app-level, live in this session): **github, neon, render, stripe, vercle (Vercel), cloudflare, chrome-devtools.** Covers the entire stack: repo, DB, both deploy platforms, payments, R2/edge, browser debugging.

CodeGraph: **indexed** (`.codegraph/codegraph.db`, ready). No resident watcher process running; writer is on-demand. Effectively zero idle cost.

Linux toolchain: 138 packages (bun, node, python3, git, gh, jq, ripgrep-adjacent utils).

## 3. Essential plugins selected

**None. Zero new installations.**

Every one of the 10 priority areas is already covered by an existing MCP server, skill, or native harness tool (see evaluation table). Installing more would violate the task's own criteria (no duplicated capability, no overhead without measurable benefit). The ecosystem is complete to the point of mild over-provisioning; the correct action is configuration/loading hygiene, not installs.

## 4. Optional plugins (already installed; use on demand, do not install separately)

- **42Crunch API security** — high value for payment/auth/multiparty surface, but heavy (audit → scan → remediate loop) and needs an external platform token. Activate only for security passes.
- **ui-ux-pro-max** — large offline design DB; Velnox already has `VELNOX_DESIGN_THEME.md` + impeccable/design skills. Load only for design work.
- **Impeccable (degraded mode)** — best frontend-design skill available; run its manual/degraded path (its bundled binary cannot exec on this device).
- **chrome-devtools MCP** — connected and live; used for frontend E2E/perf. Not blocked by plugin availability (blocked by missing disposable Postgres + expired cookies).

## 5. Rejected / not-installed plugins and reasons

- **superpowers reinstall** — already installed; its skills overlap bundled and user skill copies (TDD, debugging, verification). Re-installing is explicitly out of scope.
- Any SQL/ORM plugin — Neon MCP already exposes schema description, comparison, inspection, and `run_sql`. Duplicate.
- Any Vercel/Render/Cloudflare/Stripe plugin — their MCP servers already cover deploy, analytics, R2, payments. Duplicate.
- Any "repo analysis" plugin — GitHub MCP + `gh` CLI cover it.
- Any separate performance plugin — chrome-devtools perf trace + Vercel analytics MCP cover it.
- Any documentation plugin — `.ai/` context system + `androidharness-context-management` skill cover it.

## 6. Agent-to-plugin assignment (logical, load-on-demand)

- **Main Agent (AI 01, implementation):** git, node-api/react-frontend, android-build, caveman-patch/verify, codegraph (impact/affected for cross-app refactors), systematic-debugging. Never load every skill; only the subsystem touched.
- **Planning Agent (AI 02, architecture):** codegraph (explore/impact), architecture-diagram, web-docs, ui-ux-pro-max/impeccable (degraded) for design scoping, writing-plans. Read-only — needs only planning-model context, not the tool suite.
- **Review Agent (code/security/quality):** review, 42crunch (security passes only), ui-ux-pro-max/impeccable (design review), caveman-review, GitHub checks.
- **QA Agent (testing/verification):** test-driven-development, verification-before-completion, asstest/doctor, browser + chrome-devtools MCP, codegraph_affected (which tests break).

Rule: skills load via `skill_view` per task, never injected wholesale into all agents. Per-call `model` overrides for subagents are not effective in this harness (single `subagent_model` wins), so plan/QA share one model — keep their skill sets small and overlapping.

## 7. Context/token efficiency assessment

- The dominant ongoing cost is the **skill catalog name/description list injected into every session** (~55 bundled + user + workspace + plugin entries ≈ a couple of KB per conversation). Skill bodies themselves only load on demand → low marginal cost per active skill.
- Risk to manage: overlapping skills inflate the catalog without adding capability (e.g., 4 debugging-ish skills, 5 design skills, 3 TDD/verification skills). **Do not install more.** If catalog size becomes a problem, the fix is disabling heavyweight plugins (ui-ux-pro-max, superpowers, 42crunch) per-project in Settings → Plugins — a user action, not an agent action.
- CodeGraph: already indexed, dormant when idle → keep. Re-run `codegraph_sync` only after structural changes; do not leave a watcher running.
- No background Trojans: no resident codegraph watcher, no always-on servers started by this audit.

## 8. Installation & compatibility results

- **Installed:** nothing (none classified Essential).
- **Compatibility verified:** GitHub MCP live (`EnJirad`); neon/render/stripe/vercle/cloudflare/chrome-devtools MCP present in session; CodeGraph index ready.
- **Known incompatibility found:** Impeccable engine binary at `~/.impeccable/bin/0.1.18/impeccable` fails with `unexpected e_type: 2` on this device — use the skill's degraded/manual mode.

## 9. Remaining issues / required user actions

1. **42Crunch token** — to run live API security scans, supply a 42Crunch platform token (Settings page or env). Optional; not required for the audit/skill to load.
2. **Optional: prune catalog overhead** — in Settings → Plugins, disable heavyweight plugins per-project if the injected skill list becomes a token concern (not required today).
3. **Browser E2E blockers** — no local PostgreSQL on this device and expired saved cookies block frontend E2E; infra issue, not a plugin gap.
4. **Impeccable engine** — broken binary; no reinstall/replace without owner authorization.
5. **Uncommitted work in tree** — icon-library files (`packages/shared/src/lib/icons/`, `scripts/`) belong to a separate in-progress task; left untouched.

## Verdict

The Velnox AI Office is already fully provisioned across all ten priority areas. The leanest correct move is **not to install anything new**. Preserve current integrations, load skills on demand, and keep heavyweight plugins out of every-session loading.
