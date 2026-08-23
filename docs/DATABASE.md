# Database

## Source of Truth

Neon PostgreSQL is the only source of truth. All business data lives here.

## Schema Files

- `db/schema.sql` — Complete canonical schema
- `db/run-sqleditor.sql` — Idempotent bootstrap (safe for empty or existing DB)
- `db/migrations/` — Sequential migration files

## Tables

### Customer Domain
- `users` — User accounts (email unique, normalized)
- `auth_identities` — OAuth provider links (provider + provider_id unique)
- `customer_profiles` — Extended customer data
- `addresses` — Shipping/billing addresses
- `carts` — Shopping carts (one per user)
- `cart_items` — Cart line items

### Seller Domain
- `sellers` — Seller accounts linked to users
- `shops` — Seller storefronts (slug unique)
- `categories` — Product categories (hierarchical)
- `products` — Product listings
- `product_images` — Product photos
- `inventory` — Stock levels per product

### Commerce Domain
- `orders` — Customer orders
- `order_items` — Order line items
- `payments` — Payment records
- `refunds` — Refund records
- `commissions` — Platform commissions
- `settlements` — Seller payouts
- `subscriptions` — Seller subscription plans

### Company Domain
- `departments` — Internal departments
- `employees` — Employee records
- `company_settings` — Key-value settings
- `audit_logs` — Change audit trail

### Other
- `media` — File metadata (R2 stores binaries)
- `behavioral_events` — Customer behavior tracking
- `notifications` — User notifications

## Migration Rules

1. All migrations must be idempotent
2. Never use DROP TABLE or TRUNCATE
3. Use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
4. After migration: update schema.sql, run-sqleditor.sql, AI_Handoff.md
