/**
 * Tool schema normalizer.
 *
 * The upstream provider (OpenCode Go) rejects requests whose tool schemas
 * contain a union with more than 16 arms:
 *
 *   tools[315].function.parameters: schema branch arms exceeded: anyOf limit 16
 *
 * This module rewrites those unions *without weakening validation*:
 *
 *  1. duplicate arms are collapsed                    (lossless)
 *  2. arms already covered by a wider sibling are cut (lossless)
 *  3. const/enum-only arms of one primitive type merge into a single enum
 *                                                     (lossless)
 *  4. whatever still exceeds the limit is wrapped into nested anyOf groups.
 *     anyOf is associative, so `anyOf[a..z]` === `anyOf[anyOf[a..p], ...]`
 *     — every arm survives and the accepted set is identical.
 *
 * Nothing here drops an arm, widens a type, or converts a union into a looser
 * shape. When a schema cannot be made compatible without semantic loss the
 * caller gets a SchemaCompatibilityError naming the tool and the exact path.
 */
import {
  DEFAULT_NORMALIZE_OPTIONS,
  SchemaCompatibilityError,
  type JsonSchema,
  type NormalizeOptions,
  type NormalizedToolsResult,
  type SchemaDiagnostic,
  type ToolNormalizeReport,
  type ToolSchemaInput,
} from "./types.ts";

/** Keywords that carry documentation only — they never affect validation. */
const ANNOTATION_KEYS = new Set([
  "title",
  "description",
  "default",
  "examples",
  "example",
  "$comment",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

const SCHEMA_MAP_KEYS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
] as const;

const SCHEMA_ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;

const SCHEMA_SINGLE_KEYS = [
  "items",
  "additionalProperties",
  "additionalItems",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
] as const;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchemaLike(value: unknown): boolean {
  return typeof value === "boolean" || isPlainObject(value);
}

/** Deterministic JSON for equality checks (key order independent). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

interface NormalizeCtx {
  tool: string;
  opts: NormalizeOptions;
  actions: string[];
}

function fail(tool: string, diagnostic: Omit<SchemaDiagnostic, "tool">): never {
  throw new SchemaCompatibilityError({ tool, ...diagnostic });
}

// ── union reduction ───────────────────────────────────────────────────────

function dedupeBranches(branches: JsonSchema[], path: string, ctx: NormalizeCtx): JsonSchema[] {
  const seen = new Map<string, JsonSchema>();
  for (const branch of branches) {
    const key = stableStringify(branch);
    if (!seen.has(key)) seen.set(key, branch);
  }
  if (seen.size !== branches.length) {
    ctx.actions.push(`dedupe ${path}: ${branches.length} → ${seen.size} arms`);
  }
  return [...seen.values()];
}

function typeSetOf(schema: Record<string, unknown>): Set<string> | null {
  const type = schema.type;
  if (typeof type === "string") return new Set([type]);
  if (Array.isArray(type) && type.every((t) => typeof t === "string")) {
    return new Set(type as string[]);
  }
  return null;
}

/**
 * True when `wide` accepts every instance `narrow` accepts.
 * Deliberately conservative: it only reasons about keyword subsets with equal
 * values, and refuses to reason about $ref, dependent keywords or annotations
 * it would otherwise lose.
 */
function subsumes(wide: JsonSchema, narrow: JsonSchema): boolean {
  if (wide === true) return true;
  if (narrow === false) return true;
  if (wide === false) return false;
  if (!isPlainObject(wide) || !isPlainObject(narrow)) return false;
  if ("$ref" in wide || "$ref" in narrow) return false;

  const wideKeys = Object.keys(wide).filter((k) => !ANNOTATION_KEYS.has(k));
  const narrowKeys = new Set(Object.keys(narrow).filter((k) => !ANNOTATION_KEYS.has(k)));

  for (const key of wideKeys) {
    if (!narrowKeys.has(key)) return false;
    if (stableStringify(wide[key]) !== stableStringify(narrow[key])) return false;
  }

  // A wide arm with a type must be at least as permissive on type as the
  // narrow one, otherwise the narrow arm contributes values the wide one
  // rejects.
  const wideTypes = typeSetOf(wide);
  const narrowTypes = typeSetOf(narrow);
  if (wideTypes) {
    if (!narrowTypes) return false;
    for (const t of narrowTypes) if (!wideTypes.has(t)) return false;
  }

  // Dropping an arm must not drop documentation the survivor does not carry.
  for (const key of ["title", "description", "default", "examples"] as const) {
    if (key in narrow && stableStringify(narrow[key]) !== stableStringify(wide[key])) {
      return false;
    }
  }
  return true;
}

function dropSubsumed(branches: JsonSchema[], path: string, ctx: NormalizeCtx): JsonSchema[] {
  const keep: JsonSchema[] = [];
  for (let i = 0; i < branches.length; i++) {
    let covered = false;
    for (let j = 0; j < branches.length; j++) {
      if (i === j) continue;
      if (!subsumes(branches[j], branches[i])) continue;
      // Equal arms are handled by dedupe; avoid order-dependent removals.
      if (subsumes(branches[i], branches[j])) continue;
      covered = true;
      break;
    }
    if (!covered) keep.push(branches[i]);
  }
  if (keep.length !== branches.length) {
    ctx.actions.push(`subsumption ${path}: ${branches.length} → ${keep.length} arms`);
  }
  return keep.length > 0 ? keep : branches;
}

const SCALAR_MERGE_KEYS = new Set([
  "type",
  "enum",
  "const",
  ...ANNOTATION_KEYS,
]);

function scalarGroupKey(branch: JsonSchema): string | null {
  if (!isPlainObject(branch)) return null;
  for (const key of Object.keys(branch)) {
    if (!SCALAR_MERGE_KEYS.has(key)) return null;
  }
  // Per-arm documentation cannot survive an enum merge, so keep those arms.
  for (const key of ["title", "description", "default", "examples"] as const) {
    if (key in branch) return null;
  }
  const values = enumValuesOf(branch);
  if (!values) return null;
  const declared = branch.type;
  if (declared === undefined) {
    const kinds = new Set(values.map((v) => (v === null ? "null" : typeof v)));
    if (kinds.size !== 1) return null;
    return [...kinds][0] as string;
  }
  if (typeof declared !== "string") return null; // arrays / exotic types: leave alone
  for (const v of values) {
    const kind = v === null ? "null" : typeof v;
    if (kind !== declared) return null;
  }
  return declared;
}

function enumValuesOf(schema: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(schema.enum)) return schema.enum;
  if ("const" in schema) return [schema.const];
  return null;
}

