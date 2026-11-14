/**
 * JSON Schema types used by the normalizer.
 *
 * A JSON Schema node is either a boolean (`true` accepts everything, `false`
 * accepts nothing) or an object of keywords.
 */
export type JsonSchema = boolean | { [key: string]: unknown };

export interface NormalizeOptions {
  /** Maximum anyOf arms allowed by the upstream provider. OpenCode Go = 16. */
  maxAnyOfBranches: number;
  /**
   * What to do when an anyOf still has too many arms after lossless reduction.
   * - "chunk": wrap arms in nested anyOf groups (semantics preserved exactly).
   * - "error": refuse the request with a precise diagnostic.
   */
  anyOfOverflow: "chunk" | "error";
  /**
   * oneOf cannot be chunked without changing semantics ("exactly one arm"
   * is not associative), so the default is a diagnostic instead of a guess.
   * - "error": refuse with a diagnostic naming tool + schema path.
   * - "leave": forward untouched and let upstream decide.
   */
  oneOfOverflow: "error" | "leave";
  /** Collapse duplicate arms. Lossless. */
  dedupeBranches: boolean;
  /** Drop arms already covered by a wider sibling arm. Lossless. */
  dropSubsumedBranches: boolean;
  /** Merge const/enum-only arms of the same primitive type into one enum. Lossless. */
  mergeScalarEnums: boolean;
  /** Refuse to merge more enum values than this (keeps schemas readable). */
  maxMergedEnumValues: number;
  /** Guard against pathological schemas. */
  maxDepth: number;
}

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = {
  maxAnyOfBranches: 16,
  anyOfOverflow: "chunk",
  oneOfOverflow: "error",
  dedupeBranches: true,
  dropSubsumedBranches: true,
  mergeScalarEnums: true,
  maxMergedEnumValues: 1024,
  maxDepth: 64,
};

export interface SchemaLocation {
  /** Tool name as the client sent it. */
  tool: string;
  /** JSON pointer-ish path, e.g. `$.parameters.properties.op.anyOf` */
  path: string;
}

export interface SchemaDiagnostic extends SchemaLocation {
  code:
    | "anyOf_branch_limit"
    | "oneOf_branch_limit"
    | "schema_too_deep"
    | "invalid_tool_schema"
    | "unsupported_keyword"
    | "unresolved_ref"
    | "tool_limit_exceeded";
  message: string;
  branchCount?: number;
  limit?: number;
  hint?: string;
}

/** Thrown when a schema cannot be normalized without losing validation semantics. */
export class SchemaCompatibilityError extends Error {
  readonly diagnostic: SchemaDiagnostic;

  constructor(diagnostic: SchemaDiagnostic) {
    super(
      `tool "${diagnostic.tool}" at ${diagnostic.path}: ${diagnostic.message}` +
        (diagnostic.hint ? ` — ${diagnostic.hint}` : ""),
    );
    this.name = "SchemaCompatibilityError";
    this.diagnostic = diagnostic;
  }
}

export interface ToolSchemaInput {
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
  input_schema?: unknown;
  [key: string]: unknown;
}

export interface ToolNormalizeReport {
  tool: string;
  changed: boolean;
  actions: string[];
  maxAnyOfBefore: number;
  maxAnyOfAfter: number;
  branchesBefore: number;
  branchesAfter: number;
}

export interface NormalizedToolsResult<T extends ToolSchemaInput> {
  tools: T[];
  reports: ToolNormalizeReport[];
  changed: boolean;
}
