/**
 * Variant ↔ option-value resolution for seller product creation.
 *
 * A variant is only usable on the storefront when `product_variant_values`
 * links it to the real `product_option_values` rows of its product. The
 * seller form therefore sends the exact option selection behind each variant
 * (`options: { [groupName]: valueText }`) and this module turns that into the
 * option_value UUIDs inserted in the same transaction.
 *
 * Rules:
 *  - Only selections that exist in the product's own option groups are kept.
 *  - Unresolved selections are reported (never silently dropped, never turned
 *    into a raw string that would later be cast to a UUID).
 *  - Legacy `value-{groupIndex}-{valueIndex}` keys stay supported for older
 *    clients, but a key is only used when it maps to a value created in this
 *    same transaction.
 */

/** Keep only plain non-empty `group name → option value` string pairs. */
export function normalizeVariantOptions(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    out[key.trim()] = value.trim();
  }
  return out;
}

export interface VariantOptionResolution {
  /** Real option_value UUIDs this variant maps to (deduplicated). */
  optionValueIds: string[];
  /** `group = value` pairs that do not exist in the product's option groups. */
  unresolved: string[];
}

/**
 * Resolve a variant's option selection to option_value UUIDs.
 *
 * @param variantOptions  normalized `{ groupName: valueText }` selection
 * @param valueIdsByName  `groupName → valueText → option_value UUID` (values
 *                        created for this product in the current transaction)
 * @param legacyValueKeys legacy `value-{g}-{v}` keys sent by older clients
 * @param legacyValueIdMap legacy `value-{g}-{v} → option_value UUID` map
 */
export function resolveVariantOptionValueIds(params: {
  variantOptions: Record<string, string>;
  valueIdsByName?: Record<string, Record<string, string>>;
  legacyValueKeys?: unknown;
  legacyValueIdMap?: Record<string, string>;
}): VariantOptionResolution {
  const { variantOptions, valueIdsByName = {}, legacyValueKeys, legacyValueIdMap = {} } = params;
  const ids = new Set<string>();
  const unresolved: string[] = [];

  for (const [groupName, valueText] of Object.entries(variantOptions)) {
    const valueId = valueIdsByName[groupName]?.[valueText];
    if (valueId) ids.add(valueId);
    else unresolved.push(`${groupName} = ${valueText}`);
  }

  if (Array.isArray(legacyValueKeys)) {
    for (const key of legacyValueKeys) {
      if (typeof key !== "string") continue;
      // Never trust an arbitrary string as an id — only keys that resolve to a
      // value created in this transaction are used.
      const valueId = legacyValueIdMap[key];
      if (valueId) ids.add(valueId);
    }
  }

  return { optionValueIds: [...ids], unresolved };
}

/** Build a `groupName → valueText → option_value UUID` lookup from inserted rows. */
export function buildOptionValueIndex(
  rows: Array<{ groupName: string; valueText: string; valueId: string }>,
): Record<string, Record<string, string>> {
  const index: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    if (!row?.groupName || !row?.valueText || !row?.valueId) continue;
    const byValue = index[row.groupName] ?? (index[row.groupName] = {});
    byValue[row.valueText] = row.valueId;
  }
  return index;
}
