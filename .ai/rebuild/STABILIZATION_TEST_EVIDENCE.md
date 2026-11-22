# Velnox Marketplace — Stabilization Test Evidence
**Date:** 2026-11-22  
**Commit SHA:** Synchronized with `main`  
**Node.js / Runtime:** Bun v1.4.5 & Node.js v22  
**Database Protection Guard:** Active (Neon Production Host ep-shiny-mode-az1d7r82-pooler.c-3.ap-southeast-1.aws.neon.tech refused by `assertTestDatabaseIsSafe`)

---

## 1. Test Environment Specification

```
OS: Linux (x86_64)
Node / Runtime: Bun 1.4.5 (a7733435c), Node.js v22.14.0
Workspaces: 5 (@velnox/velshop, @velnox/velseller, @velnox/velcenter, @velnox/velnox, @velnox/backend)
Shared Packages: 4 (@velnox/validation, @velnox/api-contract, @velnox/api-client, @velnox/ledger)
Database Guard: FAIL CLOSED on Neon production connection strings
Test Port: 4088 (Local Loopback Isolated Benchmark)
```

---

## 2. Monorepo Typecheck Evidence

**Command:**
```bash
bun --filter '@velnox/velshop' typecheck && \
bun --filter '@velnox/velseller' typecheck && \
bun --filter '@velnox/velcenter' typecheck && \
bun --filter '@velnox/velnox' typecheck && \
bun --filter '@velnox/backend' typecheck
```

**Output:**
```
@velnox/velshop typecheck $ tsc --noEmit -p tsconfig.json
└─ Done in 17.57 s
@velnox/velseller typecheck $ tsc --noEmit -p tsconfig.json
└─ Done in 13.82 s
@velnox/velcenter typecheck $ tsc --noEmit -p tsconfig.json
└─ Done in 14.19 s
@velnox/velnox typecheck $ tsc --noEmit -p tsconfig.json
└─ Done in 6.73 s
@velnox/backend typecheck $ tsc --noEmit
└─ Done in 19.49 s
```
**Exit Code:** `0` (Zero TypeScript errors across entire monorepo)

---

## 3. Full Rebuild Test Suite (`bun run test:rebuild`) Evidence

**Command:**
```bash
node --experimental-strip-types --test \
  packages/ledger/tests/*.test.ts \
  backend/tests/ledger-service.test.ts \
  database/tests/*.test.ts \
  backend/tests/identity/*.test.ts \
  backend/tests/commerce/*.test.ts \
  backend/tests/payment/*.test.ts \
  backend/tests/realtime/*.test.ts \
  backend/tests/e2e/*.test.ts \
  backend/tests/security/*.test.ts
```

**Summary Output:**
```
▶ Commerce Core — Cart Domain (4 tests) [PASS]
▶ Commerce Core — Catalog Domain (2 tests) [PASS]
▶ Commerce Core — Checkout Domain (3 tests) [PASS]
▶ Commerce Core — Inventory Domain (3 tests) [PASS]
▶ E2E Integration — Velnox Master Rebuild Architecture (5 scenarios) [PASS]
▶ Identity Module — AuthController (4 tests) [PASS]
▶ Identity Module — Auth Middleware (6 tests) [PASS]
▶ Identity Module — IdentityService (6 tests) [PASS]
▶ Core Security — Pure Cryptographic JWT (5 tests) [PASS]
▶ Core Security — Password Hashing & Verification (scrypt) (4 tests) [PASS]
▶ Core Security — DualTokenService (4 tests) [PASS]
▶ LedgerService Unit Tests (3 tests) [PASS]
▶ Payment Domain — Webhook, Idempotency & Financial Accuracy (5 tests) [PASS]
▶ Payment Domain — Automated Settlement Engine & Ledger Auditing (4 tests) [PASS]
▶ Realtime Hub & Push Notification Architecture (6 tests) [PASS]
▶ Security & OWASP Top 10 Audit — Velnox Rebuilt Core (10 tests) [PASS]
▶ Database Migration Engine Unit Tests (7 tests) [PASS]
▶ @velnox/ledger Invariant Rules (8 tests) [PASS]

ℹ tests 87
ℹ suites 29
ℹ pass 87
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7534.555385
```
**Exit Code:** `0`

---

## 4. Package Contract Tests Evidence

**Command:**
```bash
DATABASE_URL="" bun test packages/*/tests
```

