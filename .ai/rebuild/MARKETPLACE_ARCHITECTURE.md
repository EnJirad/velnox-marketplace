# MARKETPLACE_ARCHITECTURE.md — who may see and do what, and who is owed what

---

## 1. Three projections of one purchase

| Surface | Sees | Does not see |
|---|---|---|
| **Customer** (VelShop) | the whole purchase: every shop's order, one payment, one refund state | other customers, sellers' internal notes, commission |
| **Seller** (VelSeller) | **only** its own `orders` (`shop_id`/`sellers.user_id`), its items, its fulfillment work and its own money | other shops' rows in the same purchase; the platform fee of another seller; the customer's other orders |
| **Admin** (VelCenter: `owner|admin|staff` + permission) | everything, with an audit trail on every write | nothing (but every write is recorded) |

**Ownership is enforced in the query, not after it.** A customer read of a
purchase resolves `checkout_groups.user_id = $me` **in the WHERE** (already the
case, `readOwnedCheckoutGroup`); a seller read resolves `shop_id IN (SELECT id
FROM shops WHERE seller_id = $mySeller)` **in the WHERE**; a 404 is returned for
a foreign id so existence is never confirmed. Frontend filtering is **never**
the boundary (§16: "ห้ามพึ่ง frontend filtering").

**Group leakage is the specific risk this model creates**, because one purchase
holds several sellers' rows. Rules:
* a seller's order list/detail query never joins `checkout_groups` without the
  `shop_id` predicate;
* a seller never receives `checkout_groups.user_id`, the purchase total, or
  another member order's amounts;
* `GET /api/seller/orders/:id` accepts an **order** id, not a purchase id, and
  resolves ownership from the order row itself;
* the settlement a seller sees is their own payable, never the purchase total.

---

## 2. Customer payment ≠ seller payout (§17)

```
                       ONE Stripe charge (the purchase)
                                   │
                        platform_cash (ledger)
                        ┌──────────┴───────────┐
                        ▼                      ▼
              platform_revenue          seller_payable(per seller)
              (the platform fee)          (the sale, minus the fee,
                                            per SellerOrder)
                                                 │
                                          settlements (period payout)
                                                 │
                                        ledger_entries.settlement_id
```

* The customer is charged through the platform's own Stripe account. **There is
  no Stripe Connect** in this repository and this rebuild does not add one
  (no connected account, no KYC, no transfers) — that remains an owner decision.
* The seller's money is therefore **internal accounting**: an immutable ledger,
  a payable per seller, and a settlement record that pays a subset of it.
* `customer paid` **never** implies `seller paid`. A refund reverses the payable;
  a payout is a separate, recorded event.

**Fee resolution — ONE place.** Today three disagreeing rates exist
(`0.03` in `lib/seller-stats.ts` and `routes/products.ts`, `0` in
`routes/seller-orders.ts`, `0.05` in the `commissions.rate` default). Target:
`resolveCommissionRate(sellerId)` in `lib/ledger.ts`, reading the seller's own
setting when present and the platform default otherwise, snapshotting the rate
used onto each ledger entry so a later rate change never rewrites history.

---

## 3. The ledger (§18) — immutable, append-only, reconcilable

Entries written inside the transaction that causes them:

| Event | Entries |
|---|---|
| payment settled | `charge` +amount on `platform_cash` (debit) · `platform_fee` on `platform_revenue` (credit) · one `seller_payable` credit per SellerOrder, minus that order's fee |
| refund succeeded | `refund` debit on `platform_cash` · `seller_payable` debit (reversal) · `platform_revenue` debit (fee reversal) |
| settlement paid | `settlement` debit on `seller_payable`, linked to the settlement row |
| manual correction | `adjustment` (reason required, actor required) |

Guarantees:
* **Append-only**: no `UPDATE`, no `DELETE` in any code path; a mistake is a new
  compensating entry. Pinned by a test that greps the module and by a DB rule
  (a `BEFORE UPDATE OR DELETE` trigger that raises, matching the repo's existing
  `prevent_circular_category_parent()` trigger style).
