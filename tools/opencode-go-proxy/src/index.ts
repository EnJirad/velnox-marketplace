/**
 * OpenCode Go Proxy — main entry point.
 *
 * Transforms [OI] requests to upstream:
 *  1. Validates the `tools` array against upstream schema limits.
 *  2. Normalizes tool schemas (anyOf/oneOf limits, $ref, enums, subsumption).
 *  3. Filters tools per-model (and per-agent if `x-agent` header is present).
 *  4. Forwards to upstream, preserving SSE streaming, tool_calls and tool results.
 *
 * Upstream:      https://opencode.ai/inference/go/openai/v1
 * Target model:  deepseek-v4.1-flash
 */
import { loadConfig } from "./config.ts";
import { normalizeTools } from "./schema/normalizer.ts";
import { validateTools, diagnosticsResponseBody } from "./schema/validate.ts";
import { filterTools, type FilterOptions } from "./tools/filter.ts";
import { SchemaCompatibilityError } from "./schema/types.ts";

const config = loadConfig();

interface OpenAIRequest {
  model?: string;
  messages?: unknown[];
  tools?: unknown[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  [key: string]: unknown;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta?: { role?: string; content?: string; tool_calls?: unknown[] };
    message?: { role?: string; content?: string; tool_calls?: unknown[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function log(...args: unknown[]): void {
  if (config.debug) console.error("[opencode-proxy]", ...args);
}

function errorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function forwardUpstream(body: unknown, signal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  signal?.addEventListener("abort", () => controller.abort());

  try {
    const upstreamUrl = `${config.upstream.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: Bun.env.OPENCODE_PROXY_API_KEY ? `Bearer ${Bun.env.OPENCODE_PROXY_API_KEY}` : "",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleChatCompletions(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const logPrefix = `[${requestId}]`;

  let requestBody: OpenAIRequest;
  try {
    requestBody = (await req.json()) as OpenAIRequest;
  } catch {
    return errorResponse(400, { error: { message: "invalid JSON", type: "invalid_request_error" } });
  }

  const { model = config.model, messages, tools, stream } = requestBody;
  const isStreaming = stream === true;
  const effectiveModel = model === "deepseek-v4-flash" ? "deepseek-v4.1-flash" : model;

  log(`${logPrefix} model=${effectiveModel} tools=${tools ? "yes" : "no"} stream=${isStreaming}`);

  // 1) Normalize tool schemas (lossless anyOf reduction)
  let processedTools = tools;
  if (tools) {
    try {
      const { tools: normalized, reports, changed } = normalizeTools(tools as any[], config.normalizer);
      if (changed || reports.length > 0) {
        const maxBefore = Math.max(...reports.map((r) => r.maxAnyOfBefore), 0);
        const maxAfter = Math.max(...reports.map((r) => r.maxAnyOfAfter), 0);
        log(`${logPrefix} normalized ${reports.length} tool(s): max anyOf ${maxBefore} → ${maxAfter}`);
        for (const r of reports) {
          if (r.actions.length > 0) log(`${logPrefix}   ${r.tool}: ${r.actions.join("; ")}`);
        }
      }
      processedTools = normalized;
    } catch (e) {
      if (e instanceof SchemaCompatibilityError) {
        log(`${logPrefix} normalization error: ${e.message}`);
        return errorResponse(400, diagnosticsResponseBody([e.diagnostic]));
      }
      throw e;
    }
  }

  // 2) Validate normalized tool schemas
  if (processedTools) {
    const validation = validateTools(processedTools);
    if (!validation.ok) {
      log(`${logPrefix} validation failed: ${validation.diagnostics.length} issue(s)`);
      return errorResponse(400, diagnosticsResponseBody(validation.diagnostics));
    }
  }

  // 3) Filter tools per-model (and per-agent if header present)
  if (processedTools) {
    const agentHeader = req.headers.get("x-agent");
    const profileKey = agentHeader ?? effectiveModel;
    const profile = config.filterProfiles[profileKey] ?? config.filterProfiles.default;
    const filterResult = filterTools(processedTools as any[], profile, { respectHistory: true, maxToolsOverflow: "error" } satisfies FilterOptions, messages);
    if (filterResult.overflow) {
      log(`${logPrefix} tool cap hit: ${filterResult.overflow.count} > ${filterResult.overflow.limit}`);
      return errorResponse(400, {
        error: {
          message: `too many tools after filtering: ${filterResult.overflow.count} > ${filterResult.overflow.limit}`,
          type: "invalid_request_error",
          code: "tool_limit_exceeded",
        },
      });
    }
    if (filterResult.removed.length > 0) {
      log(`${logPrefix} filtered: kept ${filterResult.totalAfter}/${filterResult.totalBefore}, removed ${filterResult.removed.length}`);
    }
    processedTools = filterResult.tools;
  }

  // 4) Forward to upstream
  const upstreamBody: Record<string, unknown> = {
    ...requestBody,
    model: effectiveModel,
    tools: processedTools,
  };

  if (isStreaming) {
    const upstreamRes = await forwardUpstream(upstreamBody, req.signal);
    if (!upstreamRes.ok || !upstreamRes.body) {
      const text = await upstreamRes.text().catch(() => "");
      log(`${logPrefix} upstream ${upstreamRes.status}: ${text.slice(0, 200)}`);
      return errorResponse(upstreamRes.status, {
        error: { message: text || "upstream error", type: "upstream_error" },
      });
    }

    // Pass-through SSE with minimal transformation
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamClosed = false;

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              streamClosed = true;
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              // Rewrite model name in stream chunks so clients see the same model
              if (parsed.model !== effectiveModel) {
                parsed.model = effectiveModel;
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
            } catch {
              controller.enqueue(encoder.encode(line + "\n\n"));
            }
          } else if (line.trim() !== "") {
            controller.enqueue(encoder.encode(line + "\n\n"));
          }
        }
      },
      flush(controller) {
        if (!streamClosed && buffer.trim()) {
          controller.enqueue(encoder.encode(buffer));
        }
      },
    });

    return new Response(upstreamRes.body.pipeThrough(transformStream), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  // Non-streaming
  const upstreamRes = await forwardUpstream(upstreamBody, req.signal);
  const text = await upstreamRes.text();

  if (!upstreamRes.ok) {
    log(`${logPrefix} upstream ${upstreamRes.status}: ${text.slice(0, 200)}`);
    return errorResponse(upstreamRes.status, {
      error: { message: text || "upstream error", type: "upstream_error" },
    });
  }

  try {
    const parsed = JSON.parse(text) as OpenAIResponse;
    if (parsed.model !== effectiveModel) parsed.model = effectiveModel;
    return new Response(JSON.stringify(parsed), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response(text, {
      status: upstreamRes.status,
      headers: { "content-type": upstreamRes.headers.get("content-type") ?? "application/json" },
    });
  }
}

const server = Bun.serve({
  port: config.port,
  idleTimeout: Math.ceil(config.requestTimeoutMs / 1000) + 10,
  fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 });
    }
    return handleChatCompletions(req);
  },
  error(err) {
    console.error("[opencode-proxy] server error:", err);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`[opencode-proxy] listening on http://localhost:${server.port}`);
console.log(`[opencode-proxy] upstream: ${config.upstream}`);
console.log(`[opencode-proxy] model: ${config.model}`);
console.log(`[opencode-proxy] max anyOf branches: ${config.normalizer.maxAnyOfBranches}`);
