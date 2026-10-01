/**
 * VelRepeat V2 — Phase 3: Seller Package → draft Repeat Plan → immutable
 * Pricing Snapshot.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IMPLEMENTS, AND NOTHING ELSE
 * ─────────────────────────────────────────────
 *   customer package read → purchase-time validation → canonical pricing
 *   engine → draft Repeat Plan → immutable Pricing Snapshot (+ snapshot items),
 *   ALL inside ONE `withTransaction`. Any failure rolls the whole thing back:
 *   there is no partial plan and no partial snapshot.
 *
 * OWNER DECISIONS THIS PHASE IS BUILT ON
 * ──────────────────────────────────────
 *   Q-A  A V2 plan created from a package starts as `draft`. `active` is set in
 *        Phase 4 only, after the prepaid charge is confirmed. This module never
 *        writes `active` and never updates a plan after creation, so the V1
 *        scheduler — whose due query requires `status = 'active' AND
 *        next_run_at <= NOW()` (`backend/jobs/velrepeat-scheduler.ts`) — cannot
 *        process a Phase 3 plan. No scheduler workaround exists anywhere here.
 *   Q-B  `approved` seller = eligible. The package's seller is read from the
 *        package row and its `sellers.status` is re-checked at purchase time.
 *        No seller tier, eligibility table or feature flag is introduced. G3 is
 *        re-enforced through the canonical Phase 2 gate.
 *   Q-C  Plan before payment: this module creates the unpaid draft; Phase 4 owns
 *        the Stripe charge, the payment linkage and the draft → active step.
 *
 * PRICING (unchanged from Phase 2 — no second engine, no second money module)
 * ──────────────────────────────────────────────────────────────────────────
 *   G1   sequential/multiplicative stacking, via `computeCommitmentPricingWithLines`
 *   G1.1 maximum 30% effective discount, FAIL CLOSED (never clamped/trimmed)
 *   G2   full precision, THB, exactly one 2-decimal round at the final output
 *   E    the purchase-time price and composition are snapshotted and immutable
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────
 *   • no payment — no Stripe call, no `payments` row, no `payment_method`
 *     write, no COD pseudo-payment (Phase 4);
 *   • no inventory — no reservation, no stock mutation, no `sold_count` (Phase 6);
 *   • no fulfillment — no order, no cycle, no shipment (Phase 5/6);
 *   • no V1 change — `POST /api/velrepeat/plans`, `repeat-now`, the V1 scheduler
 *     and every existing V1 path are untouched (this is a NEW, separate route
 *     namespace: `/api/velrepeat/v2/*`);
 *   • no schema change — it writes only columns that already exist;
 *   • no money maths of its own — `backend/lib/money.ts` and
 *     `backend/lib/velrepeat-pricing.ts` are the only authorities, and no
 *     `parseFloat`/`Number()` participates in a monetary calculation.
 *
 * WHY THE ROUTES LIVE UNDER `/api/velrepeat/v2/`
 * ─────────────────────────────────────────────
 * `GET /api/velrepeat/packages/:packageId` is ALREADY owned by the V1
 * buy-ahead flow (`backend/routes/velrepeat.ts`, table `vrepeat_packages`).
 * Registering a second handler on that path would shadow one of the two and
 * would be exactly the duplicate endpoint that must not be created, so the V2
 * surfaces are grouped under a namespace that cannot collide with V1:
 *
 *   GET  /api/velrepeat/v2/packages/:packageId  — customer package read
 *   POST /api/velrepeat/v2/plans                — draft plan + snapshot
 *
 * (The seller-side authoring API stays where it was:
 * `GET|POST /api/seller/velrepeat/packages`, `backend/routes/velrepeat-packages.ts`.)
 */
import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";

