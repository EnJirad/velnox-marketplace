/**
 * MVP API payload types.
 *
 * These mirror `backend/mvp/*.ts` response shapes EXACTLY as the endpoints return
 * them — camelCase for the hand-built payloads (catalogue, cart, orders) and the
 * raw column names for the admin/seller list queries that return SQL rows
 * unchanged. Money is always a string in the API (`NUMERIC(12,2)`); a number is
 * only used for DISPLAY after `Number(...)` and is never sent back as authority.
 */

export type MvpRole = "customer" | "seller" | "admin" | "owner";
export type MvpUserStatus = "active" | "suspended" | "deleted";
export type MvpSellerStatus = "pending" | "approved" | "rejected" | "suspended";
export type MvpProductStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "published"
  | "rejected";
export type MvpOrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface MvpUser {
  id: string;
  email: string;
  name: string;
  role: MvpRole;
}

export interface MvpSellerProfile {
  id: string;
  user_id?: string;
  store_name?: string;
  storeName?: string;
  slug: string;
  status: MvpSellerStatus;
  rejection_reason?: string | null;
  suspension_reason?: string | null;
}

export interface MvpCategory {
  id: string;
  slug: string;
  name: string;
  names: Record<string, string>;
  parent_id: string | null;
  sort_order: number;
  icon: string | null;
  image_url: string | null;
  children: MvpCategory[];
}

export interface MvpPagination {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export interface MvpProductSummary {
  id: string;
  slug: string;
  name: string;
  price: string;
  categorySlug: string | null;
  imageUrl: string | null;
  available: number;
  publishedAt: string | null;
  seller: { id: string; storeName: string; slug: string };
}

export interface MvpVariantOption {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  status: string;
  available: number;
}

export interface MvpProductDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  categorySlug: string | null;
  publishedAt: string | null;
  seller: {
    id: string;
    storeName: string;
    slug: string;
    description: string | null;
  };
  images: Array<{ url: string; alt: string; sortOrder: number }>;
  variants: MvpVariantOption[];
  available: number;
}

export interface MvpCartItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: string;
  variantId: string | null;
  variantName: string | null;
  variantStatus: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  available: number;
}

export interface MvpCart {
  id: string;
  seller: { id: string; storeName: string; slug: string };
  items: MvpCartItem[];
  subtotal: string;
  itemCount: number;
}

export interface MvpCartResponse {
  carts: MvpCart[];
  itemCount: number;
}

export interface MvpShippingAddress {
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
}

export interface MvpOrderItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  image_url: string | null;
  unit_price: string;
  quantity: number;
  subtotal: string;
}

export interface MvpPaymentRow {
  id: string;
  status: string;
  amount: string;
  currency: string;
  method: string;
  paid_at: string | null;
  created_at: string;
}

export interface MvpShipment {
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

export interface MvpOrderDetail {
  id: string;
  orderNumber: string;
  status: MvpOrderStatus;
  subtotal: string;
  shippingFee: string;
  totalAmount: string;
  currency: string;
  notes: string | null;
  shippingAddress: MvpShippingAddress | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  paymentExpiresAt: string | null;
  buyer: { name: string; email: string };
  seller: { id: string; storeName: string; slug: string };
  items: MvpOrderItem[];
  payments: MvpPaymentRow[];
  shipment: MvpShipment | null;
}

/** `GET /orders` row shape (raw SQL row, snake_case). */
export interface MvpOrderSummary {
  id: string;
  order_number: string;
  status: MvpOrderStatus;
  total_amount: string;
  currency: string;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  store_name: string;
  item_count: number;
}

export interface MvpPaymentStatus {
  orderId: string;
  orderStatus: MvpOrderStatus;
  paymentStatus: string | null;
  paidAt: string | null;
  settled: boolean;
}

export interface MvpPaymentSession {
  paymentId: string;
  sessionId: string;
  url: string | null;
  mode: "test";
}

export interface MvpPaymentsConfig {
  usable: boolean;
  mode: string;
  publishableKey: string | null;
  reason: string | null;
  methods: string[];
}

/** Seller-facing product payload (`sellerProductPayload`). */
export interface MvpSellerProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: string;
  categorySlug: string | null;
  status: MvpProductStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  images: Array<{ id?: string; url: string; alt: string; sortOrder: number }>;
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    price: string;
    status: string;
    sortOrder: number;
    stock: { quantity: number; reserved: number; available: number };
  }>;
  stock: { quantity: number; reserved: number; available: number } | null;
}

export interface MvpSellerStatusResponse {
  seller: MvpSellerProfile | null;
  productCounts: Record<string, number>;
}

/** Seller order row (`GET /seller/orders`, raw SQL row). */
export interface MvpSellerOrderRow {
  id: string;
  order_number: string;
  status: MvpOrderStatus;
  subtotal: string;
  shipping_fee: string;
  total_amount: string;
  currency: string;
  shipping_address: MvpShippingAddress | null;
  notes: string | null;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  buyer_name: string;
  item_count: number;
  payment_status: string | null;
}

/** Admin seller row (`GET /admin/sellers`, raw SQL row). */
export interface MvpAdminSellerRow {
  id: string;
  store_name: string;
  slug: string;
  status: MvpSellerStatus;
  rejection_reason: string | null;
  suspension_reason: string | null;
  created_at: string;
  approved_at: string | null;
  suspended_at: string | null;
  user_id: string;
  email: string;
  name: string;
  total_count?: number;
}

/** Admin product row (`GET /admin/products`, raw SQL row). */
export interface MvpAdminProductRow {
  id: string;
  name: string;
  slug: string;
  price: string;
  status: MvpProductStatus;
  rejection_reason: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  published_at: string | null;
  seller_id: string;
  store_name: string;
  image_url: string | null;
  total_count?: number;
}

/** Admin category row (`GET /admin/categories`, raw SQL row). */
export interface MvpAdminCategoryRow {
  id: string;
  slug: string;
  name: string;
  names: Record<string, string>;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  icon: string | null;
  image_url: string | null;
  product_count: number;
}

export interface MvpAdminMetrics {
  active_users?: number;
  pending_sellers?: number;
  approved_sellers?: number;
  suspended_sellers?: number;
  products_awaiting_review?: number;
  published_products?: number;
  orders_total?: number;
  orders_pending_payment?: number;
  orders_paid?: number;
  orders_delivered?: number;
  orders_cancelled?: number;
  paid_payments?: number;
  gross_settled_amount?: string;
}

export interface MvpProductQuery {
  page?: number;
  limit?: number;
  category?: string;
  q?: string;
  seller?: string;
}

export interface MvpCreateProductInput {
  name: string;
  description?: string;
  price: string;
  categorySlug?: string | null;
  images?: Array<{ url: string; alt?: string }>;
  stock?: number;
  variants?: Array<{ name: string; sku?: string | null; price: string; stock?: number }>;
}
