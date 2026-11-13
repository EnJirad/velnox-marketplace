/**
 * Authentication gate — the wiring that makes Turnstile actually mandatory.
 *
 * Two halves:
 *
 *   1. UNIT — the one-time pre-authentication proof that guards the Google
 *      redirect (`backend/lib/preauth-proof.ts`): mint, validate, expire,
 *      forge, and single-use.
 *   2. SOURCE CONTRACT — every credential entry point must call the shared
 *      gate, the frontend must not contain a bypass, and the existing OAuth
 *      state machinery must still be intact. These are assertions on the code
 *      because the alternative (driving real Google consent) is not testable
 *      here and a route that silently loses its gate is exactly the regression
 *      worth catching.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREAUTH_COOKIE,
  PREAUTH_TTL_MS,
  createPreAuthProof,
  preAuthCookieOptions,
  validatePreAuthProof,
} from "../lib/preauth-proof.js";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Strip comments before asserting on ORDER. A doc comment that names a
 * function ("this runs before createOAuthState") otherwise satisfies an
 * indexOf comparison and makes the test pass for the wrong reason.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.PREAUTH_PROOF_SECRET = "preauth-test-secret-32-characters!!";
  delete process.env.OAUTH_STATE_SECRET;
  process.env.JWT_SECRET = "jwt-test-secret-32-characters-ok!!";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("pre-auth proof — the gate in front of GET /auth/google", () => {
  test("a freshly minted proof validates", () => {
    const { cookieValue } = createPreAuthProof();
    expect(validatePreAuthProof(cookieValue).ok).toBe(true);
  });

  test("a missing cookie is rejected", () => {
    const result = validatePreAuthProof(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_cookie");
  });

  test("an empty cookie is rejected", () => {
    const result = validatePreAuthProof("");
    expect(result.ok).toBe(false);
  });

  test("a forged signature is rejected", () => {
    const { cookieValue } = createPreAuthProof();
    const [payload] = cookieValue.split(".");
    const result = validatePreAuthProof(`${payload}.deadbeef`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  test("a tampered payload is rejected", () => {
    const { cookieValue } = createPreAuthProof();
    const [, signature] = cookieValue.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ n: "attacker-nonce", e: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    const result = validatePreAuthProof(`${forgedPayload}.${signature}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  test("an expired proof is rejected", () => {
    const past = Date.now() - PREAUTH_TTL_MS - 1_000;
    const { cookieValue } = createPreAuthProof(past, PREAUTH_TTL_MS);
    const result = validatePreAuthProof(cookieValue);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  test("the proof lifetime is short by design", () => {
    expect(PREAUTH_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  test("two proofs are different (random nonce, not a constant)", () => {
    expect(createPreAuthProof().cookieValue).not.toBe(createPreAuthProof().cookieValue);
  });

  test("the cookie is httpOnly, path-scoped to /auth and Lax", () => {
    const options = preAuthCookieOptions(1000, true);
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/auth");
  });

  test("no signing secret means generation throws (fail closed)", () => {
    delete process.env.PREAUTH_PROOF_SECRET;
    delete process.env.OAUTH_STATE_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => createPreAuthProof()).toThrow();
  });

  test("validation without a secret rejects rather than accepting", () => {
    const { cookieValue } = createPreAuthProof();
    delete process.env.PREAUTH_PROOF_SECRET;
    delete process.env.OAUTH_STATE_SECRET;
    delete process.env.JWT_SECRET;
    expect(validatePreAuthProof(cookieValue).ok).toBe(false);
  });
});

describe("every credential entry point is gated", () => {
  const authRoutes = read("backend/routes/auth.ts");

  function routeBody(path: string): string {
    const start = authRoutes.indexOf(`app.post("${path}"`);
    expect(start).toBeGreaterThan(-1);
    const next = authRoutes.indexOf("app.post(", start + 1);
    const nextGet = authRoutes.indexOf("app.get(", start + 1);
    const candidates = [next, nextGet].filter((n) => n > start);
    const end = candidates.length > 0 ? Math.min(...candidates) : authRoutes.length;
    return authRoutes.slice(start, end);
  }

  test("password-login calls the shared gate", () => {
    expect(routeBody("/api/auth/password-login")).toContain('enforceTurnstile(req, res, "password_login")');
  });

  test("password-register calls the shared gate", () => {
    expect(routeBody("/api/auth/password-register")).toContain('enforceTurnstile(req, res, "password_register")');
  });

  test("member-login calls the shared gate (it had none at all before)", () => {
    expect(routeBody("/api/auth/member-login")).toContain('enforceTurnstile(req, res, "member_login")');
  });

  test("preauth records the nonce BEFORE the cookie is issued", () => {
    const body = routeBody("/api/auth/preauth");
    expect(body).toContain("recordNonce(PREAUTH_NONCE_SCOPE");
    // Fail closed if the store is unavailable — no unrecorded proof.
    expect(body).toContain("PREAUTH_STORE_UNAVAILABLE");
    expect(body.indexOf("recordNonce(")).toBeLessThan(body.indexOf("res.cookie("));
  });

  test("preauth verifies before minting a proof", () => {
    const body = routeBody("/api/auth/preauth");
    expect(body).toContain("verifyTurnstile(");
    expect(body).toContain("createPreAuthProof(");
    // The proof is only minted after the verdict — never before.
    expect(body.indexOf("verifyTurnstile(")).toBeLessThan(body.indexOf("createPreAuthProof("));
  });

  test("no endpoint still contains the old inline siteverify call", () => {
    expect(authRoutes).not.toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
  });

  test("the old fail-open branch is gone", () => {
    // `if (turnstileSecret && turnstileToken)` skipped verification entirely
    // whenever the secret was missing.
    expect(authRoutes).not.toContain("if (turnstileSecret && turnstileToken)");
  });
});

describe("GET /auth/google requires the proof and keeps the OAuth state flow", () => {
  const authRoutes = read("backend/routes/auth.ts");
  const googleStart = authRoutes.slice(
    authRoutes.indexOf('app.get("/auth/google"'),
    authRoutes.indexOf('app.get("/auth/google/callback"'),
  );

  test("it validates and consumes the proof before doing anything else", () => {
    const body = code(googleStart);
    expect(body).toContain("validatePreAuthProof(proofCookie)");
    expect(body).toContain("clearCookie(PREAUTH_COOKIE");
    // The gate runs before the OAuth state is created.
    expect(body.indexOf("validatePreAuthProof")).toBeLessThan(
      body.indexOf("createOAuthState("),
    );
  });

  test("the proof is consumed atomically before OAuth starts", () => {
    const body = code(googleStart);
    expect(body).toContain("consumeNonce(PREAUTH_NONCE_SCOPE, proof.nonce)");
    // Consumption happens before the state is created.
    expect(body.indexOf("consumeNonce(")).toBeLessThan(body.indexOf("createOAuthState("));
    // Every non-ok outcome rejects: replayed, expired, unavailable.
    expect(body).toContain('if (consumed !== "ok")');
    expect(body).toContain("preauth_required");
  });

  test("a missing proof redirects with an error instead of starting OAuth", () => {
    expect(googleStart).toContain("preauth_required");
    expect(googleStart).toContain("return;");
  });

  test("the existing OAuth state protections are untouched", () => {
    const oauthState = read("backend/lib/oauth-state.ts");
    expect(oauthState).toContain("timingSafeEqual");
    expect(oauthState).toContain("randomBytes");
    expect(oauthState).toContain("sanitizeReturnTo");
    expect(oauthState).toContain("OAUTH_STATE_COOKIE");
    expect(googleStart).toContain("createOAuthState(");
    expect(googleStart).toContain("oauthStateCookieOptions(");
  });

  test("no Turnstile token or secret ever appears in a URL", () => {
    // The OAuth redirect URL is built from client_id/redirect_uri/state only.
    const params = googleStart.slice(googleStart.indexOf("new URLSearchParams("));
    expect(params).not.toContain("turnstileToken");
    expect(params).not.toContain("secret");
  });
});

describe("frontend — no bypass, real gates", () => {
  const hook = read("packages/shared/src/hooks/use-turnstile.ts");
  const authPage = read("packages/shared/src/pages/Auth.tsx");

  test('the hook no longer returns a "bypass" token', () => {
    // The doc comment quotes the old line on purpose, so assert on real code.
    const body = code(hook);
    expect(body).not.toContain('"bypass"');
    expect(body).not.toContain("effectiveToken");
  });

  test("the hook exposes all six states and a real ready flag", () => {
    for (const state of ["loading", "verifying", "verified", "expired", "error", "unavailable"]) {
      expect(hook).toContain(`"${state}"`);
    }
    expect(hook).toContain('ready: state === "verified" && token !== null');
  });

  test("reset calls Turnstile's own reset (the old one only nulled state)", () => {
    expect(hook).toContain("window.turnstile.reset(");
  });

  test("the script is loaded once and shared, and ref-counted", () => {
    expect(hook).toContain("let scriptPromise");
    expect(hook).toContain("scriptRefCount");
    expect(hook).toContain("if (scriptRefCount > 0) return;");
  });

  test("the page gates every submit on the real token", () => {
    expect(authPage).toContain("const turnstileReady = turnstile.ready");
    // Email login, register, Google and member login each check it.
    const occurrences = authPage.split("if (!turnstileReady || !turnstile.token)").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
    // Buttons use a real disabled state, not CSS.
    expect(authPage).toContain("disabled={busy || !turnstileReady}");
    expect(authPage).toContain("!memberPassword || !turnstileReady");
  });

  /**
   * A generic "the file contains disabled={busy || !turnstileReady}" assertion
   * is what let the Google button slip through: the submit button satisfied it
   * while the Google button still said `disabled={busy}`. Each control is now
   * asserted on its OWN markup.
   */
  test("the Google button is disabled until verification succeeds", () => {
    const at = authPage.indexOf("onClick={handleGoogleSignIn}");
    expect(at).toBeGreaterThan(-1);
    const button = authPage.slice(Math.max(0, at - 600), at + 120);
    expect(button).toContain("disabled={busy || !turnstileReady}");
  });

  test("the customer submit is gated by the real token and the password check", () => {
    expect(authPage).toContain(
      "const submitDisabled = busy || !turnstileReady || registerMismatch;",
    );
    expect(authPage).toContain("disabled={submitDisabled}");
  });

  test("the VelCenter member login submit is gated", () => {
    expect(authPage).toMatch(/disabled=\{memberLoading[^}]*!turnstileReady\}/);
  });

  test("text inputs are NOT locked behind the bot check", () => {
    // Locking the text fields until the challenge resolves stops the customer
    // typing while the widget loads. Inputs are not auth triggers.
    for (const id of ['id="email"', 'id="password"', 'id="confirm-password"']) {
      const at = authPage.indexOf(id);
      expect(at).toBeGreaterThan(-1);
      const field = authPage.slice(at, at + 900);
      expect(field).toContain("disabled={busy}");
      expect(field).not.toContain("!turnstileReady");
    }
  });

  test("a failed sign-in consumes the token instead of reusing it", () => {
    expect(authPage).toContain("turnstile.consume()");
  });

  test("Google sign-in exchanges the challenge for a proof before redirecting", () => {
    const google = authPage.slice(
      authPage.indexOf("const handleGoogleSignIn"),
      authPage.indexOf("const handleEmailPasswordLogin"),
    );
    expect(google).toContain("/auth/preauth");
    expect(google.indexOf("/auth/preauth")).toBeLessThan(google.indexOf("/auth/google?returnTo="));
  });

  test("no hardcoded Thai copy remains on the auth page", () => {
    expect(authPage).not.toMatch(/"[ก-๙]/);
    expect(authPage).not.toContain("ยืนยันว่าไม่ใช่บอท");
    expect(authPage).not.toContain("ป้องกันด้วย Cloudflare");
  });
});

