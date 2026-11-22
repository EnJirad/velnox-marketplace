/**
 * OpenAPI 3.1.0 Specification Generator for Velnox Marketplace
 *
 * Generates standard OpenAPI documentation from Zod API contracts
 * without requiring third-party runtime reflection dependencies.
 */

export interface OpenApiEndpointDef {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  requiresAuth?: boolean;
  requestBodySchemaName?: string;
  responseSchemaName: string;
  parameters?: Array<{
    name: string;
    in: "query" | "path" | "header";
    required?: boolean;
    description?: string;
    schema: { type: string; format?: string; default?: unknown };
  }>;
}

export function buildVelnoxOpenApiDoc(endpoints: OpenApiEndpointDef[]) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of endpoints) {
    if (!paths[ep.path]) {
      paths[ep.path] = {};
    }

    const operation: Record<string, unknown> = {
      summary: ep.summary,
      description: ep.description || ep.summary,
      tags: ep.tags || ["General"],
      responses: {
        "200": {
          description: "Successful operation",
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${ep.responseSchemaName}`,
              },
            },
          },
        },
        "400": {
          description: "Bad Request or Validation Error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiErrorResponse" },
            },
          },
        },
        "401": ep.requiresAuth
          ? {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiErrorResponse" },
                },
              },
            }
          : undefined,
      },
    };

    if (ep.requiresAuth) {
      operation.security = [{ bearerAuth: [] }, { cookieAuth: [] }];
    }

    if (ep.parameters && ep.parameters.length > 0) {
      operation.parameters = ep.parameters;
    }

    if (ep.requestBodySchemaName) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: `#/components/schemas/${ep.requestBodySchemaName}`,
            },
          },
        },
      };
    }

    paths[ep.path][ep.method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Velnox Marketplace API",
      version: "1.0.0",
      description:
        "Official REST API Specification for Velnox Marketplace. Serves Web Storefront (Shop), Seller Dashboard, Operations Center, and Native Android Apps.",
      contact: {
        name: "Velnox Engineering Team",
        url: "https://velnox.live",
      },
    },
    servers: [
      {
        url: "https://api.velnox.live",
        description: "Production Edge API (Cloudflare Workers)",
      },
      {
        url: "http://localhost:3000",
        description: "Local Development API",
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Used by Native Mobile Apps and Service Clients via Authorization: Bearer <token>",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "velnox_session",
          description: "Used by Web Storefront, Seller, and Center via httpOnly SameSite Cookies",
        },
      },
      schemas: {
        ApiResponse: {
          type: "object",
          required: ["success", "data"],
          properties: {
            success: { type: "boolean", const: true },
            data: { type: "object" },
            meta: { $ref: "#/components/schemas/PaginationMeta" },
          },
        },
        PaginationMeta: {
          type: "object",
          required: ["page", "limit", "total", "totalPages", "hasMore", "timestamp"],
          properties: {
            page: { type: "integer", minimum: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            total: { type: "integer", minimum: 0 },
            totalPages: { type: "integer", minimum: 0 },
            hasMore: { type: "boolean" },
            timestamp: { type: "integer" },
          },
        },
        ApiErrorResponse: {
          type: "object",
          required: ["success", "error"],
          properties: {
            success: { type: "boolean", const: false },
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: { type: "object" },
              },
            },
          },
        },
        HealthCheckResponse: { $ref: "#/components/schemas/ApiResponse" },
        LoginInput: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
            rememberMe: { type: "boolean" },
          },
        },
        RegisterInput: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string" },
            phone: { type: "string" },
            role: { type: "string", enum: ["customer", "seller"] },
          },
        },
        TokenRefreshInput: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
        TokenExchangeInput: {
          type: "object",
          required: ["provider", "idToken"],
          properties: {
            provider: { type: "string", enum: ["google", "line"] },
            idToken: { type: "string" },
            nonce: { type: "string" },
          },
        },
        AddToCartInput: {
          type: "object",
          required: ["productId", "quantity"],
          properties: {
            productId: { type: "string" },
            variantId: { type: "string" },
            quantity: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };
}
