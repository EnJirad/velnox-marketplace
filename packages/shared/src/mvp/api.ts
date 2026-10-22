/**
 * Typed MVP endpoints.
 *
 * One function per backend route (`backend/mvp/index.ts` owns the inventory).
 * Nothing here computes a price, a stock level, a payment result or an order
 * status: every value that matters is returned by the server, and the UI only
 * renders it. That is deliberate — the Phase 3 backend re-reads prices, stock and
 * seller approval inside the checkout transaction, so a browser-side calculation
 * would be a lie waiting to happen.
 */
import { createMvpHttp, createMvpHttpFromEnv, type MvpHttp } from "./client.js";
import { MVP_ROUTES as R } from "./routes.js";
import type {
  MvpAdminCategoryRow,
  MvpAdminMetrics,
  MvpAdminProductRow,
  MvpAdminSellerRow,
  MvpAuthProviders,
  MvpAvatarPresign,
  MvpCart,
  MvpCartResponse,
  MvpCategory,
  MvpCreateProductInput,
  MvpFavorite,
  MvpOrderDetail,
  MvpOrderStatus,
  MvpOrderSummary,
  MvpPagination,
  MvpPaymentSession,
  MvpPaymentStatus,
  MvpPaymentsConfig,
  MvpProductDetail,
  MvpProductQuery,
  MvpProductSummary,
  MvpProfile,
  MvpReviewPage,
  MvpSellerOrderRow,
  MvpSellerProduct,
  MvpSellerProfile,
  MvpSellerStatusResponse,
  MvpSellingUnitInput,
  MvpShippingAddress,
  MvpUser,
  MvpViewerReview,
} from "./types.js";

function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface MvpSellerSession {
  user: MvpUser;
  seller: { id: string; status: string; storeName: string; slug: string } | null;
}

export interface MvpCheckoutInput {
  cartId?: string | null;
  sellerId?: string | null;
  requestKey: string;
  address: MvpShippingAddress;
  notes?: string | null;
}

export interface MvpApi {
  readonly http: MvpHttp;

  auth: {
    signup(input: { email: string; password: string; name?: string }): Promise<{ user: MvpUser }>;
    login(input: { email: string; password: string }): Promise<{ user: MvpUser }>;
    logout(): Promise<{ revoked: boolean }>;
    me(): Promise<MvpSellerSession>;
    providers(): Promise<MvpAuthProviders>;
  };

  profile: {
    get(): Promise<MvpProfile>;
    update(input: { name: string; phone?: string | null }): Promise<MvpProfile>;
    presignAvatar(input: { contentType: string; size: number }): Promise<MvpAvatarPresign>;
    confirmAvatar(objectKey: string): Promise<{ avatarUrl: string; objectKey: string }>;
    removeAvatar(): Promise<{ avatarUrl: null }>;
  };

  favorites: {
    list(): Promise<MvpFavorite[]>;
    ids(): Promise<string[]>;
    add(productId: string): Promise<{ favorited: boolean }>;
    remove(productId: string): Promise<{ favorited: boolean }>;
  };

  reviews: {
    list(slug: string, page?: number): Promise<MvpReviewPage>;
    mine(slug: string): Promise<MvpViewerReview>;
    submit(slug: string, input: { rating: number; comment: string }): Promise<{ id: string }>;
    update(reviewId: string, input: { rating: number; comment: string }): Promise<unknown>;
    remove(reviewId: string): Promise<{ deleted: boolean }>;
  };

  catalog: {
    categories(): Promise<MvpCategory[]>;
    products(query?: MvpProductQuery): Promise<{
      products: MvpProductSummary[];
      pagination: MvpPagination;
    }>;
    product(slug: string): Promise<MvpProductDetail>;
  };

  cart: {
    get(): Promise<MvpCartResponse>;
    addItem(input: {
      productId: string;
      variantId?: string | null;
      /** `null`/absent = the implicit base unit. */
      sellingUnitId?: string | null;
      quantity?: number;
    }): Promise<MvpCart | null>;
    updateItem(itemId: string, quantity: number): Promise<MvpCart | null>;
    removeItem(itemId: string): Promise<MvpCart | null>;
  };