describe("language selector — instant, persisted, non-destructive", () => {
  const authPage = read("packages/shared/src/pages/Auth.tsx");

  test("it renders the three supported languages from the shared config", () => {
    expect(authPage).toContain("SUPPORTED_LANGUAGES");
    expect(authPage).toContain("languageLabel(lang)");
    expect(authPage).toContain("setLang(option.code as Language)");
  });

  test("switching does not reload, navigate, or reset the form", () => {
    const selector = authPage.slice(authPage.indexOf("setLang(option.code as Language)"));
    const handler = selector.slice(0, selector.indexOf("}"));
    expect(handler).not.toContain("location.reload");
    expect(handler).not.toContain("navigate(");
    expect(handler).not.toContain("setEmail");
    expect(handler).not.toContain("setPassword");
    expect(handler).not.toContain("setMode");
  });

  test("the selection is persisted by the shared provider, not by the page", () => {
    const i18n = read("packages/shared/src/lib/i18n/index.tsx");
    expect(i18n).toContain("localStorage.setItem(LANGUAGE_STORAGE_KEY, next)");
    expect(i18n).toContain("readStoredLanguage");
  });
});

describe("i18n — the auth surface is fully translated", () => {
  const locales = ["th", "en", "my"];

  test("every turnstile state has copy in all three languages", () => {
    for (const lang of locales) {
      const src = read(`packages/shared/src/lib/i18n/locales/${lang}.ts`);
      for (const key of [
        "instructions:",
        "loading:",
        "verifying:",
        "verified:",
        "expired:",
        "error:",
        "required:",
        "unavailable:",
        "networkError:",
        "footer:",
      ]) {
        expect(src).toContain(key);
      }
      expect(src).toContain("languageSelector:");
    }
  });

  test("the Burmese auth block is no longer shadowed by a shallow patch", () => {
    const index = read("packages/shared/src/lib/i18n/locales/index.ts");
    // Nested groups must be merged, not replaced.
    expect(index).toContain("login: { ...myBase.auth.login");
    expect(index).toContain("register: { ...myBase.auth.register");
  });
});