import { withTransaction } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  VALID_FREQUENCIES,
  calculateNextRunAt,
  type FrequencyType,
} from "../jobs/velrepeat-scheduler.js";
import { ZERO, add, multiplyByQuantity, parseDecimal, toMoneyString } from "../lib/money.js";
import {
  InvalidPricingInputError,
  PricingCapExceededError,
  PricingConfigurationError,
  VELREPEAT_CURRENCY,
  computeCommitmentPricingWithLines,
  insertPricingSnapshot,
  loadPricingRuleSet,
  type CommitmentPricingRequestWithLines,
  type PricingRule,
  type SnapshotLine,
} from "../lib/velrepeat-pricing.js";
import {
  PackageAuthorizationError,
  authorizePackageComposition,
  type PackageItemInput,
  type ValidatedPackageItem,
} from "./velrepeat-packages.js";

/** Mirrors the UUID check the seller package routes already use. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The PostgreSQL `INTEGER` domain, which is what `commitment_cycles` is. A
 * larger value is not a business decision the platform may silently round — it
 * is simply not representable, so it is refused as invalid input instead of
 * becoming a 500 from the driver.
 */
const COMMITMENT_CYCLES_MAX = 2_147_483_647;

/**
 * Every refusal this module can make, as a typed error carrying the HTTP status
 * and the API error code — the same shape the Phase 2 package module uses.
 *
 * A typed error keeps the purchase path testable without an HTTP server and
 * guarantees that ONE refusal aborts the whole transaction.
 */
export class RepeatPlanPurchaseError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RepeatPlanPurchaseError";
    this.status = status;
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Request validation — the client supplies references and quantities only
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What a customer may send when buying a package commitment.
 *
 * NOTE what is NOT here: no seller id, no prices, no discount, no rule. A price
 * or a seller sent by a client is not read anywhere in this file — the seller
 * comes from the package row and the prices from the catalog.
 */
export interface PurchaseRequest {
  readonly packageId: string;
  /** Number of prepaid delivery cycles the customer chooses. */
  readonly commitmentCycles: number;
  readonly frequencyType: FrequencyType;
  readonly intervalValue: number;
}

export function parsePackageId(raw: unknown): string {
  if (typeof raw !== "string" || !isUuid(raw)) {
    throw new RepeatPlanPurchaseError(400, "VALIDATION_ERROR", "A valid packageId is required");
  }
  return raw;
}

/**
 * Validate the purchase body. Fails closed on anything unusable.
 *
 * The schedule (`frequencyType` / `intervalValue`) is REQUIRED here: a prepaid
 * commitment's schedule is part of the agreement, so no silent default is
 * applied on the customer's behalf. (V1's pay-per-run endpoint defaults them;
 * that defaulting is V1 behavior and is not inherited.)
 */
export function parsePurchaseRequest(raw: unknown): PurchaseRequest {
  const body = (raw ?? {}) as Record<string, unknown>;

  const packageId = parsePackageId(body.packageId);

  const cycles = body.commitmentCycles;
  if (typeof cycles !== "number" || !Number.isInteger(cycles) || cycles <= 0) {
    throw new RepeatPlanPurchaseError(
      400,
      "VALIDATION_ERROR",
      "commitmentCycles must be a positive integer",
    );
  }
  if (cycles > COMMITMENT_CYCLES_MAX) {
    throw new RepeatPlanPurchaseError(
      400,
      "VALIDATION_ERROR",
      "commitmentCycles is larger than the platform can represent",
    );
  }

  const frequencyType = body.frequencyType;
  if (
    typeof frequencyType !== "string" ||
    !VALID_FREQUENCIES.includes(frequencyType as FrequencyType)
  ) {
    throw new RepeatPlanPurchaseError(
      400,
      "VALIDATION_ERROR",
      `frequencyType must be one of ${VALID_FREQUENCIES.join(" | ")}`,
    );
  }

  const intervalValue = body.intervalValue;
  if (
    typeof intervalValue !== "number" ||
    !Number.isInteger(intervalValue) ||
    intervalValue <= 0 ||
    intervalValue > COMMITMENT_CYCLES_MAX
  ) {
    throw new RepeatPlanPurchaseError(
      400,
      "VALIDATION_ERROR",
      "intervalValue must be a positive integer",
    );
  }

  return {
    packageId,
    commitmentCycles: cycles,
    frequencyType: frequencyType as FrequencyType,
    intervalValue,
  };
}

