// The whole schema. SQLite, in the browser, persisted to IndexedDB.
// Bump SCHEMA_VERSION and add a step to MIGRATIONS to change it later.
export const SCHEMA_VERSION = 4

export const MIGRATIONS = [
  // 1
  `
  CREATE TABLE checkpoints (
    as_of_date   TEXT PRIMARY KEY,                -- YYYY-MM-DD
    source       TEXT,
    raw_json     TEXT NOT NULL,
    imported_at  TEXT NOT NULL
  );

  CREATE TABLE holdings (
    as_of_date   TEXT NOT NULL,
    sleeve       TEXT NOT NULL,                   -- equity_in | mf_in | equity_us | crypto | gold | debt
    symbol       TEXT NOT NULL,
    isin         TEXT,                            -- empty for US/crypto; primary join key for Indian
    name         TEXT,
    qty          REAL NOT NULL,
    price        REAL NOT NULL,                   -- per unit, in the holding's own currency
    invested     REAL,                            -- cost basis in holding currency (null if unknown)
    fx_rate      REAL DEFAULT 1,                  -- to INR (USD/INR for equity_us)
    currency     TEXT NOT NULL DEFAULT 'INR',
    account      TEXT,                            -- zerodha | groww | indmoney | etc
    asset_class  TEXT,                            -- equity | mutual_fund | us_equity | crypto | gold | cash | debt
    metadata     TEXT,                            -- JSON
    PRIMARY KEY (as_of_date, sleeve, symbol, isin)
  );
  CREATE INDEX holdings_sleeve ON holdings (sleeve);
  CREATE INDEX holdings_isin   ON holdings (isin);

  CREATE TABLE balances (
    as_of_date   TEXT NOT NULL,
    kind         TEXT NOT NULL,                   -- bank | credit_card | epf | splitwise | cash | loan
    account      TEXT NOT NULL,                   -- e.g. "HDFC Salary", "Amazon Pay ICICI"
    balance_inr  REAL NOT NULL,                   -- credit cards are negative
    institution  TEXT,
    account_mask TEXT,
    currency     TEXT NOT NULL DEFAULT 'INR',
    fx_rate      REAL DEFAULT 1,
    PRIMARY KEY (as_of_date, kind, account)
  );

  CREATE TABLE transactions (
    id           TEXT PRIMARY KEY,
    source       TEXT NOT NULL,                   -- wallet | zerodha | groww | splitwise
    txn_date     TEXT NOT NULL,                   -- ISO date or datetime
    account      TEXT NOT NULL,
    amount_inr   REAL NOT NULL,                   -- negative for expense, positive for income
    kind         TEXT NOT NULL,                   -- expense | income | transfer | investment | fee
    category     TEXT,
    subcategory  TEXT,
    payee        TEXT,
    note         TEXT,
    labels       TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
    raw_json     TEXT NOT NULL,
    imported_at  TEXT NOT NULL
  );
  CREATE INDEX txns_date     ON transactions (txn_date);
  CREATE INDEX txns_category ON transactions (category);

  CREATE TABLE fixed_deposits (
    id           TEXT PRIMARY KEY,
    bank         TEXT NOT NULL,
    account_mask TEXT,
    principal    REAL NOT NULL,
    rate_pct     REAL NOT NULL,                   -- e.g. 7.1 for 7.1%
    compounding  TEXT NOT NULL DEFAULT 'quarterly', -- quarterly | monthly | simple
    start_date   TEXT NOT NULL,                   -- YYYY-MM-DD
    maturity_date TEXT NOT NULL,                  -- YYYY-MM-DD
    payout       TEXT NOT NULL DEFAULT 'cumulative', -- cumulative | monthly | quarterly | maturity
    closed_date  TEXT,                            -- set if broken/withdrawn early
    imported_at  TEXT NOT NULL
  );

  -- Computed net-worth snapshots, populated on ingest from compute/networth.js.
  -- Avoids recomputing across all checkpoints on every view render.
  CREATE TABLE net_worth_snapshots (
    as_of_date   TEXT PRIMARY KEY,
    liquid_inr   REAL NOT NULL,
    total_inr    REAL NOT NULL,
    breakdown    TEXT NOT NULL                    -- JSON: sleeves, cash, card, epf, etc
  );

  CREATE TABLE sync_state (
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE settings (
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL
  );

  -- Files already ingested from data/, to skip re-reading unchanged files.
  CREATE TABLE inbox_files (
    path         TEXT PRIMARY KEY,
    hash         TEXT NOT NULL,
    kind         TEXT NOT NULL,                   -- checkpoint | transactions | fds
    records      INTEGER NOT NULL,
    imported_at  TEXT NOT NULL
  );
  `,
  // 2: benchmarks per checkpoint, trade ledger, manual assets/loans, and PPF standing tables
  `
  ALTER TABLE checkpoints ADD COLUMN benchmarks TEXT NOT NULL DEFAULT '{}';   -- {"nifty50": 24500, "sp500": 560}

  -- Every buy and sell your agent could read from a tradebook or a CAS. It is what makes
  -- XIRR exact and capital gains possible; nothing in the app needs it to run.
  CREATE TABLE ledger (
    id         TEXT PRIMARY KEY,                  -- the broker's trade id, else a hash of the row: ingest is idempotent
    sleeve     TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    isin       TEXT,
    name       TEXT,
    trade_date TEXT NOT NULL,
    side       TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    qty        REAL NOT NULL,
    price      REAL NOT NULL,                     -- per unit, in the instrument's own currency
    fx_rate    REAL NOT NULL DEFAULT 1,
    currency   TEXT NOT NULL DEFAULT 'INR',
    fees_inr   REAL NOT NULL DEFAULT 0,
    source     TEXT
  );
  CREATE INDEX ledger_date ON ledger (trade_date);

  -- Assets with no MCP behind them (NPS, PPF, property...) and loans. Several dated
  -- entries per item, so history keeps what was true then: a checkpoint reads the
  -- latest entry on or before its date.
  CREATE TABLE manual_assets (
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    as_of_date  TEXT NOT NULL,
    value_inr   REAL NOT NULL,                    -- positive; a loan is a positive amount owed
    liability   INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    PRIMARY KEY (kind, name, as_of_date)
  );

  -- PPF: standing rows like fixed deposits, valued by formula at any date. The
  -- government sets the rate every quarter, so each quarter's rate is its own row.
  CREATE TABLE ppf_deposits (
    id           INTEGER PRIMARY KEY,
    deposit_date TEXT NOT NULL,                   -- YYYY-MM-DD
    amount_inr   REAL NOT NULL,
    note         TEXT
  );
  CREATE TABLE ppf_rates (
    quarter_start TEXT PRIMARY KEY,               -- YYYY-04-01 | YYYY-07-01 | YYYY-10-01 | YYYY-01-01
    rate_pct      REAL NOT NULL
  );
  `,
  // 3: benchmark history, loaded in one go instead of one level per checkpoint
  `
  CREATE TABLE benchmark_levels (
    key        TEXT NOT NULL,                     -- nifty50 | sp500
    as_of_date TEXT NOT NULL,
    level      REAL NOT NULL,                     -- nifty50: the index close; sp500: SPY's close in USD
    PRIMARY KEY (key, as_of_date)
  );
  `,
  // 4: ensure ledger, manual_assets, ppf and benchmarks exist for any intermediate versions
  `
  CREATE TABLE IF NOT EXISTS ledger (
    id         TEXT PRIMARY KEY,
    sleeve     TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    isin       TEXT,
    name       TEXT,
    trade_date TEXT NOT NULL,
    side       TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    qty        REAL NOT NULL,
    price      REAL NOT NULL,
    fx_rate    REAL NOT NULL DEFAULT 1,
    currency   TEXT NOT NULL DEFAULT 'INR',
    fees_inr   REAL NOT NULL DEFAULT 0,
    source     TEXT
  );
  CREATE INDEX IF NOT EXISTS ledger_date ON ledger (trade_date);

  CREATE TABLE IF NOT EXISTS manual_assets (
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    as_of_date  TEXT NOT NULL,
    value_inr   REAL NOT NULL,
    liability   INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    PRIMARY KEY (kind, name, as_of_date)
  );

  CREATE TABLE IF NOT EXISTS ppf_deposits (
    id           INTEGER PRIMARY KEY,
    deposit_date TEXT NOT NULL,
    amount_inr   REAL NOT NULL,
    note         TEXT
  );
  CREATE TABLE IF NOT EXISTS ppf_rates (
    quarter_start TEXT PRIMARY KEY,
    rate_pct      REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS benchmark_levels (
    key        TEXT NOT NULL,
    as_of_date TEXT NOT NULL,
    level      REAL NOT NULL,
    PRIMARY KEY (key, as_of_date)
  );
  `,
]
