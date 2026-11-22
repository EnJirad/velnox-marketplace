import { buildVelnoxOpenApiDoc, type OpenApiEndpointDef } from "./generator.js";

export const VELNOX_V1_ENDPOINTS: OpenApiEndpointDef[] = [
  {
    method: "get",
    path: "/api/v1/health",
    summary: "Check API and database health status",
    tags: ["System"],
    requiresAuth: false,
    responseSchemaName: "HealthCheckResponse",
  },
  {
    method: "post",
    path: "/api/v1/auth/login",
    summary: "User authentication via email and password",
    tags: ["Authentication"],
    requiresAuth: false,
    requestBodySchemaName: "LoginInput",
    responseSchemaName: "ApiResponse",
  },
  {
    method: "post",
    path: "/api/v1/auth/register",
    summary: "Register new customer or seller account",
    tags: ["Authentication"],
    requiresAuth: false,
    requestBodySchemaName: "RegisterInput",
    responseSchemaName: "ApiResponse",
  },
  {
    method: "post",
    path: "/api/v1/auth/token/refresh",
    summary: "Rotate session tokens using refresh token",
    tags: ["Authentication"],
    requiresAuth: false,
    requestBodySchemaName: "TokenRefreshInput",
    responseSchemaName: "ApiResponse",
  },
  {
    method: "post",
    path: "/api/v1/auth/token/exchange",
    summary: "Exchange native mobile OAuth identity token (Google/LINE) for session tokens",
    tags: ["Authentication"],
    requiresAuth: false,
    requestBodySchemaName: "TokenExchangeInput",
    responseSchemaName: "ApiResponse",
  },
  {
    method: "get",
    path: "/api/v1/auth/me",
    summary: "Retrieve current authenticated user session and permissions",
    tags: ["Authentication"],
    requiresAuth: true,
    responseSchemaName: "ApiResponse",
  },
  {
    method: "get",
    path: "/api/v1/categories",
    summary: "List all active catalog categories in tree hierarchy",
    tags: ["Catalog"],
    requiresAuth: false,
    responseSchemaName: "ApiResponse",
  },
  {
    method: "get",
    path: "/api/v1/categories/{slug}",
    summary: "Get category details by URL slug",
    tags: ["Catalog"],
    requiresAuth: false,
    parameters: [
      {
        name: "slug",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responseSchemaName: "ApiResponse",
  },
  {
    method: "get",
    path: "/api/v1/products",
    summary: "Search and filter catalog products with pagination",
    tags: ["Catalog"],
    requiresAuth: false,
    parameters: [
      { name: "q", in: "query", schema: { type: "string" } },
      { name: "categoryId", in: "query", schema: { type: "string" } },
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
      { name: "sort", in: "query", schema: { type: "string", default: "popular" } },
    ],
    responseSchemaName: "ApiResponse",
  },
  {
    method: "get",
    path: "/api/v1/products/{id}",
    summary: "Get detailed product profile including variants and shop information",
    tags: ["Catalog"],
    requiresAuth: false,
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responseSchemaName: "ApiResponse",
  },
  {
    method: "get",
    path: "/api/v1/cart",
    summary: "Get active shopping cart with multi-shop partitioning and subtotal calculations",
    tags: ["Cart"],
    requiresAuth: true,
    responseSchemaName: "ApiResponse",
  },
  {
    method: "post",
    path: "/api/v1/cart/items",
    summary: "Add item or variant to shopping cart",
    tags: ["Cart"],
    requiresAuth: true,
    requestBodySchemaName: "AddToCartInput",
    responseSchemaName: "ApiResponse",
  },
];

export const velnoxOpenApiSpec = buildVelnoxOpenApiDoc(VELNOX_V1_ENDPOINTS);

export function validateOpenApiSpec(spec: typeof velnoxOpenApiSpec): boolean {
  if (spec.openapi !== "3.1.0") return false;
  if (!spec.info || !spec.info.title || !spec.info.version) return false;
  if (!spec.paths || Object.keys(spec.paths).length === 0) return false;
  if (!spec.components || !spec.components.schemas) return false;
  return true;
}
