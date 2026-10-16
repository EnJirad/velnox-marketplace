/**
 * Velnox — store accounts (the wholesale buyer track).
 *
 * THE ONE RULE, in one place
 * --------------------------
 *   Wholesale visibility is granted by `store_accounts.status = 'approved'`
 *   and by nothing else.
 *
 * A "store account" is a BUYER-side concept: a community shop that applied once
 * and was reviewed by VelCenter so it can order wholesale by the pack. It is not
 * a seller, not a role on `users.role`, and it grants nothing except seeing and
 * ordering selling units the seller marked `is_wholesale`.
 *
 * WHY IT IS NOT A ROLE
 *   `users.role` decides which APP you are in (customer / seller / center). A
 *   wholesale buyer is still an ordinary customer of the storefront; the account
 *   only widens what the catalog and the cart will hand them. Writing a role
 *   would also mean rewriting the session, the profile and every role-guarded
 *   route for a flag that must only ever affect one thing.
 *
 * FAIL CLOSED
 *   An unknown, pending or rejected account is never an approved store: a
 *   missing row, a malformed id, a database error or a database that has not run
 *   migration 059 all resolve to `false`. If the wholesale gate cannot be
 *   evaluated, the wholesale rows stay hidden rather than being handed out —
 *   a private price must never leak because a lookup failed.
 *
 * ONE AUTHORITY
 *   Every gate (`resolveSellingUnit`, `loadSellingUnits`, the catalog, the cart,
 *   checkout and reorder) asks this module. Nothing else may read
 *   `store_accounts` to decide visibility, or two surfaces could disagree about
 *   who a wholesale price belongs to.
 */
import type { SqlExecutor } from "./selling-units.js";

/** The review vocabulary, mirrored by the `store_accounts_status_check` CHECK. */
export const STORE_ACCOUNT_STATUSES = ["pending", "approved", "rejected"] as const;
export type StoreAccountStatus = (typeof STORE_ACCOUNT_STATUSES)[number];

/**
 * Is this a `users.id` at all?
 *
 * `store_accounts.user_id` is a UUID column, so a session id of any other shape
 * (a stale cookie, a test token, a hand-crafted payload) makes PostgreSQL raise
 * 22P02 — which would turn "this caller has no store account" into a 500. The
 * gate must be TOTAL: an id that cannot own a row is simply not an approved
 * store, and the wholesale rows stay hidden. Failing closed is the only safe
 * direction for a price gate.
 */
function isUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export interface FormattedStoreAccount {
  id: string;
  userId: string;
  storeName: string;
  contactName: string;
  contactPhone: string;
  address: string | null;
  note: string | null;
  status: StoreAccountStatus;
  /** True only for `approved` — the single value that grants wholesale access. */
  approved: boolean;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** The public shape of a store account. Never leaks anything internal. */
export function formatStoreAccount(row: any): FormattedStoreAccount {
  const status = (STORE_ACCOUNT_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as StoreAccountStatus)
    : "pending";
  return {
    id: row.id,
    userId: row.user_id,
    storeName: row.store_name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    address: row.address ?? null,
    note: row.note ?? null,
    status,
    approved: status === "approved",
    reviewNote: row.review_note ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Is this user an APPROVED store?
 *
 * The single gate for wholesale. Anonymous (`null` / `undefined`) is never
 * approved, so a public catalog request is gated by construction rather than by
 * the caller remembering to check.
 */
export async function isApprovedStore(
  exec: SqlExecutor,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!isUserId(userId)) return false;
  try {
    const res = await exec(
      `SELECT 1 FROM store_accounts WHERE user_id = $1 AND status = 'approved' LIMIT 1`,
      [userId],
    );
    return res.rows.length > 0;
  } catch (err: any) {
    // 42P01 = the table does not exist yet (migration 059 has not run). Nobody is
    // an approved store on such a database, and the wholesale units stay hidden —
    // the fail-closed direction.
    if (err?.code === "42P01") {
      console.warn("[store-accounts] store_accounts table not found — no wholesale access is granted");
      return false;
    }
    throw err;
  }
}

/** The caller's own account row (any status), or null when they never applied. */
export async function getStoreAccount(
  exec: SqlExecutor,
  userId: string,
): Promise<FormattedStoreAccount | null> {
  // Same totality rule as `isApprovedStore`: an id that cannot own a row has no
  // account, and asking the database about it would only produce a 500.
  if (!isUserId(userId)) return null;
  try {
    const res = await exec(
      `SELECT id, user_id, store_name, contact_name, contact_phone, address, note, status,
              review_note, reviewed_by, reviewed_at, created_at, updated_at
         FROM store_accounts WHERE user_id = $1`,
      [userId],
    );
    return res.rows[0] ? formatStoreAccount(res.rows[0]) : null;
  } catch (err: any) {
    if (err?.code === "42P01") return null;
    throw err;
  }
}

export interface StoreApplicationInput {
  storeName?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  address?: unknown;
  note?: unknown;
}

export type StoreApplicationValidation =
  | { ok: true; values: { storeName: string; contactName: string; contactPhone: string; address: string | null; note: string | null } }
  | { ok: false; message: string };

/** Trimmed optional text: an absent/blank field is stored as NULL, never "". */
function optionalText(value: unknown, max: number, label: string): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, message: `${label} must be text` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false, message: `${label} must be ${max} characters or fewer` };
  return { ok: true, value: trimmed };
}

/**
 * Validate a store application. Enforced on the SERVER only: the form validates
 * the same rules for an immediate message, but a crafted body still meets this.
 *
 * `store_name`, `contact_name` and `contact_phone` are required — a reviewer
 * cannot verify a shop with no name and nobody to call, and refusing at the
 * boundary is cheaper than a queue full of unreviewable rows.
 */
export function validateStoreApplication(body: StoreApplicationInput): StoreApplicationValidation {
  const required = (value: unknown, max: number, label: string): { ok: true; value: string } | { ok: false; message: string } => {
    if (typeof value !== "string" || !value.trim()) return { ok: false, message: `${label} is required` };
    const trimmed = value.trim();
    if (trimmed.length > max) return { ok: false, message: `${label} must be ${max} characters or fewer` };
    return { ok: true, value: trimmed };
  };

  const storeName = required(body.storeName, 120, "storeName");
  if (!storeName.ok) return { ok: false, message: storeName.message };
  const contactName = required(body.contactName, 120, "contactName");
  if (!contactName.ok) return { ok: false, message: contactName.message };
  const contactPhone = required(body.contactPhone, 40, "contactPhone");
  if (!contactPhone.ok) return { ok: false, message: contactPhone.message };

  const address = optionalText(body.address, 400, "address");
  if (!address.ok) return { ok: false, message: address.message };
  const note = optionalText(body.note, 400, "note");
  if (!note.ok) return { ok: false, message: note.message };

  return {
    ok: true,
    values: {
      storeName: storeName.value,
      contactName: contactName.value,
      contactPhone: contactPhone.value,
      address: address.value,
      note: note.value,
    },
  };
}
