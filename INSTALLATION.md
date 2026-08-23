# Velnox Installation

## Quick Start

```bash
git clone https://github.com/EnJirad/velnox-marketplace.git
cd velnox-marketplace
bun install

# Start VelShop
bun run dev:shop

# Or start all three
bun run dev:seller
bun run dev:center
```

## Environment

Create `.env` with:
```
VITE_API_URL=http://localhost:3001/api
```

## Backend (Optional)

```bash
cd backend
bun install
bun run dev
```

Requires: DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET

## Build

```bash
bun run typecheck    # Typecheck all
bun run build:shop   # Build VelShop
bun run build:seller # Build VelSeller
bun run build:center # Build VelCenter
```

## Languages

Thai (default), English, Burmese — selector in header.
Currencies: THB, USD, MMK — independent from language.
