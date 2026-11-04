#!/usr/bin/env bun
/**
 * Local browser-session cookie helper — SAFE BY DEFAULT.
 *
 * Deliberately CANNOT print a session cookie. Agent workflows get status and
 * identity only; the authenticated proxy is the way to make requests with the
 * session, because it injects the cookie server-side and prints nothing.
 *
 *   bun .ai/office/scripts/cookies.mjs              list accounts (no secrets)
 *   bun .ai/office/scripts/cookies.mjs --status     expiry + git-ignore state
 *   bun .ai/office/scripts/cookies.mjs <account> --check    identity via /api/auth/me
 *   ALLOW_COOKIE_EXPORT=1 bun …/cookies.mjs <account> --export-file <path>
 *                                                   (human-only; writes 0600 file)
 *
 * Raw-cookie modes (`--header`, `--curl`, bare account) were removed: they put
 * credentials in tool output, shell history and generated commands.
 */
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const file = join(repoRoot, ".ai", "secrets", "browser-cookies.json");
const SECRETS_DIR = ".ai/secrets";

function fail(message, code = 1) {
  // Messages never contain cookie values, tokens or header material.
  console.error(`cookies: ${message}`);
  process.exit(code);
}

let store;
try {
  store = JSON.parse(readFileSync(file, "utf8"));
} catch {
  fail("no cookie store at .ai/secrets/browser-cookies.json — see ESSENTIAL_RULES §11");
}

const tracked = (() => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", ".ai/secrets/browser-cookies.json"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();
if (tracked) fail("cookie store is tracked by git — run `git rm --cached .ai/secrets/browser-cookies.json` first");

const accounts = store.accounts ?? {};
const names = Object.keys(accounts);
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const accountKey = args.find((a) => !a.startsWith("--") && a !== flagValueOf("--export-file"));

function flagValueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!accountKey) {
  if (flags.includes("--status")) {
    const gitIgnored = gitIgnores(join(repoRoot, ".ai/secrets/browser-cookies.json"));
    const mode = (statSync(file).mode & 0o777).toString(8);
    console.log(`store      : .ai/secrets/browser-cookies.json`);
    console.log(`permissions: ${mode}  git-ignored: ${gitIgnored ? "yes" : "NO — STOP"}`);
    for (const name of names) {
      const a = accounts[name];
      const expired = a.expiresAt && Date.parse(a.expiresAt) < Date.now();
      console.log(`  ${name.padEnd(7)} ${String(a.role ?? "?").padEnd(7)} expires ${a.expiresAt ?? "?"}${expired ? "  [EXPIRED]" : ""}`);
    }
    console.log(`proxy      : bun .ai/office/scripts/dev-session-proxy.mjs <account> 3001`);
    process.exit(0);
  }

  console.log(`cookie store: ${file}`);
  console.log(`cookie name : ${store.cookieName}`);
  for (const name of names) {
    const a = accounts[name];
    const expired = a.expiresAt && Date.parse(a.expiresAt) < Date.now();
    console.log(
      `  ${name.padEnd(7)} ${String(a.role ?? "?").padEnd(7)} ${a.expiresAt ?? "?"}${expired ? "  [EXPIRED]" : ""}`,
    );
  }
  console.log("\nraw cookie output is disabled. use:");
  console.log("  <account> --check        identity via GET /api/auth/me");
  console.log("  dev-session-proxy.mjs    authenticated localhost preview (cookie stays server-side)");
  process.exit(0);
}

const account = accounts[accountKey];
if (!account) fail(`unknown account. known: ${names.join(", ")}`);

const cookieName = store.cookieName ?? "velnox_session";
const token = account.cookies?.[cookieName];
if (!token) fail(`account "${accountKey}" has no ${cookieName}`);
const expired = account.expiresAt && Date.parse(account.expiresAt) < Date.now();

if (flags.includes("--check")) {
  if (expired) fail(`session expired at ${account.expiresAt} — sign in again`);
  const base = store.apiBase ?? "https://velnox-api.onrender.com";
  const res = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: `${cookieName}=${token}`, accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  // Identity only: no cookie, no headers, no token.
  console.log(
    JSON.stringify(
      {
        status: res.status,
        role: body?.data?.user?.role ?? null,
        name: body?.data?.user?.name ?? null,
        expiresAt: account.expiresAt ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (flags.includes("--export-file")) {
  const target = flagValueOf("--export-file");
  if (process.env.ALLOW_COOKIE_EXPORT !== "1") {
    fail("raw export is human-only: set ALLOW_COOKIE_EXPORT=1 in your own terminal");
  }
  if (!target) fail("--export-file needs a path");
  const abs = resolve(target);
  if (abs.startsWith(resolve(repoRoot, SECRETS_DIR))) {
    fail("refusing to export into the secrets directory — the store already lives there");
  }
  if (expired) fail("session expired — refusing to export");
  writeFileSync(abs, `${cookieName}=${token}\n`, { mode: 0o600 });
  chmodSync(abs, 0o600);
  console.log(`exported to ${abs} (0600). delete it when finished.`);
  process.exit(0);
}

fail("nothing to do. use --check, --status, or the proxy (raw cookie output is disabled).");

function gitIgnores(path) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: repoRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
