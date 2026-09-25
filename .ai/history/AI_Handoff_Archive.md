# Velnox Handoff Archive

**Reference only — do not load automatically.** Moved here from the repository root
when the agent workspace moved to `.ai/` (2026-09-23). Current state lives in
[`.ai/AI_HANDOFF.md`](../AI_HANDOFF.md); load that first.

This file is the **index** to completed, superseded and investigated work. The
long-form narrative for every entry below is kept verbatim (under version control,
unchanged) in:

| File | What it holds |
|---|---|
| [`archive/AI_Handoff-2026-09-22-full.md`](./archive/AI_Handoff-2026-09-22-full.md) | the complete handoff as it stood at 2026-09-22, before the split (1,594 lines) |
| [`archive/AI_Handoff-2026-09-14.md`](./archive/AI_Handoff-2026-09-14.md) | the earlier snapshot it replaced |

**Why the index exists:** this environment's file-edit tools stop matching past
roughly 55 KB in a file, so the single ~109 KB handoff could no longer be edited.
Nothing was discarded — the full text moved to the paths above and is durable in
git history.

Nothing here is guaranteed to describe the current code. The repository is always
authoritative; treat these entries as "what was done and why", and confirm against
source before relying on any of it.

---

## Index

Line numbers below point into `AI_Handoff-2026-09-22-full.md`.

### 2026-09-15 — the verification overhaul + category UI

| Lines | Entry | Covers |
|---|---|---|
| 15 | Product Verification — removed from the user workflow | the single-verification decision; `product_verifications` / `products.verification_status` retained but unwritten |
| 32 | Category Picker (UI audit 2026-09-15) | duplicate close button; long category names escaping their container; the `min-w-0` / `truncate` / `overflow-x-hidden` width chain; files changed |
| 106 | VelCenter Category Edit — overflow fix + verification audit (2026-09-15) | long parent-category name covering the “ลำดับ” field; the `auto`-track min-content root cause; similar-pattern audit; seller-verification architecture confirmed unchanged |
| 213 | Seller Navigation | the VelSeller tab set; why there is no standalone “V Verification” tab |
| 222 | Database | `sellers.status` CHECK widening, `review_reason_code` / `review_note`, `seller_review_history`, migrations 043/044 |
| 235 | VelRepeat `item_unavailable` — investigated and fixed | duplicated migration numbers 029/030/034/035 and the prefix-keyed runner that skipped the repair |
| 257 | Files Changed | the file-by-file list for the overhaul |
| 275 | Tests Actually Performed | plus the two per-audit test tables |
| 324 | Known Limitations | the limitation list as of 2026-09-15 — most items were carried forward into `AI_Handoff.md` §6 |

### 2026-09-16 — production incidents and the control-plane upgrade

| Lines | Entry | Covers |
|---|---|---|
| 359 | VelCenter Operations Center Upgrade | the first VelCenter console pass: backend, frontend, realtime, security |
| 442 | Recommended Next Steps | stale planning list, superseded |
| 459 | Product Visibility Root-Cause Audit | why previously created products stopped appearing; the read-only diagnostic endpoint |
| 517 | VelCenter Runtime Crash Fix | `Cannot read properties of undefined (reading 'icon')` |
| 575 | VelCenter Products & Sellers "No Data" Diagnosis | the "no data" symptom traced to real causes |
| 631 | Production SQL Error Fixes — `sh.status` + `sv.evidence_notes` | the root cause and the schema fix |
| 698 | Production 42703 root cause: the migration runner was blocked at V0040 | the schema-drift report and how it was cleared |
| 826 | VelCenter moderation detail (42P10) + VelSeller correction notifications | the `json_agg(DISTINCT … ORDER BY …)` aggregate failure; correction notifications |
| 954 | UX & Localization Round | V badge redesign; localized category names; responsive audit |
| 1013 | VelCenter control-plane upgrade | product inspection workspace, staff/customer split, audit logs, company settings |
| 1080 | Audit Logs SQL repair + mobile product inspection (round 2) | the empty Audit Logs root cause; the phone inspection layout |

### 2026-09-17 → 2026-09-18 — staff auth and the permission catalog

| Lines | Entry | Covers |
|---|---|---|
| 1180 | Password Auth + Auto-Refresh + Variant Images + Mobile Nav Removal | member-ID/password login (`users.password_hash`, scrypt), auto-refresh, variant images, removing the VelCenter bottom nav |
| 1270 | VelCenter Final Gap Fix / Verification | the permission catalog as the single source of truth; the dead force-password-change gate; realtime → UI; errors must not render as "no data" |
| 1407 | Catalog enforced at every endpoint (follow-up) | every business surface gated by its catalog code; deny-by-default resolution; `payouts.process` removed |
| 1484 | Remaining gaps closed (round 2) | the `staff.manage` read path; realtime dead ends; silent empty states |

### 2026-09-23 → 2026-09-25 — production verification, and why test data reached production

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-23-r2-media-verification.md`](./archive/AI_Handoff-2026-09-23-r2-media-verification.md) | Production R2 / media — read-only verification (TASK 002) | the live R2/media evidence (health, bucket, object read, 401 boundary) and findings 1–7. Findings 1–6 were fixed in TASK 003; finding #7 (integration fixture shops visible via public `/api/shops`) was root-caused to test/database isolation and closed by TASK 004A (`.ai/AI_HANDOFF.md` §13) |
| [`archive/AI_Handoff-2026-09-23-neon-readonly-verification.md`](./archive/AI_Handoff-2026-09-23-neon-readonly-verification.md) | Production Neon — closed evidence, read-only verification (TASK 001) | the method (`gh run view --log` on `migrate-neon.yml`), the migration ledger (49 rows / 49 files, none missing or orphaned), and the verified-object table. Split out of `.ai/AI_HANDOFF.md` §9 on 2026-09-25 to keep the live handoff small; §9.4/§9.5 open items stayed live |
| [`archive/AI_Handoff-2026-09-23-ai-workspace-move.md`](./archive/AI_Handoff-2026-09-23-ai-workspace-move.md) | Agent workspace moved to `.ai/` | the full old→new layout table, the six renamed context entries, the pointer-vs-duplicate decision, the `6187bcd` reconciliation, the root cause, and the validation table. Moved out of `.ai/AI_HANDOFF.md` §8 on 2026-09-25; the described layout IS the current state, documented live in `AGENTS.md` and `.ai/README.md` |
| [`archive/AI_Handoff-2026-09-25-docs-consolidation.md`](./archive/AI_Handoff-2026-09-25-docs-consolidation.md) | Startup-sync rule + root AI files removed | the §0 “GitHub remote is the source of truth” startup rule and the removal of root `AI_RULES.md` / `AI_Handoff.md`. Moved out of `.ai/AI_HANDOFF.md` §12 on 2026-09-25; the rules are live in `.ai/AI_RULES.md` §0 and `AGENTS.md` rule 0 |

Work after 2026-09-18 continues in `.ai/AI_HANDOFF.md`, whose older sections are
archived by the same rules as above.

### Beyond the archive

Work after 2026-09-18 is recorded in `.ai/AI_HANDOFF.md` and in git history. When an
`.ai/AI_HANDOFF.md` section becomes superseded, append it here as an index row and
(if it is long) move its full text into `.ai/history/archive/`.
