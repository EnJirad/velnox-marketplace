/**
 * MVP API route constants — the single place the `/api/mvp` paths live.
 *
 * This is the only route table in the repository (the pre-MVP `lib/api-routes.ts`
 * was removed with its tree). Paths are relative to `/api/mvp`; callers append
 * them to `getApiMode().mvpBaseUrl`.
 */
export const MVP_ROUTES = {
  auth: {
    signup: "/auth/signup",
    login: "/auth/login",
    logout: "/auth/logout",
    me: "/auth/me",
    oauth: "/auth/oauth",
    providers: "/auth/providers",
    googleStart: "/auth/google/start",
    bootstrapOwner: "/auth/bootstrap-owner",
  },
  profile: {
    root: "/profile",
    avatar: "/profile/avatar",
    avatarPresign: "/profile/avatar/presign",
    avatarConfirm: "/profile/avatar/confirm",
    cover: "/profile/cover",
    coverPresign: "/profile/cover/presign",
    coverConfirm: "/profile/cover/confirm",
  },
  addresses: {
    root: "/addresses",
    address: (id: string) => `/addresses/${encodeURIComponent(id)}`,
    setDefault: (id: string) => `/addresses/${encodeURIComponent(id)}/default`,
  },
  favorites: {
    root: "/favorites",
    ids: "/favorites/ids",
    item: (productId: string) => `/favorites/${encodeURIComponent(productId)}`,
  },
  reviews: {
    forProduct: (slug: string) => `/products/${encodeURIComponent(slug)}/reviews`,
    mine: (slug: string) => `/products/${encodeURIComponent(slug)}/reviews/me`,
    review: (reviewId: string) => `/reviews/${encodeURIComponent(reviewId)}`,
  },
  catalog: {
    categories: "/categories",
    products: "/products",
    product: (slug: string) => `/products/${encodeURIComponent(slug)}`,
  },
  cart: {
    root: "/cart",
    items: "/cart/items",
    item: (id: string) => `/cart/items/${encodeURIComponent(id)}`,
  },
  checkout: "/checkout",
  orders: {
    root: "/orders",
    order: (id: string) => `/orders/${encodeURIComponent(id)}`,
    cancel: (id: string) => `/orders/${encodeURIComponent(id)}/cancel`,
    paymentStatus: (id: string) => `/orders/${encodeURIComponent(id)}/payment-status`,
    paymentSession: (id: string) => `/orders/${encodeURIComponent(id)}/payment-session`,
  },
  payments: {
    status: "/payments/status",
    webhook: "/payments/webhook",
  },
  seller: {
    apply: "/seller/apply",
    status: "/seller/status",
    profile: "/seller/profile",
    products: "/seller/products",
    product: (id: string) => `/seller/products/${encodeURIComponent(id)}`,
    submit: (id: string) => `/seller/products/${encodeURIComponent(id)}/submit`,
    publish: (id: string) => `/seller/products/${encodeURIComponent(id)}/publish`,
    variants: (id: string) => `/seller/products/${encodeURIComponent(id)}/variants`,
    productImagePresign: (id: string) =>
      `/seller/products/${encodeURIComponent(id)}/images/presign`,
    productImageConfirm: (id: string) =>
      `/seller/products/${encodeURIComponent(id)}/images/confirm`,
    variant: (id: string, variantId: string) =>
      `/seller/products/${encodeURIComponent(id)}/variants/${encodeURIComponent(variantId)}`,
    sellingUnits: (id: string) => `/seller/products/${encodeURIComponent(id)}/selling-units`,
    sellingUnit: (id: string, unitId: string) =>
      `/seller/products/${encodeURIComponent(id)}/selling-units/${encodeURIComponent(unitId)}`,
    inventory: (id: string) => `/seller/products/${encodeURIComponent(id)}/inventory`,
    orders: "/seller/orders",
    orderStatus: (id: string) => `/seller/orders/${encodeURIComponent(id)}/status`,
  },
  admin: {
    sellers: "/admin/sellers",
    approveSeller: (id: string) => `/admin/sellers/${encodeURIComponent(id)}/approve`,
    rejectSeller: (id: string) => `/admin/sellers/${encodeURIComponent(id)}/reject`,
    suspendSeller: (id: string) => `/admin/sellers/${encodeURIComponent(id)}/suspend`,
    products: "/admin/products",
    approveProduct: (id: string) => `/admin/products/${encodeURIComponent(id)}/approve`,
    rejectProduct: (id: string) => `/admin/products/${encodeURIComponent(id)}/reject`,
    categories: "/admin/categories",
    category: (id: string) => `/admin/categories/${encodeURIComponent(id)}`,
    metrics: "/admin/metrics",
    expireOrders: "/admin/maintenance/expire-pending-orders",
  },
} as const;
