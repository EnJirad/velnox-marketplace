// Velnox Shared Types — Used by all apps and backend

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface Seller {
  id: string;
  userId: string;
  status: "pending" | "active" | "suspended";
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  parentId: string | null;
}

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

export interface Order {
  id: string;
  userId: string;
  shopId: string;
  status: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
  totalAmount: number;
  currency: string;
  items: OrderItem[];
  shippingAddressId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: number;
}

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

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface BehavioralEvent {
  id: string;
  userId: string | null;
  sessionId: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface Media {
  id: string;
  url: string;
  key: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
