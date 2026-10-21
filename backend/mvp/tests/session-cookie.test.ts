/**
 * Session cookie flags — the one security property the browser E2E depends on.
 *
 * `MVP_COOKIE_SECURE=true` exists so a TLS test harness (or an HTTPS staging
 * host that does not run with NODE_ENV=production) can send the exact cookie
 * Chromium will accept for `SameSite=None`. It is a one-way switch: it may add
 * `Secure`, never remove it in production.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { sessionCookieSecure } from "../session.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECURE_FLAG = process.env.MVP_COOKIE_SECURE;

function restore() {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECURE_FLAG === undefined) delete process.env.MVP_COOKIE_SECURE;
  else process.env.MVP_COOKIE_SECURE = ORIGINAL_SECURE_FLAG;
}

afterEach(restore);

describe("MVP session cookie security", () => {
  test("production is always Secure", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MVP_COOKIE_SECURE;
    expect(sessionCookieSecure()).toBe(true);

    process.env.MVP_COOKIE_SECURE = "false";
    expect(sessionCookieSecure()).toBe(true);
  });

  test("a test/development process is not Secure by default", () => {
    process.env.NODE_ENV = "test";
    delete process.env.MVP_COOKIE_SECURE;
    expect(sessionCookieSecure()).toBe(false);
  });

  test("MVP_COOKIE_SECURE=true adds Secure outside production", () => {
    process.env.NODE_ENV = "test";
    process.env.MVP_COOKIE_SECURE = "true";
    expect(sessionCookieSecure()).toBe(true);
  });

  test("only a trimmed, case-insensitive 'true' enables it", () => {
    process.env.NODE_ENV = "test";
    for (const value of ["", "1", "yes", "false"]) {
      process.env.MVP_COOKIE_SECURE = value;
      expect(sessionCookieSecure(), JSON.stringify(value)).toBe(false);
    }
    for (const value of ["true", "TRUE", "  True  "]) {
      process.env.MVP_COOKIE_SECURE = value;
      expect(sessionCookieSecure(), JSON.stringify(value)).toBe(true);
    }
  });
});
