# Velnox Database

## Overview

Velnox uses a **single Neon PostgreSQL database** with domain-separated tables.

**Principle:** ONE DATABASE, multiple domains. No separate databases per app.

## Connection

```
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/velnox?sslmode=require
```

## Tables by Domain

### Customer Domain

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email, name, avatar) |
| `user_auth_identities` | OAuth provider links (Google sub ID) |
| `customer_profiles` | Customer preferences (JSONB) |
| `addresses` | Shipping addresses |
| `carts` | One cart per user |
| `cart_items` | Products in cart with quantity and price |
| `orders` | Purchase orders with status tracking |
| `order_items` | Products in each order |
| `notifications` | User notifications |
| `behavioral_events` | User behavior tracking (views, searches, purchases) |

### Seller Domain

| Table | Purpose |
|-------|---------|
| `sellers` | Seller accounts linked to users |
| `shops` | Storefronts with branding |
| `products` | Product listings with pricing |
| `product_images` | Product photos (URLs point to R2) |
| `inventory` | Stock quantities and thresholds |
| `seller_settings` | Seller preferences (JSONB) |
| `seller_analytics` | Daily metrics (views, orders, revenue) |

### Center Domain

| Table | Purpose |
|-------|---------|
| `departments` | Company departments |
| `employees` | Staff linked to users and departments |
| `company_settings` | Company configuration (JSONB) |
| `platform_settings` | Platform-wide settings (JSONB) |
| `audit_logs` | Action audit trail |
| `moderation_records` | Content moderation history |

### Shared Domain

| Table | Purpose |
|-------|---------|
| `media` | File metadata (R2 stores binaries) |
| `categories` | Product categories (hierarchical) |
| `system_settings` | Global system settings (JSONB) |

## Key Relationships

```
users ──1:1── carts
users ──1:N── addresses
users ──1:N── orders
users ──1:1── user_auth_identities (per provider)
users ──1:1── customer_profiles
users ──1:1── sellers
sellers ──1:1── shops
shops ──1:N── products
products ──1:N── product_images
products ──1:1── inventory
carts ──1:N── cart_items
orders ──1:N── order_items
categories ──self── categories (parent/child)
```

## Identity Resolution

The `user_auth_identities` table implements ONE PERSON = ONE USER:

```sql
-- Unique constraint prevents duplicate identities
UNIQUE(provider, provider_id)  -- Google sub ID
UNIQUE(user_id, provider)       -- One Google per user
```

Resolution algorithm:
1. Find by `(provider, provider_id)` → existing user
2. Find by normalized email → link identity to existing user
3. Create new user + identity + profile + cart

## Migrations

Located in `db/migrations/`:

| File | Tables |
|------|--------|
| `001_initial.sql` | media, categories, system_settings |
| `002_auth.sql` | users, user_auth_identities, customer_profiles |
| `003_customer.sql` | addresses, carts, cart_items, orders, order_items, notifications |
| `004_seller.sql` | sellers, shops, products, product_images, inventory, seller_settings, seller_analytics |
| `005_center.sql` | departments, employees, company_settings, platform_settings, audit_logs, moderation_records |
| `006_behavior.sql` | behavioral_events |

All migrations use `IF NOT EXISTS` for safe re-runs.

## Setup

Paste `db/run-sqleditor.sql` into the Neon SQL Editor to create the complete schema.
