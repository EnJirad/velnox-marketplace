# OpenCode Go Proxy — @velnox/opencode-go-proxy

OpenAI-compatible ([OI](https://platform.openai.com/docs/api-reference)) HTTP proxy that sits in front of **OpenCode Go** (`https://opencode.ai/inference/go/openai/v1`) and solves the `anyOf limit 16` schema rejection problem.

## Problem

OpenCode Go rejects requests whose tool schemas contain a union with >16 arms:

```
tools[315].function.parameters: schema branch arms exceeded: anyOf limit 16
```

This happens with MCP servers that expose many tools (e.g., Vercel 246 tools, Neon 139 tools).

## Solution

The proxy **normalizes tool schemas losslessly** before forwarding:

1. **Dedupe** identical arms
2. **Subsume** arms already covered by a wider sibling
3. **Merge** `const`/`enum`-only arms of one primitive type into a single `enum`
4. **Chunk** remaining `anyOf` >16 into nested `anyOf` groups (associative, so accepted set is identical)

If a schema cannot be normalized without semantic loss (e.g., `oneOf` >16), the proxy returns a precise diagnostic naming the tool and exact schema path — never an opaque HTTP 400.

Additionally, the proxy **filters tools per-model/agent** so each model sees only relevant tools (e.g., `deepseek-v4.1-flash` gets ≤128 tools, no Vercel/Render/Cloudflare).

## Quick Start

```bash
# From the marketplace repo root
cd tools/opencode-go-proxy
bun install
bun run start
```

Proxy listens on `http://localhost:8080/v1/chat/completions`.

## Configuration (env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_PROXY_PORT` | `8080` | Listen port |
| `OPENCODE_PROXY_UPSTREAM` | `https://cyberapi.carwraman.shop/v1` | Upstream endpoint |
| `OPENCODE_PROXY_MODEL` | `boz/deepseek-v4.1-flash-1017` | Model name passed to upstream |
| `OPENCODE_PROXY_API_KEY` | *(unset)* | Bearer token for upstream auth |
| `OPENCODE_PROXY_MAX_ANYOF` | `16` | Upstream anyOf limit |
| `OPENCODE_PROXY_ANYOF_OVERFLOW` | `chunk` | `chunk` \| `error` |
| `OPENCODE_PROXY_ONEOF_OVERFLOW` | `error` | `error` \| `leave` |
| `OPENCODE_PROXY_DEDUPE` | `true` | Collapse duplicate arms |
| `OPENCODE_PROXY_SUBSUME` | `true` | Drop subsumed arms |
| `OPENCODE_PROXY_MERGE_ENUMS` | `true` | Merge const/enum arms |
| `OPENCODE_PROXY_MAX_ENUM` | `1024` | Max enum values to inline |
| `OPENCODE_PROXY_MAX_DEPTH` | `64` | Max schema nesting |
| `OPENCODE_PROXY_TIMEOUT` | `120000` | Request timeout (ms) |
| `OPENCODE_PROXY_DEBUG` | `false` | Enable debug logging |

## Per-model Filter Profiles

Default profiles (in `src/config.ts`):

```ts
"deepseek-v4.1-flash": {
  maxTools: 128,
  denyServers: ["vercel", "render", "cloudflare", "stripe-sandbox"],
},
"default": { maxTools: 128 },
```

Override by setting `x-agent` header to a profile key, or edit `DEFAULT_FILTER_PROFILES`.

## Android Harness Integration

The proxy is designed for Android Harness:

- No hardcoded credentials — all via env
- Preserves SSE streaming, `tool_calls`, `tool_call_id` mapping
- Backward-compatible with existing clients
- No changes to Android Harness package required

## Running Tests

```bash
bun test          # all tests
bun run typecheck # TypeScript strict check
```

Test coverage (19 tests):

| Category | Tests |
|----------|-------|
| Schema normalization (dedupe, subsumption, enum merge, chunking) | 5 |
| `chunkAnyOf` standalone | 2 |
| Validation (valid, invalid array, oversized anyOf, unresolved $ref) | 4 |
| Tool filtering (allow/deny servers, maxTools, respectHistory) | 5 |
| Utility functions | 3 |

## Deployment

### Production (Render/Vercel/any Node host)

```bash
# Build not required — Bun runs TS directly
# Set env vars in your platform dashboard
OPENCODE_PROXY_UPSTREAM=https://opencode.ai/inference/go/openai/v1
OPENCODE_PROXY_API_KEY=sk-...
OPENCODE_PROXY_PORT=8080
# Then: bun run src/index.ts
```

### Docker

```dockerfile
FROM oven/bun:1.4
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY src ./src
COPY tsconfig.json ./
ENV OPENCODE_PROXY_PORT=8080
EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]
```

### Health Check

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"ping"}]}'
```

## Rollback

1. **Revert env vars** to previous upstream endpoint (bypass proxy)
2. **Or** deploy previous proxy version:
   ```bash
   git checkout <previous-tag>
   bun install
   bun run start
   ```
3. **Immediate** — clients need no changes; just point back to OpenCode Go directly.

## Architecture

```
Client (Android Harness / any OI client)
       │
       ▼
Proxy (:8080) ── validates tools
       │           │
       │           ├─ normalizeTools()  (src/schema/normalizer.ts)
       │           │    ├─ dedupeBranches()
       │           │    ├─ dropSubsumed()
       │           │    ├─ mergeScalarEnums()
       │           │    └─ chunkAnyOf()
       │           │
       │           ├─ validateTools()   (src/schema/validate.ts)
       │           │    ├─ anyOf/oneOf branch limits
       │           │    ├─ $ref resolution
       │           │    └─ unknown keywords (strict mode)
       │           │
       │           └─ filterTools()     (src/tools/filter.ts)
       │                ├─ allow/denyServers
       │                ├─ allow/deny (glob)
       │                ├─ maxTools cap
       │                └─ respectHistory (re-adds in-flight tools)
       │
       ▼
Upstream (cyberapi.carwraman.shop/v1)
```

## Files Changed (this package)

```
tools/opencode-go-proxy/
├── package.json
├── tsconfig.json
├── types/bun-shim.d.ts
├── src/
│   ├── index.ts           # HTTP server, SSE pass-through
│   ├── config.ts          # Env-driven config
│   ├── schema/
│   │   ├── types.ts       # Shared types, errors, defaults
│   │   ├── normalizer.ts  # Lossless schema rewriting
│   │   └── validate.ts    # Pre-flight validation + diagnostics
│   └── tools/
│       └── filter.ts      # Per-model/agent tool selection
└── tests/
    └── proxy.test.ts      # 19 automated tests
```

## Credits

Built for **Velnox Marketplace** monorepo. No external dependencies beyond Bun stdlib.

---

**Note:** Default upstream is now `https://cyberapi.carwraman.shop/v1` with model `boz/deepseek-v4.1-flash-1017`. Override via env vars if you need a different target.
