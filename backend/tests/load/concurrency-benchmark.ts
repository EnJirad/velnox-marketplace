import http from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { RealtimeHub, type SocketConnection } from "../../src/modules/realtime/services/realtime-hub.ts";
import { RealtimeController } from "../../src/modules/realtime/routes/realtime-routes.ts";

interface BenchmarkResult {
  endpoint: string;
  concurrency: number;
  totalRequests: number;
  durationMs: number;
  rps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  errors: number;
}

const PORT = 4088;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const hub = new RealtimeHub();

// 1. Health endpoint (RealtimeController)
app.get("/health", (req, res) => {
  const result = RealtimeController.getHealth();
  res.status(result.status).json(result.body);
});

// 2. Safe Catalog Categories endpoint
const mockCategories = [
  { id: "cat_1", slug: "electronics", name_th: "อิเล็กทรอนิกส์", name_en: "Electronics", parent_id: null },
  { id: "cat_2", slug: "phones", name_th: "โทรศัพท์มือถือ", name_en: "Mobile Phones", parent_id: "cat_1" },
  { id: "cat_3", slug: "clothing", name_th: "เสื้อผ้าแฟชั่น", name_en: "Fashion & Clothing", parent_id: null },
  { id: "cat_4", slug: "shoes", name_th: "รองเท้า", name_en: "Shoes", parent_id: "cat_3" },
];

app.get("/api/v1/catalog/categories", (req, res) => {
  res.json({ success: true, data: mockCategories });
});

// 3. Realtime WebSocket Handshake & Lifecycle
wss.on("connection", (ws) => {
  const socketId = `sock_bench_${Math.random().toString(36).substring(2, 9)}`;
  const socketConn: SocketConnection = {
    id: socketId,
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    },
  };

  hub.registerClient(socketConn, "bench_user");

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    hub.unregisterClient(socketId);
  });
});

async function runHttpBenchmark(
  path: string,
  concurrency: number,
  totalRequests: number,
): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  let completed = 0;
  let errors = 0;

  const startTime = process.hrtime.bigint();

  async function worker() {
    while (completed < totalRequests) {
      const idx = completed++;
      if (idx >= totalRequests) break;

      const reqStart = process.hrtime.bigint();
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
        await res.text();
        const reqEnd = process.hrtime.bigint();
        if (res.status === 200) {
          latencies.push(Number(reqEnd - reqStart) / 1_000_000);
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const endTime = process.hrtime.bigint();
  const durationMs = Number(endTime - startTime) / 1_000_000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
  const min = latencies[0] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;
  const rps = (latencies.length / (durationMs / 1000));

  return {
    endpoint: path,
    concurrency,
    totalRequests,
    durationMs: Math.round(durationMs),
    rps: Math.round(rps * 10) / 10,
    p50Ms: Math.round(p50 * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    p99Ms: Math.round(p99 * 100) / 100,
    minMs: Math.round(min * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
    errors,
  };
}

async function runWsBenchmark(
  concurrency: number,
  totalConnections: number,
): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  let completed = 0;
  let errors = 0;

  const startTime = process.hrtime.bigint();

  async function worker() {
    while (completed < totalConnections) {
      const idx = completed++;
      if (idx >= totalConnections) break;

      const reqStart = process.hrtime.bigint();
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
          const timer = setTimeout(() => {
            ws.terminate();
            reject(new Error("WS timeout"));
          }, 3000);

          ws.on("open", () => {
            ws.send(JSON.stringify({ type: "ping" }));
          });

          ws.on("message", () => {
            const reqEnd = process.hrtime.bigint();
            latencies.push(Number(reqEnd - reqStart) / 1_000_000);
            clearTimeout(timer);
            ws.close();
            resolve();
          });

          ws.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      } catch {
        errors++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const endTime = process.hrtime.bigint();
  const durationMs = Number(endTime - startTime) / 1_000_000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
  const min = latencies[0] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;
  const rps = (latencies.length / (durationMs / 1000));

  return {
    endpoint: "/ws (handshake + ping)",
    concurrency,
    totalRequests: totalConnections,
    durationMs: Math.round(durationMs),
    rps: Math.round(rps * 10) / 10,
    p50Ms: Math.round(p50 * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    p99Ms: Math.round(p99 * 100) / 100,
    minMs: Math.round(min * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
    errors,
  };
}

async function main() {
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`[bench] Safe local benchmark server started at http://127.0.0.1:${PORT}`);

  const results: BenchmarkResult[] = [];
  const concurrencyTiers = [1, 10, 25];

  console.log("\n--- Benchmarking /health ---");
  for (const c of concurrencyTiers) {
    const res = await runHttpBenchmark("/health", c, 300);
    console.log(`  C=${c}: ${res.rps} RPS, p50=${res.p50Ms}ms, p95=${res.p95Ms}ms, p99=${res.p99Ms}ms, errors=${res.errors}`);
    results.push(res);
  }

  console.log("\n--- Benchmarking /api/v1/catalog/categories ---");
  for (const c of concurrencyTiers) {
    const res = await runHttpBenchmark("/api/v1/catalog/categories", c, 300);
    console.log(`  C=${c}: ${res.rps} RPS, p50=${res.p50Ms}ms, p95=${res.p95Ms}ms, p99=${res.p99Ms}ms, errors=${res.errors}`);
    results.push(res);
  }

  console.log("\n--- Benchmarking /ws Handshake & Ping ---");
  for (const c of concurrencyTiers) {
    const res = await runWsBenchmark(c, 100);
    console.log(`  C=${c}: ${res.rps} RPS, p50=${res.p50Ms}ms, p95=${res.p95Ms}ms, p99=${res.p99Ms}ms, errors=${res.errors}`);
    results.push(res);
  }

  server.close();
  wss.close();
  console.log("\n[bench] Safe benchmark server stopped.");
  console.log("\n=== MARKDOWN RESULTS TABLE ===");
  console.log("| Endpoint | Concurrency | Total Req | Duration (ms) | Throughput (RPS) | p50 (ms) | p95 (ms) | p99 (ms) | Errors |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| \`${r.endpoint}\` | ${r.concurrency} | ${r.totalRequests} | ${r.durationMs} | ${r.rps} | ${r.p50Ms} | ${r.p95Ms} | ${r.p99Ms} | ${r.errors} |`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
