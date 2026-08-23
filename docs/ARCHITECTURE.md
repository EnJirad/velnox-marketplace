# Velnox Architecture

## Frontend Apps

| App | Purpose | Port | Responsive |
|-----|---------|------|------------|
| VelShop | Customer storefront | 5173 | Mobile-first |
| VelSeller | Merchant management | 5174 | Desktop-first |
| VelCenter | Admin management | 5175 | Desktop-first |

## Shared Packages

`@velnox/i18n`, `@velnox/api`, `@velnox/types`, `@velnox/hooks`, `@velnox/utils`, `@velnox/ui`

## Backend

Express + TypeScript REST API on Render.

## Database

Single Neon PostgreSQL with domain-separated tables.

## i18n

Thai (default), English, Burmese. All user-facing text uses `t("key")`.

## Currency

THB, USD, MMK — independent from language.
