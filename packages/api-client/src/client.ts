import type {
  AddToCartInput,
  ApiResponse,
  AuthSessionData,
  AuthTokens,
  AuthUser,
  Cart,
  Category,
  CategoryTreeNode,
  HealthCheckResponseData,
  LoginInput,
  ProductDetail,
  ProductListQuery,
  ProductSummary,
  RegisterInput,
  TokenExchangeInput,
  TokenRefreshInput,
  UpdateCartItemInput,
} from "@velnox/api-contract";
import { ApiClientError } from "./errors.js";
import type { ApiClientOptions, RequestOptions } from "./types.js";

export class VelnoxApiClient {
  private readonly baseUrl: string;
  private readonly getAuthToken?: () => string | null | Promise<string | null>;
  private readonly defaultTimeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly customFetch: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.getAuthToken = options.getAuthToken;
    this.defaultTimeoutMs = options.timeoutMs ?? 10000;
    this.defaultHeaders = options.headers ?? {};
    this.customFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...options.headers,
    };

    if (this.getAuthToken && !headers["Authorization"]) {
      const token = await this.getAuthToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    try {
      const response = await this.customFetch(url, {
        ...init,
        headers,
        signal: options.signal ?? controller.signal,
      });

      const json = await response.json().catch(() => null);

      if (!response.ok) {
        const errorPayload = json?.error;
        throw new ApiClientError(
          response.status,
          errorPayload?.code ?? "UNKNOWN_ERROR",
          errorPayload?.message ?? `HTTP ${response.status} Error`,
          errorPayload?.details,
        );
      }

      if (json && typeof json === "object" && "success" in json && json.success === true) {
        return json as ApiResponse<T>;
      }

      return {
        success: true,
        data: json as T,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Health Domain ──────────────────────────────────────────────────────────
  readonly health = {
    check: async (options?: RequestOptions): Promise<HealthCheckResponseData> => {
      const res = await this.request<HealthCheckResponseData>("/api/v1/health", { method: "GET" }, options);
      return res.data;
    },
  };

  // ─── Authentication Domain ──────────────────────────────────────────────────
  readonly auth = {
    login: async (input: LoginInput, options?: RequestOptions): Promise<AuthSessionData> => {
      const res = await this.request<AuthSessionData>(
        "/api/v1/auth/login",
        { method: "POST", body: JSON.stringify(input) },
        options,
      );
      return res.data;
    },

    register: async (input: RegisterInput, options?: RequestOptions): Promise<AuthSessionData> => {
      const res = await this.request<AuthSessionData>(
        "/api/v1/auth/register",
        { method: "POST", body: JSON.stringify(input) },
        options,
      );
      return res.data;
    },

    refreshToken: async (input: TokenRefreshInput, options?: RequestOptions): Promise<AuthTokens> => {
      const res = await this.request<AuthTokens>(
        "/api/v1/auth/token/refresh",
        { method: "POST", body: JSON.stringify(input) },
        options,
      );
      return res.data;
    },

    exchangeToken: async (input: TokenExchangeInput, options?: RequestOptions): Promise<AuthSessionData> => {
      const res = await this.request<AuthSessionData>(
        "/api/v1/auth/token/exchange",
        { method: "POST", body: JSON.stringify(input) },
        options,
      );
      return res.data;
    },

    me: async (options?: RequestOptions): Promise<AuthUser> => {
      const res = await this.request<AuthUser>("/api/v1/auth/me", { method: "GET" }, options);
      return res.data;
    },
  };

  // ─── Categories Domain ──────────────────────────────────────────────────────
  readonly categories = {
    list: async (options?: RequestOptions): Promise<CategoryTreeNode[]> => {
      const res = await this.request<CategoryTreeNode[]>("/api/v1/categories", { method: "GET" }, options);
      return res.data;
    },

    getBySlug: async (slug: string, options?: RequestOptions): Promise<Category> => {
      const res = await this.request<Category>(`/api/v1/categories/${encodeURIComponent(slug)}`, { method: "GET" }, options);
      return res.data;
    },
  };

  // ─── Products Domain ────────────────────────────────────────────────────────
  readonly products = {
    list: async (
      query: ProductListQuery = {},
      options?: RequestOptions,
    ): Promise<ApiResponse<ProductSummary[]>> => {
      const params = new URLSearchParams();
      if (query.q) params.set("q", query.q);
      if (query.categoryId) params.set("categoryId", query.categoryId);
      if (query.categorySlug) params.set("categorySlug", query.categorySlug);
      if (query.minPrice !== undefined) params.set("minPrice", String(query.minPrice));
      if (query.maxPrice !== undefined) params.set("maxPrice", String(query.maxPrice));
      if (query.sort) params.set("sort", query.sort);
      if (query.page) params.set("page", String(query.page));
      if (query.limit) params.set("limit", String(query.limit));

      const qs = params.toString();
      return this.request<ProductSummary[]>(`/api/v1/products${qs ? `?${qs}` : ""}`, { method: "GET" }, options);
    },

    getById: async (id: string, options?: RequestOptions): Promise<ProductDetail> => {
      const res = await this.request<ProductDetail>(`/api/v1/products/${encodeURIComponent(id)}`, { method: "GET" }, options);
      return res.data;
    },
  };

  // ─── Cart Domain ────────────────────────────────────────────────────────────
  readonly cart = {
    get: async (options?: RequestOptions): Promise<Cart> => {
      const res = await this.request<Cart>("/api/v1/cart", { method: "GET" }, options);
      return res.data;
    },

    addItem: async (input: AddToCartInput, options?: RequestOptions): Promise<Cart> => {
      const res = await this.request<Cart>(
        "/api/v1/cart/items",
        { method: "POST", body: JSON.stringify(input) },
        options,
      );
      return res.data;
    },

    updateItem: async (itemId: string, input: UpdateCartItemInput, options?: RequestOptions): Promise<Cart> => {
      const res = await this.request<Cart>(
        `/api/v1/cart/items/${encodeURIComponent(itemId)}`,
        { method: "PATCH", body: JSON.stringify(input) },
        options,
      );
      return res.data;
    },

    removeItem: async (itemId: string, options?: RequestOptions): Promise<Cart> => {
      const res = await this.request<Cart>(
        `/api/v1/cart/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
        options,
      );
      return res.data;
    },
  };
}
