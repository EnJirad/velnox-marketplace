/**
 * Pre-flight validation of the tool block, before anything reaches upstream.
 *
 * The point is to turn an opaque `HTTP 400 tools[315]...` into a diagnostic
 * that names the tool, the index and the exact schema path, without ever
 * logging credentials or tool arguments.
 */
import { inspectUnions, isPlainObject, toolNameOf } from "./normalizer.ts";
import {
  DEFAULT_NORMALIZE_OPTIONS,
  type JsonSchema,
  type NormalizeOptions,
  type SchemaDiagnostic,
  type ToolSchemaInput,
} from "./types.ts";

export interface ValidationResult {
  ok: boolean;
  diagnostics: SchemaDiagnostic[];
  checkedTools: number;
}

export interface ValidateOptions {
  normalizer: NormalizeOptions;
  /** When true, unknown keywords are reported as diagnostics (off by default). */
  strictKeywords: boolean;
}

const DEFAULT_VALIDATE_OPTIONS: ValidateOptions = {
  normalizer: DEFAULT_NORMALIZE_OPTIONS,
  strictKeywords: false,
};

const KNOWN_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "$comment",
  "definitions",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "type",
  "enum",
  "const",
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  "maxLength",
  "minLength",
  "pattern",
  "format",
  "contentEncoding",
  "contentMediaType",
  "items",
  "prefixItems",
  "additionalItems",
  "contains",
  "maxContains",
  "minContains",
  "maxItems",
  "minItems",
  "uniqueItems",
  "maxProperties",
  "minProperties",
  "properties",
  "patternProperties",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "dependentRequired",
  "dependentSchemas",
  "propertyNames",
  "required",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "discriminator",
]);

function schemaOf(tool: ToolSchemaInput): { schema: JsonSchema; path: string } | null {
  const fn = (tool as Record<string, unknown>).function;
  if (isPlainObject(fn)) {
    if (isPlainObject(fn.parameters)) return { schema: fn.parameters as JsonSchema, path: "$.function.parameters" };
    if (isPlainObject(fn.input_schema)) return { schema: fn.input_schema as JsonSchema, path: "$.function.input_schema" };
    return null;
  }
  if (isPlainObject(tool.parameters)) return { schema: tool.parameters as JsonSchema, path: "$.parameters" };
  if (isPlainObject(tool.input_schema)) return { schema: tool.input_schema as JsonSchema, path: "$.input_schema" };
  return null;
}

function collectRefs(node: JsonSchema, at: string, out: Array<{ ref: string; path: string }>): void {
  if (!isPlainObject(node)) return;
  if (typeof node.$ref === "string") out.push({ ref: node.$ref, path: `${at}.$ref` });
  for (const key of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]) {
    const value = node[key];
    if (!isPlainObject(value)) continue;
    for (const [name, child] of Object.entries(value)) collectRefs(child as JsonSchema, `${at}.${key}.${name}`, out);
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    value.forEach((child, index) => collectRefs(child as JsonSchema, `${at}.${key}[${index}]`, out));
  }
  for (const key of ["items", "additionalProperties", "not", "if", "then", "else", "contains", "propertyNames"]) {
    const value = node[key];
    if (isPlainObject(value)) collectRefs(value as JsonSchema, `${at}.${key}`, out);
  }
}

