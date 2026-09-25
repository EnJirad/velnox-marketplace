/**
 * Velnox payment configuration — the ONE decision point for
 * "may this deployment take a payment, with which methods, in which mode?".
 *
 * Every payment route reads its answer from here so the rules cannot drift
 * apart between endpoints. The safety model:
 *
 *   • **Stripe TEST MODE ONLY.** A live-looking secret key is *refused*, not
 *     used. It is never a warning, never a fallback.
 *   • **No silent fallback.** A missing key, an unrecognized key format, a
 *     declared `STRIPE_MODE` that disagrees with the key, or a missing webhook
 *     secret all resolve to "payment unavailable". There is no path that
 *     substitutes one credential for another.
 *   • **COD fails closed.** Only the literal `true`/`1` enables it; an absent,
 *     empty, misspelled, or quoted value means DISABLED. Missing configuration
 *     must never read as "enabled".
 *   • **The secret key never leaves this module's server-side callers**; only
 *     the publishable key is ever allowed to reach a browser.
 *
 * Nothing here logs, echoes, or returns a secret in a response body.
 */

// ─── Payment method domain ───────────────────────────────────────────────────

export type PaymentMethodId = "CARD" | "PROMPTPAY" | "COD";
export type PaymentProvider = "STRIPE" | "CARRIER";
export type StripeMode = "test" | "live";

export const PAYMENT_METHOD = {
  CARD: "CARD",
  PROMPTPAY: "PROMPTPAY",
  COD: "COD",
} as const;

/** Payment lifecycle states stored in `payments.status`. */
export const PAYMENT_STATUS = {
  /** Payment row exists, nothing has been sent to a provider yet. */
  PENDING: "pending",
  /** The customer must still act (card form, or scanning a PromptPay QR). */
  REQUIRES_ACTION: "requires_action",
  /** Handed to the provider, awaiting confirmation. */
  PROCESSING: "processing",
  /** Provider-confirmed success. Mirrors the existing Velnox "paid" state. */
  PAID: "paid",
  FAILED: "failed",
  CANCELED: "cancelled",
} as const;

/** Refund lifecycle stored in `payments.refund_status` (and mirrored on `refunds`). */
export const REFUND_STATUS = {
  PENDING: "pending",
  PARTIALLY_REFUNDED: "partially_refunded",
  REFUNDED: "refunded",
  FAILED: "failed",
} as const;

/**
 * Legacy wire values the storefront used before methods had explicit names.
 * `online` was the pre-foundation value for "pay with Stripe" and still maps to
 * CARD so an older client cannot be broken by the rename.
 */
const METHOD_ALIASES: Record<string, PaymentMethodId> = {
  online: "CARD",
  credit_card: "CARD",
  debit_card: "CARD",
  promptpay: "PROMPTPAY",
  qr: "PROMPTPAY",
  cash_on_delivery: "COD",
};

/**
 * Canonicalize a client-supplied payment method.
 * Returns `null` for anything unknown so callers can answer 400 rather than
 * guessing a default.
 */
export function normalizePaymentMethod(raw: unknown): PaymentMethodId | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const snake = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  const upper = snake.toUpperCase();
  if (upper === "CARD" || upper === "PROMPTPAY" || upper === "COD") {
    return upper as PaymentMethodId;
  }
  return METHOD_ALIASES[snake] ?? null;
}

/**
 * The Stripe Checkout payment-method type for a Velnox method.
 * `null` for COD, which has no Stripe rail.
 */
export function stripePaymentMethodType(method: PaymentMethodId): string | null {
  if (method === "CARD") return "card";
  if (method === "PROMPTPAY") return "promptpay";
  return null;
}

export function providerForMethod(method: PaymentMethodId): PaymentProvider {
  return method === "COD" ? "CARRIER" : "STRIPE";
}

// ─── Environment reads (values never logged) ─────────────────────────────────

