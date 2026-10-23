/**
 * The restored address book — real routes, real PostgreSQL, no mocks.
 *
 * What only a database can prove here: one default per account (partial unique
 * index), the latitude/longitude pairing CHECK, and that every mutation is
 * scoped to the session's own user id.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import {
  api,
  createPublishedProduct,
  createSeller,
  createUser,
  startApp,
  type TestApp,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

const BANGKOK = { latitude: 13.756331, longitude: 100.501762 };

function addressBody(overrides: Record<string, unknown> = {}) {
  return {
    label: "Home",
    recipientName: "Somchai Jaidee",
    phone: "0812345678",
    line1: "12/34 Sukhumvit Rd.",
    subdistrict: "Khlong Toei",
    district: "Khlong Toei",
    city: "Bangkok",
    state: "Bangkok",
    postalCode: "10110",
    country: "TH",
    ...BANGKOK,
    ...overrides,
  };
}

describe("address book (needs a test database)", () => {
  let app: TestApp;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  itDb("requires a signed-in account", async () => {
    const anonymous = await api(app.base, "/api/mvp/addresses");
    expect(anonymous.status).toBe(401);

    const create = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      body: addressBody(),
    });
    expect(create.status).toBe(401);
  });

  itDb("creates, lists and deletes an owned address", async () => {
    const user = await createUser();

    const empty = await api(app.base, "/api/mvp/addresses", { cookie: user.cookie });
    expect(empty.status).toBe(200);
    expect(empty.body.data.addresses).toEqual([]);

    const created = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: user.cookie,
      body: addressBody(),
    });
    expect(created.status).toBe(201);
    const address = created.body.data.address;
    expect(address.recipientName).toBe("Somchai Jaidee");
    expect(address.city).toBe("Bangkok");
    expect(address.latitude).toBeCloseTo(BANGKOK.latitude, 5);
    expect(address.longitude).toBeCloseTo(BANGKOK.longitude, 5);
    expect(address.isDefault).toBe(false);

    const listed = await api(app.base, "/api/mvp/addresses", { cookie: user.cookie });
    expect(listed.body.data.addresses).toHaveLength(1);
    expect(listed.body.data.addresses[0].id).toBe(address.id);

    const removed = await api(app.base, `/api/mvp/addresses/${address.id}`, {
      method: "DELETE",
      cookie: user.cookie,
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data.deleted).toBe(true);

    const after = await api(app.base, "/api/mvp/addresses", { cookie: user.cookie });
    expect(after.body.data.addresses).toEqual([]);
  });

  itDb("refuses a default address without a map-picked position", async () => {
    const user = await createUser();
    const withoutGps = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: user.cookie,
      body: addressBody({ ...BANGKOK, latitude: null, longitude: null, isDefault: true }),
    });
    expect(withoutGps.status).toBe(400);
    expect(withoutGps.body.error.code).toBe("GPS_REQUIRED");
  });

  itDb("refuses half a coordinate pair and an out-of-range latitude", async () => {
    const user = await createUser();
    const half = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: user.cookie,
      body: addressBody({ longitude: null }),
    });
    expect(half.status).toBe(400);
    expect(half.body.error.code).toBe("INVALID_COORDINATES");

    const outOfRange = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: user.cookie,
      body: addressBody({ latitude: 91 }),
    });
    expect(outOfRange.status).toBe(400);
  });

  itDb("keeps ONE default per account when another address is promoted", async () => {
    const user = await createUser();
    const first = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: user.cookie,
      body: addressBody({ label: "Home", isDefault: true }),
    });
    expect(first.status).toBe(201);
    expect(first.body.data.address.isDefault).toBe(true);

    const second = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: user.cookie,
      body: addressBody({ label: "Work" }),
    });
    const secondId = second.body.data.address.id;

    const promoted = await api(app.base, `/api/mvp/addresses/${secondId}/default`, {
      method: "POST",
      cookie: user.cookie,
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.address.isDefault).toBe(true);

    const listed = await api(app.base, "/api/mvp/addresses", { cookie: user.cookie });
    const defaults = listed.body.data.addresses.filter(
      (a: { isDefault: boolean }) => a.isDefault,
    );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(secondId);

    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM addresses WHERE user_id = $1 AND is_default`,
      [user.id],
    );
    expect(rows.rows[0]!.count).toBe("1");
  });

  itDb("refuses to promote an address that has no GPS", async () => {
    const user = await createUser();
    const noGps = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: user.cookie,
      body: addressBody({ latitude: null, longitude: null }),
    });
    expect(noGps.status).toBe(201);

    const promoted = await api(
      app.base,
      `/api/mvp/addresses/${noGps.body.data.address.id}/default`,
      { method: "POST", cookie: user.cookie },
    );
    expect(promoted.status).toBe(400);
    expect(promoted.body.error.code).toBe("GPS_REQUIRED");
  });

  itDb("updates only the caller's own address", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const created = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: owner.cookie,
      body: addressBody(),
    });
    const id = created.body.data.address.id;

    const strangerPatch = await api(app.base, `/api/mvp/addresses/${id}`, {
      method: "PATCH",
      cookie: stranger.cookie,
      body: addressBody({ recipientName: "Hijacked" }),
    });
    expect(strangerPatch.status).toBe(404);

    const strangerDelete = await api(app.base, `/api/mvp/addresses/${id}`, {
      method: "DELETE",
      cookie: stranger.cookie,
    });
    expect(strangerDelete.status).toBe(404);

    const strangerDefault = await api(app.base, `/api/mvp/addresses/${id}/default`, {
      method: "POST",
      cookie: stranger.cookie,
    });
    expect(strangerDefault.status).toBe(404);

    const ownPatch = await api(app.base, `/api/mvp/addresses/${id}`, {
      method: "PATCH",
      cookie: owner.cookie,
      body: addressBody({ recipientName: "Updated Recipient", label: "Condo" }),
    });
    expect(ownPatch.status).toBe(200);
    expect(ownPatch.body.data.address.recipientName).toBe("Updated Recipient");
    expect(ownPatch.body.data.address.label).toBe("Condo");
  });

  itDb("carries the chosen address into the order and freezes it", async () => {
    const admin = await createUser({ role: "admin" });
    const seller = await createSeller({ approvedBy: admin.id });
    const product = await createPublishedProduct(seller.id, admin.id, {
      price: "10.00",
      stock: 3,
    });
    const buyer = await createUser();

    const created = await api(app.base, "/api/mvp/addresses", {
      method: "POST",
      cookie: buyer.cookie,
      body: addressBody({ isDefault: true, label: "Condo" }),
    });
    expect(created.status).toBe(201);
    const addressId = created.body.data.address.id;

    const added = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, quantity: 1 },
    });
    expect(added.status).toBe(201);
    const cartId = (await api(app.base, "/api/mvp/cart", { cookie: buyer.cookie })).body.data
      .carts[0].id;

    const placed = await api(app.base, "/api/mvp/checkout", {
      method: "POST",
      cookie: buyer.cookie,
      body: {
        cartId,
        sellerId: seller.id,
        requestKey: `addr-${addressId}`,
        addressId,
        notes: null,
      },
    });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order;
    expect(order.shippingAddress.recipientName).toBe("Somchai Jaidee");
    expect(order.shippingAddress.city).toBe("Bangkok");

    // Rewriting or deleting the saved address must not rewrite the placed order.
    await api(app.base, `/api/mvp/addresses/${addressId}`, {
      method: "PATCH",
      cookie: buyer.cookie,
      body: addressBody({ recipientName: "Someone Else", isDefault: true }),
    });
    await api(app.base, `/api/mvp/addresses/${addressId}`, {
      method: "DELETE",
      cookie: buyer.cookie,
    });

    const reread = await api(app.base, `/api/mvp/orders/${order.id}`, { cookie: buyer.cookie });
    expect(reread.status).toBe(200);
    expect(reread.body.data.order.shippingAddress.recipientName).toBe("Somchai Jaidee");
    expect(reread.body.data.order.shippingAddress.city).toBe("Bangkok");
  });

  itDb("exposes the cover slot on the profile and fails closed without storage", async () => {
    const user = await createUser();

    const profile = await api(app.base, "/api/mvp/profile", { cookie: user.cookie });
    expect(profile.status).toBe(200);
    expect(profile.body.data.profile.coverUrl).toBeNull();

    const saved = {
      id: process.env.R2_ACCOUNT_ID,
      key: process.env.R2_ACCESS_KEY_ID,
      secret: process.env.R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET,
    };
    try {
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_BUCKET;

      const presign = await api(app.base, "/api/mvp/profile/cover/presign", {
        method: "POST",
        cookie: user.cookie,
        body: { contentType: "image/png", size: 1024 },
      });
      expect(presign.status).toBe(503);
      expect(presign.body.error.code).toBe("UPLOAD_NOT_CONFIGURED");

      // Confirming an object outside the caller's own cover namespace is refused
      // before storage is ever contacted.
      const foreign = await api(app.base, "/api/mvp/profile/cover/confirm", {
        method: "POST",
        cookie: user.cookie,
        body: { objectKey: "profile/cover/00000000-0000-0000-0000-000000000000/x.png" },
      });
      expect(foreign.status).toBe(403);
      expect(foreign.body.error.code).toBe("OBJECT_NOT_OWNED");
    } finally {
      for (const [key, value] of [
        ["R2_ACCOUNT_ID", saved.id],
        ["R2_ACCESS_KEY_ID", saved.key],
        ["R2_SECRET_ACCESS_KEY", saved.secret],
        ["R2_BUCKET", saved.bucket],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
