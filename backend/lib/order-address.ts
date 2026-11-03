/**
 * Order address snapshot — one reader for every order surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * `orders.shipping_address` is a JSONB column. The `pg` driver hands a JSONB
 * value back as an already-parsed JavaScript object, NOT a string. The two
 * copy-pasted readers in `routes/cart.ts` and `routes/seller-orders.ts` only
 * accepted a string (`typeof raw !== "string" → null`), so every order whose
 * address came back as an object produced `addressSnapshot: null`:
 *
 *   - the seller order detail rendered no address at all, and
 *   - the customer order detail lost the address too,
 *
 * while the recipient/phone fell back to the account row, which is why the
 * phone sometimes appeared and the address never did.
 *
 * The reader therefore accepts BOTH representations, and additionally maps the
 * legacy snake_case key set onto the canonical camelCase shape written by
 * `orderAddressSnapshot()` at checkout, so historical rows keep rendering.
 */

/** Canonical snapshot shape written by the checkout path. */
export interface OrderAddressSnapshot {
  label?: string | null;
  recipientName?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/** Legacy/alternate key names seen in older rows, mapped to canonical names. */
const LEGACY_KEYS: Record<string, keyof OrderAddressSnapshot> = {
  recipient_name: "recipientName",
  recipient: "recipientName",
  customer_name: "recipientName",
  customerName: "recipientName",
  tel: "phone",
  telephone: "phone",
  phone_number: "phone",
  address_line1: "line1",
  addressLine1: "line1",
  address: "line1",
  address_line2: "line2",
  addressLine2: "line2",
  sub_district: "subdistrict",
  tambon: "subdistrict",
  city: "subdistrict",
  amphoe: "district",
  amphur: "district",
  state: "province",
  postcode: "postalCode",
  postal_code: "postalCode",
  zip: "postalCode",
  zipCode: "postalCode",
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Parse the stored snapshot.
 *
 * Accepts the JSON-text form (older drivers/rows) and the already-parsed object
 * form (current `pg` + JSONB). Returns `null` only when there is genuinely no
 * address to show.
 */
export function parseShippingAddress(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      return asObject(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  return asObject(raw);
}

/**
 * Canonicalize a snapshot so consumers can rely on one key set.
 *
 * Canonical keys win; a legacy key only fills a field the canonical shape left
 * empty. Nothing is invented: absent fields stay absent.
 */
export function normalizeAddressSnapshot(raw: unknown): Record<string, unknown> | null {
  const parsed = parseShippingAddress(raw);
  if (!parsed) return null;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    out[key] = value;
  }

  for (const [legacy, canonical] of Object.entries(LEGACY_KEYS)) {
    const current = out[canonical];
    const hasCanonical =
      current !== undefined && !(typeof current === "string" && current.trim() === "");
    if (!hasCanonical && out[legacy] !== undefined) {
      out[canonical] = out[legacy];
    }
  }

  return out;
}

/** A non-empty trimmed string, or null. */
export function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The customer contact a SELLER sees for one order.
 *
 * The order's OWN snapshot (`recipientName` / `phone`) wins over the account
 * row: the seller ships to the details entered FOR THIS ORDER, so a later
 * profile edit must not rewrite history. Account values remain a fallback for
 * legacy orders written before the snapshot carried them.
 */
export function orderContact(
  address: Record<string, unknown> | null,
  account: { name?: string | null; phone?: string | null } | undefined,
): { name: string | null; phone: string | null } {
  return {
    name: textValue(address?.recipientName) ?? textValue(account?.name),
    phone: textValue(address?.phone) ?? textValue(account?.phone),
  };
}