* **Idempotent**: `idempotency_key UNIQUE` — a retried settlement writes the same
  key and becomes a no-op instead of a double charge.
* **Reconcilable**: per purchase, `Σ charge − Σ refund = Σ (fee + payable)`;
  per seller, `Σ payable credits − Σ settlements ≥ 0`; the ledger reconciler
  verifies both and reports findings.

---

## 4. Seller lifecycle boundaries (unchanged, not to be touched)

The rebuild must not disturb: Google OAuth login, seller onboarding, identity
verification (`seller_verifications`, V badge), product management, image
upload/R2, customer and seller profiles, or the admin surfaces. Concretely:
* `sellers.verification_status`, `sellers.status`, `seller_verifications`,
  `seller_review_history` — **read only** in this rebuild; no write path changes.
* `media`/R2 — untouched.
* `products`/`categories`/variants — touched only where stock moves through the
  one inventory writer, and only in the guard clauses (the product CRUD stays).
* Auth, cookies, sessions, `revoked_tokens` — untouched.

The seller **fulfillment** surface (`PATCH /api/seller/orders/:id/status`) is
extended: it now validates against the four-axis model and delegates shipment
creation to the one shipment writer, but it keeps every existing gate
(payment-before-confirm, no-cancel-after-paid, carrier+tracking-before-ship) and
its existing error codes (`ORDER_ALREADY_PAID`, `PAYMENT_IN_PROGRESS`,
`PAYMENT_NOT_CONFIRMED`, `SHIPMENT_REQUIRED`, `INVALID_STATUS`).

---

## 5. Security review of the surfaces this rebuild touches (§28)

| Concern | Position |
|---|---|
| authentication | unchanged (Google OAuth + httpOnly JWT + `revoked_tokens`) |
| authorization | unchanged mechanism; new admin surfaces require a permission (`orders.manage`, `sellers.manage`); server-side only |
| ownership / IDOR | every new read is scoped in the WHERE by `user_id` or `shop_id`; new tables never trust an id from the body |
| webhook signature | unchanged (`constructEventAsync` over raw bytes, endpoint secret only, 400 on failure, 503 when unconfigured) |
| replay | webhook: `event_id` claim · checkout/payment: `checkout_requests` · refund: `idempotency_key` |
| SQL injection | parameterised queries only; new SQL is written in the same style (no concatenated values; only identifiers/static fragments) |
| privilege escalation | a seller can never act on another shop's order (predicate), never refunds, never settles, never sees the platform fee of another seller |
| secrets | never in `VITE_*`, never logged, never returned (the existing secret-leak tests are extended to the new modules) |
| rate limiting | **NOT implemented today** — recorded as an open gap, not silently claimed. The rebuild adds a bounded, DB-backed attempt cap for payment attempts per order and keeps every other endpoint's existing behaviour |
| CSRF | cookie auth + same-site cookies are the existing posture; no CSRF token layer exists and this rebuild does not claim one. Recorded as a gap in `FINAL_VERIFICATION.md` |
| input validation | Zod where present, `validateCheckoutQuantity` style guards elsewhere; every new body field is validated and coerced |

---

## 6. Admin inspection surfaces (§33)

| Surface | Reads | Writes |
|---|---|---|
| order inspector | `orders`, `order_items`, `fulfillment_orders`, `shipments`, `shipment_items` | only through the order/fulfillment transitions |
| payment inspector | `payments`, `payment_attempts`, `refunds` | nothing |
| webhook inspector | `payment_events` (payload reference, status, attempt_count, next_retry_at, error) | **retry** an event (re-arms the claim — the only write, audited) |
| inventory inspector | `inventory`, `inventory_movements` | `adjust` movement only (reason required) |
| reconciliation inspector | `reconciliation_runs`, `reconciliation_findings` | resolve/ignore a finding (note required) |
| incident register | `payment_incidents` (all kinds) | resolve (note required) |

Every write above appends to `audit_logs` (the existing table) with actor, action,
entity and details.
