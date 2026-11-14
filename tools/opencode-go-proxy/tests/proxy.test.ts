import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { normalizeTools, inspectUnions, stableStringify, chunkAnyOf } from "../src/schema/normalizer.ts";
import { validateTools, validateToolSchema } from "../src/schema/validate.ts";
import { filterTools, toolsReferencedInHistory, serverOf } from "../src/tools/filter.ts";
import { SchemaCompatibilityError } from "../src/schema/types.ts";

const SAMPLE_TOOL = {
  type: "function",
  function: {
    name: "test_tool",
    description: "A tool with various unions",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          anyOf: [
            { const: "a" },
            { const: "b" },
            { const: "c" },
          ],
        },
        nested: {
          anyOf: [
            { type: "string" },
            { type: "number" },
            { type: "boolean" },
          ],
        },
      },
    },
  },
};

describe("stableStringify", () => {
  test("key order independent", () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });
});

describe("inspectUnions", () => {
  test("counts anyOf branches", () => {
    const { maxAnyOf, maxAnyOfPath } = inspectUnions(SAMPLE_TOOL.function.parameters);
    expect(maxAnyOf).toBe(3);
    expect(maxAnyOfPath).toContain("anyOf");
  });
});

describe("normalizeTools", () => {
  test("merges const arms to enum while preserving type keyword", () => {
    const { tools, changed, reports } = normalizeTools([SAMPLE_TOOL]);
    // The SAMPLE_TOOL has const arms that get merged to an enum - this is lossless
    expect(changed).toBe(true);
    expect(tools.length).toBe(1);
    expect(reports.length).toBe(1);
    expect(reports[0].actions.some((a: string) => a.includes("enum merge"))).toBe(true);
    const props = tools[0].function.parameters.properties;
    const mode = props.mode as Record<string, unknown>;
    // anyOf stays because type keyword exists; it now contains one arm with the merged enum
    const anyOf = mode.anyOf as unknown[];
    expect(anyOf.length).toBe(1);
    const mergedArm = anyOf[0] as Record<string, unknown>;
    expect(mergedArm.enum).toEqual(["a", "b", "c"]);
    expect(mergedArm.type).toBe("string");
  });

  test("dedupes duplicate arms then merges to enum", () => {
    const tool = {
      ...SAMPLE_TOOL,
      function: {
        ...SAMPLE_TOOL.function,
        parameters: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              anyOf: [
                { const: "a" },
                { const: "a" }, // duplicate
                { const: "b" },
              ],
            },
          },
        },
      },
    };
    const { tools, reports } = normalizeTools([tool]);
    const props = tools[0].function.parameters.properties;
    const mode = props.mode as Record<string, unknown>;
    // After dedupe: {const:"a"}, {const:"b"} -> then merged to enum ["a","b"]
    const anyOf = mode.anyOf as unknown[];
    expect(anyOf.length).toBe(1);
    const mergedArm = anyOf[0] as Record<string, unknown>;
    expect(mergedArm.enum).toEqual(["a", "b"]);
    expect(mergedArm.type).toBe("string");
    expect(reports[0].actions.some((a: string) => a.includes("dedupe"))).toBe(true);
    expect(reports[0].actions.some((a: string) => a.includes("enum merge"))).toBe(true);
  });

  test("merges scalar enums (explicit type + const arms)", () => {
    const tool = {
      ...SAMPLE_TOOL,
      function: {
        ...SAMPLE_TOOL.function,
        parameters: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              anyOf: [
                { const: "a" },
                { const: "b" },
                { const: "c" },
              ],
            },
          },
        },
      },
    };
    const { tools, reports } = normalizeTools([tool]);
    const props = tools[0].function.parameters.properties;
    const mode = props.mode as Record<string, unknown>;
    // anyOf stays because type keyword exists; it now contains one arm with the merged enum
    const anyOf = mode.anyOf as unknown[];
    expect(anyOf.length).toBe(1);
    const mergedArm = anyOf[0] as Record<string, unknown>;
    expect(mergedArm.enum).toEqual(["a", "b", "c"]);
    expect(mergedArm.type).toBe("string");
    expect(reports[0].actions.some((a: string) => a.includes("enum merge"))).toBe(true);
  });

  test("chunks oversized anyOf with non-scalar arms", () => {
    // Use object arms that can't be merged to enum
    const arms = Array.from({ length: 20 }, (_, i) => ({
      type: "object",
      properties: { id: { const: `obj${i}` } },
    }));
    const tool = {
      ...SAMPLE_TOOL,
      function: {
        ...SAMPLE_TOOL.function,
        parameters: {
          type: "object",
          properties: {
            mode: {
              anyOf: arms,
            },
          },
        },
      },
    };
    const { tools, reports } = normalizeTools([tool]);
    const props = tools[0].function.parameters.properties;
    const mode = props.mode as Record<string, unknown>;
    const anyOf = mode.anyOf as unknown[];
    // 20 arms > 16 limit, should be chunked into nested anyOf groups
    expect(anyOf.length).toBeLessThanOrEqual(16);
    expect(reports[0].actions.some((a: string) => a.includes("chunk"))).toBe(true);
  });

  test("reports oneOf overflow when error mode", () => {
    const arms = Array.from({ length: 20 }, (_, i) => ({ const: `value${i}` }));
    const tool = {
      ...SAMPLE_TOOL,
      function: {
        ...SAMPLE_TOOL.function,
        parameters: {
          type: "object",
          properties: {
            mode: {
              oneOf: arms,
            },
          },
        },
      },
    };
    expect(() => normalizeTools([tool])).toThrow(SchemaCompatibilityError);
  });
});