function mergeScalarEnums(branches: JsonSchema[], path: string, ctx: NormalizeCtx): JsonSchema[] {
  const groups = new Map<string, { values: unknown[]; members: number[] }>();
  const passthrough: JsonSchema[] = [];

  branches.forEach((branch, index) => {
    const key = scalarGroupKey(branch);
    if (key === null) {
      passthrough.push(branch);
      return;
    }
    const values = enumValuesOf(branch as Record<string, unknown>)!;
    const group = groups.get(key) ?? { values: [], members: [] };
    for (const value of values) {
      if (!group.values.some((existing) => stableStringify(existing) === stableStringify(value))) {
        group.values.push(value);
      }
    }
    group.members.push(index);
    groups.set(key, group);
  });

  if (groups.size === 0) return branches;

  const merged: JsonSchema[] = [];
  for (const [type, group] of groups) {
    if (group.values.length > ctx.opts.maxMergedEnumValues) {
      // Too many values to inline: keep the original arms and let chunking run.
      for (const index of group.members) merged.push(branches[index]);
      continue;
    }
    merged.push({ type, enum: group.values });
  }

  const totalMembers = [...groups.values()].reduce((sum, g) => sum + g.members.length, 0);
  if (totalMembers > groups.size) {
    ctx.actions.push(`enum merge ${path}: ${totalMembers} arms → ${groups.size} enum arm(s)`);
  }
  return [...merged, ...passthrough];
}

/**
 * Wraps arms into nested anyOf groups so every node stays within `limit`.
 * anyOf is associative, so the accepted instance set is unchanged.
 */
export function chunkAnyOf(branches: JsonSchema[], limit: number): JsonSchema[] {
  if (branches.length <= limit) return branches;
  const groupSize = Math.ceil(branches.length / limit);
  const groups: JsonSchema[][] = [];
  for (let i = 0; i < branches.length; i += groupSize) {
    groups.push(branches.slice(i, i + groupSize));
  }
  return groups.map((group) => {
    const nested = chunkAnyOf(group, limit);
    return nested.length === 1 ? nested[0] : { anyOf: nested };
  });
}

