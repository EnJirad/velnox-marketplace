export interface ApiClientOptions {
  baseUrl: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}
