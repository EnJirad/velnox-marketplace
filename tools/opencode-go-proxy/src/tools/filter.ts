/**
 * Per-model / per-agent tool selection.
 *
 * Filtering happens on the `tools` array only. Assistant messages, their
 * `tool_calls` and `role: "tool"` results are never rewritten, so routing and
 * tool_call_id mapping stay exactly as the client sent them.
 *
 * Safety rule: if the conversation history already calls a tool that the
 * profile would hide, the tool is re-added for that request. Otherwise the
 * provider rejects the history ("tool not found") and the whole turn fails.
 */
import { isPlainObject } from "../schema/normalizer.ts";

export interface FilterProfile {
  /** Keep only tools matching these patterns. Absent = keep everything. */
  allow?: string[];
  /** Drop tools matching these patterns. Applied after `allow`. */
  deny?: string[];
  /** Keep only tools belonging to these MCP servers (mcp__<server>__<tool>). */
  allowServers?: string[];
  /** Drop tools belonging to these MCP servers. */
  denyServers?: string[];
  /** Hard cap on tools sent upstream. */
  maxTools?: number;
  /** "error" (default) returns a diagnostic instead of silently dropping. */
  maxToolsOverflow?: "error" | "drop";
}

export interface FilterOptions {
  respectHistory: boolean;
  maxToolsOverflow: "error" | "drop";
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  respectHistory: true,
  maxToolsOverflow: "error",
};

export interface FilterResult<T> {
  tools: T[];
  removed: string[];
  reAdded: string[];
  totalBefore: number;
  totalAfter: number;
  serverCounts: Record<string, number>;
  overflow: { limit: number; count: number } | null;
}

/** `mcp__vercel__list_projects` → `vercel`; built-ins → `builtin`. */
export function serverOf(toolName: string): string {
  const match = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(toolName);
  return match ? match[1] : "builtin";
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(name: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => (pattern.includes("*") ? globToRegExp(pattern).test(name) : pattern === name));
}

function toolNameOf(tool: unknown): string | null {
  if (!isPlainObject(tool)) return null;
  const fn = tool.function;
  if (isPlainObject(fn) && typeof fn.name === "string") return fn.name;
  if (typeof tool.name === "string") return tool.name;
  return null;
}

/** Tool names already present in the conversation, in first-seen order. */
export function toolsReferencedInHistory(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const names: string[] = [];
  const add = (name: unknown): void => {
    if (typeof name !== "string" || name === "") return;
    if (!names.includes(name)) names.push(name);
  };
  for (const message of messages) {
    if (!isPlainObject(message)) continue;
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (isPlainObject(call) && isPlainObject(call.function)) add(call.function.name);
      }
    }
    if (message.role === "tool" && typeof message.name === "string") add(message.name);
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (isPlainObject(part) && part.type === "tool_use" && typeof part.name === "string") add(part.name);
      }
    }
  }
  return names;
}

export function filterTools<T>(
  tools: T[],
  profile: FilterProfile | undefined,
  options: FilterOptions = DEFAULT_FILTER_OPTIONS,
  messages?: unknown,
): FilterResult<T> {
  const totalBefore = tools.length;
  const removed: string[] = [];
  const reAdded: string[] = [];

  if (!profile) {
    const serverCounts: Record<string, number> = {};
    for (const tool of tools) {
      const name = toolNameOf(tool);
      if (!name) continue;
      const server = serverOf(name);
      serverCounts[server] = (serverCounts[server] ?? 0) + 1;
    }
    return {
      tools,
      removed,
      reAdded,
      totalBefore,
      totalAfter: tools.length,
      serverCounts,
      overflow: null,
    };
  }

  const keep: T[] = [];
  for (const tool of tools) {
    const name = toolNameOf(tool);
    if (!name) {
      keep.push(tool);
      continue;
    }
    const server = serverOf(name);

    let allowed = true;
    if (profile.allowServers && profile.allowServers.length > 0) allowed = profile.allowServers.includes(server);
    if (allowed && profile.denyServers?.includes(server)) allowed = false;
    if (allowed && profile.allow && profile.allow.length > 0) allowed = matchesAny(name, profile.allow);
    if (allowed && matchesAny(name, profile.deny)) allowed = false;

    if (allowed) keep.push(tool);
    else removed.push(name);
  }

  // Never break an in-flight tool result: re-add tools the history calls.
  if (options.respectHistory) {
    const referenced = toolsReferencedInHistory(messages);
    const keptNames = new Set(keep.map((tool) => toolNameOf(tool)).filter((n): n is string => n !== null));
    for (const name of referenced) {
      if (keptNames.has(name)) continue;
      const original = tools.find((tool) => toolNameOf(tool) === name);
      if (!original) continue;
      keep.push(original);
      keptNames.add(name);
      reAdded.push(name);
      const index = removed.indexOf(name);
      if (index >= 0) removed.splice(index, 1);
    }
  }

  let overflow: FilterResult<T>["overflow"] = null;
  let finalTools = keep;
  if (profile.maxTools !== undefined && keep.length > profile.maxTools) {
    const mode = profile.maxToolsOverflow ?? options.maxToolsOverflow;
    overflow = { limit: profile.maxTools, count: keep.length };
    if (mode === "drop") finalTools = keep.slice(0, profile.maxTools);
  }

  const serverCounts: Record<string, number> = {};
  for (const tool of finalTools) {
    const name = toolNameOf(tool);
    if (!name) continue;
    const server = serverOf(name);
    serverCounts[server] = (serverCounts[server] ?? 0) + 1;
  }

  return {
    tools: finalTools,
    removed,
    reAdded,
    totalBefore,
    totalAfter: finalTools.length,
    serverCounts,
    overflow,
  };
}
