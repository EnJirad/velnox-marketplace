# AI Report — Cookie exposure removal, write-mode proof, VelCenter owner QA

**Date:** 2026-11-04

## A. Repository state

| | |
|---|---|
| Branch | `main` |
| Starting SHA | `e1f0a8b` |
| Hardening commit | `c52cd839494cb5818dd3e444dbf629cf1bf54d10` |
| Final SHA | this report's commit (immediately after `c52cd83`) |
| Working tree | clean; only the files listed below touched |

## B. Cookie security

**Raw output removed.** `cookies.mjs` can no longer emit a session cookie:

| Mode | Before | Now |
|---|---|---|
| bare `<account>` | printed `velnox_session=…` | refuses: "raw cookie output is disabled" |
| `--header` | printed a full `Cookie:` header | removed |
| `--curl <url>` | embedded the cookie in a runnable command | removed |
| `<account> --check` | identity JSON | unchanged — role/name/expiry only |
| `--status` | — | expiry + permissions + git-ignore state |
| `--export-file` | — | human-only (`ALLOW_COOKIE_EXPORT=1`), writes a 0600 file, refuses the secrets dir |

Guards kept: tracked-file refusal, `--check` refuses expired sessions, error
messages never include a value, no URL is generated with credentials.

Evidence: 7 CLI tests (`proxy-write-mode.test.ts`) run the helper as a process
and assert its **output** never contains the stored token.

Storage: `.ai/secrets/` is gitignored (`git check-ignore` asserted in tests),
store is `0600`, and the test fails if the mode is anything else.

## C. Write mode

Fail-closed. Safe mode is the default and only `GET`/`HEAD` reach the backend.

Write mode requires **all** of:

1. `PROXY_ALLOW_WRITES=1`
2. `PROXY_TEST_ENV_ID` (`^[a-z0-9][a-z0-9-]{2,31}$`, no "prod")
3. `PROXY_TEST_API_BASE` — `http://` + `localhost`/`127.0.0.1` + port 1024–65535
4. `PROXY_TEST_DB_PROOF` — a 0600 JSON file with
   `environment: "test"`, `writesApproved: true`, `disposable: true`,
   matching `envId` and `apiBase`, `databaseUrlHost` loopback, future `expiresAt`

Rejected and tested: writes disabled by default; bare flag; missing/blank env id;
"prod" env id; the known production API; a `.vercel.app` alias; unknown remote
host; URL credentials; `https` to loopback; privileged port; missing proof;
group-readable proof; malformed JSON; non-test environment; `writesApproved:false`;
non-disposable DB; env-id mismatch; API-base mismatch; remote database host;
expired proof. A fully proven local stack is the only accepted case.

Also fixed during this pass: a bare `allowWrites: true` without a verified
`writeMode` used to construct a proxy over the production API — it now throws
`NO_VERIFIED_TEST_ENVIRONMENT`.

## D. VelCenter QA — genuine owner session

Identity from `GET /api/auth/me`: **role `owner`** (the store entry formerly
labelled "customer" is the site owner; renamed to `owner`).

**Verified in the browser** (`http://localhost:3001/`, safe mode, read-only):

- Shell renders: header, owner chip ("เจ้าของบริษัท"), 12-module tablist
  (ภาพรวม · แชท · ออเดอร์ · Intelligence · สินค้า · พ่อค้า · หมวดหมู่ ·
  ผู้ใช้ & ลูกค้า · Audit Logs · ตรวจสอบยอดเงิน · การตลาด · ตั้งค่าระบบ).
- Dashboard shows real data, not placeholders: revenue ฿419.3, 5 orders,
  2 approved shops, 2 products, 1 low-stock, 1 reorder-due, intelligence summary.
- 12 admin API calls observed in the proxy log, all `200`
  (`overview`, `dashboard/counts`, `market-overview`, `verifications`, `users`,
  `settings`, `permissions`, `bootstrap-status`, `seller/status`, catalog).

**API-level module check** (owner cookie, read-only `GET`): `admin/orders`,
`admin/sellers`, `admin/verifications`, `admin/permissions`, `admin/audit-logs`,
`admin/dashboard/counts`, `admin/payment-incidents`, `admin/categories` → all `200`.

**Module UI: NOT VERIFIED.** The drawer opens and the tab buttons receive the
click (hit-test confirms the button is the top element at the click point), but
`aria-selected` stays on ภาพรวม — the panel never switches. That is a harness
limitation of the hidden WebView's synthetic clicks, or a real drawer-click bug;
it was not resolved here, so no module screenshot or per-module UI claim is made.

**Responsive: NOT VERIFIED** — the WebView cannot resize and the Chrome DevTools
MCP cannot start on this platform (`Cannot download a binary for the provided
platform: android (arm64)`).

No write was performed: every request in this task was `GET`.

## E. Test results

| Item | Status |
|---|---|
| Cookie-output exposure (7 CLI tests) | **AUTOMATED TEST PASSED** |
| Write-mode rejection matrix + acceptance (22 tests) | **AUTOMATED TEST PASSED** |
| Proxy safe-mode suite (30 tests, unchanged) | **AUTOMATED TEST PASSED** |
| Full backend suite | **AUTOMATED TEST PASSED** — 1693 pass / 389 skip / 0 fail |
| `typecheck` (all apps) | PASS |
| `velcenter` production build | PASS |
| `git diff --check` | PASS |
| VelCenter dashboard (owner) | BROWSER VERIFIED |
| VelCenter modules UI | NOT VERIFIED (tab switching did not register) |
| Responsive | NOT VERIFIED |
| Impeccable | NOT APPLICABLE this change (no UI change); engine still blocked |

## F. AI 02 review

- **Plan (accepted):** remove the three raw-cookie modes, replace curl usage with
  a request-runner/proxy, and make write mode a proof-file gate rather than one
  URL comparison. Adopted almost verbatim.
- **Independent final review of `c52cd83`: PASS.** It confirmed (1) no normal CLI
  path prints a cookie, (2) no path enables a write against a non-loopback or
  unproven target, (3) the tests assert those properties, noting the cookie tests
  are representative rather than exhaustive.
- Earlier in the same session AI 02 returned **FAIL** on the previous proxy test
  set; the four gaps it named were fixed before this commit.

## G. Remaining risks

1. A *verified* test deployment could still be misconfigured to point at
   production internally; the proof file cannot see inside that service.
2. An isolated test database can contain real data; isolation ≠ safety.
3. VelCenter module UI is unverified — needs a browser whose clicks reach the
   tablist (or a fix if this is a genuine drawer bug).
4. Responsive testing is blocked on this device (no resize capability).
5. Impeccable remains blocked (arm64 `ET_EXEC` engine).
6. Two seller-application UIs still coexist (`RequireRole.tsx` vs
   `ShopOnboarding.tsx`) — owner decision needed.
