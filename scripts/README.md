# FinGod Helper Scripts

These scripts assist in syncing financial data from connected brokers into FinGod's local SQLite database and `data/` folder.

## Setup & Credentials

FinGod never stores credentials in tracked files. Create a `.env` file in the project root:

```bash
# BudgetBakers Wallet
WALLET_MCP_TOKEN="<your_jwt_token_here>"

# Binance (Read-Only API Key)
BINANCE_API_KEY="<your_api_key>"
BINANCE_API_SECRET="<your_api_secret>"
# Optional RSA private key:
# BINANCE_PRIVATE_KEY_PATH="/path/to/private_key.pem"
```

## Running the Web Server

FinGod runs locally in your browser. Launch the Python server with live file watching and automatic SQLite reloads:

```bash
python serve.py
```
Then visit `http://127.0.0.1:8000`.

## Ingestion & Sync Scripts

* **`fetch_kite.cjs`** / **`sync_kite.cjs`**:
  Fetches holdings and trade transactions from Zerodha Kite via MCP.
  ```bash
  node scripts/fetch_kite.cjs
  ```

* **`fetch_indmoney.cjs`**:
  Fetches US stock holdings and EPF balances from INDmoney via MCP.
  ```bash
  node scripts/fetch_indmoney.cjs
  ```

* **`fetch_binance.py`** / **`sync_binance.py`**:
  Reads Spot and Earn (Flexible) cryptocurrency balances from Binance using read-only API credentials.
  ```bash
  python scripts/sync_binance.py
  ```

* **`build_transactions.py`**:
  Parses and normalizes transactions from connected sources into `data/transactions/`.
  ```bash
  python scripts/build_transactions.py
  ```

* **`build_benchmarks.py`**:
  Fetches index performance (Nifty 50, Nifty Midcap 150, Nasdaq 100, etc.) for sleeve comparison.
  ```bash
  python scripts/build_benchmarks.py
  ```