function resolvePointer(root: JsonSchema, ref: string): boolean {
  if (!ref.startsWith("#/")) return true; // remote refs are out of scope
  const segments = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cursor: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(cursor) || !(segment in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return true;
}

function scanUnknownKeywords(
  node: JsonSchema,
  at: string,
  tool: string,
  diagnostics: SchemaDiagnostic[],
): void {
  if (!isPlainObject(node)) return;
  for (const key of Object.keys(node)) {
    if (KNOWN_KEYWORDS.has(key) || key.startsWith("x-")) continue;
    diagnostics.push({
      tool,
      path: at,
      code: "unsupported_keyword",
      message: `unknown schema keyword "${key}"`,
      hint: "unknown keywords are usually ignored by providers; disable strictKeywords to silence",
    });
  }
  for (const key of ["properties", "patternProperties", "$defs", "definitions"]) {
    const value = node[key];
    if (!isPlainObject(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      scanUnknownKeywords(child as JsonSchema, `${at}.${key}.${name}`, tool, diagnostics);
    }
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    value.forEach((child, index) => scanUnknownKeywords(child as JsonSchema, `${at}.${key}[${index}]`, tool, diagnostics));
  }
  for (const key of ["items", "additionalProperties", "not", "if", "then", "else", "contains", "propertyNames"]) {
    const value = node[key];
    if (isPlainObject(value)) scanUnknownKeywords(value as JsonSchema, `${at}.${key}`, tool, diagnostics);
  }
}

/** Validates a single tool definition. Returns [] when compatible. */
export function validateToolSchema(
  tool: ToolSchemaInput,
  index: number,
  options: ValidateOptions = DEFAULT_VALIDATE_OPTIONS,
): SchemaDiagnostic[] {
  const diagnostics: SchemaDiagnostic[] = [];
  const name = toolNameOf(tool);
  const where = `tools[${index}]`;

  if (name === "<unnamed>" || name.trim() === "") {
    diagnostics.push({
      tool: name,
      path: where,
      code: "invalid_tool_schema",
      message: "tool has no name",
    });
  }

  const slot = schemaOf(tool);
  if (!slot) {
    const fn = (tool as Record<string, unknown>).function;
    const hasParams = isPlainObject(fn) ? "parameters" in fn : "parameters" in (tool as Record<string, unknown>);
    if (!hasParams) return diagnostics; // parameterless tool is legal
    diagnostics.push({
      tool: name,
      path: where,
      code: "invalid_tool_schema",
      message: "tool parameters must be a JSON object schema",
    });
    return diagnostics;
  }

  const { maxAnyOf, maxAnyOfPath, maxOneOf, maxOneOfPath } = inspectUnions(slot.schema, slot.path);
  const limit = options.normalizer.maxAnyOfBranches;

  if (maxAnyOf > limit) {
    diagnostics.push({
      tool: name,
      path: maxAnyOfPath,
      code: "anyOf_branch_limit",
      message: `anyOf has ${maxAnyOf} arms, upstream allows ${limit}`,
      branchCount: maxAnyOf,
      limit,
      hint: "the normalizer should have handled this — check anyOfOverflow settings",
    });
  }

  if (maxOneOf > limit && options.normalizer.oneOfOverflow === "error") {
    diagnostics.push({
      tool: name,
      path: maxOneOfPath,
      code: "oneOf_branch_limit",
      message: `oneOf has ${maxOneOf} arms, upstream allows ${limit}`,
      branchCount: maxOneOf,
      limit,
      hint: "oneOf cannot be grouped without changing 'exactly one' semantics",
    });
  }

  const refs: Array<{ ref: string; path: string }> = [];
  collectRefs(slot.schema, slot.path, refs);
  for (const { ref, path } of refs) {
    if (!resolvePointer(slot.schema, ref)) {
      diagnostics.push({
        tool: name,
        path,
        code: "unresolved_ref",
        message: `$ref "${ref}" does not resolve inside this tool schema`,
      });
    }
  }

  if (options.strictKeywords) scanUnknownKeywords(slot.schema, slot.path, name, diagnostics);

  return diagnostics;
}

/** Validates the whole `tools` array of a request body. */
export function validateTools(
  tools: unknown,
  options: ValidateOptions = DEFAULT_VALIDATE_OPTIONS,
): ValidationResult {
  if (tools === undefined) return { ok: true, diagnostics: [], checkedTools: 0 };
  if (!Array.isArray(tools)) {
    return {
      ok: false,
      checkedTools: 0,
      diagnostics: [
        {
          tool: "<request>",
          path: "$.tools",
          code: "invalid_tool_schema",
          message: "tools must be an array",
        },
      ],
    };
  }

  const diagnostics: SchemaDiagnostic[] = [];
  tools.forEach((tool, index) => {
    if (!isPlainObject(tool)) {
      diagnostics.push({
        tool: `<tools[${index}]>`,
        path: `tools[${index}]`,
        code: "invalid_tool_schema",
        message: "tool entry must be an object",
      });
      return;
    }
    diagnostics.push(...validateToolSchema(tool as ToolSchemaInput, index, options));
  });

  return { ok: diagnostics.length === 0, diagnostics, checkedTools: tools.length };
}

/**
 * [OI]-compatible error envelope. Clients (Android Harness included) surface
 * `error.message`, so the message carries the tool and path.
 */
export function diagnosticsResponseBody(diagnostics: SchemaDiagnostic[]): Record<string, unknown> {
  const first = diagnostics[0];
  const summary =
    diagnostics.length === 1
      ? `tool schema incompatible: ${first.tool} at ${first.path} — ${first.message}`
      : `tool schema incompatible: ${diagnostics.length} problems, first is ${first.tool} at ${first.path} — ${first.message}`;
  return {
    error: {
      message: summary,
      type: "invalid_request_error",
      code: "tool_schema_incompatible",
      param: first.path,
      diagnostics,
    },
  };
}
