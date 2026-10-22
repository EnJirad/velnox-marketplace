/**
 * Restored shopper features — favourites, reviews, profile, Google identity.
 *
 * Real routes, real PostgreSQL, no mocks: the unique constraints, the derived
 * verified-purchase flag and the ownership rules are only provable that way.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import { resolveGoogleUser, verifyGoogleIdToken } from "../oauth.js";
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

/** A signed Google ID token + the JWKS that verifies it (no network). */
function googleFixture(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const kid = `kid-${crypto.randomUUID().slice(0, 8)}`;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      sub: `google-${crypto.randomUUID()}`,
      email: `google-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
      email_verified: true,
      name: "Google Shopper",
      picture: "https://example.invalid/avatar.png",
      exp: Math.floor(Date.now() / 1000) + 600,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey)
    .toString("base64url");
  return {
    token: `${header}.${payload}.${signature}`,
    keys: [{ ...jwk, kid }],
    clientId: "test-client-id",
  };
}

describe("Google ID token verification (offline, real RSA keypair)", () => {
  test("accepts a correctly signed token", async () => {
    const fixture = googleFixture();
    const claims = await verifyGoogleIdToken(fixture.token, {
      clientId: fixture.clientId,
      keys: fixture.keys,
    });
    expect(claims.email_verified).toBe(true);
    expect(claims.name).toBe("Google Shopper");
  });

  test("refuses a wrong audience, an expired token and a tampered signature", async () => {
    const wrongAudience = googleFixture({ aud: "someone-else" });
    await expect(
      verifyGoogleIdToken(wrongAudience.token, {
        clientId: wrongAudience.clientId,
        keys: wrongAudience.keys,
      }),
    ).rejects.toThrow();

    const expired = googleFixture({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(
      verifyGoogleIdToken(expired.token, { clientId: expired.clientId, keys: expired.keys }),
    ).rejects.toThrow();

    const tampered = googleFixture();
    const parts = tampered.token.split(".");
    const forgedSignature = `${parts[0]}.${parts[1]}.${Buffer.from("nope").toString("base64url")}`;
    await expect(
      verifyGoogleIdToken(forgedSignature, { clientId: tampered.clientId, keys: tampered.keys }),
    ).rejects.toThrow();
  });

  test("refuses an unverified email", async () => {
    const unverified = googleFixture({ email_verified: false });
    await expect(
      verifyGoogleIdToken(unverified.token, {
        clientId: unverified.clientId,
        keys: unverified.keys,
      }),
    ).rejects.toThrow();
  });
});

describe("restored shopper features (needs a test database)", () => {
  let app: TestApp;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── Favourites ───────────────────────────────────────────────────────────
  itDb("favourites: add twice stores one row, list joins the product, remove clears it", async () => {
    const admin = await createUser({ role: "admin" });
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id);
    const buyer = await createUser();

    const anonymous = await api(app.base, "/api/mvp/favorites");
    expect(anonymous.status).toBe(401);

    const first = await api(app.base, `/api/mvp/favorites/${product.id}`, {
      method: "POST",
      cookie: buyer.cookie,
    });
    expect(first.status).toBe(201);
    expect(first.body.data.favorited).toBe(true);

    const second = await api(app.base, `/api/mvp/favorites/${product.id}`, {
      method: "POST",
      cookie: buyer.cookie,
    });
    expect(second.status).toBe(201);

    const rows = await query(`SELECT COUNT(*)::int AS count FROM product_favorites WHERE user_id = $1`, [
      buyer.id,
    ]);
    expect((rows.rows[0] as { count: number }).count).toBe(1);

    const ids = await api(app.base, "/api/mvp/favorites/ids", { cookie: buyer.cookie });
    expect(ids.status).toBe(200);
    expect(ids.body.data.productIds).toContain(product.id);

    const list = await api(app.base, "/api/mvp/favorites", { cookie: buyer.cookie });
    expect(list.status).toBe(200);
    expect(list.body.data.favorites).toHaveLength(1);
    expect(list.body.data.favorites[0].product.name).toBeTruthy();
    expect(list.body.data.favorites[0].product.slug).toBe(product.slug);

    const removed = await api(app.base, `/api/mvp/favorites/${product.id}`, {
      method: "DELETE",
      cookie: buyer.cookie,
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data.favorited).toBe(false);

    const after = await api(app.base, "/api/mvp/favorites", { cookie: buyer.cookie });
    expect(after.body.data.favorites).toHaveLength(0);
  });

  itDb("favourites: a draft product cannot be favourited", async () => {
    const seller = await createSeller();
    const created = await query(
      `INSERT INTO products (seller_id, name, slug, price, status)
       VALUES ($1, 'Draft', $2, 10.00, 'draft') RETURNING id`,
      [seller.id, `draft-${crypto.randomUUID().slice(0, 8)}`],
    );
    const draftId = (created.rows[0] as { id: string }).id;
    const buyer = await createUser();
    const res = await api(app.base, `/api/mvp/favorites/${draftId}`, {
      method: "POST",
      cookie: buyer.cookie,
    });
    expect(res.status).toBe(404);
  });

  // ── Reviews ──────────────────────────────────────────────────────────────
  itDb("reviews: one row per shopper, summary is computed, only the author deletes", async () => {
    const admin = await createUser({ role: "admin" });
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id);
    const author = await createUser();
    const other = await createUser();

    const anonymous = await api(app.base, `/api/mvp/products/${product.slug}/reviews`, {
      method: "POST",
      body: { rating: 5, comment: "nice" },
    });
    expect(anonymous.status).toBe(401);

    const created = await api(app.base, `/api/mvp/products/${product.slug}/reviews`, {
      method: "POST",
      cookie: author.cookie,
      body: { rating: 4, comment: "Solid product" },
    });
    expect(created.status).toBe(201);

    // A second submission from the same shopper edits the same row.
    const edited = await api(app.base, `/api/mvp/products/${product.slug}/reviews`, {
      method: "POST",
      cookie: author.cookie,
      body: { rating: 5, comment: "Even better on day two" },
    });
    expect(edited.status).toBe(201);

    const rows = await query(
      `SELECT COUNT(*)::int AS count FROM product_reviews WHERE product_id = $1`,
      [product.id],
    );
    expect((rows.rows[0] as { count: number }).count).toBe(1);

    const listed = await api(app.base, `/api/mvp/products/${product.slug}/reviews`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.reviews).toHaveLength(1);
    expect(listed.body.data.reviews[0].comment).toBe("Even better on day two");
    expect(listed.body.data.summary.count).toBe(1);
    expect(listed.body.data.summary.average).toBe(5);
    expect(listed.body.data.reviews[0].verifiedPurchase).toBe(false);

    const mine = await api(app.base, `/api/mvp/products/${product.slug}/reviews/me`, {
      cookie: author.cookie,
    });
    expect(mine.status).toBe(200);
    expect(mine.body.data.review.rating).toBe(5);

    const reviewId = mine.body.data.review.id;
    const foreignDelete = await api(app.base, `/api/mvp/reviews/${reviewId}`, {
      method: "DELETE",
      cookie: other.cookie,
    });
    expect(foreignDelete.status).toBe(403);

    const ownDelete = await api(app.base, `/api/mvp/reviews/${reviewId}`, {
      method: "DELETE",
      cookie: author.cookie,
    });
    expect(ownDelete.status).toBe(200);

    const empty = await api(app.base, `/api/mvp/products/${product.slug}/reviews`);
    expect(empty.body.data.reviews).toHaveLength(0);
    expect(empty.body.data.summary.count).toBe(0);
  });

  itDb("reviews: the catalogue exposes the computed rating", async () => {
    const admin = await createUser({ role: "admin" });
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id);
    const reviewer = await createUser();
    await api(app.base, `/api/mvp/products/${product.slug}/reviews`, {
      method: "POST",
      cookie: reviewer.cookie,
      body: { rating: 3, comment: "It is fine" },
    });

    const detail = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(detail.body.data.product.reviewCount).toBe(1);
    expect(Number(detail.body.data.product.rating)).toBe(3);

    const list = await api(app.base, `/api/mvp/products?limit=50`);
    const found = (list.body.data.products as Array<{ id: string; reviewCount: number }>).find(
      (p) => p.id === product.id,
    );
    expect(found?.reviewCount).toBe(1);
  });

  // ── Profile ──────────────────────────────────────────────────────────────
  itDb("profile: reads and updates the caller's own name and phone", async () => {
    const user = await createUser();
    const read = await api(app.base, "/api/mvp/profile", { cookie: user.cookie });
    expect(read.status).toBe(200);
    expect(read.body.data.profile.email).toBe(user.email);

    const updated = await api(app.base, "/api/mvp/profile", {
      method: "PATCH",
      cookie: user.cookie,
      body: { name: "Updated Name", phone: "0812345678" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.profile.name).toBe("Updated Name");
    expect(updated.body.data.profile.phone).toBe("0812345678");

    const me = await api(app.base, "/api/mvp/auth/me", { cookie: user.cookie });
    expect(me.body.data.user.name).toBe("Updated Name");
    expect(me.body.data.user.phone).toBe("0812345678");
  });

  itDb("profile: avatar presign fails closed when storage is not configured", async () => {
    const user = await createUser();
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
      const res = await api(app.base, "/api/mvp/profile/avatar/presign", {
        method: "POST",
        cookie: user.cookie,
        body: { contentType: "image/png", size: 1024 },
      });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("UPLOAD_NOT_CONFIGURED");
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

  // ── Google identity resolution ───────────────────────────────────────────
  itDb("Google: creates one account, then resolves the same identity to it", async () => {
    const email = `g-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const sub = `google-${crypto.randomUUID()}`;
    const first = await resolveGoogleUser({ sub, email, name: "G Shopper", picture: "" });
    expect(first.created).toBe(true);
    expect(first.status).toBe("active");

    const second = await resolveGoogleUser({ sub, email, name: "G Shopper", picture: "" });
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);

    const count = await query(`SELECT COUNT(*)::int AS count FROM users WHERE lower(email) = $1`, [
      email,
    ]);
    expect((count.rows[0] as { count: number }).count).toBe(1);
  });

  itDb("Google: links to an existing password account with the same email", async () => {
    const user = await createUser();
    const resolved = await resolveGoogleUser({
      sub: `google-${crypto.randomUUID()}`,
      email: user.email.toUpperCase(),
      name: "",
      picture: "",
    });
    expect(resolved.linked).toBe(true);
    expect(resolved.userId).toBe(user.id);
    // A display name the shopper set is never overwritten by an empty claim.
    const row = await query(`SELECT name FROM users WHERE id = $1`, [user.id]);
    expect((row.rows[0] as { name: string }).name).toBe("MVP Test User");
  });

  itDb("Google: the start route fails closed when the client is not configured", async () => {
    const saved = {
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect: process.env.GOOGLE_REDIRECT_URI,
    };
    try {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_REDIRECT_URI;
      const providers = await api(app.base, "/api/mvp/auth/providers");
      expect(providers.status).toBe(200);
      expect(providers.body.data.providers.google.enabled).toBe(false);

      const start = await api(app.base, "/api/mvp/auth/google/start");
      expect(start.status).toBe(503);
      expect(start.body.error.code).toBe("GOOGLE_NOT_CONFIGURED");
    } finally {
      if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = saved.id;
      if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = saved.secret;
      if (saved.redirect === undefined) delete process.env.GOOGLE_REDIRECT_URI;
      else process.env.GOOGLE_REDIRECT_URI = saved.redirect;
    }
  });
});
