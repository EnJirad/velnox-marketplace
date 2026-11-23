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
  TURNSTILE_SECRET_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  R2_BUCKET?: R2Bucket;
  R2_PUBLIC_URL_PREFIX?: string;
  REALTIME_HUB?: DurableObjectNamespace;
  NOTIFICATIONS_QUEUE?: Queue<any>;
}

export interface Variables {
  requestId: string;
  startTime: number;
  user: JwtPayload;
}
