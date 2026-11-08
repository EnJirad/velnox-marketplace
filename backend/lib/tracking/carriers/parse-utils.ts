/**
 * Defensive JSON digging for carrier responses.
 *
 * Every carrier's exact response shape moves; these helpers search a parsed
 * JSON tree for the fields we need instead of trusting one path. When a field
 * cannot be found the helper returns null and the adapter reports
 * MALFORMED_RESPONSE — never a fabricated event.
 */
export function getPath(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) {
      // Allow numeric path segments through arrays.
      const idx = Number(key);
      if (Number.isInteger(idx) && idx >= 0 && idx < cur.length) cur = cur[idx];
      else return null;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  return cur;
}

/** First string found along any of the candidate paths. */
export function firstString(obj: unknown, ...paths: Array<string[]>): string | null {
  for (const p of paths) {
    const v = getPath(obj, ...p);
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** First datetime candidate found; tolerates the many carrier date formats. */
export function firstDate(obj: unknown, ...paths: Array<string[]>): Date | null {
  for (const p of paths) {
    const v = getPath(obj, ...p);
    if (v === null || v === undefined) continue;
    const d = v instanceof Date ? v : new Date(typeof v === "number" ? v : String(v));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Deep first-array search (bounded) so a renamed events container still works. */
export function firstArrayByKey(root: unknown, keys: string[], depth = 6): unknown[] | null {
  if (root === null || root === undefined || typeof root !== "object") return null;
  if (depth <= 0) return null;
  const visit = (node: unknown, d: number): unknown[] | null => {
    if (node === null || node === undefined) return null;
    if (Array.isArray(node)) {
      if (d < depth) {
        for (const item of node) {
          if (item && typeof item === "object") {
            const arr = visit(item, d + 1);
            if (arr) return arr;
          }
        }
      }
      return null;
    }
    if (typeof node !== "object") return null;
    const record = node as Record<string, unknown>;
    for (const key of keys) {
      const v = record[key];
      if (Array.isArray(v)) return v;
    }
    for (const value of Object.values(record)) {
      const arr = visit(value, d + 1);
      if (arr) return arr;
    }
    return null;
  };
  return visit(root, 0);
}
