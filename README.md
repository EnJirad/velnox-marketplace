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

## Repository Structure

```
velnox/
├── src/                    # VelShop (customer storefront - root app)
├── apps/
│   ├── shop/              # VelShop (standalone build for Vercel)
│   ├── seller/            # VelSeller (merchant management)
│   └── center/            # VelCenter (admin management)
├── packages/
│   ├── i18n/              # Translation system (th, en, my)
│   ├── api/               # Shared API client
│   ├── types/             # Shared TypeScript types
│   ├── hooks/             # useAuth, useCart, useIsMobile
│   ├── utils/             # formatPrice, formatDate, etc.
│   └── ui/                # Shared UI components
├── backend/               # Express API server
├── db/                    # Database schema & migrations
└── docs/                  # Documentation
```

## Development

```bash
bun install
bun run dev:shop       # VelShop (port 5173)
bun run dev:seller     # VelSeller (port 5174)
bun run dev:center     # VelCenter (port 5175)
bun run typecheck      # Typecheck all
```

## i18n

3 languages: Thai (default), English, Burmese
3 currencies: THB, USD, MMK (independent from language)

## Deployment

| App | Platform | Root |
|-----|----------|------|
| VelShop | Vercel | `apps/shop/` or root |
| VelSeller | Vercel | `apps/seller/` |
| VelCenter | Vercel | `apps/center/` |
| Backend | Render | `backend/` |

## Environment Variables

### Frontend (Vercel)
```
VITE_API_URL=
```

### Backend (Render)
```
DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
R2_BUCKET, R2_PUBLIC_DOMAIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
JWT_SECRET, PORT, CORS_ORIGINS
```

## License

Private — Velnox
