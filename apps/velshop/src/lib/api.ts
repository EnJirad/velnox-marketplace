import type { ApiResponse } from "@/types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

class ApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, timeout = 15000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = 2
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data: ApiResponse<T> = await response.json();
      if (!data.success) {
        const error = new Error(data.error.message);
        (error as Error & { code: string }).code = data.error.code;
        throw error;
      }
      return (data as { success: true; data: T }).data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (retries > 0 && err instanceof Error && err.name === "AbortError") {
        return this.request<T>(method, path, body, retries - 1);
      }
      throw err;
    }
  }

  async get<T>(path: string): Promise<T> { return this.request<T>("GET", path); }
  async post<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("POST", path, body); }
  async put<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("PUT", path, body); }
  async patch<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("PATCH", path, body); }
  async delete<T>(path: string): Promise<T> { return this.request<T>("DELETE", path); }
}

export const api = new ApiClient(API_URL);

export const authApi = {
  getGoogleUrl: () => api.get<{ url: string }>("/auth/google"),
  logout: () => api.post<{ success: boolean }>("/auth/logout"),
  me: () => api.get<{ user: import("@/types").User }>("/auth/me"),
};

export const productsApi = {
  list: (params?: { page?: number; pageSize?: number; category?: string; search?: string; featured?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set("page", String(params.page));
    if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
    if (params?.category) sp.set("category", params.category);
    if (params?.search) sp.set("search", params.search);
    if (params?.featured) sp.set("featured", "true");
    const q = sp.toString();
    return api.get<{ items: import("@/types").Product[]; total: number; page: number; pageSize: number; totalPages: number }>(`/products${q ? `?${q}` : ""}`);
  },
  get: (id: string) => api.get<{ product: import("@/types").Product }>(`/products/${id}`),
};

export const categoriesApi = {
  list: () => api.get<{ categories: import("@/types").Category[] }>("/categories"),
};

export const cartApi = {
  get: () => api.get<{ cart: import("@/types").Cart }>("/cart"),
  addItem: (productId: string, quantity: number) =>
    api.post<{ cart: import("@/types").Cart }>("/cart/items", { productId, quantity }),
  updateItem: (itemId: string, quantity: number) =>
    api.patch<{ cart: import("@/types").Cart }>(`/cart/items/${itemId}`, { quantity }),
  removeItem: (itemId: string) =>
    api.delete<{ cart: import("@/types").Cart }>(`/cart/items/${itemId}`),
};

export const shopsApi = {
  get: (slug: string) => api.get<{ shop: import("@/types").Shop }>(`/shops/${slug}`),
  list: (params?: { page?: number }) => {
    const q = params?.page ? `?page=${params.page}` : "";
    return api.get<{ items: import("@/types").Shop[]; total: number }>(`/shops${q}`);
  },
};

export const ordersApi = {
  create: (data: { shopId: string; addressId: string; items: { productId: string; quantity: number }[] }) =>
    api.post<{ order: import("@/types").Order }>("/orders", data),
  list: () => api.get<{ orders: import("@/types").Order[] }>("/orders"),
  get: (id: string) => api.get<{ order: import("@/types").Order }>(`/orders/${id}`),
};

export const addressesApi = {
  list: () => api.get<{ addresses: import("@/types").Address[] }>("/addresses"),
  create: (data: Omit<import("@/types").Address, "id" | "userId">) =>
    api.post<{ address: import("@/types").Address }>("/addresses", data),
  update: (id: string, data: Partial<import("@/types").Address>) =>
    api.put<{ address: import("@/types").Address }>(`/addresses/${id}`, data),
  delete: (id: string) => api.delete<{ success: boolean }>(`/addresses/${id}`),
};
