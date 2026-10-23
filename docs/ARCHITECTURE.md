# Architecture

## Overview

Velnox Marketplace is a multi-vendor e-commerce platform with four independent frontend applications, one centralized backend, and a single PostgreSQL database.

## System Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  VelShop    │  │  VelSeller  │  │  VelCenter  │  │  Velnox     │
│  (Vercel)   │  │  (Vercel)   │  │  (Vercel)   │  │  (Vercel)   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────────────┘
       │                │                │
       └────────┬───────┴────────┬───────┘
                │                │
         ┌──────▼──────────────▼──────┐
         │    Backend API (Render)    │
         │    Express + WebSocket     │
         └──────┬──────────────┬──────┘
                │              │
         ┌──────▼──────┐ ┌────▼────┐
         │    Neon     │ │ Cloud   │
         │ PostgreSQL  │ │ R2      │
         └─────────────┘ └─────────┘
```

## Monorepo Structure

```
velnox-marketplace/
├── apps/           # 4 independent frontend apps
│   ├── velshop/    # Customer marketplace
│   ├── velseller/  # Seller management
│   ├── velcenter/  # Admin management
│   └── velnox/     # Corporate website
├── backend/        # Centralized API server
├── packages/       # Shared packages
│   ├── ui/         # Reusable UI components
│   ├── api-client/ # API client
│   ├── i18n/       # Internationalization
│   ├── shared/     # Types, constants, utilities
│   ├── types/      # TypeScript types
│   ├── hooks/      # React hooks
│   ├── utils/      # Utility functions
│   └── config/     # Shared configuration
├── db/             # Database schema and migrations
└── docs/           # Documentation
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS v4
- **UI:** shadcn/ui, Radix UI, Framer Motion
- **Backend:** Express, TypeScript, Node.js
- **Database:** Neon PostgreSQL
- **Storage:** Cloudflare R2
- **Realtime:** WebSocket
- **Auth:** Google OAuth + JWT cookies
- **Deployment:** Vercel (frontend), Render (backend)
- **Package Manager:** Bun with workspaces
