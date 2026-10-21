/**
 * Raw-body preservation for `POST /api/mvp/payments/webhook`.
 *
 * Stripe signs the exact bytes it sends, so the MVP webhook verifies a Buffer —
 * never a re-serialised object. This reuses the SAME matching rule and the same
 * parser as the pre-MVP webhook (`middleware/stripe-raw-body.ts`): case-insensitive
 * path, trailing slash tolerated, and the content type is not a gate. Only the
 * path list differs, so the two webhooks cannot drift apart in how they buffer
 * or verify a body.
 *
 * Must be mounted BEFORE `express.json()` in `server.ts`, and before
 * `express.json()` in any test app builder.
 */
import { stripeWebhookRawBodyFor } from "../middleware/stripe-raw-body.js";

export const MVP_STRIPE_WEBHOOK_PATH = "/api/mvp/payments/webhook";

export const mvpWebhookRawBody = stripeWebhookRawBodyFor([MVP_STRIPE_WEBHOOK_PATH]);
