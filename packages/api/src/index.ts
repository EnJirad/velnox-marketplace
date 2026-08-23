import type { ApiResponse } from "@velnox/types";

export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
}

export class ApiClient {
  private baseUrl: string;
  private timeout: number;
  private retries: number;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? 15000;
    this.retries = config.retries ?? 2;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries?: number
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
      const remaining = retries ?? this.retries;
      if (remaining > 0 && err instanceof Error && err.name === "AbortError") {
        return this.request<T>(method, path, body, remaining - 1);
      }
      throw err;
    }
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}

let _client: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!_client) {
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env: Record<string, string> }).env
          .VITE_API_URL) ||
      "http://localhost:3001/api";
    _client = new ApiClient({ baseUrl });
  }
  return _client;
}

// ─── Domain API Modules ──────────────────────────────────

export const authApi = {
  me: () => getApiClient().get<{ user: import("@velnox/types").User }>("/auth/me"),
  logout: () => getApiClient().post<{ success: boolean }>("/auth/logout"),
  getGoogleUrl: () =>
    getApiClient().get<{ url: string }>("/auth/google"),
};

export const productsApi = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    category?: string;
    search?: string;
    featured?: boolean;
  }) => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set("page", String(params.page));
    if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
    if (params?.category) sp.set("category", params.category);
    if (params?.search) sp.set("search", params.search);
    if (params?.featured) sp.set("featured", "true");
    const q = sp.toString();
    return getApiClient().get<{
      items: import("@velnox/types").Product[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/products${q ? `?${q}` : ""}`);
  },
  get: (id: string) =>
    getApiClient().get<{ product: import("@velnox/types").Product }>(
      `/products/${id}`
    ),
};

export const categoriesApi = {
  list: () =>
    getApiClient().get<{
      categories: import("@velnox/types").Category[];
    }>("/categories"),
};

export const cartApi = {
  get: () =>
    getApiClient().get<{ cart: import("@velnox/types").Cart }>("/cart"),
  addItem: (productId: string, quantity: number) =>
    getApiClient().post<{ cart: import("@velnox/types").Cart }>(
      "/cart/items",
      { productId, quantity }
    ),
  updateItem: (itemId: string, quantity: number) =>
    getApiClient().patch<{ cart: import("@velnox/types").Cart }>(
      `/cart/items/${itemId}`,
      { quantity }
    ),
  removeItem: (itemId: string) =>
    getApiClient().delete<{ cart: import("@velnox/types").Cart }>(
      `/cart/items/${itemId}`
    ),
};

export const ordersApi = {
  list: () =>
    getApiClient().get<{ orders: import("@velnox/types").Order[] }>("/orders"),
  get: (id: string) =>
    getApiClient().get<{ order: import("@velnox/types").Order }>(
      `/orders/${id}`
    ),
  create: (data: {
    shopId: string;
    addressId: string;
    items: { productId: string; quantity: number }[];
  }) =>
    getApiClient().post<{ order: import("@velnox/types").Order }>("/orders", data),
};

export const shopsApi = {
  list: (params?: { page?: number }) => {
    const q = params?.page ? `?page=${params.page}` : "";
    return getApiClient().get<{
      items: import("@velnox/types").Shop[];
      total: number;
    }>(`/shops${q}`);
  },
  get: (slug: string) =>
    getApiClient().get<{ shop: import("@velnox/types").Shop }>(
      `/shops/${slug}`
    ),
};

export const addressesApi = {
  list: () =>
    getApiClient().get<{
      addresses: import("@velnox/types").Address[];
    }>("/addresses"),
  create: (data: Omit<import("@velnox/types").Address, "id" | "userId">) =>
    getApiClient().post<{ address: import("@velnox/types").Address }>(
      "/addresses",
      data
    ),
  update: (id: string, data: Partial<import("@velnox/types").Address>) =>
    getApiClient().put<{ address: import("@velnox/types").Address }>(
      `/addresses/${id}`,
      data
    ),
  delete: (id: string) =>
    getApiClient().delete<{ success: boolean }>(`/addresses/${id}`),
};
