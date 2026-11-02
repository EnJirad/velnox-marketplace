# 2026-11-02 — Local authenticated UI harness (owner session cookies)

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 12:05 +07 (05:05Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `39939dea5f04af370532ded0a003af1b9c9fcb5f` |
| 5 | Commit SHA after | docs-only commit recorded in §149 |
| 6 | Purpose | Let future UI checks run locally against the real production API with the owner's own sessions, instead of guessing from public pages |
| 7 | Inspected | `.gitignore` (`.harness/` ignored), existing `.harness/proxy.py`, API auth endpoints (`/api/auth/me`, `/api/admin/settings`, `/api/seller/status`) |
| 8 | Files touched | `.harness/sessions.json` (untracked, 600), `.harness/proxy.py`, `.harness/dev-auth.sh` (untracked); docs only are committed |
| 9 | Added | session store (customer / center / seller), cookie-injecting proxy for all methods, role→port helper script |
| 10 | Removed | the old header-less GET-only proxy body |
| 11 | What changed | The local proxy now forwards GET/POST/PUT/PATCH/DELETE, injects the stored `velnox_session` cookie and CORS headers, so any local dev origin can call the production API as that account |
| 12 | Why | Cookies cannot be set cross-site for `onrender.com`; injecting server-side is the only reliable way to authenticate a localhost build |
| 13 | Systems affected | Local tooling only — no application, backend or database change |
| 14 | Confirmed unaffected | `git status` shows no app files touched; `.harness/` is gitignored so nothing secret can be committed |
| 15 | Checks run | `curl http://127.0.0.1:5190/api/auth/me`, `/api/admin/settings`, `/api/seller/status`; `bash .harness/dev-auth.sh center`; `ls -l` permissions check |
| 16 | Results | `/api/auth/me` **200** (user Jirad, id 884291e5…), `/api/admin/settings` **200** (settings.manage present), `/api/seller/status` **200**; session file `-rw-------` |
| 17 | Problems found | The in-app browser now fails every authenticated load: `document.documentElement === null`, `document.scripts.length === 0`, `readyState: "loading"` — the harness injection (§137) replaces the document, so neither the VelCenter drawer nor the announcement editor could be inspected visually today |
| 18 | Limitations | Runtime UI verification of VelCenter remains **BLOCKED**; no screenshots. Only API-level authentication is proven |
| 19 | Work still open | Retry the drawer/editor check when the preview surface works; then verify the announcement upload end-to-end |
| 20 | Next agent must know | Start with `.harness/dev-auth.sh center` (or shop/seller) for the exact ports, then `HARNESS_ROLE=… HARNESS_PORT=… python3 .harness/proxy.py` and `VITE_API_URL=http://127.0.0.1:<port> bun run dev:<app> -- --port <dev>`. Session values live only in `.harness/sessions.json`; never commit or echo them. Tokens expire (`exp` ≈ 7 days), so replace the file when `/api/auth/me` starts returning 401 |
