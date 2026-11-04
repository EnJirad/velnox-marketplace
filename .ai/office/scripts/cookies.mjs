#!/usr/bin/env bun
/**
 * Local browser-session cookie helper.
 *
 * Reads `.ai/secrets/browser-cookies.json` (gitignored, live production
 * sessions) and prints ONLY what the caller asked for, so an agent can
 * authenticate an API call or a browser check without ever re-typing a token
 * and without printing it into the chat transcript.
 *
 * Usage
 *   bun .ai/office/scripts/cookies.mjs                     list accounts (no tokens)
 *   bun .ai/office/scripts/cookies.mjs seller               "velnox_session=…"  (for curl -b)
 *   bun .ai/office/scripts/cookies.mjs seller --header      "Cookie: velnox_session=…"
 *   bun .ai/office/scripts/cookies.mjs seller --curl URL    ready-to-run curl command
 *   bun .ai/office/scripts/cookies.mjs seller --check       GET /api/auth/me and report identity
 *
 * Rules baked in here:
 *   • the file is gitignored; refuse to run if it is ever tracked by git
 *   • an expired cookie is reported as expired instead of being printed
 *   • no other account's data is ever emitted
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const file = join(repoRoot, ".ai", "secrets", "browser-cookies.json");

function fail(message, code = 1) {
  console.error(`cookies: ${message}`);
  process.exit(code);
}

let store;
try {
  store = JSON.parse(readFileSync(file, "utf8"));
} catch {
  fail(`no cookie store at ${file}. Create it locally (it is gitignored) — see .ai/office/ESSENTIAL_RULES.md §11.`);
}

// A tracked file means the credentials are about to be published. Stop.
try {
  execFileSync("git", ["ls-files", "--error-unmatch", ".ai/secrets/browser-cookies.json"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  fail("cookie store is tracked by git — run `git rm --cached .ai/secrets/browser-cookies.json` before using it.");
} catch (err) {
  if (err?.status === 0) fail("cookie store is tracked by git — remove it from the index before using it.");
}

const args = process.argv.slice(2);
const accountKey = args.find((a) => !a.startsWith("--"));
const flag = args.find((a) => a.startsWith("--")) ?? "";
const flagValue = flag ? args[args.indexOf(flag) + 1] : undefined;

const accounts = store.accounts ?? {};
const names = Object.keys(accounts);

if (!accountKey) {
  console.log(`cookie store: ${file}`);
  console.log(`cookie name : ${store.cookieName}`);
  for (const name of names) {
    const account = accounts[name];
    const expired = account.expiresAt && Date.parse(account.expiresAt) < Date.now();
    console.log(
      `  ${name.padEnd(10)} ${String(account.role).padEnd(9)} ${account.email}  expires ${account.expiresAt ?? "?"}${expired ? "  [EXPIRED]" : ""}`,
    );
  }
  console.log("\nusage: cookies.mjs <account> [--header|--curl <url>|--check]");
  process.exit(0);
}

const account = accounts[accountKey];
if (!account) fail(`unknown account "${accountKey}". Known: ${names.join(", ")}`);

const cookieName = store.cookieName ?? "velnox_session";
const token = account.cookies?.[cookieName];
if (!token) fail(`account "${accountKey}" has no ${cookieName} cookie`);

const expired = account.expiresAt && Date.parse(account.expiresAt) < Date.now();
if (expired && flag !== "--check") fail(`cookie for "${accountKey}" expired at ${account.expiresAt} — refresh it first.`);

const cookieHeader = `${cookieName}=${token}`;

switch (flag) {
  case "":
    process.stdout.write(cookieHeader);
    break;
  case "--header":
    process.stdout.write(`Cookie: ${cookieHeader}`);
    break;
  case "--curl": {
    const url = flagValue;
    if (!url) fail("--curl needs a URL");
    process.stdout.write(
      `curl -sS '${url}' -H 'Cookie: ${cookieHeader}' -H 'accept: application/json' -H 'origin: ${account.origins?.[0] ?? ""}'`,
    );
    break;
  }
  case "--check": {
    const base = store.apiBase ?? "https://velnox-api.onrender.com";
    const response = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader } });
    const body = await response.json().catch(() => ({}));
    console.log(
      JSON.stringify(
        { status: response.status, ok: response.ok, identity: body?.data ?? body, expiresAt: account.expiresAt },
        null,
        2,
      ),
    );
    break;
  }
  default:
    fail(`unknown flag ${flag}`);
}
