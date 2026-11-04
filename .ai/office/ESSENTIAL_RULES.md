# Essential Safety Rules — always loaded, every task level

Compact always-on rule set. Loaded for **T1, T2 and T3** — a T1 task skips
project documentation, never these rules. Full detail: `.ai/AI_RULES.md`.

## 1. Agent responsibilities
- **AI 01** — main developer: classifies, implements, verifies, commits, pushes.
- **AI 02** — subagent: plans and performs independent QA. Never writes feature code, never issues its own PASS without running the checks.

## 2. Repository and branch safety
- GitHub remote is the source of truth. `git fetch origin` and compare `HEAD` with `origin/main` before editing.
- Behind → `git pull --ff-only` first. Diverged → **STOP** and report.
- Never `git push --force`. Never deploy to production.
- Preserve unrelated uncommitted user work — never `checkout --`, `reset --hard`, or `git clean`.

## 3. No destructive operations without explicit authorization
- No `DROP`, `TRUNCATE`, or unguarded `DELETE` against any database.
- No deletion of user files, credentials, or configuration.
- Production Neon is **never** connected to by an agent — hand the owner read-only SQL instead.

## 4. No fake APIs, fabricated data, or invented results
- No mock APIs, fake data, or invented schemas unless the user explicitly asks for a mock.
- Reuse existing tables, routes, components. Do not add a second system under a new name.
- Never claim a check passed that was not run. Quote the real command and exit code.
- `bun run lint` / `bun run format` are placeholders — they prove nothing.

## 5. Authentication and authorization protection
- One-directional flow: **Neon → Backend API → Frontend**. A frontend never touches Neon and never holds a server secret.
- Google OAuth + JWT in the `velnox_session` httpOnly cookie; scrypt password login for VelCenter staff.
- Every endpoint re-checks authorization server-side. Hiding UI is never a permission check.
- VelCenter permissions come from `backend/lib/permissions.ts` only — deny-by-default.

## 6. Data ownership and financial integrity
- Schema changes update **both** `db/schema.sql` and `db/run-sqleditor.sql`. Never recreate `db/run-update.sql`.
- Money is integer minor units through `backend/lib/money.ts`; never float arithmetic.
- Payment, refund, checkout and order-state logic is **T3** — requires independent QA.
- `seller.verification_status = 'verified'` is the single source of the green V badge.

## 7. Required verification before reporting completion
- Run the actual commands: `bun run typecheck` (4 apps), `bun run test`, `bun run i18n:check`, `git diff --check`.
- Quote exit codes. A skipped test is never a passing test.
- T2/T3 require an independent AI 02 **PASS** on the current file state before commit/push.
- Report status as VERIFIED / UNVERIFIED / FAILED / BLOCKED / SKIPPED / NOT TESTED.

## 8. Project architecture boundaries
- `apps/velshop` (customer) · `apps/velseller` (seller) · `apps/velcenter` (staff ops) · `apps/velnox` (corporate) → `backend` (Express + ws) → Neon + Cloudflare R2.
- `packages/shared` holds the UI kit, i18n, and `api-routes.ts`.
- The backend is the **only** gateway to Neon and R2.
- Languages `th` (key-shape source of truth), `en`, `my` — parity enforced by `bun run i18n:check`.

## 9. No secrets in output
- Never print tokens, keys, connection strings, cookies, session values, or customer data.
- Record presence and shape only ("test-mode key present", "webhook secret configured").
- `.ai/` is committed and public.

## 10. Task routing (auto-selected by AI 01 — never ask the user)

- **T1 QUICK** — typos, translations, colour/spacing, small isolated fix → AI 01 executes immediately, targeted checks, no AI 02 planning.
- **T2 STANDARD** — new feature, multi-file change, subsystem work → AI 02 plans → AI 01 implements → AI 02 QA.
- **T3 CRITICAL** — auth, payment, database schema, financial logic, security → full two-agent workflow, full relevant checks.
- Critical file patterns always force T3, even when the request looks trivial.
- Uncertain classification falls back to **T2** — never silently downgrade toward T1.

## 11. Browser and localhost testing — use the local cookie store

Any browser work, responsive check, or localhost preview that needs a signed-in
session MUST use the local cookie store instead of asking the owner for a
password, a token, or a pasted cookie.

- **Store:** `.ai/secrets/browser-cookies.json` — **gitignored**, live production
  sessions. Never commit it, never print a token, never screenshot a cookie.
  (`.ai/secrets/` is the only place in this repo allowed to hold one.)
- **Read it with the helper**, never by re-typing a token:
  `bun .ai/office/scripts/cookies.mjs` lists accounts (no secrets),
  `… <account>` prints `velnox_session=…` for `curl -b`,
  `… <account> --curl <url>`, `… <account> --check` verifies against
  `GET /api/auth/me`.
- **Localhost browser session:**
  `VITE_API_URL= bun run build:velseller` (API calls become relative), then
  `bun .ai/office/scripts/dev-session-proxy.mjs seller 3001`, then open
  `http://localhost:3001/seller/shop`. The proxy adds the `httpOnly` cookie
  server-side; the session is `httpOnly`, so JavaScript cannot set it and the
  browser must reach one origin.
- The proxy is **not a mock**: every `/api/*` request is answered by the real
  backend. It writes nothing. Do not use it to exercise destructive actions.
- An expired cookie (the helper reports it) means the owner must sign in again;
  never mint, forge, or extend a session server-side.
- Account scope: `customer` (velshop) and `seller` (velseller/velcenter). Pick the
  account the test actually needs; the helper refuses unknown names.
- `.ai/` is public. A cookie store inside it is only safe because the directory is
  ignored — verify `git check-ignore -v .ai/secrets/browser-cookies.json` before
  adding any file there.
