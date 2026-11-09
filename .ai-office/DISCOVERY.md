# DISCOVERY.md — Velnox AI Office Hybrid State Manager & Watcher

**Discovery date:** 2026-11-09
**Author:** AI 01 (Main Developer)
**Status:** Phase 1 complete — ready for Phase 2 design

---

## 1. Android Harness Version & Runtime Environment

| Property | Value |
|----------|-------|
| Android version | 16 (API 36) |
| App package | `com.androidharness.app` |
| App UID | `u0_a622` (10622) |
| CPU | arm64-v8a |
| Linux env prefix | `/data/user/0/com.androidharness.app/files/linux` |
| Shell | bash via Termux-derived packages |
| Bun | 1.4.4 |
| Node | available (managed by harness prefix) |
| Git | available, configured with GitHub token |
| Tool dispatch | Harness app-internal — no external CLI or SSH |

**Verified:** No Termux app is installed; the Linux environment is provided entirely by the Harness app's own termux-core package. No PM2, systemd, tmux, or process supervisor exists.

---

## 2. AI Office Execution Architecture

The existing AI Office is a **TypeScript library + documentation** pattern, not a running process:

### What exists under `.ai/office/`:

| Component | File | Purpose |
|-----------|------|---------|
| Task Router | `context-management/task-router.ts` | Classifies T1/T2/T3 levels and selects context profiles |
| Context Budget | `context-management/context-budget.ts` | Estimates tokens per model config and provider gateway limits |
| Context Selector | `context-management/task-context-selector.ts` | Assembles document/source context per task phase |
| Context Compactor | `context-management/context-compaction.ts` | Compresses conversation history |
| Global Request Scheduler | `scheduler/request-scheduler.ts` | In-process singleton preventing concurrent model requests |
| Agent Wrapper | `scheduler/agent-wrapper.ts` | Wraps scheduler with retry/queue/persist |
| Workflow Orchestrator | `scheduler/workflow-orchestrator.ts` | Phase A→B→C→D finite-state machine |
| Status Display | `scheduler/status-display.ts` | Text-format status output |
| Report Manager | `report-manager.ts` | Structures task reports |

### Key finding: **Library pattern, not runtime**

All TypeScript modules are **compilation-only references** — they are never `import`ed or `exec`uted by the Harness runtime. The actual execution architecture is:

1. The **Harness app** instantiates one model session per chat.
2. That session (this agent, AI 01) executes tools directly via Harness-provided schema.
3. Subagents run via the `task` tool — a read-only or foreground sub-session.
4. No `.ai/office/` TypeScript is loaded at runtime. The scheduler, router, and budget manager are design documents describing *what an integration would do*, not active code.

**Implication:** Any new state manager must be implemented as **JSON files** and **Harness tool calls**, not as a Node.js daemon or imported TS module.

---

## 3. Background Process Capabilities

| Capability | Available? | Evidence |
|------------|-----------|----------|
| `shell_background` | ✅ YES | Survives app backgrounding via foreground service; killed on process termination |
| `nohup … &` | ❌ NO | Reaped when shell call ends (verified 2026-11-02) |
| `pm2`/`forever`/`tmux` | ❌ NOT INSTALLED | Not available in package repo |
| Cron/scheduled | ❌ NO | No Android AlarmManager or WorkManager access from shell |
| App restart persistence | ✅ YES | Task-control files survive in `files/task-controls/` |
| bg log files | ✅ YES | `.harness/bg/*.log` under workspace |

**Conclusion:** Background processes live as long as the HLForegroundService keeps the app alive. They **do not** survive a full app kill. The `shell_background` is the only supported mechanism.

---

## 4. Filesystem & Storage

| Location | Writable | Persists | Purpose |
|----------|----------|----------|---------|
| `workspace/.ai-office/` | ✅ YES | ✅ YES | New state, queue, event files — committed to git or `.gitignore` |
| `workspace/.harness/` | ✅ YES | ✅ YES | Harness-managed (bg logs, file history, memory) — gitignored |
| `files/task-controls/` | ✅ YES | ✅ YES | App-level task state (not per-workspace, gitignored) |
| `files/.harness-scratch/` | ✅ YES | ✅ NO | Scratch space, app may clean |
| `files/linux/tmp/` | ✅ YES | ❌ NO | Volatile temp directory |
| External SD card | maybe | maybe | Not reliable, avoid |

**Recommendation:** Store `.ai-office/` in the workspace root. It is the only location that is:
- Writable by the app UID
- Persistent across app restarts
- Cleanable by gitignore if desired
- Not volatile

---

## 5. Existing Task State & Recovery

### Task-control files (`files/task-controls/`):
- JSON files keyed by UUID, one per chat session
- Contain: provider config, model, mode, initial prompt, context limits, tokens used, cost, elapsed, autoContinue state
- **Not designed for multi-agent coordination** — each file owns one chat session, not an agent or a task

### Harness memory system:
- `.harness/memory/` — topic-based memory files
- `memory_read/memory_write` — agent memory (fact retention)
- `recall/remember` — user-facing durable facts

### AI Office handoff:
- `.ai/AI_HANDOFF.md` — hand-edited Markdown summary of project state
- `.ai/history/archive/` — dated session records (written by agent, not automated)
- `.ai/reports/LATEST.md` — latest task implementation report

