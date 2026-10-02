## 59. VelRepeat **V2 Phase 3 — package → draft plan → immutable snapshot** (2026-10-01)

**Superseded by §60; moved here 2026-10-01 to keep the current-state file small.** Phase 3 delivered
`GET /api/velrepeat/v2/packages/:packageId` + `POST /api/velrepeat/v2/plans` (draft plan + immutable
snapshot) in `backend/routes/velrepeat-v2-plans.ts`, with owner decisions **Q-A** (plan starts `draft`),
**Q-B** (`approved` seller = eligible), **Q-C** (plan before payment). G1/G1.1/G2/G3/E preserved: 30%
cap fails CLOSED, THB, one final 2dp round, catalog `NUMERIC` parsed exactly; plan + lines + snapshot +
items + `PLAN_CREATED` are ONE transaction. No schema change (that arrived in Phase 4 as migration 051).
Full record + the Phase-4 handover items it left behind:
`.ai/tasks/audits/velrepeat-v2-phase3-pricing-snapshot-2026-10-01.md`. Still-relevant flag: V1's
`products.vrepeat_enabled` is NOT part of the V2 purchase gate (Phase 5/7 must decide).

