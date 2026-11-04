# Impeccable skill — installation and capability report (2026-11-02)

**Repo SHA at install:** `c0e5e50` (main). **Installed from:** `https://github.com/pbakaus/impeccable`
(`git clone --depth 1`), source folder `.agent/skills/impeccable/`.

## 1. Installation

| Item | Result |
|---|---|
| Target | `/data/user/0/…/files/skills/impeccable/` (user skill, not bundled) |
| Size | 2.3 MB |
| Contents | `SKILL.md` · `references/` (**42 files**) · `scripts/` (**11 files**) |
| Registration | visible in `skills_list(category="design")` as `impeccable (user)` |
| Frontmatter | `name`, `description`, `category: design` — valid for the Harness loader |
| Version | `scripts/VERSION` → `0.1.18`; body references "Impeccable 4.8.0" |

### Adaptation required (repo layout ≠ Harness layout)

- The Harness resolves auxiliary files under **`references/`** (plural). The repo ships `reference/`, so the
  directory was renamed and **66 path mentions** inside `SKILL.md` were rewritten `reference/` → `references/`.
- No content was removed or edited otherwise.

## 2. Verified working

- `skill_view("impeccable")` loads the body.
- `skill_view("impeccable", "references/android.md")` returns the real runbook
  (Material 3, 48 dp targets, edge-to-edge insets, `adb exec-out screencap`, dark-theme/font-scale checks).
- Every documented command (`shape, init, document, extract, critique, audit, polish, bolder, quieter, distill,
  harden, onboard, animate, colorize, typeset, layout, delight, overdrive, clarify, adapt, optimize, live,
  generate, pin, unpin, hooks, doctor`) now has its `references/<cmd>.md` file present.

## 3. NOT working (verified by execution)

`scripts/impeccable` is a POSIX launcher that executes `<this dir>/bin/<os>-<arch>/impeccable`:

```
$ node scripts/impeccable --version   → error (no platform binary)
```

The repository only contains `cli/platform-packages/linux-arm64/package.json` — the binary is published as a
separate npm platform package and is **not** in the git checkout.

Consequences:

| Feature | Status |
|---|---|
| `hooks on|off|status`, `hooks ignore-*` | **not executable** (no detector binary) |
| `pin` / `unpin` | not executable (needs command handlers) |
| `doctor` | not executable (needs CLI) |
| `live` / `generate` | not executable (needs browser automation; in this device the WebView is fixed at 492 px
  and Chrome DevTools MCP cannot start on android/arm64) |
| All design **judgement** commands | **usable** — the agent follows `references/<cmd>.md` directly |

## 4. Capability matrix (actual, not aspirational)

| Capability | Available | Requirements | Limitation |
|---|---|---|---|
| Design critique | ✅ | SKILL.md + `references/critique.md` | agent-driven, no automated scoring |
| UI audit (a11y/responsive) | ✅ manual | `references/audit.md` | no axe/Lighthouse tooling here |
| Polish / layout / typography / color / animation | ✅ | code edits + `references/*` | no visual diff |
| Accessibility | ◐ | judgement + DOM inspection | no automated checker |
| Responsive verification | ◐ | browser at multiple widths | WebView fixed 492 px; DevTools MCP unavailable |
| Android native / iOS runbooks | ✅ readable | native project | this repo is web-only |
| Design system extraction / DESIGN.md | ✅ manual | `references/extract.md`, `document.md` | no CLI generator |
| `hooks` / `doctor` / `pin` | ❌ | platform binary | not shipped in git |

## 5. Recommended next step for full integration

Install the platform binary (npm platform package for `linux-arm64`), place it at
`skills/impeccable/scripts/bin/linux-arm64/impeccable`, then verify `node scripts/impeccable --version` and
`scripts/impeccable doctor`. Until then, use the reference runbooks only, and never report a CLI command as
executed.

## 6. How this skill should be activated in this project

Activate for UI/UX work on `apps/velshop`, `apps/velcenter`, `apps/velseller`, `apps/velnox`: redesign, polish,
critique, audit, typography/layout/color/motion, onboarding/empty states, design-system extraction.
Never for backend, DB/schema, payments/Stripe/PromptPay, auth/RBAC, or infrastructure changes.