function reduceUnion(
  kind: "anyOf" | "oneOf",
  branches: JsonSchema[],
  path: string,
  ctx: NormalizeCtx,
): JsonSchema[] {
  let out = branches.slice();
  const limit = ctx.opts.maxAnyOfBranches;

  if (kind === "anyOf") {
    if (ctx.opts.dedupeBranches) out = dedupeBranches(out, path, ctx);
    if (ctx.opts.dropSubsumedBranches) out = dropSubsumed(out, path, ctx);
    if (ctx.opts.mergeScalarEnums) out = mergeScalarEnums(out, path, ctx);

    if (out.length > limit) {
      if (ctx.opts.anyOfOverflow === "error") {
        fail(ctx.tool, {
          code: "anyOf_branch_limit",
          path,
          message: `anyOf has ${out.length} arms, upstream allows ${limit}`,
          branchCount: out.length,
          limit,
          hint: "set anyOfOverflow=chunk to wrap the arms into nested anyOf groups (lossless)",
        });
      }
      const chunked = chunkAnyOf(out, limit);
      ctx.actions.push(`chunk ${path}: ${out.length} arms → ${chunked.length} nested group(s)`);
      out = chunked;
    }
    return out;
  }

  // oneOf: "exactly one arm matches" is not associative, so chunking would
  // change semantics. Never guess here.
  if (out.length > limit) {
    if (ctx.opts.oneOfOverflow === "error") {
      fail(ctx.tool, {
        code: "oneOf_branch_limit",
        path,
        message: `oneOf has ${out.length} arms, upstream allows ${limit}`,
        branchCount: out.length,
        limit,
        hint: "oneOf cannot be grouped without changing 'exactly one' semantics — split it in the tool definition or set oneOfOverflow=leave",
      });
    }
  }
  return out;
}

const ANY_OF_ONLY_KEYS = new Set(["anyOf", ...ANNOTATION_KEYS]);

function normalizeNode(schema: JsonSchema, path: string, ctx: NormalizeCtx, depth: number): JsonSchema {
  if (typeof schema === "boolean") return schema;
  if (!isPlainObject(schema)) return schema;

  if (depth > ctx.opts.maxDepth) {
    fail(ctx.tool, {
      code: "schema_too_deep",
      path,
      message: `schema nesting exceeded ${ctx.opts.maxDepth} levels`,
    });
  }

  const node: Record<string, unknown> = { ...schema };

  for (const key of SCHEMA_MAP_KEYS) {
    const value = node[key];
    if (!isPlainObject(value)) continue;
    const next: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value)) {
      next[name] = isSchemaLike(child)
        ? normalizeNode(child as JsonSchema, `${path}.${key}.${name}`, ctx, depth + 1)
        : child;
    }
    node[key] = next;
  }

  for (const key of SCHEMA_ARRAY_KEYS) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    node[key] = value.map((child, index) =>
      isSchemaLike(child) ? normalizeNode(child as JsonSchema, `${path}.${key}[${index}]`, ctx, depth + 1) : child,
    );
  }

  for (const key of SCHEMA_SINGLE_KEYS) {
    const value = node[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      node[key] = value.map((child, index) =>
        isSchemaLike(child) ? normalizeNode(child as JsonSchema, `${path}.${key}[${index}]`, ctx, depth + 1) : child,
      );
    } else if (isSchemaLike(value)) {
      node[key] = normalizeNode(value as JsonSchema, `${path}.${key}`, ctx, depth + 1);
    }
  }

  if (Array.isArray(node.anyOf)) {
    const reduced = reduceUnion("anyOf", node.anyOf as JsonSchema[], `${path}.anyOf`, ctx);
    if (reduced.length === 1) {
      const onlyAnyOf = Object.keys(node).every((key) => ANY_OF_ONLY_KEYS.has(key));
      const branch = reduced[0];
      if (onlyAnyOf) {
        if (isPlainObject(branch)) {
          const annotations: Record<string, unknown> = {};
          for (const key of Object.keys(node)) if (key !== "anyOf") annotations[key] = node[key];
          return { ...branch, ...annotations };
        }
        return branch;
      }
    }
    node.anyOf = reduced;
  }

  if (Array.isArray(node.oneOf)) {
    node.oneOf = reduceUnion("oneOf", node.oneOf as JsonSchema[], `${path}.oneOf`, ctx);
  }

  return node;
}

// ── public API ────────────────────────────────────────────────────────────

interface SchemaSlot {
  container: Record<string, unknown>;
  key: "parameters" | "input_schema";
  path: string;
}

function findSchemaSlot(tool: ToolSchemaInput): SchemaSlot | null {
  const fn = (tool as Record<string, unknown>).function;
  if (isPlainObject(fn)) {
    if (isPlainObject(fn.parameters)) return { container: fn, key: "parameters", path: "$.function.parameters" };
    if (isPlainObject(fn.input_schema)) return { container: fn, key: "input_schema", path: "$.function.input_schema" };
    return null;
  }
  if (isPlainObject(tool.parameters)) return { container: tool as Record<string, unknown>, key: "parameters", path: "$.parameters" };
  if (isPlainObject(tool.input_schema)) return { container: tool as Record<string, unknown>, key: "input_schema", path: "$.input_schema" };
  return null;
}

