/**
 * Velnox Stripe Payment Endpoints
 *
 * POST   /api/stripe/checkout         — Create Stripe Checkout Session
 * POST   /api/payments/stripe/webhook — Stripe webhook handler (raw body)
 * GET    /api/stripe/configured       — Check if Stripe is configured
 * GET    /api/stripe/payment-status/:sessionId — Get payment status
 * GET    /api/orders/:orderId         — Get order with payment status
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/index.js";
import Stripe from "stripe";

// Lazy-initialized Stripe client (only when STRIPE_SECRET_KEY is set)
let stripe: Stripe | null = null;

function getStripe(): Stripe | null {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" as any });
  return stripe;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/**
 * Generate a human-readable order number like VNX-20260826-AB12CD
 */
function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `VNX-${dateStr}-${rand}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────

export function setupStripeRoutes(app: Express): void {
  // ── GET /api/stripe/configured ──────────────────────────────────────────
  app.get("/api/stripe/configured", (_req: Request, res: Response) => {
    res.json({ success: true, data: { configured: !!process.env.STRIPE_SECRET_KEY } });
  });

  // ── POST /api/stripe/checkout ───────────────────────────────────────────
  // Creates a Stripe Checkout Session for an already-created order.
  // The order must exist with status = 'pending_payment' or 'pending'.
  app.post("/api/stripe/checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      const s = getStripe();
      if (!s) {
        res.status(503).json({ success: false, error: { code: "STRIPE_NOT_CONFIGURED", message: "Stripe is not configured on this server" } });
        return;
      }

      const userId = req.user!.userId;
      const { orderId, returnPath } = req.body as { orderId?: string; returnPath?: string };

      if (!orderId || typeof orderId !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "orderId is required" } });
        return;
      }

      // Fetch order and verify ownership
      const orderResult = await query(
        `SELECT o.id, o.user_id, o.order_number, o.total_amount, o.currency, o.status
         FROM orders o WHERE o.id = $1`,
        [orderId],
      );
      if (orderResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const order = orderResult.rows[0];
      if (order.user_id !== userId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not your order" } });
        return;
      }
      if (!["pending", "pending_payment"].includes(order.status)) {
        res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: `Order status '${order.status}' cannot be paid` } });
        return;
      }

      // Fetch order items for Stripe line items
      const itemsResult = await query(
        `SELECT oi.product_name_snapshot, oi.quantity, oi.subtotal, oi.price,
                oi.image_url_snapshot, sh.name AS shop_name
         FROM order_items oi
         LEFT JOIN shops sh ON oi.shop_id = sh.id
         WHERE oi.order_id = $1`,
        [orderId],
      );

      const frontendUrl = process.env.VITE_VELSHOP_URL || "https://velshop.vercel.app";
      const backendUrl = process.env.API_URL || process.env.RENDER_EXTERNAL_URL || "https://velnox-api.onrender.com";

      // Build Stripe Checkout Session
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = itemsResult.rows.map((item: any) => ({
        price_data: {
          currency: (order.currency || "THB").toLowerCase(),
          product_data: {
            name: item.product_name_snapshot || "Product",
            ...(item.image_url_snapshot ? { images: [item.image_url_snapshot] } : {}),
          },
          unit_amount: Math.round(Number(item.price) * 100), // Stripe uses cents
        },
        quantity: item.quantity,
      }));

      // If no line items, add a fallback
      if (lineItems.length === 0) {
        lineItems.push({
          price_data: {
            currency: "thb",
            product_data: { name: `Order ${order.order_number || orderId}` },
            unit_amount: Math.round(Number(order.total_amount) * 100),
          },
          quantity: 1,
        });
      }

      const session = await s.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order=${orderId}`,
        cancel_url: `${frontendUrl}/checkout/cancel?order=${orderId}`,
        metadata: {
          orderId: orderId,
          userId: userId,
          orderNumber: order.order_number || "",
        },
        // Use Stripe's built-in email collection
        customer_creation: "always",
        // Allow promotion codes
        allow_promotion_codes: true,
      });

      // Update order status to pending_payment and store session ID
      await query(
        `UPDATE orders SET status = 'pending_payment', updated_at = NOW() WHERE id = $1`,
        [orderId],
      );

      // Update or create payment record with Stripe session
      const existingPayment = await query(
        `SELECT id FROM payments WHERE order_id = $1 AND provider = 'stripe'`,
        [orderId],
      );

      if (existingPayment.rows.length > 0) {
        await query(
          `UPDATE payments SET provider_checkout_session_id = $1, updated_at = NOW() WHERE id = $2`,
          [session.id, existingPayment.rows[0].id],
        );
      } else {
        await query(
          `INSERT INTO payments (order_id, provider, provider_checkout_session_id, amount, currency, status)
           VALUES ($1, 'stripe', $2, $3, $4, 'pending')`,
          [orderId, session.id, order.total_amount, order.currency || "THB"],
        );
      }

      res.json({ success: true, data: { url: session.url, sessionId: session.id } });
    } catch (err) {
      console.error("[stripe] checkout error:", err);
      res.status(500).json({ success: false, error: { code: "STRIPE_ERROR", message: "Failed to create checkout session" } });
    }
  });

  // ── POST /api/payments/stripe/webhook ──────────────────────────────────
  // NOTE: This endpoint uses raw body (configured in server.ts) and skips JSON parsing.
  app.post("/api/payments/stripe/webhook", async (req: Request, res: Response) => {
    try {
      const s = getStripe();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!s || !webhookSecret) {
        console.warn("[stripe webhook] Stripe not configured — ignoring webhook");
        res.status(200).json({ received: true });
        return;
      }

      // Verify Stripe signature
      const sig = req.headers["stripe-signature"] as string;
      if (!sig) {
        res.status(400).json({ error: "Missing stripe-signature header" });
        return;
      }

      let event: Stripe.Event;
      try {
        event = s.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        console.error("[stripe webhook] Signature verification failed:", err.message);
        res.status(400).json({ error: "Invalid signature" });
        return;
      }

      // Deduplicate: check if we've already processed this event
      const existingEvent = await query(
        `SELECT id FROM payment_events WHERE event_id = $1`,
        [event.id],
      );
      if (existingEvent.rows.length > 0) {
        console.log(`[stripe webhook] Duplicate event ${event.id} — skipping`);
        res.status(200).json({ received: true });
        return;
      }

      // Record the event
      await query(
        `INSERT INTO payment_events (provider, event_id, event_type, payload)
         VALUES ('stripe', $1, $2, $3)`,
        [event.id, event.type, JSON.stringify(event.data.object)],
      );

      console.log(`[stripe webhook] Processing event: ${event.type} (${event.id})`);

      // Handle the event
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = session.metadata?.orderId;
          if (!orderId) {
            console.warn("[stripe webhook] checkout.session.completed with no orderId in metadata");
            break;
          }

          await withTransaction(async (client) => {
            // Update order status to paid
            await client.query(
              `UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'pending_payment')`,
              [orderId],
            );

            // Update payment record
            await client.query(
              `UPDATE payments SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
               provider_payment_id = $1
               WHERE order_id = $2 AND provider = 'stripe'`,
              [session.payment_intent as string || session.id, orderId],
            );

            // Decrement inventory for each order item
            const items = await client.query(
              `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
              [orderId],
            );
            for (const item of items.rows) {
              await client.query(
                `UPDATE inventory SET reserved = GREATEST(0, reserved - $1) WHERE product_id = $2`,
                [item.quantity, item.product_id],
              );
              // Also increment sold_count on the product
              await client.query(
                `UPDATE products SET sold_count = sold_count + $1 WHERE id = $2`,
                [item.quantity, item.product_id],
              );
            }

            console.log(`[stripe webhook] Order ${orderId} marked as paid`);
          });
          break;
        }

        case "checkout.session.expired": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orderId = session.metadata?.orderId;
          if (orderId) {
            await query(
              `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'pending_payment'`,
              [orderId],
            );
            console.log(`[stripe webhook] Order ${orderId} cancelled (checkout expired)`);
          }
          break;
        }

        case "payment_intent.payment_failed": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          const orderId = paymentIntent.metadata?.orderId;
          if (orderId) {
            await query(
              `UPDATE payments SET status = 'failed', updated_at = NOW()
               WHERE order_id = $1 AND provider = 'stripe'`,
              [orderId],
            );
            await query(
              `UPDATE orders SET status = 'payment_failed', updated_at = NOW() WHERE id = $1`,
              [orderId],
            );
            console.log(`[stripe webhook] Order ${orderId} payment failed`);
          }
          break;
        }

        default:
          console.log(`[stripe webhook] Unhandled event type: ${event.type}`);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[stripe webhook] Error:", err);
      // Always return 200 to Stripe to prevent retries for non-transient errors
      res.status(200).json({ received: true });
    }
  });

  // ── GET /api/stripe/payment-status/:sessionId ───────────────────────────
  app.get("/api/stripe/payment-status/:sessionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const s = getStripe();
      const sessionId = param(req, "sessionId");

      if (!s) {
        res.status(503).json({ success: false, error: { code: "STRIPE_NOT_CONFIGURED", message: "Stripe not configured" } });
        return;
      }

      if (!sessionId) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "sessionId is required" } });
        return;
      }

      const session = await s.checkout.sessions.retrieve(sessionId);
      const orderId = session.metadata?.orderId;

      res.json({
        success: true,
        data: {
          status: session.status,
          paymentStatus: session.payment_status,
          orderId,
          amountTotal: session.amount_total,
          currency: session.currency,
        },
      });
    } catch (err) {
      console.error("[stripe] payment-status error:", err);
      res.status(500).json({ success: false, error: { code: "STRIPE_ERROR", message: "Failed to retrieve payment status" } });
    }
  });

  // ── GET /api/orders/:orderId ────────────────────────────────────────────
  // Returns order with items and payment status (for success page polling)
  app.get("/api/orders/:orderId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orderId = param(req, "orderId");

      const orderResult = await query(
        `SELECT o.*, sh.name AS shop_name, sh.slug AS shop_slug
         FROM orders o
         LEFT JOIN shops sh ON o.shop_id = sh.id
         WHERE o.id = $1`,
        [orderId],
      );
      if (orderResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }

      const order = orderResult.rows[0];
      if (order.user_id !== userId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not your order" } });
        return;
      }

      // Fetch order items
      const itemsResult = await query(
        `SELECT oi.*, sh.name AS shop_name
         FROM order_items oi
         LEFT JOIN shops sh ON oi.shop_id = sh.id
         WHERE oi.order_id = $1
         ORDER BY oi.created_at ASC`,
        [orderId],
      );

      // Fetch payment info
      const paymentResult = await query(
        `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orderId],
      );

      const payment = paymentResult.rows[0] ?? null;

      res.json({
        success: true,
        data: {
          id: order.id,
          orderNumber: order.order_number,
          status: order.status,
          subtotal: parseFloat(order.subtotal || order.total_amount || 0),
          shippingFee: parseFloat(order.shipping_fee || 0),
          discount: parseFloat(order.discount || 0),
          total: parseFloat(order.total_amount || 0),
          currency: order.currency,
          shopName: order.shop_name,
          shopSlug: order.shop_slug,
          items: itemsResult.rows.map((r: any) => ({
            id: r.id,
            productId: r.product_id,
            productName: r.product_name_snapshot || r.product_name || "",
            variantName: r.variant_name_snapshot,
            imageUrl: r.image_url_snapshot,
            quantity: r.quantity,
            price: parseFloat(r.price),
            subtotal: parseFloat(r.subtotal || 0),
            shopId: r.shop_id,
            shopName: r.shop_name,
          })),
          payment: payment ? {
            id: payment.id,
            provider: payment.provider,
            status: payment.status,
            paidAt: payment.paid_at,
          } : null,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
        },
      });
    } catch (err) {
      console.error("[orders] detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch order" } });
    }
  });
}
