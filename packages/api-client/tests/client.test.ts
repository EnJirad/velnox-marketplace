import { describe, expect, it } from "bun:test";
import { VelnoxApiClient, ApiClientError } from "../src/index.js";

describe("@velnox/api-client", () => {
  it("sends request with headers and unwraps success envelope", async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.velnox.live/api/v1/health");
      expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-token-123");

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            status: "ok",
            version: "3.0.0",
            service: "velnox-api",
            uptime: 100,
            timestamp: Date.now(),
            database: "connected",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new VelnoxApiClient({
      baseUrl: "https://api.velnox.live",
      getAuthToken: () => "test-token-123",
      fetch: mockFetch as any,
    });

    const health = await client.health.check();
    expect(health.status).toBe("ok");
    expect(health.database).toBe("connected");
  });

  it("throws ApiClientError when API responds with an error envelope", async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Session has expired or is invalid",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new VelnoxApiClient({
      baseUrl: "https://api.velnox.live",
      fetch: mockFetch as any,
    });

    try {
      await client.auth.me();
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err instanceof ApiClientError).toBe(true);
      const apiErr = err as ApiClientError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.code).toBe("UNAUTHORIZED");
      expect(apiErr.message).toBe("Session has expired or is invalid");
    }
  });

  it("appends query parameters correctly for product list", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          meta: { page: 1, limit: 10, total: 0, totalPages: 0, hasMore: false, timestamp: Date.now() },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new VelnoxApiClient({
      baseUrl: "https://api.velnox.live",
      fetch: mockFetch as any,
    });

    await client.products.list({ q: "keyboard", sort: "newest", page: 1, limit: 10 });
    expect(capturedUrl).toContain("q=keyboard");
    expect(capturedUrl).toContain("sort=newest");
    expect(capturedUrl).toContain("limit=10");
  });
});
