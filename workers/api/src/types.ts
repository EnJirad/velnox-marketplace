/**
 * Cloudflare Workers Runtime Environment Bindings & Context Variables
 */

export interface Bindings {
  ENVIRONMENT?: string;
  APP_NAME?: string;
  APP_VERSION?: string;
  CORS_ORIGINS?: string;
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  R2_BUCKET?: R2Bucket;
}

export interface Variables {
  requestId: string;
  startTime: number;
}
