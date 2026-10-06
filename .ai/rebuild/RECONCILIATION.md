# RECONCILIATION.md — detecting drift without making it worse

> §23 requires four reconcilers at minimum. This document defines six, their
> schedules, their exact comparisons, what they may write, and — most importantly —
> what they may **never** do.

---

## 1. Principles

1. **A reconciler never repairs business state.** It writes a *finding*. Repair is
   a separate, authorized, audited action (or an operator decision). A reconciler
   that "fixes" drift silently converts a detected problem into an undetected one.
2. **A reconciler is idempotent.** Running it twice produces the same findings,
   not duplicates — enforced by `reconciliation_findings.fingerprint UNIQUE`
   (`kind + entity_type + entity_id + fingerprint`) with an upsert that refreshes
   `observed`/`detected_at` on an already-open finding.
3. **Bounded and read-only by default.** Each run takes a `scope` (a seller, a
   date range, or all) so a full-table comparison is never the only option, and
   each run records `checked_count` + `mismatch_count` even when it finds nothing.
4. **Findings are evidence, not prose.** `expected` and `observed` are stored as
   JSON so a reviewer sees the numbers the reconciler saw.
5. **Provider-side comparison only when credentials exist.** With a Stripe key the
   payment reconciler calls the provider; without it, the run records
   `status='completed'` with `details.providerSide = 'SKIPPED_NO_CREDENTIALS'` —
   an explicit, visible skip, never a green tick that was not earned.

---

## 2. The six reconcilers

### R1 — payment
| Check | Expected | Observed |
|---|---|---|
| attempt ↔ payment | every `succeeded` attempt has a `paid` (or refunded) payment | `payment_attempts` vs `payments` |
| payment ↔ order/purchase | every `paid` payment covers an order or purchase whose state reflects it | `payments` vs `orders.order_state` / `payments` |
| settled-but-unapplied | a `succeeded` attempt with no settled order (the §70 silent-loss shape) | both |
| amount parity | `payments.amount` = Σ member `orders.total_amount` for a purchase | `payments` vs `orders` |
| stale attempts | live attempt older than the reservation window with no order movement | `payment_attempts` |
| provider side (when configured) | Stripe's session/intent status and amount equal ours | Stripe API |
| webhook backlog | `payment_events` in `processing`/`failed` beyond the retry budget | `payment_events` |

### R2 — inventory
`INVENTORY_ARCHITECTURE.md` §7: reservation ↔ open orders, commitment ↔ settled
orders, fulfillment ↔ shipments, movement replay (fold of `inventory_movements`
equals the counters — the strongest check), projection parity
(`product_variants.stock` = variant `available`), non-negativity.

### R3 — fulfillment
`FULFILLMENT_ARCHITECTURE.md` §7: work unit per paid order, `shipped` implies a
real shipment, quantity accounting per item, no over-ship, stuck work beyond the
SLA, lost/returned shipments without a resolution.

### R4 — refund
| Check | Expected | Observed |
|---|---|---|
| refund ↔ captured | `SUM(succeeded refunds) ≤ payments.amount` | `refunds` vs `payments` |
| refund ↔ provider (when configured) | our status matches the provider refund | Stripe API |
| stale pending | a refund `pending` beyond the retry budget with a recorded last error | `refunds` |
| refund ↔ ledger | every succeeded refund has its ledger entries | `refunds` vs `ledger_entries` |

### R5 — ledger
| Check | Expected | Observed |
|---|---|---|
| per purchase | Σ charge − Σ refund = Σ fee + Σ payable | `ledger_entries` |
| per seller | Σ payable credits − Σ settlements ≥ 0 | `ledger_entries` |
| per payment | fee + payable = charge | same |
| settlement link | every settlement references the entries it paid, and their sum equals its amount | `settlements` vs `ledger_entries` |

### R6 — purchase
| Check | Expected | Observed |
|---|---|---|
| total parity | `checkout_groups.total_amount` = Σ member order totals | both |
| single currency | one currency per purchase | both |
| single owner | every member order's `user_id` equals the purchase's | both |
| orphan members | no order points at a missing purchase | FK (should be impossible; asserted anyway) |

---

## 3. Schedule and execution

| Job | Cadence | Scope default | Rationale |
|---|---|---|---|
| webhook retry worker | every 60 s | n/a | keeps `payment_events` moving without waiting for a provider redelivery |
| outbox drain | every 15 s | n/a | the publish path |
| R1 payment | every 15 min | last 24 h | money is the most expensive drift |
| R2 inventory | hourly | all levels | cheap, high value |
| R3 fulfillment | hourly | active orders | catches stuck parcels |
| R4 refund | every 15 min | last 7 days | paired with R1 |
| R5 ledger | daily | previous day | payable integrity |
| R6 purchase | daily | previous day | structural integrity |

All jobs are started from `server.ts` in the same style as the existing
`payment-reservation-scheduler.ts` (30 s tick, guarded, single writer), each with
its own advisory lock (`pg_try_advisory_lock`) so two instances of the process
never run the same reconciler concurrently.

---

## 4. Findings lifecycle

```
 open ──(operator reviews)──> resolved   (resolution_note required)
   │
   └──(known/benign, with a reason)──> ignored
```

* A finding that is still true on the next run stays `open` with a refreshed
  `detected_at` and `observed` (the fingerprint upsert), so the run count is not
  noise and the age is visible.
* A finding that is no longer true on the next run is `resolved` **by the
  reconciler** with `resolution_note='no longer detected by run <id>'` — the only
  automatic closure, and it is not a repair (the reconciler simply no longer sees
  the drift).
* `severity` is fixed per check (`critical` for money-affecting checks, `warning`
  for stuck/aging, `info` for cosmetic parity), so alerting is not a judgement
  call made in the moment.

---

## 5. What reconciliation explicitly does NOT do

* It does not refund, cancel, ship, reserve, release or settle anything.
* It does not rewrite a row to match its expectation.
* It does not delete a finding to make a report clean.
* It does not call a provider in a way that moves money (read-only API calls only).
* It does not silently skip: an unavailable comparison (no credentials, provider
  outage) is recorded as an explicit `SKIPPED_*` detail in the run, and reported
  in `FINAL_VERIFICATION.md` as a limitation.

---

## 6. Owner actions that reconciliation will surface first

Given the current production state (unverifiable from this workspace — see
`FINAL_VERIFICATION.md`), the first R1/R4 runs are expected to be noisy for
historical rows:
1. charges captured on orders that were already `expired` (from the §70 incident)
   — the money is recorded on `payments` and needs an operator refund or
   fulfilment decision;
2. refunds created before `refunds.idempotency_key` existed (no key) — the
   reconciler reports them as `info` parity, not as drift;
3. `product_variants.stock` values that disagree with the new inventory rows
   immediately after migration (the migration backfills them, so this should be
   zero — if it is not, the migration ran on data it could not see).
