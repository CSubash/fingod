// The prompt the app and landing page hand to the user's coding agent, and the
// agents it knows how to start. The setup conversation itself lives in
// docs/ONBOARDING.md, so it can improve without touching the prompt.
// Keep MASTER in step with /PROMPT.md, landing/prompt.md and the README.

export const REPO = 'https://github.com/HarishTeens/fingod.git'

/** The coding agents we ship project MCP config for. */
export const AGENTS = {
  claude: { name: 'Claude Code', cmd: 'claude', config: '.mcp.json', how: 'It asks you to approve them once.' },
  antigravity: { name: 'Antigravity', cmd: 'python serve.py', config: '.gemini/settings.json', how: 'Runs locally with Python and loads .gemini/settings.json or Antigravity MCP servers.' },
  codex: { name: 'Codex CLI', cmd: 'codex', config: '.codex/config.toml', how: 'Trust the project so .codex/config.toml loads. Sign in to INDmoney with: codex mcp login indmoney (Coinbase: codex mcp login coinbase)' },
  gemini: { name: 'Gemini CLI', cmd: 'gemini', config: '.gemini/settings.json', how: 'It reads .gemini/settings.json from the project. Sign in to INDmoney with: /mcp auth indmoney (Coinbase: /mcp auth coinbase)' },
  pi: { name: 'Pi', cmd: 'pi', config: '.pi/mcp.json', how: 'Trust the project so .pi/mcp.json loads. Sign in to INDmoney with: /mcp login indmoney (Coinbase: /mcp login coinbase)' },
}
export const startCommand = (agent) => {
  if (agent === 'antigravity') return `git clone ${REPO} && cd fingod && python serve.py`
  return `git clone ${REPO} && cd fingod && ${(AGENTS[agent] || AGENTS.claude).cmd}`
}

/** The one prompt that sets everything up for Claude Code. */
export const MASTER = `Set up fingod for me, a local-first net worth tracker that runs in my browser.

1. If this repo isn't already your working folder, clone https://github.com/HarishTeens/fingod and work from there.
2. Read docs/ONBOARDING.md and follow it step by step. It covers finding out which accounts I use, connecting them, writing my data into data/, and, only once all that is done, opening my dashboard in my browser.
3. Run it in this terminal as a short form: use your multiple-choice question tool for every choice (selectable options, then a submit step), and plain questions only for numbers and text.

Rules: read-only. Never place, modify or cancel an order. Never commit anything from data/. Ask me before anything that depends on my preferences.`

/** Setup prompt tailored for Antigravity. */
export const ANTIGRAVITY_MASTER = `Set up fingod for me, a local-first net worth tracker that runs in my browser.

1. If this repo isn't already your working folder, clone https://github.com/HarishTeens/fingod and work from there.
2. Read docs/ONBOARDING.md and follow it step by step. Use your ask_question tool for every multiple-choice choice (selectable options, then a submit step), and plain questions only for numbers and text.
3. Check connected MCP servers (Zerodha Kite, INDmoney, BudgetBakers Wallet, Binance, Groww) or configured environment variables in .env.
4. Read every connected source, write the initial checkpoint into data/checkpoints/<today>.json, and write transactions into data/transactions/.
5. Start or verify the local server with \`python serve.py\` (running on http://127.0.0.1:8000) so my dashboard reflects the latest data.

Rules: read-only. Never place, modify or cancel an order. Never commit anything from data/. Ask me before anything that depends on my preferences.`

/** Sample .env format for credentials. */
export const ANTIGRAVITY_ENV_FORMAT = `# FinGod Credentials & Tokens (.env is gitignored)
# 1. BudgetBakers Wallet (Settings -> MCP -> Copy Token in mobile app)
WALLET_MCP_TOKEN="<your_jwt_token_here>"

# 2. Binance (Create API Key with Read-Only permissions enabled)
BINANCE_API_KEY="<your_binance_api_key>"
BINANCE_API_SECRET="<your_binance_api_secret>"
# If using RSA Key:
# BINANCE_PRIVATE_KEY_PATH="E:/Stocks/binance_private_key.pem"`

/** Antigravity MCP configuration format (.gemini/settings.json). */
export const ANTIGRAVITY_MCP_FORMAT = `{
  "mcpServers": {
    "kite": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.kite.trade/mcp"]
    },
    "wallet": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.wallet.budgetbakers.com", "--header", "Authorization:\${WALLET_AUTH}"],
      "env": { "WALLET_AUTH": "Bearer $WALLET_MCP_TOKEN" }
    },
    "indmoney": {
      "httpUrl": "https://mcp.indmoney.com/mcp"
    },
    "binance": {
      "command": "uvx",
      "args": ["amazing-binance-mcp"],
      "env": {
        "BINANCE_API_KEY": "$BINANCE_API_KEY",
        "BINANCE_PRIVATE_KEY_PATH": "$BINANCE_PRIVATE_KEY_PATH"
      }
    }
  }
}`

export const checkpointPrompt = `Take a fingod checkpoint. Follow .claude/skills/refresh/SKILL.md, starting with its update step (item 0 of its Preflight): bring fingod to the latest main with a fast-forward pull only, and tell me what changed before you go on. Then: read every connected source, ask me for the figures no server can supply (like my Bitcoin quantity and value), and write data/checkpoints/<today>.json plus any new data/transactions/*.json. Rules: this is READ-ONLY. Never place, modify or cancel an order, and never write anywhere outside this repo's data/ folder. Money is exact: send qty and price, never a computed total. If a file for today's date already exists in data/checkpoints/, read it and MERGE your parts into it instead of overwriting. Then tell me net worth and what moved, split into market, flow and FX, plus the 52-week price watch.`
