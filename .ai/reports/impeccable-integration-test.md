# Impeccable integration test — real critique + audit run (2026-11-02)

⚠️ **DEGRADED: single-context (detector CLI unavailable; assessments run inline)**
Method: design review only — `scripts/impeccable` has no platform binary (see
`superpowers-installation-report.md` §3 and `impeccable-skill-analysis.md` §3), so Assessment B (detector +
overlay) could not run at all.

## 1. Skill loading

| Step | Result |
|---|---|
| Discovery | `skills_list(category="design")` → `impeccable (user)` |
| `skill_view("impeccable")` | loaded (307-line SKILL.md, Impeccable 4.8.0 lineage) |
| `skill_view("impeccable", "references/critique.md")` | **loaded** — full method: dual assessments, 10 Nielsen heuristics, cognitive-load checklist, personas, P0–P3 severity |
| `references/audit.md` | read (head): 5-dimension technical scan, accessibility/performance/responsive/quality |
| Relative paths | resolve through `references/` (renamed from upstream `reference/`); verified working |
| Scripts | `scripts/impeccable` present but **not executable here** (no `bin/<os>-<arch>` binary) |

## 2. Target

`apps/velshop/src/pages/ShopProfile.tsx` — 457 lines, the account hub: identity header, four-tile order strip,
3 menu groups, session card with sign-out, rendered inside `ShopHeader`.

## 3. Design critique (Assessment A, inline)

### Design Health Score (honest)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | group headings + active states exist; no countdown/feedback on slow fetches |
| 2 | Match system / real world | 3 | Thai shopping vocabulary is natural; "Session" is developer-speak |
| 3 | User control & freedom | 3 | every row navigable, back via header; no undo anywhere (low risk here) |
| 4 | Consistency & standards | 3 | rows share one renderer; the new order tiles use a different visual grammar (no icon container, 11 px label) |
| 5 | Error prevention | 2 | destructive sign-out is guarded by a dialog, but nothing else prevents mistakes |
| 6 | Recognition over recall | 3 | labelled rows, no icon-only nav |
| 7 | Flexibility & efficiency | 2 | no shortcuts/bulk actions; acceptable for a profile |
| 8 | Aesthetic & minimalist | 3 | compact, but the identity header carries many stacked badges |
| 9 | Error recovery | 2 | page-level error rendering exists; row-level failures have no inline retry |
| 10 | Help & documentation | 2 | `/help` row only; no contextual help |
| **Total** | | **26/40** | **Acceptable** |

### Priority issues
1. **[P1] Order tiles have no state colour or count** — four identical grey glyphs read as decoration, not
   status. Fix: tint the icon (amber=to pay, sky=to ship, indigo=to receive, emerald=done) and add the real count
   where an API exists; Suggested command: `/impeccable colorize`.
2. **[P1] No visible focus styles on rows/tiles** — `grep` for `focus-visible` in the page returns **0**. Keyboard
   users have no position cue. Fix: `focus-visible:ring-2 ring-emerald-500/40` on row/tile wrappers; Suggested:
   `/impeccable audit`.
3. **[P2] Two visual grammars in one screen** — menu rows use a 40 px tinted icon tile; order tiles use bare
   20 px icons. Unify the icon treatment; Suggested: `/impeccable polish`.
4. **[P2] "Session" group heading is internal jargon** — rename to a user-facing label; Suggested:
   `/impeccable clarify`.
5. **[P3] Dead footer import** — the page still imports and renders `ShopFooter` (returns `null` since §125).
   Remove the import in a UI-only cleanup; Suggested: `/impeccable distill`.

### Personas (e-commerce profile → Casey, Sam, Jordan)
- **Casey (mobile, one-handed)**: sign-out sits at the very bottom under a long list — fine; but the header's
  edit button is top-right, out of thumb reach.
- **Sam (accessibility)**: no focus-visible styling (see P1); `aria-label` count in the file is 0, so icon-only
  controls rely on surrounding text.
- **Jordan (first-timer)**: "ข้อมูลบัญชีธนาคาร" is absent (correctly, no bank API) but nothing explains why —
  acceptable; "Session" heading is unclear.

## 4. Technical audit (audit.md dimensions, code-level only)

| Dimension | Score | Evidence |
|---|---|---|
| Accessibility | 2/4 | 0 `focus-visible`, 0 `aria-label` in this page; text sizes 11–12 px for secondary copy (below comfortable mobile reading) |
| Performance | 3/4 | single page, no heavy assets; no measured numbers (no Lighthouse available) |
| Responsive | 3/4 | `max-w-3xl`, `grid-cols-4` tiles, truncation on row descriptions; **not measured in a browser** |
| Interaction states | 2/4 | hover/active exist on rows; no focus, no disabled/loading affordance on tiles |
| Technical quality | 3/4 | data-driven rows (no duplicated JSX), typed `ProfileRow`, i18n keys in all locales; one dead import |

## 5. Visual verification status

**NOT PERFORMED.** No browser session was used for this test: the local harness processes are not running and the
WebView is fixed at 492 px. No screenshots, no `getBoundingClientRect` values — none are reported.

## 6. Unsupported capabilities (verified, not assumed)

- `scripts/impeccable detect` / `live-server` / `critique-storage` — launcher has no platform binary.
- Sub-agent isolation for Assessment A/B — a `task` tool does exist, so the inline run is a **degraded** path and is
  labelled as such above.
- Browser overlay injection — requires the missing CLI plus a mutable page; not attempted.

## 7. Overall integration result

**PARTIAL PASS** — the skill loads, its reference files resolve, and its documented method produced a genuine,
evidence-backed critique with scores and severity tags. The *tooling* half (detector, overlay, snapshot storage)
is unavailable, so every run in this Harness must carry the DEGRADED banner and cannot claim automated findings.
