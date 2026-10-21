/**
 * MVP API route constants — the single place the `/api/mvp` paths live.
 *
 * Deliberately SEPARATE from `lib/api-routes.ts` (the legacy table). Nothing here
 * may ever be used by a legacy screen, and no legacy constant is rewritten to
 * point at `/api/mvp`: the Phase 3 backend is opt-in per build
 * (`mvp/config.ts`) and the two trees must stay independently deployable.
 */
export const MVP_ROUTES = {
  auth: {
    signup: "/auth/signup",
    login: "/auth/login",
    logout: "/auth/logout",
    me: "/auth/me",
    oauth: "/auth/oauth",
    bootstrapOwner: "/auth/bootstrap-owner",
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
    products: "/seller/products",
    product: (id: string) => `/seller/products/${encodeURIComponent(id)}`,
    submit: (id: string) => `/seller/products/${encodeURIComponent(id)}/submit`,
    publish: (id: string) => `/seller/products/${encodeURIComponent(id)}/publish`,
    variants: (id: string) => `/seller/products/${encodeURIComponent(id)}/variants`,
    variant: (id: string, variantId: string) =>
      `/seller/products/${encodeURIComponent(id)}/variants/${encodeURIComponent(variantId)}`,
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
