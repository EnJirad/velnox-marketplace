# Velnox

The modern e-commerce marketplace. Three independent frontend applications backed by a unified REST API.

## Architecture

```
                    Vercel
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       VelShop     VelSeller    VelCenter
          │           │           │
          └───────────┼───────────┘
                      ▼
                Render Backend
                 REST API
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       Neon DB                 Cloudflare R2
    PostgreSQL              Images / Files
```

**Stack:**
- **Frontend:** React 19 + TypeScript + Vite (Vercel)
- **Backend:** Node.js + Express + TypeScript (Render)
- **Database:** Neon PostgreSQL (single database, domain-separated)
- **File Storage:** Cloudflare R2
- **i18n:** Thai (default), English, Burmese
- **Currency:** THB, USD, MMK

## Repository Structure

```
velnox/
├── src/                    # VelShop (customer storefront)
├── apps/
│   ├── seller/            # VelSeller (merchant management)
│   └── center/            # VelCenter (admin management)
├── packages/
│   ├── i18n/              # Translation system (th, en, my)
│   ├── api/               # Shared API client
│   ├── types/             # Shared TypeScript types
│   ├── hooks/             # Shared React hooks (useAuth, useCart)
│   ├── utils/             # Shared utilities (formatPrice, etc.)
│   └── ui/                # Shared UI components
├── backend/               # Express API server
├── db/                    # Database schema & migrations
└── docs/                  # Documentation
```

## Development

```bash
# Install dependencies
bun install

# Start VelShop (customer storefront)
bun run dev:shop

# Start VelSeller (merchant management)
bun run dev:seller

# Start VelCenter (admin management)
bun run dev:center

# Typecheck all
bun run typecheck
```

## i18n

Three languages supported:
- **Thai (th)** — Default
- **English (en)**
- **Burmese (my)**

Language selector persists to localStorage. All user-facing text uses `t("key")` pattern.

## Deployment

| App | Platform | Root |
|-----|----------|------|
| VelShop | Vercel | `src/` |
| VelSeller | Vercel | `apps/seller/` |
| VelCenter | Vercel | `apps/center/` |
| Backend | Render | `backend/` |

## License

Private — Velnox
