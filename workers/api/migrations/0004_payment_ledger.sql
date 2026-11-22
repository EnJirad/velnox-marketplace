-- ============================================================================
-- Velnox Marketplace Clean Rebuild — Migration 0004: Payment & Finance Schema
-- Version: 2.0.0
-- Applies to: Clean Neon PostgreSQL Database
-- ============================================================================

-- Table: payments (Payment Transactions & Gateway References)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('stripe', 'promptpay', 'cod', 'bank_transfer')),
  payment_intent_id TEXT UNIQUE,
  amount BIGINT NOT NULL CHECK (amount >= 0), -- satang minor units
  currency TEXT NOT NULL DEFAULT 'THB',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
  idempotency_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_intent_id ON payments (payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);

-- Table: ledger_accounts (Chart of Accounts for Double-Entry Bookkeeping)
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  balance BIGINT NOT NULL DEFAULT 0, -- satang minor units
  currency TEXT NOT NULL DEFAULT 'THB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_code ON ledger_accounts (account_code);

-- Table: ledger_transactions (Double-Entry Balanced Transactions)
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_number ON ledger_transactions (transaction_number);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_idempotency ON ledger_transactions (idempotency_key);

-- Table: ledger_entries (Debits & Credits Posting Entries)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES ledger_accounts(account_code) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount BIGINT NOT NULL CHECK (amount > 0), -- satang minor units
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_tx_id ON ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (account_code);

-- Table: seller_settlements (Seller Earnings & Platform Commission Settlements)
CREATE TABLE IF NOT EXISTS seller_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  gross_amount BIGINT NOT NULL CHECK (gross_amount >= 0), -- satang
  platform_fee BIGINT NOT NULL CHECK (platform_fee >= 0), -- satang
  net_amount BIGINT NOT NULL CHECK (net_amount >= 0), -- satang
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'paid_out', 'cancelled')),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_settlements_seller_id ON seller_settlements (seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_settlements_shop_id ON seller_settlements (shop_id);
CREATE INDEX IF NOT EXISTS idx_seller_settlements_order_id ON seller_settlements (order_id);
CREATE INDEX IF NOT EXISTS idx_seller_settlements_status ON seller_settlements (status);

-- Seed Default Chart of Accounts for Marketplace Satang Double-Entry Ledger
INSERT INTO ledger_accounts (account_code, name, type, balance)
VALUES
  ('platform_cash', 'Platform Payment Gateway Clearing Account', 'asset', 0),
  ('seller_payable', 'Accounts Payable to Marketplace Sellers', 'liability', 0),
  ('platform_revenue', 'Marketplace Commission & Platform Revenue', 'revenue', 0),
  ('refund_clearing', 'Customer Refund Clearing Account', 'expense', 0)
ON CONFLICT (account_code) DO NOTHING;
