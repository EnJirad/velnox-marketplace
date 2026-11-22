/**
 * Cloudflare Workers Runtime Environment Bindings & Context Variables
 */

import type { JwtPayload } from "./core/security/jwt.js";

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
  user: JwtPayload;
}
