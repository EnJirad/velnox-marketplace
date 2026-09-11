/**
 * Velnox API Route Mapping
 *
 * Maps logical route keys to REST API endpoints.
 * All frontend pages use this to call the Express backend.
 *
 * New code should use api-client.ts directly with REST paths.
 */
import { apiBaseUrl as API_BASE } from "./sites";

// ─── Simple in-memory GET cache (60s TTL) ──────────────────────────────────
const _getCache = new Map<string, { data: any; expires: number }>();
const GET_TTL_MS = 60_000;

function invalidateGetCache(prefix?: string) {
  if (!prefix) { _getCache.clear(); return; }
  for (const key of _getCache.keys()) {
    if (key.startsWith(prefix)) _getCache.delete(key);
  }
}

async function apiPost(path: string, args?: any): Promise<any> {
  // Invalidate GET cache on any mutation
  invalidateGetCache(path.split("/").slice(0, 4).join("/"));
  // Strip /api prefix if present — API_BASE already includes it
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: args ? JSON.stringify(args) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    const errMsg = data.error?.message || data.error || `Request failed: ${res.status}`;
    throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
  }
  const json = await res.json();
  // Unwrap {success, data} envelope — components expect the inner payload
  return json.data !== undefined ? json.data : json;
}

async function apiGet(path: string): Promise<any> {
  const cached = _getCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.data;
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    const errMsg = data.error?.message || data.error || `Request failed: ${res.status}`;
    throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
  }
  const json = await res.json();
  // Unwrap {success, data} envelope — components expect the inner payload
  const unwrapped = json.data !== undefined ? json.data : json;
  _getCache.set(path, { data: unwrapped, expires: Date.now() + GET_TTL_MS });
  return unwrapped;
}

/** GET without the 60s in-memory cache — for chat/notifications where staleness is visible. */
async function apiGetFresh(path: string): Promise<any> {
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    const errMsg = data.error?.message || data.error || `Request failed: ${res.status}`;
    throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
  }
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

async function apiPut(path: string, args?: any): Promise<any> {
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: args ? JSON.stringify(args) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    const errMsg = data.error?.message || data.error || `Request failed: ${res.status}`;
    throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
  }
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

async function apiPatch(path: string, args?: any): Promise<any> {
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: args ? JSON.stringify(args) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    const errMsg = data.error?.message || data.error || `Request failed: ${res.status}`;
    throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
  }
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

