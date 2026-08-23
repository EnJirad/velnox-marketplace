# Velnox Installation Guide

## Prerequisites

1. **Bun** — `curl -fsSL https://bun.sh/install | bash`
2. **Node.js** 18+

## Step 1: Clone & Install

```bash
git clone https://github.com/EnJirad/velnox.git
cd velnox
bun install
```

## Step 2: Environment Variables

Create `.env` in project root:
```env
VITE_API_URL=http://localhost:3001/api
```

## Step 3: Start Development

### VelShop (Customer Storefront)
```bash
bun run dev:shop
# Opens at http://localhost:5173
```

### VelSeller (Merchant Management)
```bash
bun run dev:seller
# Opens at http://localhost:5174
```

### VelCenter (Admin Management)
```bash
bun run dev:center
# Opens at http://localhost:5175
```

## Step 4: Backend (Optional for full functionality)

```bash
cd backend
bun install
# Create backend/.env with DATABASE_URL, GOOGLE_CLIENT_ID, etc.
bun run dev
# Runs at http://localhost:3001
```

## Step 5: Database (Optional)

1. Create a Neon project at https://neon.tech
2. Paste `db/run-sqleditor.sql` into Neon SQL Editor
3. Set `DATABASE_URL` in backend `.env`

## Step 6: Verify

- VelShop shows landing page at http://localhost:5173
- Language selector works (ไทย, English, မြန်မာ)
- Currency selector works (฿ THB, $ USD, K MMK)

## Build

```bash
bun run typecheck    # Typecheck all
bun run build:shop   # Build VelShop
bun run build:seller # Build VelSeller
bun run build:center # Build VelCenter
```
