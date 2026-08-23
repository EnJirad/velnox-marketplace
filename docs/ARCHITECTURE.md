# Velnox Architecture

## Overview

Three independent frontend applications communicating with a unified REST API backend.

## Frontend Apps

| App | Purpose | Port | Responsive |
|-----|---------|------|------------|
| VelShop | Customer storefront | 5173 | Mobile-first |
| VelSeller | Merchant management | 5174 | Desktop-first |
| VelCenter | Admin management | 5175 | Desktop-first |

## Shared Packages

- `@velnox/i18n` — Translation system (th, en, my)
- `@velnox/api` — Centralized API client
- `@velnox/types` — Shared TypeScript types
- `@velnox/hooks` — useAuth, useCart, useIsMobile
- `@velnox/utils` — formatPrice, formatDate, slugify
- `@velnox/ui` — LoadingSpinner, EmptyState, ErrorState, Skeleton, LanguageSelector, CurrencySelector, ProductCard, AvatarUpload

## Backend

Express + TypeScript REST API on Render:
- Authentication (Google OAuth + JWT)
- Products, Categories, Shops
- Cart, Orders, Addresses
- File uploads (R2 presigned URLs)

## Database

Single Neon PostgreSQL with domain-separated tables:
- Customer: users, addresses, carts, orders
- Seller: sellers, shops, products, inventory
- Center: employees, departments, settings
- Shared: media, categories

## i18n

Custom context-based system with 3 languages:
- Thai (default)
- English
- Burmese

All user-facing text uses `t("key")` pattern.

## Currency

THB, USD, MMK — independent from language.
