// Velnox Shared Types — v1

// ─── API Responses ───────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── User ────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthIdentity {
  id: string;
  userId: string;
  provider: "google";
  providerId: string;
  email: string;
}

// ─── Product ─────────────────────────────────────────────
export interface Product {
  id: string;
  shopId: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string | null;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  status: "draft" | "active" | "archived";
  featured: boolean;
  rating: number | null;
  reviewCount: number;
  soldCount: number;
  categoryId: string | null;
  category?: Category;
  shop?: Shop;
  images: ProductImage[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  alt: string;
  sortOrder: number;
}

// ─── Shop ────────────────────────────────────────────────
export interface Shop {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
  cover: string | null;
  rating: number | null;
  productCount: number;
  createdAt: string;
}

// ─── Seller ──────────────────────────────────────────────
export interface Seller {
  id: string;
  userId: string;
  shopId: string | null;
  status: "pending" | "active" | "suspended";
  createdAt: string;
}

// ─── Category ────────────────────────────────────────────
export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  parentId: string | null;
}

// ─── Cart ────────────────────────────────────────────────
export interface Cart {
  id: string;
  userId: string;
  items: CartItem[];
  totalItems: number;
  totalAmount: number;
  updatedAt: string;
}

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  product?: Product;
  quantity: number;
  price: number;
  addedAt: string;
}

// ─── Order ───────────────────────────────────────────────
export interface Order {
  id: string;
  userId: string;
  shopId: string;
  status: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
  totalAmount: number;
  currency: string;
  items: OrderItem[];
  shippingAddress: Address | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  product?: Product;
  quantity: number;
  price: number;
}

// ─── Address ─────────────────────────────────────────────
export interface Address {
  id: string;
  userId: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

// ─── Notification ────────────────────────────────────────
export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

// ─── Media ───────────────────────────────────────────────
export interface Media {
  id: string;
  url: string;
  key: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
}

// ─── Auth ────────────────────────────────────────────────
export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface LoginResponse {
  user: User;
  token: string;
}
