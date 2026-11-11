CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  cutoff_day INTEGER NOT NULL DEFAULT 1 CHECK (cutoff_day BETWEEN 1 AND 31),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE budget_members (
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (budget_id, user_id)
);

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  type TEXT NOT NULL DEFAULT 'checking',
  closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (budget_id, name)
);

CREATE TABLE category_groups (
  id INTEGER PRIMARY KEY,
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (budget_id, name)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  UNIQUE (budget_id, name)
);

CREATE TABLE recurring (
  id INTEGER PRIMARY KEY,
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,            -- signed cents; negative = money out
  payee TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
  next_date TEXT NOT NULL,
  anchor_day INTEGER NOT NULL,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,            -- signed cents; negative = money out
  payee TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  memo TEXT NOT NULL DEFAULT '',
  cleared INTEGER NOT NULL DEFAULT 0,
  opening INTEGER NOT NULL DEFAULT 0, -- 1 = account opening balance
  transfer_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tx_budget_date ON transactions (budget_id, date);
CREATE INDEX idx_tx_account ON transactions (account_id, date);
CREATE INDEX idx_tx_category ON transactions (category_id, date);

-- Money assigned to a category for a period. The period is a 'YYYY-MM' label,
-- not a date range, so changing the budget's cutoff day needs no migration.
CREATE TABLE assignments (
  budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY (category_id, period)
);