async function apiDelete(path: string): Promise<any> {
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

// ─── API Route Mapping ──────────────────────────────────────────────────────

const ACTION_MAP: Record<string, (args?: any) => Promise<any>> = {
  // Customer actions
  "api.customer.myProfile": () => apiGet("/api/customer/profile"),
  "api.customer.accountSummary": () => apiGet("/api/customer/account-summary"),
  "api.customer.updateProfileAction": (a) => apiPut("/api/customer/profile", a),
  "api.customer.getProfileImageUploadIntent": (a) => apiPost("/api/customer/profile-image/upload-intent", a),
  "api.customer.saveProfileImage": (a) => apiPost("/api/customer/profile-image/save", a),
  "api.customer.myAddresses": () => apiGet("/api/customer/addresses"),
  "api.customer.saveAddress": (a) => apiPost("/api/customer/addresses", a),
  "api.customer.deleteAddressAction": (a) => apiDelete(`/api/customer/addresses/${a.addressId}`),
  "api.customer.myCart": () => apiGet("/api/customer/cart"),
  "api.customer.addToCartAction": (a) => apiPost("/api/customer/cart/add", a),
  "api.customer.updateCartItemAction": (a) => apiPut(`/api/customer/cart/item/${a.cartItemId}`, a),
  "api.customer.removeCartItemAction": (a) => apiDelete(`/api/customer/cart/item/${a.cartItemId}`),
  "api.customer.checkoutAction": (a) => apiPost("/api/customer/checkout", a),
  "api.customer.myOrders": (a) => apiGet(`/api/customer/orders?limit=${a?.limit ?? 50}`),
  "api.customer.orderDetail": (a) => apiGet(`/api/customer/orders/${a.orderId}`),
  "api.customer.myWishlist": () => apiGet("/api/customer/wishlist"),
  "api.customer.toggleWishlistAction": (a) => apiPost("/api/customer/wishlist/toggle", a),
  "api.customer.reviewProduct": (a) => apiPost(`/api/products/${a.productId}/reviews`, a),
  "api.customer.productReviews": (a) => apiGetFresh(`/api/products/${a.productId}/reviews${a.before ? `?before=${encodeURIComponent(String(a.before))}` : ""}`),
  "api.customer.createReviewAction": (a) => apiPost(`/api/products/${a.productId}/reviews`, a),
  "api.customer.updateReviewAction": (a) => apiPatch(`/api/reviews/${a.reviewId}`, a),
  "api.customer.deleteReviewAction": (a) => apiDelete(`/api/reviews/${a.reviewId}`),
  "api.customer.shopReviews": (a) => apiGet(`/api/shops/${a.shopId}/reviews`),

  "api.customer.myNotifications": () => apiGetFresh("/api/customer/notifications"),
  "api.customer.markNotificationReadAction": (a) => apiPatch(`/api/customer/notifications/${a.notificationId}/read`),
  "api.customer.markAllNotificationsRead": () => apiPut("/api/customer/notifications/read-all"),
  // Chat — customer
  "api.customer.myConversations": () => apiGetFresh("/api/customer/conversations"),
  "api.customer.createConversationAction": (a) => apiPost("/api/customer/conversations", a),
  "api.customer.supportConversationAction": () => apiPost("/api/customer/support/conversation"),
  "api.customer.conversationMessages": (a) => apiGetFresh(`/api/customer/conversations/${a.conversationId}/messages${a.before ? `?before=${encodeURIComponent(String(a.before))}` : ""}`),
  "api.customer.sendMessageAction": (a) => apiPost(`/api/customer/conversations/${a.conversationId}/messages`, a),
  "api.customer.markConversationReadAction": (a) => apiPost(`/api/customer/conversations/${a.conversationId}/read`, {}),
  // Chat — seller
  "api.seller.sellerConversations": () => apiGetFresh("/api/seller/conversations"),
  "api.seller.sellerConversationMessages": (a) => apiGetFresh(`/api/seller/conversations/${a.conversationId}/messages${a.before ? `?before=${encodeURIComponent(String(a.before))}` : ""}`),
  "api.seller.sendSellerMessageAction": (a) => apiPost(`/api/seller/conversations/${a.conversationId}/messages`, a),
  "api.seller.markSellerConversationReadAction": (a) => apiPost(`/api/seller/conversations/${a.conversationId}/read`, {}),
  "api.customer.reorderAction": (a) => apiPost("/api/customer/reorder", a),
  "api.customer.publicShops": () => apiGet("/api/shops"),
  "api.customer.shopDetail": (a) => apiGet(`/api/shops/${a.shopId}`),
  "api.customer.categories": () => apiGet("/api/categories"),
  "api.customer.categoryTreeAction": () => apiGet("/api/categories/tree"),
  "api.customer.categoryStatsAction": () => apiGet("/api/categories/stats"),

  // Commerce actions (seller)
  "api.commerce.mySellerStatus": () => apiGet("/api/seller/status"),
  "api.commerce.mySellerProfile": () => apiGet("/api/seller/profile"),
  "api.commerce.openShop": (a) => apiPost("/api/seller/apply", a),
  "api.commerce.createSellerApplication": (a) => apiPost("/api/seller/apply", a),
  "api.commerce.listProducts": (a) => {
    if (a?.mine) return apiGet("/api/seller/products");
    return apiGet("/api/products/catalog");
  },
  "api.commerce.getProductDetail": (a) => apiGet(`/api/products/${a.productId}`),
  "api.commerce.catalogProductsAction": (a) => {
    const params = new URLSearchParams();
    if (a?.q) params.set("q", a.q);
    if (a?.category) params.set("category", a.category);
    if (a?.shopId) params.set("shopId", a.shopId);
    if (a?.minPrice) params.set("minPrice", String(a.minPrice));
    if (a?.maxPrice) params.set("maxPrice", String(a.maxPrice));
    if (a?.inStock) params.set("inStock", "true");
    if (a?.sortBy) params.set("sortBy", a.sortBy);
    if (a?.limit) params.set("limit", String(a.limit));
    if (a?.offset) params.set("offset", String(a.offset));
    return apiGet(`/api/products/catalog?${params}`);
  },
  "api.commerce.myOrders": (a) => apiGet(`/api/customer/orders?limit=${a?.limit ?? 50}`),
  "api.commerce.sellerOrders": (a) => apiGet(`/api/seller/orders?limit=${a?.limit ?? 50}`),
  "api.commerce.setOrderStatus": (a) => apiPatch(`/api/seller/orders/${a.orderId}/status`, a),
  "api.commerce.cancelOrderAction": (a) => apiPatch(`/api/customer/orders/${a.orderId}/cancel`, {}),
  // VelRepeat packages (new system)
  "api.commerce.myVelRepeatPackages": () => apiGet("/api/velrepeat/packages"),
  "api.commerce.velRepeatPackageDetail": (a) => apiGet(`/api/velrepeat/packages/${a.packageId}`),
  "api.commerce.createVelRepeatPackage": (a) => apiPost("/api/velrepeat/packages", a),
  "api.commerce.updateVelRepeatPackage": (a) => apiPatch(`/api/velrepeat/packages/${a.packageId}`, a),
  "api.commerce.velRepeatDeliveries": (a) => apiGet(`/api/velrepeat/packages/${a.packageId}/deliveries`),
  "api.commerce.sellerVelRepeatDeliveries": () => apiGet("/api/seller/velrepeat/deliveries"),
  "api.commerce.updateVelRepeatDelivery": (a) => apiPatch(`/api/seller/velrepeat/deliveries/${a.deliveryId}`, a),
  // VelRepeat V2 recurring plans
  "api.commerce.myVelRepeatPlans": () => apiGet("/api/velrepeat/plans"),
  "api.commerce.velRepeatPlanDetail": (a) => apiGet(`/api/velrepeat/plans/${a.planId}`),
  "api.commerce.createVelRepeatPlan": (a) => apiPost("/api/velrepeat/plans", a),
  "api.commerce.updateVelRepeatPlan": (a) => apiPatch(`/api/velrepeat/plans/${a.planId}`, a),
  "api.commerce.pauseVelRepeatPlan": (a) => apiPost(`/api/velrepeat/plans/${a.planId}/pause`, a),
  "api.commerce.resumeVelRepeatPlan": (a) => apiPost(`/api/velrepeat/plans/${a.planId}/resume`, a),
  "api.commerce.cancelVelRepeatPlan": (a) => apiPost(`/api/velrepeat/plans/${a.planId}/cancel`, a),
  "api.commerce.runVelRepeatPlanNow": (a) => apiPost(`/api/velrepeat/plans/${a.planId}/run-now`, a),
  "api.commerce.velRepeatPlanRuns": (a) => apiGet(`/api/velrepeat/plans/${a.planId}/runs`),
  "api.commerce.repeatOrderNow": (a) => apiPost("/api/velrepeat/repeat-now", a),
  "api.commerce.sellerVelRepeatOverview": () => apiGet("/api/seller/velrepeat/overview"),
  "api.centerAdmin.velRepeatOverview": () => apiGet("/api/admin/velrepeat/overview"),
  // Legacy subscriptions (kept for backward compat)
  "api.commerce.mySubscriptions": () => apiGet("/api/customer/subscriptions"),
  "api.commerce.sellerSubscriptions": () => apiGet("/api/seller/subscriptions"),
  "api.commerce.pauseSubscription": (a) => apiPatch(`/api/subscriptions/${a.subscriptionId}/pause`, a),
  "api.commerce.updateSubscriptionAction": (a) => apiPatch(`/api/subscriptions/${a.subscriptionId}`, a),
  "api.commerce.processDueSubscriptions": () => apiPost("/api/subscriptions/process-due"),
  "api.commerce.createVelRepeat": (a) => apiPost("/api/subscriptions/create", a),
  "api.commerce.sellerIncomeReport": () => apiGet("/api/seller/income"),
  "api.commerce.sellerReorderSuggestionsAction": () => apiGet("/api/seller/reorder-suggestions"),
  "api.commerce.customerRegulars": () => apiGet("/api/commerce/regulars"),
  "api.commerce.setProductStatusAction": (a) => apiPatch(`/api/seller/products/${a.productId}/status`, a),
  "api.commerce.deleteProductAction": (a) => apiDelete(`/api/seller/products/${a.productId}`),
  "api.commerce.createProductAction": (a) => apiPost("/api/seller/products", a),
  "api.commerce.createFullProductAction": (a) => apiPost("/api/seller/products/create-full", a),
  "api.commerce.draftUploadIntent": (a) => apiPost("/api/seller/products/draft-upload-intent", a),
  "api.commerce.updateProductAction": (a) => apiPatch(`/api/seller/products/${a.productId}`, a),
  "api.commerce.getProductImageUploadIntent": (a) => apiPost("/api/seller/products/image-upload-intent", a),
  "api.commerce.saveProductImage": (a) => apiPost("/api/seller/products/save-image", a),
  "api.commerce.deleteProductImageAction": (a) => apiDelete(`/api/seller/products/images/${a.imageId}`),
  "api.commerce.setPrimaryProductImageAction": (a) => apiPatch(`/api/seller/products/${a.productId}/primary-image`, a),
  "api.commerce.reorderProductImagesAction": (a) => apiPatch(`/api/seller/products/${a.productId}/reorder-images`, a),
  "api.commerce.setStockAction": (a) => apiPatch(`/api/seller/products/${a.productId}/stock`, a),
  "api.commerce.setReorderLevelAction": (a) => apiPatch(`/api/seller/products/${a.productId}/reorder-level`, a),

  // Center admin actions
  "api.centerAdmin.sellerList": () => apiGet("/api/admin/sellers"),
  "api.centerAdmin.setSellerStatusAction": (a) => apiPatch(`/api/admin/sellers/${a.sellerId}/status`, a),
  "api.centerAdmin.productModerationList": () => apiGet("/api/admin/products/moderation"),
  "api.centerAdmin.setProductModerationStatus": (a) => apiPatch(`/api/admin/products/${a.productId}/moderation`, a),
  "api.centerAdmin.getPlatformSettings": () => apiGet("/api/admin/settings"),
  "api.centerAdmin.updatePlatformSettingAction": (a) => apiPatch("/api/admin/settings", a),
  "api.centerAdmin.marketOverviewAction": () => apiGet("/api/admin/market-overview"),
  "api.centerAdmin.ordersListAction": (a) => apiGet(`/api/admin/orders?limit=${a?.limit ?? 100}`),
  "api.centerAdmin.updateOrderStatusAction": (a) => apiPatch(`/api/admin/orders/${a.orderId}/status`, a),
  "api.centerAdmin.auditLogs": () => apiGet("/api/admin/audit-logs"),
  "api.centerAdmin.permissionCatalog": () => apiGet("/api/admin/permissions"),
  "api.centerAdmin.setStaffProfileAction": (a) => apiPatch("/api/admin/staff", a),
  "api.centerAdmin.recomputeBalances": () => apiPost("/api/admin/recompute-balances"),
  "api.centerAdmin.platformRevenue": () => apiGet("/api/admin/revenue"),
  "api.centerAdmin.payoutList": () => apiGet("/api/admin/payouts"),
  "api.centerAdmin.processPayoutAction": (a) => apiPost("/api/admin/payouts/process", a),
  "api.centerAdmin.getBusinessRules": () => apiGet("/api/admin/rules"),

  // Center overview/products
  "api.center.overview": () => apiGet("/api/admin/overview"),
  "api.products.listAll": () => apiGet("/api/products/catalog?limit=200"),

  // Users (admin)
  "api.users.currentUser": () => apiGet("/api/auth/me"),
  "api.users.listUsers": () => apiGet("/api/admin/users"),
  "api.users.setUserAccess": (a) => apiPatch(`/api/admin/users/${a.targetUserId}/access`, a),
  "api.users.ownerBootstrapStatus": () => apiGet("/api/admin/bootstrap-status"),
  "api.users.claimOwner": (a) => apiPost("/api/admin/claim-owner", a),

  // Employee auth
  "api.employeeAuth.employeeListAction": () => apiGet("/api/admin/employees"),
  "api.employeeAuth.createEmployeeAction": (a) => apiPost("/api/admin/employees", a),
  "api.employeeAuth.resetEmployeePasswordAction": (a) => apiPost(`/api/admin/employees/${a.userId ?? a.employeeId}/reset-password`, a),
  "api.employeeAuth.setEmployeeActiveAction": (a) => apiPatch(`/api/admin/employees/${a.userId ?? a.employeeId}/active`, a),
  "api.employeeAuth.setOwnPasswordAction": (a) => apiPost("/api/auth/change-password", a),

  // Goals (seller)
  "api.goals.list": () => apiGet("/api/seller/goals"),
  "api.goals.create": (a) => apiPost("/api/seller/goals", a),
  "api.goals.update": (a) => apiPatch(`/api/seller/goals/${a.goalId}`, a),
  "api.goals.remove": (a) => apiDelete(`/api/seller/goals/${a.goalId}`),
  "api.goals.addProgress": (a) => apiPost(`/api/seller/goals/${a.goalId}/progress`, a),

  // Memory / Intelligence
  "api.memory.recommendForCustomer": (a) => apiGet(`/api/memory/recommendations?limit=${a?.limit ?? 8}`),
  "api.memory.dueReorderReminders": () => apiGet("/api/memory/reminders"),
  "api.memory.marketInsights": () => apiGet("/api/memory/insights"),
  "api.memory.myMemory": () => apiGet("/api/memory/my-memory"),
  "api.memory.flushToNeon": () => apiPost("/api/memory/flush"),

  // Stripe
  "api.stripe.stripeConfiguredAction": () => apiGet("/api/stripe/configured"),
  "api.stripe.createStripeCheckoutAction": (a) => apiPost("/api/stripe/checkout", a),
  "api.stripe.stripePaymentStatusAction": (a) => apiGet(`/api/stripe/payment-status/${a.sessionId}`),

  // Profile image (users)
  "api.users.patchUserImage": (a) => apiPatch("/api/customer/profile-image", a),

  // Seller ops
  "api.sellerOps.myShipments": () => apiGet("/api/seller/shipments"),
  "api.sellerOps.createShipmentAction": (a) => apiPost("/api/seller/shipments", a),
  "api.sellerOps.addTrackingEventAction": (a) => apiPost(`/api/seller/shipments/${a.shipmentId}/tracking`, a),

  "api.sellerOps.sellerFinancialReportAction": () => apiGet("/api/seller/financial-report"),
  "api.sellerOps.myPayouts": () => apiGet("/api/seller/payouts"),
  "api.sellerOps.requestPayoutAction": (a) => apiPost("/api/seller/payouts/request", a),
  "api.sellerOps.updateShopLocation": (a) => apiPatch(`/api/seller/shop/${a.shopId}/location`, a),

  // Storefront
  "api.storefront.settings": (a) => apiGet(`/api/shops/${a.shopId}/settings`),

  // Verification (dual seller + product)
  "api.seller.verificationStatus": () => apiGet("/api/seller/verification"),
  "api.seller.submitVerification": (a) => apiPost("/api/seller/verification", a),
  "api.seller.productVerificationStatus": (a) => apiGet(`/api/seller/products/${a.productId}/verification`),
  "api.seller.submitProductVerification": (a) => apiPost(`/api/seller/products/${a.productId}/verification`, a),
  "api.admin.verifications": (a) => apiGet(`/api/admin/verifications${a?.type ? `?type=${a.type}` : ""}${a?.status ? `&status=${a.status}` : ""}`),
  "api.admin.sellerVerificationAction": (a) => apiPatch(`/api/admin/verifications/seller/${a.verificationId}`, a),
  "api.admin.productVerificationAction": (a) => apiPatch(`/api/admin/verifications/product/${a.verificationId}`, a),
  "api.public.shopVerification": (a) => apiGet(`/api/shops/${a.shopId}/verification`),
  // Categories (localized)
  "api.customer.categoriesLocalized": (a) => apiGet(`/api/categories?lang=${a?.lang ?? "th"}`),
};

/**
 * useAction replacement — returns a callable function for POST-based actions.
 * Maps api.xxx.yyy to the corresponding API endpoint.
 * If a function is passed directly (e.g. useAction(api.commerce.createProductAction)),
 * it is returned as-is.
 */
export function useAction(routeKeyOrFn: string | ((...args: any[]) => any)): (...args: any[]) => Promise<any> {
  if (typeof routeKeyOrFn === "function") return routeKeyOrFn;
  const handler = ACTION_MAP[routeKeyOrFn];
  if (handler) return handler;
  // Fallback: try POST to a guessed path
  const parts = routeKeyOrFn.replace(/^api\./, "").split(".");
  const path = `/api/${parts.join("/")}`;
  return (args?: any) => apiPost(path, args);
}

/**
 * useQuery replacement — returns data from a GET endpoint.
 * Note: This is NOT reactive. Use with useEffect.
 */
export function useQuery(routeKey: string): any {
  const handler = ACTION_MAP[routeKey];
  if (!handler) return undefined;
  return undefined;
}

/**
 * useMutation replacement — returns a callable function for mutations.
 * If a function is passed directly, it is returned as-is.
 */
export function useMutation(routeKeyOrFn: string | ((...args: any[]) => any)): (...args: any[]) => Promise<any> {
  if (typeof routeKeyOrFn === "function") return routeKeyOrFn;
  const handler = ACTION_MAP[routeKeyOrFn];
  if (handler) return handler;
  const parts = routeKeyOrFn.replace(/^api\./, "").split(".");
  const path = `/api/${parts.join("/")}`;
  return (args?: any) => apiPost(path, args);
}

// ─── api stub for backward compatibility ─────────────────────────────────────

function createApiProxy(path: string): any {
  return new Proxy({} as any, {
    get(_target, prop) {
      const routeKey = `${path}.${String(prop)}`;
      const handler = ACTION_MAP[routeKey];
      if (handler) return handler;
      // Return a function that calls the API
      return (args?: any) => {
        const parts = routeKey.replace(/^api\./, "").split("/");
        const apiPath = `/api/${parts.join("/")}`;
        return apiPost(apiPath, args);
      };
    },
  });
}

/** Invalidate the frontend GET cache. Call after mutations that change profile data. */
export function invalidateProfileCache() {
  invalidateGetCache("/api/customer/profile");
  invalidateGetCache("/api/auth/me");
}

export const api = new Proxy({} as any, {
  get(_target, prop) {
    return createApiProxy(`api.${String(prop)}`);
  },
});
