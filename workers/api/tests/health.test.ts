import { describe, expect, it } from "bun:test";
import { app } from "../src/app.js";
import { healthCheckResponseSchema } from "@velnox/api-contract";

describe("Cloudflare Workers API — Foundation & Health Endpoints", () => {
  it("GET /health returns HTTP 200 conforming to @velnox/api-contract", async () => {
    const req = new Request("http://localhost/health", {
      method: "GET",
    });

    const res = await app.request(req, {}, {
      ENVIRONMENT: "test",
      APP_NAME: "Velnox Test API",
      APP_VERSION: "3.0.0",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-request-id")).toBeDefined();

    const body = (await res.json()) as any;
    const validated = healthCheckResponseSchema.parse(body);

    expect(validated.success).toBe(true);
    expect(validated.data.status).toBe("ok");
    expect(validated.data.version).toBe("3.0.0");
    expect(typeof validated.data.timestamp).toBe("number");
    expect(typeof validated.data.uptime).toBe("number");
  });

  it("GET /api/v1/health returns HTTP 200 with matching schema", async () => {
    const req = new Request("http://localhost/api/v1/health", {
      method: "GET",
    });

    const res = await app.request(req, {}, {
      ENVIRONMENT: "test",
      APP_VERSION: "3.0.0",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const validated = healthCheckResponseSchema.parse(body);

    expect(validated.success).toBe(true);
    expect(validated.data.status).toBe("ok");
  });

  it("GET / returns root system metadata", async () => {
    const req = new Request("http://localhost/", {
      method: "GET",
    });

    const res = await app.request(req, {}, {
      APP_NAME: "Velnox Marketplace API",
      APP_VERSION: "3.0.0",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.runtime).toBe("cloudflare-workers");
    expect(body.version).toBe("3.0.0");
  });

  it("GET /unknown-route returns structured 404 error envelope", async () => {
    const req = new Request("http://localhost/not-found-endpoint", {
      method: "GET",
    });

    const res = await app.request(req);
    expect(res.status).toBe(404);

    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("not found");
  });

  it("sets CORS headers for allowed origins", async () => {
    const req = new Request("http://localhost/health", {
      method: "GET",
      headers: {
        Origin: "https://shop.velnox.live",
      },
    });

    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://shop.velnox.live");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
