import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { DbQueryable } from "../../../database/src/types.ts";
import { IdentityService } from "../../src/modules/identity/services/identity-service.ts";
import { DualTokenService } from "../../src/core/security/tokens.ts";
import { hashPassword, verifyPassword } from "../../src/core/security/password.ts";
import { authenticateRequest, assertUserRole } from "../../src/core/middleware/auth-middleware.ts";
import { CheckoutService } from "../../src/modules/checkout/services/checkout-service.ts";
import { InventoryService } from "../../src/modules/inventory/services/inventory-service.ts";
import {
  PaymentService,
  type WebhookProcessResult,
} from "../../src/modules/payment/services/payment-service.ts";
import {
  calculatePlatformFeeMinor,
  calculateSellerPayableMinor,
  verifyStripeSignature,
} from "../../src/modules/payment/domain/payment.ts";
import {
  createCustomerPaymentTransaction,
  createSellerSettlementTransaction,
  validateTransaction,
  type LedgerTransaction,
} from "../../../packages/ledger/src/index.ts";
import { LedgerDomainService } from "../../src/modules/ledger/services/ledger-domain-service.ts";
import { RealtimeHub, type SocketConnection } from "../../src/modules/realtime/services/realtime-hub.ts";
import { PushNotificationService } from "../../src/modules/realtime/services/push-notification-service.ts";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "../../src/core/errors/app-error.ts";