  checkout: {
    create(input: MvpCheckoutInput): Promise<{ order: MvpOrderDetail; replayed: boolean }>;
  };

  orders: {
    list(): Promise<MvpOrderSummary[]>;
    get(orderId: string): Promise<MvpOrderDetail>;
    cancel(orderId: string): Promise<{ order: MvpOrderDetail; outcome: string }>;
    paymentStatus(orderId: string): Promise<MvpPaymentStatus>;
    createPaymentSession(
      orderId: string,
      method?: "CARD" | "PROMPTPAY",
    ): Promise<MvpPaymentSession>;
  };

  payments: {
    status(): Promise<MvpPaymentsConfig>;
  };

  seller: {
    apply(input: { storeName: string; description?: string }): Promise<{ seller: MvpSellerProfile }>;
    updateProfile(input: { storeName: string; description?: string | null }): Promise<{ seller: MvpSellerProfile }>;
    status(): Promise<MvpSellerStatusResponse>;
    products(status?: string): Promise<MvpSellerProduct[]>;
    product(productId: string): Promise<MvpSellerProduct>;
    createProduct(input: MvpCreateProductInput): Promise<MvpSellerProduct>;
    updateProduct(
      productId: string,
      input: Partial<MvpCreateProductInput> & { images?: Array<{ url: string; alt?: string }> },
    ): Promise<MvpSellerProduct>;
    submit(productId: string): Promise<MvpSellerProduct>;
    publish(productId: string): Promise<MvpSellerProduct>;
    addVariant(
      productId: string,
      input: { name: string; sku?: string | null; price: string; stock?: number },
    ): Promise<MvpSellerProduct>;
    updateVariant(
      productId: string,
      variantId: string,
      input: { name?: string; sku?: string | null; price?: string; status?: "active" | "inactive" },
    ): Promise<MvpSellerProduct>;
    addSellingUnit(productId: string, input: MvpSellingUnitInput): Promise<MvpSellerProduct>;
    updateSellingUnit(
      productId: string,
      unitId: string,
      input: Partial<Omit<MvpSellingUnitInput, "variantId">>,
    ): Promise<MvpSellerProduct>;
    setInventory(
      productId: string,
      input: { variantId?: string | null; quantity: number },
    ): Promise<MvpSellerProduct>;
    orders(status?: MvpOrderStatus): Promise<MvpSellerOrderRow[]>;
    updateOrderStatus(
      orderId: string,
      input: { status: "processing" | "shipped" | "delivered"; carrier?: string; trackingNumber?: string },
    ): Promise<Record<string, unknown>>;
  };

  admin: {
    sellers(query?: { status?: string; page?: number; limit?: number }): Promise<{
      sellers: MvpAdminSellerRow[];
      pagination: MvpPagination;
    }>;
    approveSeller(sellerId: string): Promise<Record<string, unknown>>;
    rejectSeller(sellerId: string, reason: string): Promise<Record<string, unknown>>;
    suspendSeller(sellerId: string, reason: string): Promise<Record<string, unknown>>;
    products(query?: { status?: string; page?: number; limit?: number }): Promise<{
      products: MvpAdminProductRow[];
      pagination: MvpPagination;
    }>;
    approveProduct(productId: string): Promise<Record<string, unknown>>;
    rejectProduct(productId: string, reason: string): Promise<Record<string, unknown>>;
    categories(): Promise<MvpAdminCategoryRow[]>;
    createCategory(input: {
      slug: string;
      name: string;
      names?: Record<string, string>;
      parentId?: string | null;
      sortOrder?: number;
      isActive?: boolean;
    }): Promise<Record<string, unknown>>;
    updateCategory(
      categoryId: string,
      input: {
        name?: string;
        names?: Record<string, string>;
        parentId?: string | null;
        sortOrder?: number;
        isActive?: boolean;
      },
    ): Promise<Record<string, unknown>>;
    deleteCategory(categoryId: string): Promise<{ deleted: boolean }>;
    metrics(): Promise<MvpAdminMetrics>;
    expireOrders(limit?: number): Promise<{ expired: number }>;
  };
}

