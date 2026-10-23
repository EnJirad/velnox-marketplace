/**
 * MVP address book.
 *
 * The original shopper experience kept a saved address list, chose one at
 * checkout, and required a map-picked GPS position on the default address so a
 * courier could find it. That behaviour is restored here against the canonical
 * `addresses` table.
 *
 * Write rules:
 *   • every row is scoped to the session's user id — no user id is ever read
 *     from the body or the path, so one account cannot read or mutate another's
 *     addresses;
 *   • a default address must carry a confirmed coordinate pair (the schema also
 *     enforces that latitude and longitude are both set or both absent);
 *   • promoting a default demotes the previous one in the same transaction, so
 *     the partial unique index on `(user_id) WHERE is_default` is never violated.
 *
 * `orders.shipping_address` stores an immutable snapshot taken at checkout, so
 * editing or deleting an address can never rewrite a placed order.
 */
import type { Express, Request, Response } from "express";
import { query, withTransaction } from "../db/index.js";
import {
  ApiError,
  badRequest,
  ok,
  optionalString,
  pathUuid,
  requireActiveUser,
  requireString,
  route,
} from "./http.js";

interface AddressRow {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  subdistrict: string | null;
  district: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  latitude: string | null;
  longitude: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface AddressPayload {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subdistrict: string | null;
  district: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: string | null;
  longitude: string | null;
  isDefault: boolean;
}

function addressPayload(row: AddressRow) {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    subdistrict: row.subdistrict,
    district: row.district,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, label, recipient_name, phone, line1, line2, subdistrict, district,
              city, state, postal_code, country, latitude, longitude, is_default,
              created_at, updated_at`;

/**
 * Render a coordinate as the 6-decimal text `NUMERIC(9,6)` holds.
 *
 * Integer arithmetic, not `toFixed` and not a float format: the MVP tree forbids
 * float formatting so a NUMERIC column can never round-trip through IEEE-754
 * (asserted by `tests/isolation.test.ts`).
 */
function formatCoordinate(n: number): string {
  const scaled = Math.round(n * 1_000_000);
  const sign = scaled < 0 ? "-" : "";
  const magnitude = Math.abs(scaled);
  const whole = Math.trunc(magnitude / 1_000_000);
  const fraction = String(magnitude % 1_000_000).padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}

/**
 * A coordinate is accepted as a JSON number or a decimal string, then stored as
 * the 6-decimal text `NUMERIC(9,6)` holds. `NaN`, `Infinity` and out-of-range
 * values are refused rather than clamped.
 */
function optionalCoordinate(
  value: unknown,
  field: "latitude" | "longitude",
  limit: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw badRequest("INVALID_INPUT", `${field} must be a number`);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw badRequest("INVALID_INPUT", `${field} must be a finite number`);
  if (n < -limit || n > limit) {
    throw badRequest("INVALID_INPUT", `${field} must be between -${limit} and ${limit}`);
  }
  return formatCoordinate(n);
}

export function parseAddressPayload(input: unknown): AddressPayload {
  if (typeof input !== "object" || input === null) {
    throw badRequest("INVALID_INPUT", "An address body is required");
  }
  const body = input as Record<string, unknown>;
  const country = (optionalString(body.country, "country", { max: 2 }) ?? "TH").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw badRequest("INVALID_INPUT", "country must be a 2-letter ISO code");
  }

  const latitude = optionalCoordinate(body.latitude, "latitude", 90);
  const longitude = optionalCoordinate(body.longitude, "longitude", 180);
  if ((latitude === null) !== (longitude === null)) {
    throw badRequest("INVALID_COORDINATES", "latitude and longitude must be provided together");
  }

  const isDefault = body.isDefault === true;
  // The legacy rule, kept: a default address is the one a courier is sent to,
  // and it cannot be saved without a map-picked position.
  if (isDefault && latitude === null) {
    throw badRequest(
      "GPS_REQUIRED",
      "A default address needs GPS coordinates — pick a location on the map before saving",
    );
  }

  return {
    label: optionalString(body.label, "label", { max: 60 }) ?? "Home",
    recipientName: requireString(body.recipientName, "recipientName", { max: 120 }),
    phone: requireString(body.phone, "phone", { max: 40 }),
    line1: requireString(body.line1, "line1", { max: 200 }),
    line2: optionalString(body.line2, "line2", { max: 200 }),
    subdistrict: optionalString(body.subdistrict, "subdistrict", { max: 120 }),
    district: optionalString(body.district, "district", { max: 120 }),
    city: requireString(body.city, "city", { max: 120 }),
    state: requireString(body.state, "state", { max: 120 }),
    postalCode: requireString(body.postalCode, "postalCode", { max: 20 }),
    country,
    latitude,
    longitude,
    isDefault,
  };
}

async function loadOwnedAddress(userId: string, addressId: string): Promise<AddressRow> {
  const result = await query(
    `SELECT ${SELECT_COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`,
    [addressId, userId],
  );
  const row = result.rows[0] as AddressRow | undefined;
  if (!row) throw new ApiError(404, "ADDRESS_NOT_FOUND", "Address not found");
  return row;
}

export function setupMvpAddressRoutes(app: Express): void {
  // ── List own addresses (default first) ───────────────────────────────────
  app.get(
    "/api/mvp/addresses",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const result = await query(
        `SELECT ${SELECT_COLUMNS}
           FROM addresses
          WHERE user_id = $1
          ORDER BY is_default DESC, created_at DESC`,
        [req.sessionUser!.id],
      );
      ok(res, { addresses: (result.rows as AddressRow[]).map(addressPayload) });
    }),
  );

  // ── Create ───────────────────────────────────────────────────────────────
  app.post(
    "/api/mvp/addresses",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const input = parseAddressPayload(req.body);

      const row = await withTransaction(async (client) => {
        if (input.isDefault) {
          await client.query(
            `UPDATE addresses SET is_default = FALSE, updated_at = NOW()
              WHERE user_id = $1 AND is_default`,
            [userId],
          );
        }
        const inserted = await client.query(
          `INSERT INTO addresses (
             user_id, label, recipient_name, phone, line1, line2, subdistrict,
             district, city, state, postal_code, country, latitude, longitude, is_default
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING ${SELECT_COLUMNS}`,
          [
            userId,
            input.label,
            input.recipientName,
            input.phone,
            input.line1,
            input.line2,
            input.subdistrict,
            input.district,
            input.city,
            input.state,
            input.postalCode,
            input.country,
            input.latitude,
            input.longitude,
            input.isDefault,
          ],
        );
        return inserted.rows[0] as AddressRow;
      });

      ok(res, { address: addressPayload(row) }, 201);
    }),
  );

  // ── Update (full form replace) ───────────────────────────────────────────
  app.patch(
    "/api/mvp/addresses/:id",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const addressId = pathUuid(req.params.id);
      await loadOwnedAddress(userId, addressId);
      const input = parseAddressPayload(req.body);

      const row = await withTransaction(async (client) => {
        if (input.isDefault) {
          await client.query(
            `UPDATE addresses SET is_default = FALSE, updated_at = NOW()
              WHERE user_id = $1 AND is_default AND id <> $2`,
            [userId, addressId],
          );
        }
        const updated = await client.query(
          `UPDATE addresses SET
             label = $1, recipient_name = $2, phone = $3, line1 = $4, line2 = $5,
             subdistrict = $6, district = $7, city = $8, state = $9, postal_code = $10,
             country = $11, latitude = $12, longitude = $13, is_default = $14,
             updated_at = NOW()
           WHERE id = $15 AND user_id = $16
           RETURNING ${SELECT_COLUMNS}`,
          [
            input.label,
            input.recipientName,
            input.phone,
            input.line1,
            input.line2,
            input.subdistrict,
            input.district,
            input.city,
            input.state,
            input.postalCode,
            input.country,
            input.latitude,
            input.longitude,
            input.isDefault,
            addressId,
            userId,
          ],
        );
        return updated.rows[0] as AddressRow;
      });

      ok(res, { address: addressPayload(row) });
    }),
  );

  // ── Promote to default ───────────────────────────────────────────────────
  app.post(
    "/api/mvp/addresses/:id/default",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const addressId = pathUuid(req.params.id);
      const existing = await loadOwnedAddress(userId, addressId);
      if (existing.latitude === null || existing.longitude === null) {
        throw badRequest(
          "GPS_REQUIRED",
          "This address has no GPS coordinates — pick a location on the map before setting it as default",
        );
      }

      const row = await withTransaction(async (client) => {
        await client.query(
          `UPDATE addresses SET is_default = FALSE, updated_at = NOW()
            WHERE user_id = $1 AND is_default AND id <> $2`,
          [userId, addressId],
        );
        const updated = await client.query(
          `UPDATE addresses SET is_default = TRUE, updated_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING ${SELECT_COLUMNS}`,
          [addressId, userId],
        );
        return updated.rows[0] as AddressRow;
      });

      ok(res, { address: addressPayload(row) });
    }),
  );

  // ── Delete ───────────────────────────────────────────────────────────────
  app.delete(
    "/api/mvp/addresses/:id",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const addressId = pathUuid(req.params.id);
      const deleted = await query(
        `DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING id`,
        [addressId, req.sessionUser!.id],
      );
      if (!deleted.rows[0]) throw new ApiError(404, "ADDRESS_NOT_FOUND", "Address not found");
      ok(res, { deleted: true });
    }),
  );
}