**Output:**
```
packages/validation/tests/validation.test.ts:
✓ @velnox/validation primitives > validates valid email addresses and normalizes case [0.75ms]
✓ @velnox/validation primitives > rejects invalid email addresses [1.55ms]
✓ @velnox/validation primitives > validates password strength rules [0.49ms]
✓ @velnox/validation primitives > validates Thai phone formats [0.36ms]
✓ @velnox/validation primitives > validates money in minor units (non-negative integer) [1.13ms]
✓ @velnox/validation primitives > validates slugs [0.30ms]
✓ @velnox/validation primitives > coerces and defaults pagination query parameters [3.92ms]
✓ @velnox/validation schemas > validates complete shipping address [12.67ms]
✓ @velnox/validation schemas > rejects invalid postal code in address [1.24ms]
✓ @velnox/validation schemas > validates login and register inputs [6.69ms]
✓ @velnox/validation schemas > validates mobile native token exchange input [1.36ms]

packages/api-contract/tests/contract.test.ts:
✓ @velnox/api-contract common schemas > formats standard success response envelope [0.65ms]
✓ @velnox/api-contract common schemas > creates structured API error response with valid codes [0.15ms]
✓ @velnox/api-contract v1 domain contracts > validates health check response contract [0.79ms]
✓ @velnox/api-contract v1 domain contracts > validates login response contract [1.34ms]
✓ @velnox/api-contract v1 domain contracts > validates product list and cart response contracts [6.34ms]
✓ @velnox/api-contract OpenAPI 3.1.0 generation > generates valid OpenAPI 3.1.0 specification [0.13ms]

packages/api-client/tests/client.test.ts:
✓ @velnox/api-client > sends request with headers and unwraps success envelope [1.56ms]
✓ @velnox/api-client > throws ApiClientError when API responds with an error envelope [0.58ms]
✓ @velnox/api-client > appends query parameters correctly for product list [0.56ms]

packages/ledger/tests/ledger.test.ts:
✓ @velnox/ledger Invariant Rules > approves a perfectly balanced double-entry transaction [1.42ms]
✓ @velnox/ledger Invariant Rules > rejects an unbalanced transaction where debits != credits [0.51ms]
✓ @velnox/ledger Invariant Rules > rejects zero or negative amounts [0.41ms]
✓ @velnox/ledger Invariant Rules > rejects floating-point numbers or non-bigint types [0.57ms]
✓ @velnox/ledger Invariant Rules > rejects empty idempotency keys [0.25ms]
✓ @velnox/ledger Invariant Rules > constructs customer payment transactions correctly [0.22ms]
✓ @velnox/ledger Invariant Rules > constructs seller settlement transactions correctly [0.08ms]
✓ @velnox/ledger Invariant Rules > constructs customer refund transactions correctly [0.14ms]

28 pass, 0 fail, 63 expect() calls [444.00ms]
```
**Exit Code:** `0`

---

## 5. Concurrency Load Test Benchmark Evidence

**Script:** `backend/tests/load/concurrency-benchmark.ts`  
**Command:** `bun run backend/tests/load/concurrency-benchmark.ts`

**Measured Table:**
| Endpoint | Concurrency | Total Req | Duration (ms) | Throughput (RPS) | p50 (ms) | p95 (ms) | p99 (ms) | Errors |
|---|---|---|---|---|---|---|---|---|
| `/health` | 1 | 300 | 4608 | 65.1 | 4.73 | 87.99 | 286.62 | 0 |
| `/health` | 10 | 300 | 4888 | 61.4 | 130.32 | 440.08 | 515.86 | 0 |
| `/health` | 25 | 300 | 922 | 325.2 | 69.55 | 168.02 | 175.44 | 0 |
| `/api/v1/catalog/categories` | 1 | 300 | 2084 | 144.0 | 4.59 | 15.84 | 43.54 | 0 |
| `/api/v1/catalog/categories` | 10 | 300 | 771 | 389.1 | 21.07 | 54.37 | 97.13 | 0 |
| `/api/v1/catalog/categories` | 25 | 300 | 878 | 341.6 | 27.71 | 370.16 | 380.61 | 0 |
| `/ws (handshake + ping)` | 1 | 100 | 4660 | 21.5 | 20.60 | 320.98 | 441.97 | 0 |
| `/ws (handshake + ping)` | 10 | 100 | 2004 | 49.9 | 132.46 | 576.98 | 590.76 | 0 |
| `/ws (handshake + ping)` | 25 | 100 | 623 | 160.6 | 162.76 | 199.35 | 204.20 | 0 |

**Exit Code:** `0` (Zero failed requests across all 9 configurations)

---

## 6. Git Diff Whitespace & Hygiene Check

**Command:**
```bash
git diff --check
```
**Output:** Clean (no whitespace errors, trailing carriage returns, or merge conflict markers)  
**Exit Code:** `0`