describe("E2E Integration — Velnox Master Rebuild Architecture", () => {
  const jwtSecret = "velnox_jwt_e2e_secret_key_32_bytes_super_secure!";
  const webhookSecret = "whsec_e2e_test_webhook_secret_key_987654321";

  function createSignedPayload(payload: any, timestamp = Math.floor(Date.now() / 1000)) {
    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const signatureHeader = `t=${timestamp},v1=${signature}`;
    return { rawBody, signatureHeader };
  }

  // =========================================================================
  // SCENARIO 1: Identity & Dual-Token Authentication Lifecycle
  // =========================================================================
  describe("Scenario 1: Identity & Dual-Token Auth", () => {
    const usersDb = new Map<string, any>();
    const tokensDb = new Map<string, any>();

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        // Check user exists by email
        if (q.includes("FROM users WHERE email = $1")) {
          const user = Array.from(usersDb.values()).find((u) => u.email === params?.[0]);
          return { rows: user ? [user] : [] };
        }
        // Check user exists by id
        if (q.includes("FROM users WHERE id = $1")) {
          const user = usersDb.get(params?.[0]);
          return { rows: user ? [user] : [] };
        }
        // Insert user
        if (q.includes("INSERT INTO users")) {
          const user = {
            id: `usr_${Date.now()}`,
            email: params?.[0],
            name: params?.[1],
            password_hash: params?.[2],
            role: params?.[3] ?? "customer",
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          usersDb.set(user.id, user);
          return { rows: [user] };
        }
        // Save refresh token
        if (q.includes("INSERT INTO refresh_tokens")) {
          const tokenRecord = {
            id: params?.[0],
            user_id: params?.[1],
            family_id: params?.[2],
            token_hash: params?.[3],
            expires_at: params?.[4],
            revoked_at: null,
          };
          tokensDb.set(tokenRecord.id, tokenRecord);
          return { rows: [tokenRecord] };
        }
        // Check revoked
        if (q.includes("FROM revoked_tokens WHERE jti = $1")) {
          return { rows: [] };
        }
        // Revoke token
        if (q.includes("INSERT INTO revoked_tokens")) {
          return { rows: [] };
        }
        // Find refresh token by id
        if (q.includes("FROM refresh_tokens WHERE id = $1")) {
          const token = tokensDb.get(params?.[0]);
          return { rows: token ? [token] : [] };
        }
        // Update refresh token revoked_at
        if (q.includes("UPDATE refresh_tokens SET revoked_at")) {
          const token = tokensDb.get(params?.[1]);
          if (token) token.revoked_at = params?.[0];
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    it("registers user, validates scrypt hash, issues dual tokens, and checks RBAC", async () => {
      // 1. Register Alice
      const regResult = await IdentityService.register(
        mockDb,
        {
          email: "alice@example.com",
          password: "Password123!",
          name: "Alice Marketplace",
        },
        jwtSecret,
      );

      assert.ok(regResult.user.id);
      assert.equal(regResult.user.email, "alice@example.com");
      assert.equal(regResult.user.role, "customer");
      assert.ok(regResult.tokens.accessToken);
      assert.ok(regResult.tokens.refreshToken);

      // Verify scrypt hash format
      const user = usersDb.get(regResult.user.id);
      assert.ok(user.password_hash.startsWith("$scrypt$"));
      const isPasswordValid = await verifyPassword("Password123!", user.password_hash);
      assert.equal(isPasswordValid, true);

      // 2. Authenticate Request via Bearer Token
      const authenticatedUser = await authenticateRequest(
        mockDb,
        { authorization: `Bearer ${regResult.tokens.accessToken}` },
        jwtSecret,
      );
      assert.equal(authenticatedUser.userId, regResult.user.id);
      assert.equal(authenticatedUser.role, "customer");

      // 3. RBAC Route Assertion
      // Customer role allowed:
      assert.doesNotThrow(() => assertUserRole(authenticatedUser, ["customer", "seller"]));
      // Admin role forbidden:
      assert.throws(
        () => assertUserRole(authenticatedUser, ["admin", "superadmin"]),
        (err: any) => err instanceof ForbiddenError,
      );

      // 4. Token Rotation
      const rotated = await IdentityService.refreshToken(
        mockDb,
        regResult.tokens.refreshToken,
        jwtSecret,
      );
      assert.ok(rotated.accessToken);
      assert.ok(rotated.refreshToken);
      assert.notEqual(rotated.refreshToken, regResult.tokens.refreshToken);
    });
  });

  // =========================================================================
  // SCENARIO 2: Multi-Shop Cart & Atomic Checkout
  // =========================================================================
  describe("Scenario 2: Multi-Shop Cart & Atomic Checkout", () => {
    let reservedItems: Array<{ productId: string; qty: number }> = [];

    const mockCartItems = [
      {
        id: "ci_1",
        cart_id: "cart_e2e",
        product_id: "prod_alpha_1",
        variant_id: null,
        quantity: 2,
        product_title: "Alpha Headphones",
        product_price: "500.00", // 500.00 THB = 50,000 satang each (total 100,000 satang)
        shop_id: "shop_alpha",
        shop_name: "Alpha Electronics",
      },
      {
        id: "ci_2",
        cart_id: "cart_e2e",
        product_id: "prod_beta_1",
        variant_id: null,
        quantity: 1,
        product_title: "Beta Mechanical Keyboard",
        product_price: "250.00", // 250.00 THB = 25,000 satang
        shop_id: "shop_beta",
        shop_name: "Beta Gadgets",
      },
    ];

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        // Check duplicate checkout group
        if (q.includes("FROM checkout_groups") && q.includes("idempotency_key = $1")) {
          return { rows: [] }; // Not duplicate
        }
        // Find cart
        if (q.includes("SELECT id FROM carts")) {
          return { rows: [{ id: "cart_e2e" }] };
        }
        // Cart items
        if (q.includes("FROM cart_items ci")) {
          return { rows: mockCartItems };
        }
        // Reserve stock
        if (q.includes("UPDATE inventory") && q.includes("reserved = reserved + $1")) {
          reservedItems.push({ productId: params?.[1], qty: params?.[0] });
          return { rows: [{ product_id: params?.[1], stock: 100, reserved: params?.[0] }] };
        }
        // Create checkout group
        if (q.includes("INSERT INTO checkout_groups")) {
          return { rows: [{ id: "cg_e2e_123" }] };
        }
        // Create orders
        if (q.includes("INSERT INTO orders")) {
          const shopId = params?.[2];
          return {
            rows: [
              {
                id: `ord_${shopId}`,
                user_id: params?.[1],
                shop_id: shopId,
                checkout_group_id: params?.[0],
                status: "pending",
                payment_status: "pending",
                currency: "THB",
                total: params?.[3],
                items_snapshot: params?.[4],
                shipping_address: params?.[5],
                billing_address: params?.[6],
                shipping_carrier: params?.[7],
                payment_expires_at: new Date(Date.now() + 1800000).toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        // Create order item
        if (q.includes("INSERT INTO order_items")) {
          return { rows: [{ id: "oi_mock_1" }] };
        }
        // Clear cart
        if (q.includes("DELETE FROM cart_items")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    it("splits multi-shop items into distinct orders with guarded inventory reservation", async () => {
      reservedItems = [];
      const checkoutResult = await CheckoutService.checkout(
        mockDb,
        "usr_e2e_customer",
        "idemp_checkout_999",
      );

      // Verify checkout group creation
      assert.equal(checkoutResult.checkoutGroup.id, "cg_e2e_123");
      // Verify split orders: exactly 2 distinct orders (one for Shop Alpha, one for Shop Beta)
      assert.equal(checkoutResult.orders.length, 2);

      const orderAlpha = checkoutResult.orders.find((o) => o.shopId === "shop_alpha");
      const orderBeta = checkoutResult.orders.find((o) => o.shopId === "shop_beta");

      assert.ok(orderAlpha);
      assert.ok(orderBeta);
      assert.equal(orderAlpha.totalAmountMinor, 100000n); // 2 * 50,000 satang
      assert.equal(orderBeta.totalAmountMinor, 25000n);  // 1 * 25,000 satang

      // Verify inventory was atomically reserved for both products
      assert.equal(reservedItems.length, 2);
      assert.deepEqual(reservedItems, [
        { productId: "prod_alpha_1", qty: 2 },
        { productId: "prod_beta_1", qty: 1 },
      ]);
    });
  });

  // =========================================================================
  // SCENARIO 3: Stripe Payment Webhook Processing & Ledger Integration
  // =========================================================================
  describe("Scenario 3: Payment Webhook, Replay Protection & Ledger", () => {
    let orderPaid = false;
    let stockCommitted = false;
    let ledgerEntries: any[] = [];
    let claimedEvents = new Set<string>();

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        // Claim webhook event idempotently: $1 is provider, $2 is event_id
        if (q.includes("INSERT INTO payment_events")) {
          const eventId = params?.[1];
          if (claimedEvents.has(eventId)) {
            return { rows: [] }; // Duplicate: ON CONFLICT DO NOTHING returned 0 rows
          }
          claimedEvents.add(eventId);
          return { rows: [{ id: eventId, status: "processing" }] };
        }
        // Check existing payment event on conflict duplicate check
        if (q.includes("FROM payment_events WHERE event_id = $1")) {
          return { rows: [{ id: params?.[0], status: "processed" }] };
        }
        // Update payment event status
        if (q.includes("UPDATE payment_events SET status = $1") || q.includes("UPDATE payment_events")) {
          return { rows: [] };
        }
        // Find payment by session or provider ID
        if (q.includes("FROM payments") && (q.includes("provider_checkout_session_id = $1") || q.includes("provider_payment_id = $1") || q.includes("stripe_session_id = $1"))) {
          return {
            rows: [
              {
                id: "pay_mock_123",
                checkout_group_id: "cg_e2e_123",
                user_id: "usr_alice",
                status: "pending",
                amount: "1000.00",
                currency: "THB",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        // Lock orders for checkout group
        if (q.includes("FROM orders") && q.includes("checkout_group_id = $1") && q.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: "ord_shop_alpha",
                shop_id: "shop_alpha",
                status: "pending",
                total_amount: "1000.00",
                checkout_group_id: "cg_e2e_123",
                inventory_released: false,
              },
            ],
          };
        }
        // Mark orders paid
        if (q.includes("UPDATE orders") && q.includes("SET status = 'paid'")) {
          orderPaid = true;
          return {
            rows: [
              {
                id: "ord_shop_alpha",
                shop_id: "shop_alpha",
                status: "paid",
                total_amount: "1000.00",
                checkout_group_id: "cg_e2e_123",
                inventory_released: false,
              },
            ],
          };
        }
        // Update payment attempt status
        if (q.includes("UPDATE payments SET status = $1")) {
          return { rows: [] };
        }
        // Get order items for inventory commit
        if (q.includes("FROM order_items") && q.includes("order_id = ANY")) {
          return {
            rows: [
              {
                id: "oi_1",
                order_id: "ord_shop_alpha",
                product_id: "prod_alpha_1",
                variant_id: null,
                quantity: 2,
              },
            ],
          };
        }
        // Commit inventory stock
        if (q.includes("UPDATE inventory") && q.includes("quantity = GREATEST(0, quantity - $1)")) {
          stockCommitted = true;
          return { rows: [] };
        }
        // Seller ID for shop
        if (q.includes("FROM shops WHERE id = $1")) {
          return { rows: [{ seller_id: "seller_alpha" }] };
        }
        // Commission record
        if (q.includes("INSERT INTO commissions")) {
          return { rows: [{ id: "comm_1" }] };
        }
        // Insert journal entry
        if (q.includes("INSERT INTO journal_entries")) {
          return { rows: [{ id: "je_e2e_1" }] };
        }
        // Insert ledger entries
        if (q.includes("INSERT INTO ledger_entries")) {
          ledgerEntries.push({
            idempotency_key: params?.[0],
            entry_type: params?.[1],
            account: params?.[2],
            direction: params?.[3],
            amount: params?.[4],
            currency: params?.[5],
          });
          return { rows: [{ id: `le_${Date.now()}` }] };
        }
        return { rows: [] };
      },
    };

    it("verifies webhook signature, rejects replay attacks, commits stock, and posts double-entry ledger", async () => {
      const payload = {
        id: "evt_stripe_payment_e2e_999",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_e2e_session_123",
            client_reference_id: "cg_e2e_123",
            metadata: {
              checkoutGroupId: "cg_e2e_123",
            },
            payment_status: "paid",
            amount_total: 100000, // 1,000.00 THB in satang
            currency: "thb",
          },
        },
      };

      // 1. Signature Verification with Anti-Replay Guard
      const { rawBody, signatureHeader } = createSignedPayload(payload);
      const isValid = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
      assert.equal(isValid, true);

      // Replay attack with expired timestamp (>300 seconds old) must be rejected
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 350;
      const expired = createSignedPayload(payload, expiredTimestamp);
      assert.equal(
        verifyStripeSignature(expired.rawBody, expired.signatureHeader, webhookSecret),
        false,
      );

      // 2. Process Genuine Webhook
      const result: WebhookProcessResult = await PaymentService.handleStripeWebhook(
        mockDb,
        rawBody,
        signatureHeader,
        webhookSecret,
      );

      assert.equal(result.received, true);
      assert.equal(result.duplicate, false);
      assert.equal(result.settledOrdersCount, 1);
      assert.equal(orderPaid, true);
      assert.equal(stockCommitted, true);

      // 3. Double-Entry Invariant Verification
      // Gross: 100,000 satang. 5% platform fee = 5,000 satang. Seller payable = 95,000 satang.
      assert.equal(ledgerEntries.length, 3);
      const debitEntry = ledgerEntries.find((e) => e.direction === "debit");
      const sellerPayableCredit = ledgerEntries.find((e) => e.account === "seller_payable");
      const platformFeeCredit = ledgerEntries.find((e) => e.account === "platform_revenue");

      assert.ok(debitEntry);
      assert.equal(debitEntry.account, "platform_cash");
      assert.equal(BigInt(debitEntry.amount), 100000n);

      assert.ok(sellerPayableCredit);
      assert.equal(BigInt(sellerPayableCredit.amount), 95000n);

      assert.ok(platformFeeCredit);
      assert.equal(BigInt(platformFeeCredit.amount), 5000n);

      // Strict Zero-Float Satang Invariant: Debits == Credits
      const totalDebits = BigInt(debitEntry.amount);
      const totalCredits = BigInt(sellerPayableCredit.amount) + BigInt(platformFeeCredit.amount);
      assert.equal(totalDebits, totalCredits);

      // 4. Test Idempotent Duplicate Delivery
      const duplicateResult = await PaymentService.handleStripeWebhook(
        mockDb,
        rawBody,
        signatureHeader,
        webhookSecret,
      );
      assert.equal(duplicateResult.received, true);
      assert.equal(duplicateResult.duplicate, true);
    });
  });

  // =========================================================================
  // SCENARIO 4: Realtime Hub & Push Notification Architecture
  // =========================================================================
  describe("Scenario 4: Realtime Hub & Push Notification Suppression", () => {
    it("handles multi-tab presence tracking and suppresses push when actively viewing conversation", async () => {
      const hub = new RealtimeHub();

      const receivedTab1: any[] = [];
      const receivedTab2: any[] = [];

      const tab1Client: SocketConnection = {
        id: "sock_alice_tab1",
        userId: "usr_alice",
        send: (msg: string) => receivedTab1.push(JSON.parse(msg)),
      };

      const tab2Client: SocketConnection = {
        id: "sock_alice_tab2",
        userId: "usr_alice",
        send: (msg: string) => receivedTab2.push(JSON.parse(msg)),
      };

      // 1. Multi-tab Presence
      hub.registerClient(tab1Client, "usr_alice");
      hub.registerClient(tab2Client, "usr_alice");

      let presence = hub.getUserPresence("usr_alice");
      assert.equal(presence.isOnline, true);
      assert.equal(presence.activeConnectionsCount, 2);

      // 2. Pub/Sub Channel Broadcast
      hub.subscribe("sock_alice_tab1", "order:cg_e2e_123");
      hub.subscribe("sock_alice_tab2", "order:cg_e2e_123");

      const orderUpdatedData = { orderId: "ord_shop_alpha", status: "paid" };
      hub.broadcastToChannel("order:cg_e2e_123", "order:updated", orderUpdatedData);

      assert.equal(receivedTab1.length, 1);
      assert.equal(receivedTab2.length, 1);
      assert.equal(receivedTab1[0].event, "order:updated");
      assert.equal(receivedTab1[0].data.status, "paid");

      // 3. Active Conversation Viewing & Push Notification Suppression
      // Alice is actively viewing conversation conv_777 in Tab 1
      hub.setViewingConversation("usr_alice", "conv_777");
      assert.equal(hub.isUserViewingConversation("usr_alice", "conv_777"), true);

      const mockDb: DbQueryable = {
        async query(sql: string) {
          if (sql.includes("INSERT INTO notifications")) {
            return { rows: [{ id: "notif_db_1" }] };
          }
          if (sql.includes("FROM user_device_tokens")) {
            return { rows: [{ device_token: "fcm_token_alice_123", platform: "android" }] };
          }
          return { rows: [] };
        },
      };

      process.env.FIREBASE_PROJECT_ID = "velnox-test";
      process.env.FIREBASE_CLIENT_EMAIL = "firebase@velnox-test.iam.gserviceaccount.com";
      process.env.FIREBASE_PRIVATE_KEY = "test_key";

      // Dispatch chat message notification while viewing -> Push should be SUPPRESSED
      const suppressedResult = await PushNotificationService.dispatchNotification(
        mockDb,
        {
          recipientUserId: "usr_alice",
          title: "New Message",
          body: "Seller: Your package has shipped!",
          category: "chat",
          conversationId: "conv_777",
        },
        hub,
      );

      assert.equal(suppressedResult.suppressedByPresence, true);
      assert.equal(suppressedResult.pushDispatched, false);

      // Alice navigates away from conv_777
      hub.setViewingConversation("usr_alice", null);
      assert.equal(hub.isUserViewingConversation("usr_alice", "conv_777"), false);

      // Dispatch chat message notification now -> Push should be DISPATCHED
      const dispatchedResult = await PushNotificationService.dispatchNotification(
        mockDb,
        {
          recipientUserId: "usr_alice",
          title: "New Message",
          body: "Seller: Any other questions?",
          category: "chat",
          conversationId: "conv_777",
        },
        hub,
      );

      assert.equal(dispatchedResult.suppressedByPresence, false);
      assert.equal(dispatchedResult.pushDispatched, true);
      assert.equal(dispatchedResult.pushStatus, "delivered");

      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;

      // 4. Disconnect Tab 1 -> Alice remains online via Tab 2
      hub.unregisterClient("sock_alice_tab1");
      presence = hub.getUserPresence("usr_alice");
      assert.equal(presence.isOnline, true);
      assert.equal(presence.activeConnectionsCount, 1);

      // Disconnect Tab 2 -> Alice transitions to offline
      hub.unregisterClient("sock_alice_tab2");
      presence = hub.getUserPresence("usr_alice");
      assert.equal(presence.isOnline, false);
      assert.equal(presence.activeConnectionsCount, 0);
    });
  });

  // =========================================================================
  // SCENARIO 5: Automated Seller Payout & Full Double-Entry Audit
  // =========================================================================
  describe("Scenario 5: Seller Settlement & Full Ledger Audit", () => {
    it("executes seller settlement and verifies total ledger balance integrity", async () => {
      const ledgerEntries: any[] = [];

      // 1. Accrued balance: Seller Alpha has 95,000 satang accrued in seller_payable
      const mockDb: DbQueryable = {
        async query(sql: string, params?: any[]) {
          const q = sql.trim();
          // Query seller payable balance
          if (q.includes("account = 'seller_payable'") && q.includes("seller_id = $1")) {
            return {
              rows: [
                { direction: "credit", total: "95000" },
                { direction: "debit", total: "0" },
              ],
            };
          }
          // Insert settlements record
          if (q.includes("INSERT INTO settlements")) {
            return { rows: [{ id: "set_alpha_999" }] };
          }
          // Update settlements status
          if (q.includes("UPDATE settlements SET status = $1") || q.includes("UPDATE settlements SET status = $2")) {
            return { rows: [] };
          }
          // Insert journal entry
          if (q.includes("INSERT INTO journal_entries")) {
            return { rows: [{ id: "je_settlement_99" }] };
          }
          // Insert ledger entries
          if (q.includes("INSERT INTO ledger_entries")) {
            const entry = {
              id: `le_${ledgerEntries.length + 1}`,
              idempotency_key: params?.[0],
              entry_type: params?.[1],
              account: params?.[2],
              direction: params?.[3],
              amount_minor: params?.[4],
              currency: params?.[5],
            };
            ledgerEntries.push(entry);
            return { rows: [entry] };
          }
          // Audit verifyLedgerIntegrity: totalsRes
          if (q.includes("GROUP BY direction") && q.includes("FROM ledger_entries")) {
            return {
              rows: [
                { direction: "debit", total: "195000", count: "3" },
                { direction: "credit", total: "195000", count: "3" },
              ],
            };
          }
          // Audit verifyLedgerIntegrity: negativeRes
          if (q.includes("WHERE amount_minor <= 0")) {
            return { rows: [{ count: "0" }] };
          }
          return { rows: [] };
        },
      };

      // 2. Execute Seller Settlement for 95,000 satang
      const settlement = await PaymentService.executeSellerSettlement(
        mockDb,
        "seller_alpha",
        95000n,
        "idemp_settle_shop_alpha_1",
      );

      assert.equal(settlement.sellerId, "seller_alpha");
      assert.equal(settlement.amountMinor, 95000n);
      assert.equal(settlement.status, "completed");

      // Verify settlement ledger entry pair: Debit seller_payable, Credit platform_cash
      assert.equal(ledgerEntries.length, 2);
      const debit = ledgerEntries.find((e) => e.direction === "debit");
      const credit = ledgerEntries.find((e) => e.direction === "credit");

      assert.ok(debit);
      assert.equal(debit.account, "seller_payable");
      assert.equal(debit.amount_minor, "95000");

      assert.ok(credit);
      assert.equal(credit.account, "platform_cash");
      assert.equal(credit.amount_minor, "95000");

      // 3. Full Ledger Integrity Audit: Verify total debits == total credits across database
      const auditResult = await LedgerDomainService.verifyLedgerIntegrity(mockDb);
      assert.equal(auditResult.isBalanced, true);
      assert.equal(auditResult.totalDebitsMinor, 195000n);
      assert.equal(auditResult.totalCreditsMinor, 195000n);
      assert.equal(auditResult.discrepancyMinor, 0n);
      assert.equal(auditResult.invalidNegativeEntriesCount, 0);
    });
  });
});
