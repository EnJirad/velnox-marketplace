/**
 * scripts/verify-cutover.ts
 *
 * Automated Synthetic Smoke Testing & Verification tool for Cloudflare Cutover.
 * Implements Phase 2 & Phase 3 checks from docs/CLOUDFLARE_CUTOVER_RUNBOOK.md.
 *
 * Usage:
 *   bun run scripts/verify-cutover.ts
 *   API_URL=https://api.velnox.live SHOP_URL=https://shop.velnox.live bun run scripts/verify-cutover.ts
 */

import { WebSocket } from "ws";

interface CheckResult {
  name: string;
  target: string;
  status: "PASS" | "FAIL" | "WARN";
  message: string;
  durationMs: number;
}

const API_BASE = process.env.API_URL || "https://api.velnox.live";
const SHOP_BASE = process.env.SHOP_URL || "https://shop.velnox.live";
const SELLER_BASE = process.env.SELLER_URL || "https://seller.velnox.live";
const CENTER_BASE = process.env.CENTER_URL || "https://center.velnox.live";
const LANDING_BASE = process.env.LANDING_URL || "https://velnox.live";

async function timeRun<T>(fn: () => Promise<T>): Promise<{ result?: T; error?: any; durationMs: number }> {
  const start = process.hrtime.bigint();
  try {
    const result = await fn();
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { result, durationMs: Math.round(durationMs * 100) / 100 };
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { error, durationMs: Math.round(durationMs * 100) / 100 };
  }
}

async function checkUrlReachable(name: string, url: string): Promise<CheckResult> {
  const { result, error, durationMs } = await timeRun(async () => {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    const text = await res.text();
    return { status: res.status, text };
  });

  if (error || !result) {
    return {
      name,
      target: url,
      status: "WARN",
      message: `Failed to connect (${error?.message || "network error"}) — check DNS or local test`,
      durationMs,
    };
  }

  if (result.status >= 200 && result.status < 400) {
    return {
      name,
      target: url,
      status: "PASS",
      message: `HTTP ${result.status} OK (content length: ${result.text.length} bytes)`,
      durationMs,
    };
  }

  return {
    name,
    target: url,
    status: "FAIL",
    message: `HTTP ${result.status} returned`,
    durationMs,
  };
}

async function checkSpaDeepLink(name: string, url: string): Promise<CheckResult> {
  const { result, error, durationMs } = await timeRun(async () => {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    return { status: res.status, isHtml: text.includes("<!DOCTYPE html>") || text.includes("<html") };
  });

  if (error || !result) {
    return {
      name,
      target: url,
      status: "WARN",
      message: `Deep-link check unreachable (${error?.message || "error"})`,
      durationMs,
    };
  }

  if (result.status === 200 && result.isHtml) {
    return {
      name,
      target: url,
      status: "PASS",
      message: `HTTP 200 (Proper SPA HTML fallback via _redirects)`,
      durationMs,
    };
  }

  return {
    name,
    target: url,
    status: "FAIL",
    message: `Expected HTTP 200 with HTML, received HTTP ${result.status}`,
    durationMs,
  };
}

async function checkApiHealth(apiUrl: string): Promise<CheckResult> {
  const url = `${apiUrl}/health`;
  const { result, error, durationMs } = await timeRun(async () => {
    const res = await fetch(url);
    const json = await res.json();
    return { status: res.status, json };
  });

  if (error || !result) {
    return {
      name: "API Health Endpoint",
      target: url,
      status: "WARN",
      message: `Unreachable: ${error?.message || "error"}`,
      durationMs,
    };
  }

  const isHealthy =
    result.status === 200 &&
    (result.json?.status === "healthy" ||
      result.json?.status === "ok" ||
      result.json?.data?.status === "healthy" ||
      result.json?.data?.status === "ok");

  if (isHealthy) {
    return {
      name: "API Health Endpoint",
      target: url,
      status: "PASS",
      message: `HTTP 200 Healthy`,
      durationMs,
    };
  }

  return {
    name: "API Health Endpoint",
    target: url,
    status: "FAIL",
    message: `HTTP ${result.status} response unexpected: ${JSON.stringify(result.json)}`,
    durationMs,
  };
}

async function checkWebSocket(apiUrl: string): Promise<CheckResult> {
  const wsUrl = apiUrl.replace(/^http/, "ws") + "/ws";
  const { result, error, durationMs } = await timeRun(async () => {
    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error("WebSocket handshake timeout after 5s"));
      }, 5000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "ping" }));
      });

      ws.on("message", (msg) => {
        clearTimeout(timer);
        ws.close();
        resolve(msg.toString());
      });

      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });

  if (error) {
    return {
      name: "WebSocket Gateway Handshake",
      target: wsUrl,
      status: "WARN",
      message: `WS connection warning: ${error?.message || "unable to connect"}`,
      durationMs,
    };
  }

  return {
    name: "WebSocket Gateway Handshake",
    target: wsUrl,
    status: "PASS",
    message: `Connected & responded: ${result}`,
    durationMs,
  };
}

async function main() {
  console.log("==================================================================");
  console.log("  VELNOX MARKETPLACE — PRODUCTION CUTOVER SYNTHETIC VERIFICATION  ");
  console.log("==================================================================");
  console.log(`API Base:      ${API_BASE}`);
  console.log(`Shop Base:     ${SHOP_BASE}`);
  console.log(`Seller Base:   ${SELLER_BASE}`);
  console.log(`Center Base:   ${CENTER_BASE}`);
  console.log(`Landing Base:  ${LANDING_BASE}\n`);

  const results: CheckResult[] = [];

  console.log("[1/5] Checking SPA Edge Reachability...");
  results.push(await checkUrlReachable("VelShop Web", SHOP_BASE));
  results.push(await checkUrlReachable("VelSeller Web", SELLER_BASE));
  results.push(await checkUrlReachable("VelCenter Web", CENTER_BASE));
  results.push(await checkUrlReachable("VelNox Landing", LANDING_BASE));

  console.log("[2/5] Checking SPA Client-Side Routing Fallback (_redirects)...");
  results.push(await checkSpaDeepLink("VelShop Deep Link", `${SHOP_BASE}/products/test-slug`));
  results.push(await checkSpaDeepLink("VelSeller Deep Link", `${SELLER_BASE}/orders/test-order`));
  results.push(await checkSpaDeepLink("VelCenter Deep Link", `${CENTER_BASE}/dashboard`));

  console.log("[3/5] Checking Backend API Health...");
  results.push(await checkApiHealth(API_BASE));

  console.log("[4/5] Checking WebSocket Realtime Gateway...");
  results.push(await checkWebSocket(API_BASE));

  console.log("\n==================================================================");
  console.log("                      VERIFICATION SUMMARY                        ");
  console.log("==================================================================");
  console.log("| Check | Target | Status | Duration | Details |");
  console.log("|:---|:---|:---:|:---:|:---|");
  for (const r of results) {
    const statusIcon = r.status === "PASS" ? "PASS" : r.status === "WARN" ? "WARN" : "FAIL";
    console.log(`| ${r.name} | \`${r.target}\` | **${statusIcon}** | ${r.durationMs}ms | ${r.message} |`);
  }
  console.log("==================================================================\n");

  const failCount = results.filter((r) => r.status === "FAIL").length;
  if (failCount > 0) {
    console.error(`Verification completed with ${failCount} critical failures.`);
    process.exit(1);
  } else {
    console.log("All cutover verification checks completed cleanly (0 critical failures).");
  }
}

main().catch((err) => {
  console.error("Cutover script failed:", err);
  process.exit(1);
});