export function createMvpApi(http: MvpHttp): MvpApi {
  return {
    http,

    auth: {
      signup: (input) =>
        http.request<{ user: MvpUser }>(R.auth.signup, { method: "POST", body: input }),
      login: (input) =>
        http.request<{ user: MvpUser }>(R.auth.login, { method: "POST", body: input }),
      logout: () => http.request<{ revoked: boolean }>(R.auth.logout, { method: "POST" }),
      me: () => http.request<MvpSellerSession>(R.auth.me),
      providers: async () => {
        const data = await http.request<{ providers: MvpAuthProviders }>(R.auth.providers);
        return data.providers;
      },
    },

    profile: {
      get: async () => {
        const data = await http.request<{ profile: MvpProfile }>(R.profile.root);
        return data.profile;
      },
      update: async (input) => {
        const data = await http.request<{ profile: MvpProfile }>(R.profile.root, {
          method: "PATCH",
          body: { name: input.name, phone: input.phone ?? null },
        });
        return data.profile;
      },
      presignAvatar: (input) =>
        http.request<MvpAvatarPresign>(R.profile.avatarPresign, { method: "POST", body: input }),
      confirmAvatar: (objectKey) =>
        http.request<{ avatarUrl: string; objectKey: string }>(R.profile.avatarConfirm, {
          method: "POST",
          body: { objectKey },
        }),
      removeAvatar: () =>
        http.request<{ avatarUrl: null }>(R.profile.avatar, { method: "DELETE" }),
    },

    favorites: {
      list: async () => {
        const data = await http.request<{ favorites: MvpFavorite[] }>(R.favorites.root);
        return data.favorites ?? [];
      },
      ids: async () => {
        const data = await http.request<{ productIds: string[] }>(R.favorites.ids);
        return data.productIds ?? [];
      },
      add: (productId) =>
        http.request<{ favorited: boolean }>(R.favorites.item(productId), { method: "POST" }),
      remove: (productId) =>
        http.request<{ favorited: boolean }>(R.favorites.item(productId), { method: "DELETE" }),
    },

    reviews: {
      list: (slug, page = 1) =>
        http.request<MvpReviewPage>(
          `${R.reviews.forProduct(slug)}${queryString({ page, limit: 5 })}`,
        ),
      mine: (slug) => http.request<MvpViewerReview>(R.reviews.mine(slug)),
      submit: async (slug, input) => {
        const data = await http.request<{ review: { id: string } }>(R.reviews.forProduct(slug), {
          method: "POST",
          body: input,
        });
        return data.review;
      },
      update: (reviewId, input) =>
        http.request<unknown>(R.reviews.review(reviewId), { method: "PATCH", body: input }),
      remove: (reviewId) =>
        http.request<{ deleted: boolean }>(R.reviews.review(reviewId), { method: "DELETE" }),
    },

    catalog: {
      categories: async () => {
        const data = await http.request<{ categories: MvpCategory[] }>(R.catalog.categories);
        return data.categories ?? [];
      },
      products: async (query = {}) => {
        const data = await http.request<{
          products: MvpProductSummary[];
          pagination: MvpPagination;
        }>(
          `${R.catalog.products}${queryString({
            page: query.page,
            limit: query.limit,
            category: query.category,
            q: query.q,
            seller: query.seller,
            sort: query.sort,
          })}`,
        );
        return { products: data.products ?? [], pagination: data.pagination };
      },
      product: async (slug) => {
        const data = await http.request<{ product: MvpProductDetail }>(R.catalog.product(slug));
        return data.product;
      },
    },

    cart: {
      get: () => http.request<MvpCartResponse>(R.cart.root),
      addItem: async (input) => {
        const data = await http.request<{ cart: MvpCart | null }>(R.cart.items, {
          method: "POST",
          body: {
            productId: input.productId,
            variantId: input.variantId ?? null,
            // Omitted, not `null`: the server reads an absent unit as the
            // implicit base unit (`cart.ts` treats undefined and null the same),
            // so declaring one only when the caller picked it keeps the request
            // to the fields it actually chose — never a price, never a stock.
            ...(input.sellingUnitId ? { sellingUnitId: input.sellingUnitId } : {}),
            quantity: input.quantity ?? 1,
          },
        });
        return data.cart ?? null;
      },
      updateItem: async (itemId, quantity) => {
        const data = await http.request<{ cart: MvpCart | null }>(R.cart.item(itemId), {
          method: "PATCH",
          body: { quantity },
        });
        return data.cart ?? null;
      },
      removeItem: async (itemId) => {
        const data = await http.request<{ cart: MvpCart | null }>(R.cart.item(itemId), {
          method: "DELETE",
        });
        return data.cart ?? null;
      },
    },

    checkout: {
      create: (input) =>
        http.request<{ order: MvpOrderDetail; replayed: boolean }>(R.checkout, {
          method: "POST",
          body: {
            cartId: input.cartId ?? null,
            sellerId: input.sellerId ?? null,
            requestKey: input.requestKey,
            address: input.address,
            notes: input.notes ?? null,
          },
        }),
    },

    orders: {
      list: async () => {
        const data = await http.request<{ orders: MvpOrderSummary[] }>(R.orders.root);
        return data.orders ?? [];
      },
      get: async (orderId) => {
        const data = await http.request<{ order: MvpOrderDetail }>(R.orders.order(orderId));
        return data.order;
      },
      cancel: (orderId) =>
        http.request<{ order: MvpOrderDetail; outcome: string }>(R.orders.cancel(orderId), {
          method: "POST",
        }),
      paymentStatus: (orderId) => http.request<MvpPaymentStatus>(R.orders.paymentStatus(orderId)),
      createPaymentSession: (orderId, method = "CARD") =>
        http.request<MvpPaymentSession>(R.orders.paymentSession(orderId), {
          method: "POST",
          body: { method },
        }),
    },

    payments: {
      status: () => http.request<MvpPaymentsConfig>(R.payments.status),
    },

    seller: {
      apply: (input) =>
        http.request<{ seller: MvpSellerProfile }>(R.seller.apply, { method: "POST", body: input }),
      updateProfile: (input) =>
        http.request<{ seller: MvpSellerProfile }>(R.seller.profile, {
          method: "PATCH",
          body: input,
        }),
      status: () => http.request<MvpSellerStatusResponse>(R.seller.status),
      products: async (status) => {
        const data = await http.request<{ products: MvpSellerProduct[] }>(
          `${R.seller.products}${queryString({ status })}`,
        );
        return data.products ?? [];
      },
      product: async (productId) => {
        const data = await http.request<{ product: MvpSellerProduct }>(R.seller.product(productId));
        return data.product;
      },
      createProduct: async (input) => {
        const data = await http.request<{ product: MvpSellerProduct }>(R.seller.products, {
          method: "POST",
          body: input,
        });
        return data.product;
      },
      updateProduct: async (productId, input) => {
        const data = await http.request<{ product: MvpSellerProduct }>(R.seller.product(productId), {
          method: "PATCH",
          body: input,
        });
        return data.product;
      },
      submit: async (productId) => {
        const data = await http.request<{ product: MvpSellerProduct }>(R.seller.submit(productId), {
          method: "POST",
        });
        return data.product;
      },
      publish: async (productId) => {
        const data = await http.request<{ product: MvpSellerProduct }>(
          R.seller.publish(productId),
          { method: "POST" },
        );
        return data.product;
      },
      addVariant: async (productId, input) => {
        const data = await http.request<{ product: MvpSellerProduct }>(
          R.seller.variants(productId),
          { method: "POST", body: input },
        );
        return data.product;
      },
      updateVariant: async (productId, variantId, input) => {
        const data = await http.request<{ product: MvpSellerProduct }>(
          R.seller.variant(productId, variantId),
          { method: "PATCH", body: input },
        );
        return data.product;
      },
      addSellingUnit: async (productId, input) => {
        const data = await http.request<{ product: MvpSellerProduct }>(
          R.seller.sellingUnits(productId),
          { method: "POST", body: input },
        );
        return data.product;
      },
      updateSellingUnit: async (productId, unitId, input) => {
        const data = await http.request<{ product: MvpSellerProduct }>(
          R.seller.sellingUnit(productId, unitId),
          { method: "PATCH", body: input },
        );
        return data.product;
      },
      setInventory: async (productId, input) => {
        const data = await http.request<{ product: MvpSellerProduct }>(
          R.seller.inventory(productId),
          {
            method: "PUT",
            body: { variantId: input.variantId ?? null, quantity: input.quantity },
          },
        );
        return data.product;
      },
      orders: async (status) => {
        const data = await http.request<{ orders: MvpSellerOrderRow[] }>(
          `${R.seller.orders}${queryString({ status })}`,
        );
        return data.orders ?? [];
      },
      updateOrderStatus: async (orderId, input) => {
        const data = await http.request<{ order: Record<string, unknown> }>(
          R.seller.orderStatus(orderId),
          { method: "PATCH", body: input },
        );
        return data.order ?? {};
      },
    },

    admin: {
      sellers: (query = {}) =>
        http.request<{ sellers: MvpAdminSellerRow[]; pagination: MvpPagination }>(
          `${R.admin.sellers}${queryString({
            status: query.status,
            page: query.page,
            limit: query.limit,
          })}`,
        ),
      approveSeller: (sellerId) =>
        http.request<Record<string, unknown>>(R.admin.approveSeller(sellerId), { method: "POST" }),
      rejectSeller: (sellerId, reason) =>
        http.request<Record<string, unknown>>(R.admin.rejectSeller(sellerId), {
          method: "POST",
          body: { reason },
        }),
      suspendSeller: (sellerId, reason) =>
        http.request<Record<string, unknown>>(R.admin.suspendSeller(sellerId), {
          method: "POST",
          body: { reason },
        }),
      products: (query = {}) =>
        http.request<{ products: MvpAdminProductRow[]; pagination: MvpPagination }>(
          `${R.admin.products}${queryString({
            status: query.status,
            page: query.page,
            limit: query.limit,
          })}`,
        ),
      approveProduct: (productId) =>
        http.request<Record<string, unknown>>(R.admin.approveProduct(productId), {
          method: "POST",
        }),
      rejectProduct: (productId, reason) =>
        http.request<Record<string, unknown>>(R.admin.rejectProduct(productId), {
          method: "POST",
          body: { reason },
        }),
      categories: async () => {
        const data = await http.request<{ categories: MvpAdminCategoryRow[] }>(R.admin.categories);
        return data.categories ?? [];
      },
      createCategory: (input) =>
        http.request<Record<string, unknown>>(R.admin.categories, { method: "POST", body: input }),
      updateCategory: (categoryId, input) =>
        http.request<Record<string, unknown>>(R.admin.category(categoryId), {
          method: "PATCH",
          body: input,
        }),
      deleteCategory: (categoryId) =>
        http.request<{ deleted: boolean }>(R.admin.category(categoryId), { method: "DELETE" }),
      metrics: async () => {
        const data = await http.request<{ metrics: MvpAdminMetrics }>(R.admin.metrics);
        return data.metrics ?? {};
      },
      expireOrders: (limit) =>
        http.request<{ expired: number }>(R.admin.expireOrders, {
          method: "POST",
          body: limit === undefined ? {} : { limit },
        }),
    },
  };
}

let singleton: MvpApi | null = null;

/** The MVP API bound to this build's resolved configuration (created once). */
export function getMvpApi(): MvpApi {
  if (!singleton) singleton = createMvpApi(createMvpHttpFromEnv());
  return singleton;
}

/** Test/staging seam: bind the API to an explicit HTTP client. */
export function setMvpApiForTests(api: MvpApi | null): void {
  singleton = api;
}

export { createMvpHttp };