### What is MISSING:
- **No durable task queue** — tasks are input directly by the user
- **No state machine** — the workflow orchestrator TS is not running
- **No event log** — no append-only record of state transitions
- **No watcher** — no mechanism to detect stale tasks or heartbeat expiry
- **No lock manager** — concurrent write protection is non-existent
- **No agent coordination layer** — AI 01 ↔ AI 02 handoff is manual prompt injection via `task` tool

---

## 6. MCP Integration & Tool Limit

### MCP servers connected (6 total):

| Server | Tools | Type |
|--------|-------|------|
| Vercel | 246 | HTTP MCP |
| Neon | 139 | HTTP MCP |
| GitHub | 46 | HTTP MCP |
| Render | 28 | HTTP MCP |
| Stripe (sandbox) | 10 | HTTP MCP |
| Cloudflare | 4 | HTTP MCP |
| **Total MCP tools** | **473** | |

### Plus built-in Harness tools: **~40-50** (file, shell, git, browser, skills, memory, etc.)

### 128-tool schema limit:

The system instruction states **"there is a 128-tool schema limit"**. Current observation:
- **473 MCP tools** are loaded simultaneously via OpenAPI schema flattening
- The `vercel` MCP alone provides 246 tools
- Neither the system prompt nor this integration can filter which MCP tools reach the schema

### Tool loading strategy:
The current approach is **load-all** — every MCP server's full tool set is connected and listed in the available tools. The actual model provider (OpenAI-compatible, context-limited) receives all tool definitions. When context is compressed or prompt is large, tool definitions consume a significant portion of the available window.

### What can be improved:
- Tool usage data exists in `mcp-status.json` (`connectedAtMs`, `toolCount`) but no **dynamic tool profile** is applied
- The `task-controls` JSON tracks `usedTokens` and `usedCost` per session, showing real consumption — this can guide tool-profile decisions
- **No Harness API exists to filter MCP tools per task**; the limit is a model-context constraint, not an API gate

---

## 7. Recommended Integration Method

Given the findings:

### Integration type: **File-based Hybrid**
- State Manager, Event Log, Task Queue, Lock Manager, Watcher implement as **shell scripts + JSON files**
- Orchestration controlled by **Harness tools** (`shell`, `read_file`, `write_file`, `grep`)
- No Node.js daemon, no imported TS, no external dependencies
- All state lives in `.ai-office/` (workspace-root JSON)

### Why not Node.js daemon:
1. No guarantee of process survival across app kill
2. No PM2/systemd — would need unreliable shell tricks
3. Adds complexity that contradicts "do not introduce unnecessary dependencies"
4. The existing AI Office TS library is already the right design — it simply needs a runtime adapter

### Why file-based works:
1. `write_file` + `read_file` are atomic per Harness tool
2. JSON + JSONL files survive restart (persistent storage)
3. No concurrent write conflicts when using atomic rename pattern
4. The Watcher can be a state probe function, not a daemon

### The Runtime Adapter:
The key architectural piece: a **Harness tool-call sequence** that maps the existing TS scheduler's `enqueue()`, `dequeue()`, `persist()`, `restore()` to JSON file operations. This adapter executes **inside the agent's own tool loop**, not as a background service.

---

## 8. Verified Constraints

| Constraint | Status |
|------------|--------|
| Do not rebuild AI Office | ✅ Preserved — existing `.ai/office/` files unchanged |
| Do not change model providers | ✅ No changes to `files/task-controls/*.json` provider configs |
| Do not change model assignments | ✅ AI 01/02 roles in ARCHITECTURE.md untouched |
| Do not remove MCP integrations | ✅ All 6 MCP servers remain connected |
| Do not introduce deps | ✅ Zero npm/db/external dependencies |
| Preserve `.ai/` docs | ✅ No files under `.ai/` modified |
| Stop if runtime unsupported | ✅ Supported — file-based integration is feasible |

---

## 9. Recommendations for Phase 2 Design

1. **State Manager**: `.ai-office/state/*.json`, one file per task or agent, atomic writes via `write_file`
2. **Event Log**: `.ai-office/logs/events.jsonl`, append-only using `read_file` + `write_file` (atomic append by reading, appending, rewriting)
3. **Task Queue**: `.ai-office/queue/tasks.json` — ordered array of task descriptors
4. **Lock Manager**: `.ai-office/runtime/lock.json` — simple JSON with `{locked_by, locked_at, ttl_seconds}` — checked before every state write
5. **Watcher**: Agent's own tool loop reads state files, checks heartbeats, detects stale tasks — **not** a background daemon
6. **Recovery Manager**: On agent startup, read `.ai-office/runtime/recovery.json`, compare with current task-controls, restore or fail known tasks
7. **Tool Profiles**: Document tool groupings per agent role; use `task` tool to delegate by profile — tools themselves are not filterable, but each subagent sees only what is in its prompt context
8. **120-tool workaround**: Accept the 473-tool load. Document it. The profile distinction happens at the **prompt/instruction level**, not the tool-schema level. Subagents (AI 02, AI 03, AI 04) get focused instructions that de-emphasise irrelevant tools despite all being available.