function envString(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Classify a Stripe secret key **by shape only**.
 *
 * `null` means "not a credential this application is willing to use" — an
 * unrecognized or placeholder value. We never attempt a request with it.
 */
export function classifyStripeSecretKey(key: string | null): StripeMode | null {
  if (!key) return null;
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return null;
}

/** `pk_test_…` / `pk_live_…`; null when the value is not a publishable key. */
export function classifyStripePublishableKey(key: string | null): StripeMode | null {
  if (!key) return null;
  if (/^pk_test_/.test(key)) return "test";
  if (/^pk_live_/.test(key)) return "live";
  return null;
}

/** Machine-readable reasons a deployment cannot take a Stripe payment. */
export type StripeUnavailableReason =
  | "STRIPE_NOT_CONFIGURED"
  | "STRIPE_LIVE_KEY_REFUSED"
  | "STRIPE_KEY_UNRECOGNIZED"
  | "STRIPE_MODE_MISMATCH"
  | "STRIPE_WEBHOOK_NOT_CONFIGURED";

export interface StripeStatus {
  /** A test secret key is present and usable. */
  usable: boolean;
  /** Always `"test"` when `usable` — live mode is never reported as usable. */
  mode: StripeMode | null;
  /** Publishable (browser-safe) key, or null. Never a secret key. */
  publishableKey: string | null;
  publishableKeyMatchesMode: boolean;
  webhookConfigured: boolean;
  reason: StripeUnavailableReason | null;
}

/**
 * Resolve the Stripe configuration for this process.
 *
 * Deliberately reads `process.env` on every call (no module-level cache) so a
 * test can flip configuration between assertions and so a redeploy that changes
 * a key can never be masked by a stale snapshot.
 */
export function stripeStatus(): StripeStatus {
  const secret = envString("STRIPE_SECRET_KEY");
  const publishable = envString("STRIPE_PUBLISHABLE_KEY");
  const webhook = envString("STRIPE_WEBHOOK_SECRET");
  const declaredMode = envString("STRIPE_MODE")?.toLowerCase() ?? null;

  const secretMode = classifyStripeSecretKey(secret);
  const publishableMode = classifyStripePublishableKey(publishable);
  const webhookConfigured = Boolean(webhook);

  // Nothing is exposed until the WHOLE configuration is proven usable. A
  // half-configured deployment must not tell a browser which key to use, so
  // every refusal path below leaves this null.
  const base: StripeStatus = {
    usable: false,
    mode: null,
    publishableKey: null,
    publishableKeyMatchesMode: false,
    webhookConfigured,
    reason: null,
  };

  if (!secret) return { ...base, reason: "STRIPE_NOT_CONFIGURED" };
  if (secretMode === "live") return { ...base, reason: "STRIPE_LIVE_KEY_REFUSED" };
  if (secretMode === null) return { ...base, reason: "STRIPE_KEY_UNRECOGNIZED" };
  // An explicit STRIPE_MODE that disagrees with the key means the operator's
  // intent and the credential do not match. Refuse rather than pick a winner.
  if (declaredMode !== null && declaredMode !== "test") {
    return { ...base, mode: "test", reason: "STRIPE_MODE_MISMATCH" };
  }
  if (!webhookConfigured) {
    return { ...base, mode: "test", reason: "STRIPE_WEBHOOK_NOT_CONFIGURED" };
  }

  return {
    ...base,
    usable: true,
    mode: "test",
    publishableKey: publishableMode === "test" ? publishable : null,
    publishableKeyMatchesMode: publishableMode === "test",
    reason: null,
  };
}

/**
 * The server-only Stripe secret key, or `null` when payments must not run.
 * Callers must never put the return value in a response, a log line, or an
 * error message.
 */
export function stripeSecretKey(): string | null {
  const status = stripeStatus();
  if (!status.usable) return null;
  return envString("STRIPE_SECRET_KEY");
}

/** Server-only webhook signing secret, or `null`. */
export function stripeWebhookSecret(): string | null {
  return envString("STRIPE_WEBHOOK_SECRET");
}

// ─── COD feature flags (both default OFF) ────────────────────────────────────

/**
 * Is the COD rail enabled server-side?
 *
 * Fails **closed**: only an explicit `true`/`1` counts. This single flag is what
 * the COD API guard reads, so an absent variable can never open the rail.
 */
export function isCodEnabled(): boolean {
  const raw = envString("COD_ENABLED")?.toLowerCase() ?? null;
  return raw === "true" || raw === "1";
}

/**
 * May COD be offered to a customer in the storefront?
 *
 * Separate from `isCodEnabled()` on purpose: a deployment may enable the rail
 * backend-side without exposing it as a checkout choice. Defaults to OFF, and
 * can never be true while the rail itself is disabled.
 */
export function isCodCustomerSelectable(): boolean {
  const raw = envString("COD_CUSTOMER_SELECTABLE")?.toLowerCase() ?? null;
  const declared = raw === "true" || raw === "1";
  return declared && isCodEnabled();
}

// ─── Method discovery ────────────────────────────────────────────────────────

export interface PaymentMethodOption {
  id: PaymentMethodId;
  provider: PaymentProvider;
  /** Selectable by a customer right now. */
  enabled: boolean;
  /** Present only for methods that route through Stripe. */
  stripePaymentMethodType: string | null;
}

/**
 * Every method the platform knows about, with whether it is currently usable.
 *
 * CARD/PROMPTPAY require a *usable* Stripe configuration (test mode + webhook
 * secret). COD requires its feature flag — which is off by default and must stay
 * off until a carrier/settlement model exists.
 */
export function paymentMethodOptions(): PaymentMethodOption[] {
  const stripe = stripeStatus();
  return [
    {
      id: "CARD",
      provider: "STRIPE",
      enabled: stripe.usable,
      stripePaymentMethodType: "card",
    },
    {
      id: "PROMPTPAY",
      provider: "STRIPE",
      enabled: stripe.usable,
      stripePaymentMethodType: "promptpay",
    },
    {
      id: "COD",
      provider: "CARRIER",
      enabled: isCodCustomerSelectable(),
      stripePaymentMethodType: null,
    },
  ];
}

/** The customer-selectable subset — what the storefront may render. */
export function customerSelectablePaymentMethods(): PaymentMethodId[] {
  return paymentMethodOptions()
    .filter((option) => option.enabled)
    .map((option) => option.id);
}

/**
 * Guard every payment-mutating endpoint runs.
 *
 * A method that is not currently selectable is rejected here, server-side,
 * regardless of what the frontend rendered. `COD_ENABLED=false` therefore makes
 * a direct API attempt fail even though the CLI never showed the option.
 */
export function assertPaymentMethodUsable(
  method: PaymentMethodId,
): { ok: true } | { ok: false; code: string; status: number; message: string } {
  if (method === "COD") {
    if (!isCodEnabled()) {
      return {
        ok: false,
        code: "PAYMENT_METHOD_DISABLED",
        status: 403,
        message: "Cash on delivery is not available.",
      };
    }
    return { ok: true };
  }

  const stripe = stripeStatus();
  if (!stripe.usable) {
    return {
      ok: false,
      code: stripe.reason ?? "STRIPE_NOT_CONFIGURED",
      status: 503,
      message: "Card and PromptPay payments are not available right now.",
    };
  }
  return { ok: true };
}