export function toolNameOf(tool: ToolSchemaInput): string {
  const fn = (tool as Record<string, unknown>).function;
  if (isPlainObject(fn) && typeof fn.name === "string") return fn.name;
  if (typeof tool.name === "string") return tool.name;
  return "<unnamed>";
}

/** Highest anyOf/oneOf arm count anywhere in the schema, plus its path. */
export function inspectUnions(
  schema: JsonSchema,
  path = "$",
): { maxAnyOf: number; maxAnyOfPath: string; maxOneOf: number; maxOneOfPath: string; anyOfNodes: number } {
  let maxAnyOf = 0;
  let maxAnyOfPath = path;
  let maxOneOf = 0;
  let maxOneOfPath = path;
  let anyOfNodes = 0;

  const visit = (node: JsonSchema, at: string): void => {
    if (!isPlainObject(node)) return;
    for (const kind of ["anyOf", "oneOf"] as const) {
      const value = node[kind];
      if (!Array.isArray(value)) continue;
      if (kind === "anyOf") {
        anyOfNodes += 1;
        if (value.length > maxAnyOf) {
          maxAnyOf = value.length;
          maxAnyOfPath = `${at}.anyOf`;
        }
      } else if (value.length > maxOneOf) {
        maxOneOf = value.length;
        maxOneOfPath = `${at}.oneOf`;
      }
      value.forEach((child, index) => visit(child as JsonSchema, `${at}.${kind}[${index}]`));
    }
    for (const key of SCHEMA_MAP_KEYS) {
      const value = node[key];
      if (!isPlainObject(value)) continue;
      for (const [name, child] of Object.entries(value)) visit(child as JsonSchema, `${at}.${key}.${name}`);
    }
    for (const key of SCHEMA_SINGLE_KEYS) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child, index) => visit(child as JsonSchema, `${at}.${key}[${index}]`));
      else if (isSchemaLike(value)) visit(value as JsonSchema, `${at}.${key}`);
    }
  };

  visit(schema, path);
  return { maxAnyOf, maxAnyOfPath, maxOneOf, maxOneOfPath, anyOfNodes };
}

/** Normalizes one tool's parameter schema in place-safe fashion (returns a copy). */
export function normalizeToolSchema<T extends ToolSchemaInput>(
  tool: T,
  options: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
): { tool: T; report: ToolNormalizeReport } {
  const name = toolNameOf(tool);
  const slot = findSchemaSlot(tool);
  const before = slot ? inspectUnions(slot.container[slot.key] as JsonSchema, slot.path) : null;

  if (!slot) {
    return {
      tool,
      report: {
        tool: name,
        changed: false,
        actions: [],
        maxAnyOfBefore: 0,
        maxAnyOfAfter: 0,
        branchesBefore: 0,
        branchesAfter: 0,
      },
    };
  }

  const ctx: NormalizeCtx = { tool: name, opts: options, actions: [] };
  const normalized = normalizeNode(slot.container[slot.key] as JsonSchema, slot.path, ctx, 0);
  const after = inspectUnions(normalized as JsonSchema, slot.path);
  const changed = stableStringify(normalized) !== stableStringify(slot.container[slot.key]);

  if (!changed) {
    return {
      tool,
      report: {
        tool: name,
        changed: false,
        actions: ctx.actions,
        maxAnyOfBefore: before?.maxAnyOf ?? 0,
        maxAnyOfAfter: after.maxAnyOf,
        branchesBefore: before?.maxAnyOf ?? 0,
        branchesAfter: after.maxAnyOf,
      },
    };
  }

  const toolCopy: Record<string, unknown> = { ...(tool as Record<string, unknown>) };
  if (isPlainObject(toolCopy.function)) {
    toolCopy.function = { ...(toolCopy.function as Record<string, unknown>), [slot.key]: normalized };
  } else {
    toolCopy[slot.key] = normalized;
  }

  return {
    tool: toolCopy as T,
    report: {
      tool: name,
      changed: true,
      actions: ctx.actions,
      maxAnyOfBefore: before?.maxAnyOf ?? 0,
      maxAnyOfAfter: after.maxAnyOf,
      branchesBefore: before?.maxAnyOf ?? 0,
      branchesAfter: after.maxAnyOf,
    },
  };
}

/** Normalizes every tool in an OpenAI-style `tools` array. */
export function normalizeTools<T extends ToolSchemaInput>(
  tools: T[],
  options: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
): NormalizedToolsResult<T> {
  const reports: ToolNormalizeReport[] = [];
  const out: T[] = [];
  for (const tool of tools) {
    const { tool: normalized, report } = normalizeToolSchema(tool, options);
    out.push(normalized);
    if (report.changed || report.actions.length > 0) reports.push(report);
  }
  return { tools: out, reports, changed: reports.some((r) => r.changed) };
}
