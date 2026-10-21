/**
 * MVP API mode — default, opt-in and production-safety matrix.
 *
 * These are contract tests for the ONE rule that decides whether a build talks to
 * `/api/mvp`. They run without a browser, a bundler or a database.
 */
import { describe, expect, test } from "bun:test";
import {
  describeApiMode,
  normaliseApiOrigin,
  resolveApiMode,
  setApiModeForTests,
  isMvpMode,
} from "../src/mvp/config.js";

const STAGING = "https://staging-api.velnox.test";

describe("MVP mode defaults", () => {
  test("no environment variables means the legacy API", () => {
    const resolved = resolveApiMode({});
    expect(resolved.mode).toBe("legacy");
    expect(resolved.disabledReason).toBe("MODE_NOT_REQUESTED");
    expect(resolved.apiOrigin).toBe("http://localhost:3001");
    expect(resolved.mvpBaseUrl).toBe("http://localhost:3001/api/mvp");
  });

  test("anything other than the literal 'mvp' stays on legacy", () => {
    for (const value of ["", "true", "1", "MVPX", "mvp-api", "  ", "yes"]) {
      const resolved = resolveApiMode({ VITE_API_MODE: value, VITE_DEPLOY_ENV: "staging" });
      expect(resolved.mode, `VITE_API_MODE=${JSON.stringify(value)}`).toBe("legacy");
    }
  });

  test("'mvp' is case-insensitive and selects the MVP base URL once", () => {
    for (const value of ["mvp", "MVP", " MvP "]) {
      const resolved = resolveApiMode({
        VITE_API_MODE: value,
        VITE_DEPLOY_ENV: "staging",
        VITE_API_URL: STAGING,
      });
      expect(resolved.mode).toBe("mvp");
      expect(resolved.mvpBaseUrl).toBe(`${STAGING}/api/mvp`);
      expect(resolved.mvpBaseUrl.match(/\/api\/mvp/g)).toHaveLength(1);
      expect(resolved.disabledReason).toBeNull();
    }
  });

  test("a local development build may opt in without declaring an env", () => {
    const resolved = resolveApiMode({ VITE_API_MODE: "mvp", PROD: false });
    expect(resolved.mode).toBe("mvp");
    expect(resolved.deployEnv).toBe("development");
  });
});

describe("MVP mode production safety", () => {
  test("a production build cannot enable MVP mode implicitly", () => {
    const resolved = resolveApiMode({ VITE_API_MODE: "mvp", PROD: true, VITE_API_URL: STAGING });
    expect(resolved.mode).toBe("legacy");
    expect(resolved.disabledReason).toBe("MVP_FORBIDDEN_IN_PRODUCTION");
    expect(resolved.deployEnv).toBe("production");
    expect(resolved.apiOrigin).toBe(STAGING);
  });

  test("VITE_DEPLOY_ENV=production overrides an explicit MVP request", () => {
    const resolved = resolveApiMode({
      VITE_API_MODE: "mvp",
      VITE_DEPLOY_ENV: "production",
      VITE_API_URL: STAGING,
    });
    expect(resolved.mode).toBe("legacy");
    expect(resolved.disabledReason).toBe("MVP_FORBIDDEN_IN_PRODUCTION");
  });

  test("only staging/development-like environments are allowed", () => {
    for (const env of ["staging", "development", "dev", "local", "test"]) {
      expect(resolveApiMode({ VITE_API_MODE: "mvp", VITE_DEPLOY_ENV: env }).mode).toBe("mvp");
    }
    for (const env of ["production", "preview", "qa", "prod"]) {
      const resolved = resolveApiMode({ VITE_API_MODE: "mvp", VITE_DEPLOY_ENV: env });
      expect(resolved.mode, env).toBe("legacy");
    }
  });

  test("the refusal message never contains a credential or a URL secret", () => {
    const message = describeApiMode(
      resolveApiMode({ VITE_API_MODE: "mvp", PROD: true, VITE_API_URL: STAGING }),
    );
    expect(message).toContain("MVP_FORBIDDEN_IN_PRODUCTION");
    expect(message).not.toContain("password");
    expect(message).not.toContain("@");
  });
});

describe("backend origin validation", () => {
  test("accepts http/https origins, normalises trailing slashes", () => {
    expect(normaliseApiOrigin("https://api.velnox.com")).toBe("https://api.velnox.com");
    expect(normaliseApiOrigin("http://127.0.0.1:3101/")).toBe("http://127.0.0.1:3101");
    expect(normaliseApiOrigin("  https://api.velnox.com  ")).toBe("https://api.velnox.com");
    expect(normaliseApiOrigin(undefined)).toBe("http://localhost:3001");
  });

  test("rejects credentials, paths, queries, fragments and non-http schemes", () => {
    const invalid = [
      "not a url",
      "ftp://api.velnox.com",
      "https://user:pass@api.velnox.com",
      "https://api.velnox.com/api",
      "https://api.velnox.com/api/mvp",
      "https://api.velnox.com?token=x",
      "https://api.velnox.com#frag",
      "javascript:alert(1)",
    ];
    for (const value of invalid) {
      expect(normaliseApiOrigin(value), value).toBeNull();
    }
  });

  test("an invalid origin refuses MVP mode instead of falling back to localhost", () => {
    const resolved = resolveApiMode({
      VITE_API_MODE: "mvp",
      VITE_DEPLOY_ENV: "staging",
      VITE_API_URL: "https://api.velnox.com/api",
    });
    expect(resolved.mode).toBe("legacy");
    expect(resolved.disabledReason).toBe("INVALID_API_URL");
    expect(resolved.mvpBaseUrl).toBe("http://localhost:3001/api/mvp");
  });
});

describe("configuration surface", () => {
  test("the resolved config exposes only public, secret-free fields", () => {
    const resolved = resolveApiMode({
      VITE_API_MODE: "mvp",
      VITE_DEPLOY_ENV: "staging",
      VITE_API_URL: STAGING,
    });
    expect(Object.keys(resolved).sort()).toEqual([
      "apiOrigin",
      "deployEnv",
      "disabledReason",
      "mode",
      "mvpBaseUrl",
    ]);
  });

  test("the process singleton honours an explicit test environment", () => {
    setApiModeForTests({ VITE_API_MODE: "mvp", VITE_DEPLOY_ENV: "staging" });
    expect(isMvpMode()).toBe(true);
    setApiModeForTests({ VITE_API_MODE: "mvp", PROD: true });
    expect(isMvpMode()).toBe(false);
    setApiModeForTests(null);
  });
});