describe("chunkAnyOf", () => {
  test("under limit returns as-is", () => {
    const arms = [{ const: "a" }, { const: "b" }];
    const out = chunkAnyOf(arms, 16);
    expect(out.length).toBe(2);
  });

  test("over limit creates nested groups", () => {
    const arms = Array.from({ length: 20 }, (_, i) => ({ const: `v${i}` }));
    const out = chunkAnyOf(arms, 16);
    expect(out.length).toBeLessThanOrEqual(16);
    // flatten should yield same arms
    const flat = out.flatMap((g) => (typeof g === "object" && g !== null && "anyOf" in g && Array.isArray(g.anyOf) ? g.anyOf : [g]));
    expect(flat.length).toBe(20);
  });
});

describe("validateTools", () => {
  test("accepts valid tools", () => {
    const result = validateTools([SAMPLE_TOOL]);
    expect(result.ok).toBe(true);
    expect(result.checkedTools).toBe(1);
  });

  test("rejects invalid tools array", () => {
    const result = validateTools("not an array");
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe("invalid_tool_schema");
  });

  test("detects oversized anyOf", () => {
    const arms = Array.from({ length: 20 }, (_, i) => ({ const: `v${i}` }));
    const tool = {
      ...SAMPLE_TOOL,
      function: {
        ...SAMPLE_TOOL.function,
        parameters: {
          type: "object",
          properties: {
            mode: { anyOf: arms },
          },
        },
      },
    };
    const result = validateTools([tool]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe("anyOf_branch_limit");
  });

  test("detects unresolved $ref", () => {
    const tool = {
      ...SAMPLE_TOOL,
      function: {
        ...SAMPLE_TOOL.function,
        parameters: {
          type: "object",
          properties: {
            data: { $ref: "#/defs/DoesNotExist" },
          },
        },
      },
    };
    const result = validateTools([tool]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d: { code: string }) => d.code === "unresolved_ref")).toBe(true);
  });
});

describe("filterTools", () => {
  const builtinTool = { type: "function", function: { name: "builtin_read", description: "Read" } };
  const mcpTool = { type: "function", function: { name: "mcp__github__list_repos", description: "List" } };
  const allTools = [builtinTool, mcpTool];

  test("allowServers keeps only specified servers", () => {
    const result = filterTools(allTools, { allowServers: ["github"] });
    expect(result.totalAfter).toBe(1);
    expect(result.tools[0].function.name).toBe("mcp__github__list_repos");
  });

  test("denyServers drops specified servers", () => {
    const result = filterTools(allTools, { denyServers: ["github"] });
    expect(result.totalAfter).toBe(1);
    expect(result.tools[0].function.name).toBe("builtin_read");
  });

  test("maxTools caps and errors by default", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      type: "function",
      function: { name: `tool_${i}` },
    }));
    const result = filterTools(many, { maxTools: 50 });
    expect(result.overflow).not.toBeNull();
    expect(result.totalAfter).toBe(200); // kept all, just flagged
  });

  test("respectHistory re-adds tools from messages", () => {
    const messages = [
      { role: "assistant", tool_calls: [{ function: { name: "mcp__github__list_repos" } }] },
    ];
    const result = filterTools(allTools, { denyServers: ["github"] }, { respectHistory: true, maxToolsOverflow: "error" }, messages);
    expect(result.totalAfter).toBe(2);
    expect(result.reAdded).toContain("mcp__github__list_repos");
  });

  test("serverOf parses MCP names", () => {
    expect(serverOf("mcp__github__list_repos")).toBe("github");
    expect(serverOf("mcp__cloudflare__list_zones")).toBe("cloudflare");
    expect(serverOf("builtin_read")).toBe("builtin");
  });

  test("toolsReferencedInHistory extracts from assistant tool_calls", () => {
    const messages = [
      { role: "assistant", tool_calls: [{ function: { name: "tool_a" } }, { function: { name: "tool_b" } }] },
      { role: "tool", name: "tool_a" },
    ];
    const refs = toolsReferencedInHistory(messages);
    expect(refs).toEqual(["tool_a", "tool_b"]);
  });
});