/**
 * Map any internal failure onto a customer-safe refusal, or `null` when the
 * failure is not one this module understands (⇒ 500).
 *
 * Customer responses must never carry internal authorization reasons (a product
 * that is `draft`, a variant that is `archived`) or platform pricing
 * configuration (rule keys, discount values, the cap). The concrete reason is
 * logged server-side instead, and asserted in tests.
 */
export function toPurchaseError(error: unknown): RepeatPlanPurchaseError | null {
  if (error instanceof RepeatPlanPurchaseError) return error;
  if (
    error instanceof PricingCapExceededError ||
    error instanceof PricingConfigurationError ||
    error instanceof InvalidPricingInputError
  ) {
    return new RepeatPlanPurchaseError(
      409,
      "PRICING_UNAVAILABLE",
      "This package cannot be priced right now",
    );
  }
  if (error instanceof PackageAuthorizationError) {
    return new RepeatPlanPurchaseError(
      409,
      "PACKAGE_NOT_PURCHASABLE",
      "This package is not available for purchase",
    );
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Purchase-time package validation (server-side only)
// ═══════════════════════════════════════════════════════════════════════════

/** A package that passed every purchase-time check, with its validated lines. */
export interface PurchasablePackage {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly sellerId: string;
  readonly items: readonly ValidatedPackageItem[];
}

/**
 * The package must EXIST and be ACTIVE. Missing and inactive are reported
 * identically (404), exactly like the seller-side read: an unavailable package
 * is indistinguishable from one that was never there, and neither answer leaks
 * anything about the seller.
 */
export function assertPackageAvailable(row: { is_active?: unknown } | undefined): void {
  if (!row || row.is_active !== true) {
    throw new RepeatPlanPurchaseError(404, "PACKAGE_NOT_FOUND", "Package not found");
  }
}

/**
 * Q-B — `approved` seller = eligible for VelRepeat. Nothing else is required
 * and nothing else is allowed to be required: no tier, no eligibility table,
 * no feature flag. A suspended/pending seller's package is refused without
 * exposing the seller's status to the customer.
 */
export function assertSellerEligible(sellerStatus: unknown): void {
  if (sellerStatus !== "approved") {
    throw new RepeatPlanPurchaseError(
      409,
      "PACKAGE_NOT_PURCHASABLE",
      "This package is not available for purchase",
    );
  }
}

/**
 * Load and validate a package for purchase.
 *
 * Reads the package and its seller in ONE statement, then re-runs the canonical
 * Phase 2 composition gate over every item — so ownership, product eligibility
 * (`published`) and variant state (`active`) are the SAME rules that governed
 * authoring, and the catalog prices returned here are the authoritative ones.
 *
 * Every check is server-side. Nothing is accepted from the request: not a
 * seller id, not a price, not a discount.
 *
 * @throws RepeatPlanPurchaseError 404 when missing/inactive, 409 when it exists
 *         but may not be purchased by anyone right now.
 */
export async function loadPurchasablePackage(
  client: PoolClient,
  packageId: string,
): Promise<PurchasablePackage> {
  const header = await client.query(
    `SELECT p.id, p.name, p.description, p.is_active, p.seller_id, s.status AS seller_status
       FROM velrepeat_packages p
       JOIN sellers s ON s.id = p.seller_id
      WHERE p.id = $1`,
    [packageId],
  );

  assertPackageAvailable(header.rows[0]);
  const row = header.rows[0];
  assertSellerEligible(row.seller_status);

  const itemsResult = await client.query(
    `SELECT product_id, variant_id, quantity
       FROM velrepeat_package_items
      WHERE package_id = $1
      ORDER BY product_id ASC, variant_id ASC NULLS FIRST`,
    [packageId],
  );

  const items: PackageItemInput[] = itemsResult.rows.map((item) => ({
    productId: item.product_id as string,
    variantId: (item.variant_id as string | null) ?? null,
    quantity: item.quantity as number,
  }));

  // An empty composition cannot be priced (`computeCommitmentPricingWithLines`
  // requires at least one line), so it is refused as unpurchasable here rather
  // than surfacing as an internal error.
  if (items.length === 0) {
    throw new RepeatPlanPurchaseError(
      409,
      "PACKAGE_NOT_PURCHASABLE",
      "This package is not available for purchase",
    );
  }

  let validated: ValidatedPackageItem[];
  try {
    validated = await authorizePackageComposition(client, row.seller_id as string, items);
  } catch (error) {
    if (error instanceof PackageAuthorizationError) {
      // The reason (which product, which status) is internal: log it, never
      // return it.
      console.warn("[velrepeat-v2] package refused at purchase time:", {
        packageId,
        code: error.code,
        reason: error.message,
      });
      throw new RepeatPlanPurchaseError(
        409,
        "PACKAGE_NOT_PURCHASABLE",
        "This package is not available for purchase",
      );
    }
    throw error;
  }

  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    sellerId: row.seller_id as string,
    items: validated,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Catalog price → exact money (the only adapter)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Turn validated package lines into snapshot lines.
 *
 * The catalog stores `NUMERIC(12, 2)`, which the driver returns as an exact
 * decimal STRING; `parseDecimal` turns that string into an exact rational, so
 * no IEEE-754 value exists at any point in the pipeline.
 */
export function packageLinesFromItems(items: readonly ValidatedPackageItem[]): SnapshotLine[] {
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity,
    unitPrice: parseDecimal(item.unitPrice),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. The write path — draft plan + immutable snapshot, one transaction
// ═══════════════════════════════════════════════════════════════════════════

export interface CreatedDraftPlan {
  readonly planId: string;
  readonly status: "draft";
  readonly frequencyType: FrequencyType;
  readonly intervalValue: number;
  readonly commitmentCycles: number;
  readonly nextRunAt: string;
  readonly snapshotId: string;
  readonly currency: string;
  readonly basePrice: string;
  readonly discountAmount: string;
  /** The discounted price of ONE delivery cycle. */
  readonly cyclePrice: string;
  /**
   * THE amount a prepaid customer owes for the WHOLE commitment:
   * cyclePrice × commitmentCycles, rounded once. This is the number a future
   * UI must display as "you will be charged", and the number Phase 4 charges.
   */
  readonly totalPrepaidAmount: string;
  readonly effectiveDiscountPercent: string;
}

/**
 * Create the draft plan AND its immutable pricing snapshot.
 *
 * MUST be called inside the caller's `withTransaction`: the plan, its lines,
 * the snapshot, the snapshot items and the audit event are ONE unit of work.
 * If any statement fails — including the snapshot insert — the whole
 * transaction rolls back and neither the plan nor the snapshot exists.
 *
 * The plan is written with status `draft` (Q-A) and deliberately WITHOUT
 * `payment_method`/`payment_method_ref` (Phase 4 owns payment semantics), without
 * `started_at` (Phase 4 owns the activation instant) and without inventory,
 * orders or cycles.
 */
export async function createDraftPlanFromPackage(
  client: PoolClient,
  userId: string,
  request: PurchaseRequest,
): Promise<CreatedDraftPlan> {
  // ── 1. Validate: package, seller, every item, catalog prices ────────────
  const pkg = await loadPurchasablePackage(client, request.packageId);

  // ── 2. The one pricing authority (platform data, never source constants) ─
  const rules: PricingRule[] = await loadPricingRuleSet(client);
  const lines = packageLinesFromItems(pkg.items);

  // ── 3. The plan row. `draft` is the only status this phase may write. ────
  // `next_run_at` is NOT NULL and is the same canonical derivation V1 uses;
  // a draft is invisible to the scheduler's `status = 'active'` due query, and
  // Phase 4 decides the real activation instant.
  const nextRunAt = calculateNextRunAt(new Date(), request.frequencyType, request.intervalValue);
  const planResult = await client.query(
    `INSERT INTO velrepeat_plans
       (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
     VALUES ($1, 'draft', $2, $3, $4, $5)
     RETURNING id`,
    [
      userId,
      request.frequencyType,
      request.intervalValue,
      request.commitmentCycles,
      nextRunAt.toISOString(),
    ],
  );
  const planId = planResult.rows[0].id as string;

  // ── 4. Plan lines: the existing composition architecture (§40.1) — a plan
  //       from a package reduces to the same lines the run engine reads. ─────
  for (const item of pkg.items) {
    await client.query(
      `INSERT INTO velrepeat_items
         (plan_id, product_id, variant_id, shop_id, seller_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        planId,
        item.productId,
        item.variantId,
        item.shopId,
        pkg.sellerId,
        item.quantity,
        toMoneyString(parseDecimal(item.unitPrice)),
      ],
    );
  }

  // ── 5. Price it once, then freeze it (decision E) ────────────────────────
  const snapshotRequest: CommitmentPricingRequestWithLines = {
    planId,
    commitmentCycles: request.commitmentCycles,
    lines,
    rules,
    sellerId: pkg.sellerId,
    packageId: pkg.id,
  };
  const pricing = computeCommitmentPricingWithLines(snapshotRequest);
  const snapshotId = await insertPricingSnapshot(client, snapshotRequest, pricing);

  // ── 6. Audit event — the existing vocabulary and table ───────────────────
  await client.query(
    `INSERT INTO velrepeat_events (plan_id, event_type, metadata)
     VALUES ($1, 'PLAN_CREATED', $2::jsonb)`,
    [
      planId,
      JSON.stringify({
        source: "package",
        package_id: pkg.id,
        commitment_cycles: request.commitmentCycles,
        snapshot_id: snapshotId,
        status: "draft",
      }),
    ],
  );

  return {
    planId,
    status: "draft",
    frequencyType: request.frequencyType,
    intervalValue: request.intervalValue,
    commitmentCycles: request.commitmentCycles,
    nextRunAt: nextRunAt.toISOString(),
    snapshotId,
    currency: pricing.currency,
    basePrice: pricing.basePriceString,
    discountAmount: pricing.discountAmountString,
    cyclePrice: pricing.cyclePrice,
    totalPrepaidAmount: pricing.totalPrepaidString,
    effectiveDiscountPercent: pricing.effectiveDiscountPercentString,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. The customer read view — a projection, never a second validator
// ═══════════════════════════════════════════════════════════════════════════

interface PackageDisplayRow {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  product_name: string;
  shop_name: string;
  variant_name: string | null;
  image_url: string | null;
}

export interface PackageItemView {
  readonly productId: string;
  readonly variantId: string | null;
  readonly productName: string;
  readonly variantName: string | null;
  readonly shopName: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly imageUrl: string | null;
}

export interface PackageView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly currency: string;
  readonly basePrice: string;
  readonly items: readonly PackageItemView[];
}

/**
 * Build the customer-visible package view from ALREADY VALIDATED lines.
 *
 * The item set is driven by the validated lines, never by the display rows: an
 * item that did not pass the purchase-time gate cannot appear here even if the
 * projection returned it. No seller id, no product/variant status, no stock, no
 * audit metadata and no pricing configuration is ever included; prices come
 * from the canonical validation gate and are formatted by `money.ts`.
 */
export function buildPackageView(
  pkg: PurchasablePackage,
  display: readonly PackageDisplayRow[],
): PackageView {
  const byKey = new Map(display.map((row) => [`${row.product_id}:${row.variant_id ?? "base"}`, row]));

  let base = ZERO;
  const items: PackageItemView[] = pkg.items.map((item) => {
    const shown = byKey.get(`${item.productId}:${item.variantId ?? "base"}`);
    const unitPrice = parseDecimal(item.unitPrice);
    const lineTotal = multiplyByQuantity(unitPrice, item.quantity);
    base = add(base, lineTotal);
    return {
      productId: item.productId,
      variantId: item.variantId,
      productName: shown?.product_name ?? item.productName,
      variantName: shown?.variant_name ?? null,
      shopName: shown?.shop_name ?? "",
      quantity: item.quantity,
      unitPrice: toMoneyString(unitPrice),
      lineTotal: toMoneyString(lineTotal),
      imageUrl: shown?.image_url ?? null,
    };
  });

  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    currency: VELREPEAT_CURRENCY,
    basePrice: toMoneyString(base),
    items,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Routes
// ═══════════════════════════════════════════════════════════════════════════

/** Map a refusal onto the repository's canonical error envelope. */
function fail(res: Response, error: unknown): void {
  const refusal = toPurchaseError(error);
  if (refusal) {
    res.status(refusal.status).json({
      success: false,
      error: { code: refusal.code, message: refusal.message },
    });
    return;
  }
  console.error("[velrepeat-v2] unexpected failure:", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Could not complete the request" },
  });
}

export function setupVelRepeatV2PlanRoutes(app: Express): void {
  // ── GET /api/velrepeat/v2/packages/:packageId — customer package read ────
  app.get(
    "/api/velrepeat/v2/packages/:packageId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const packageId = parsePackageId(String(req.params.packageId ?? ""));

        const view = await withTransaction(async (client) => {
          // Purchasability is proven BEFORE anything is projected, so an
          // unpublished product or an inactive variant cannot be read here.
          const pkg = await loadPurchasablePackage(client, packageId);
          const display = await client.query(
            `SELECT i.product_id, i.variant_id, i.quantity,
                    p.name AS product_name,
                    sh.name AS shop_name,
                    pv.name AS variant_name,
                    (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS image_url
               FROM velrepeat_package_items i
               JOIN products p ON p.id = i.product_id
               JOIN shops sh ON sh.id = p.shop_id
               LEFT JOIN product_variants pv ON pv.id = i.variant_id
              WHERE i.package_id = $1
              ORDER BY p.name ASC, i.variant_id ASC`,
            [packageId],
          );
          return buildPackageView(pkg, display.rows as PackageDisplayRow[]);
        });

        res.json({ success: true, data: { package: view } });
      } catch (error) {
        fail(res, error);
      }
    },
  );

  // ── POST /api/velrepeat/v2/plans — draft plan + immutable snapshot ───────
  app.post("/api/velrepeat/v2/plans", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const request = parsePurchaseRequest(req.body);

      const created = await withTransaction((client) =>
        createDraftPlanFromPackage(client, userId, request),
      );

      console.log(
        `[velrepeat-v2] draft plan created: ${created.planId} package=${request.packageId} ` +
          `user=${userId} cycles=${created.commitmentCycles} snapshot=${created.snapshotId} ` +
          `cycle=${created.cyclePrice} totalPrepaid=${created.totalPrepaidAmount} ${created.currency}`,
      );

      res.status(201).json({
        success: true,
        data: {
          plan: {
            id: created.planId,
            status: created.status,
            frequencyType: created.frequencyType,
            intervalValue: created.intervalValue,
            commitmentCycles: created.commitmentCycles,
            nextRunAt: created.nextRunAt,
          },
          pricing: {
            currency: created.currency,
            basePrice: created.basePrice,
            discountAmount: created.discountAmount,
            // The price of ONE delivery cycle …
            cyclePrice: created.cyclePrice,
            // … and what is actually charged for the whole prepaid commitment.
            // They are equal only when commitmentCycles is 1.
            totalPrepaidAmount: created.totalPrepaidAmount,
            effectiveDiscountPercent: created.effectiveDiscountPercent,
          },
          snapshotId: created.snapshotId,
        },
      });
    } catch (error) {
      fail(res, error);
    }
  });
}
