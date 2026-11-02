// The empty state. Onboarding happens in the terminal, as a conversation with the
// user's coding agent (docs/ONBOARDING.md); the browser only shows the result. So
// this page does three small things: says how to start that conversation, offers
// the demo, and takes files by hand. It fills itself in when the first data lands.
import { hasData, latestCheckpoint } from '../repo.js'
import { getSetting, setSetting } from '../db.js'
import { syncInbox, inboxFailures, ingestAny } from '../ingest.js'
import { loadDemo } from '../demo.js'
import { AGENTS, REPO, MASTER, ANTIGRAVITY_MASTER, ANTIGRAVITY_ENV_FORMAT, ANTIGRAVITY_MCP_FORMAT, startCommand } from '../prompts.js'
import { esc } from './format.js'

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text) } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
  }
  const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = old), 1800)
}

export function render(el, { onData }) {
  const startedEmpty = !hasData()
  let timer
  const draw = () => {
    const cur = getSetting('agent', 'claude'), a = AGENTS[cur] || AGENTS.claude
    const isAntigravity = cur === 'antigravity'
    el.innerHTML = `<div class="onboard"><div class="panel">
      <div class="eyebrow">${startedEmpty ? 'No data yet' : 'Connect more'}</div>
      <h1>${startedEmpty ? 'Set up from your terminal.' : 'Connect another source.'}</h1>
      <p class="lede">Your coding agent connects Wallet, Zerodha, Groww and INDmoney and walks you through it as a conversation. This page fills in on its own when the first data arrives. Nothing is ever traded: every connector is read-only.</p>

      <div class="eyebrow" style="margin-top:26px">1 · Select your coding agent</div>
      <div class="agents">${Object.entries(AGENTS).map(([id, x]) => `<button class="btn" data-agent="${id}" aria-pressed="${id === cur}">${esc(x.name)}</button>`).join(' ')}</div>

      ${isAntigravity ? `
      <div class="eyebrow" style="margin-top:26px">2 · Start Antigravity & local Python server</div>
      <div class="prompt"><pre id="cmd">git clone ${REPO} && cd fingod && python serve.py</pre><button class="btn primary" data-copy="cmd">Copy command</button></div>
      <p class="note" style="margin-top:0">Run <code>python serve.py</code> in your terminal to start the live local dashboard at <code>http://127.0.0.1:8000</code>. Then open this folder in Antigravity (or run <code>agy</code> in the terminal).</p>

      <div class="eyebrow" style="margin-top:26px">3 · Configuration file formats (.env & .gemini/settings.json)</div>
      <p class="note" style="margin-top:0">Sensitive credentials go into <code>.env</code> (gitignored and never committed). Antigravity loads MCP connectors from <code>.gemini/settings.json</code>:</p>
      <div class="eyebrow" style="font-size:11px;margin-top:12px">Credentials file format (.env)</div>
      <div class="prompt"><pre id="env-format">${esc(ANTIGRAVITY_ENV_FORMAT)}</pre><button class="btn primary" data-copy="env-format">Copy .env format</button></div>
      <div class="eyebrow" style="font-size:11px;margin-top:12px">Antigravity MCP config (.gemini/settings.json)</div>
      <div class="prompt"><pre id="mcp-format">${esc(ANTIGRAVITY_MCP_FORMAT)}</pre><button class="btn primary" data-copy="mcp-format">Copy MCP config</button></div>
      <div class="eyebrow" style="font-size:11px;margin-top:12px">Data folder layout (where Antigravity saves your data)</div>
      <div class="prompt"><pre>data/
  checkpoints/
    YYYY-MM-DD.json     # Portfolio snapshot: net worth, liquid total & holdings
  transactions/
    wallet.json         # Bank, credit card and cash spend logs
    kite.json           # Stock and mutual fund trade books
  standing/
    fds.json            # Fixed deposit contracts
    ppf.json            # PPF contribution and interest ledgers
    splitwise.json      # Unsettled friends/family balances</pre></div>

      <div class="eyebrow" style="margin-top:26px">4 · Paste this prompt into Antigravity</div>
      <div class="prompt"><pre id="prompt">${esc(ANTIGRAVITY_MASTER)}</pre><button class="btn primary" data-copy="prompt">Copy prompt</button></div>
      ` : `
      <div class="eyebrow" style="margin-top:26px">2 · Start your agent inside the repo</div>
      <div class="prompt"><pre id="cmd">${esc(startCommand(cur))}</pre><button class="btn primary" data-copy="cmd">Copy command</button></div>
      <p class="note" style="margin-top:0">Starting inside the folder is what lets your agent load this project's MCP servers. ${esc(a.how)} Already inside the repo? Just run <code>${esc(a.cmd)}</code>.</p>

      <div class="eyebrow" style="margin-top:26px">3 · Paste this prompt into it</div>
      <div class="prompt"><pre id="prompt">${esc(MASTER)}</pre><button class="btn primary" data-copy="prompt">Copy prompt</button></div>
      `}

      <div class="status" data-status><span class="spin"></span><span>Waiting for your agent to write data into <code>data/</code>…</span></div>
      <div data-errs></div>

      <div class="eyebrow" style="margin-top:30px">Or</div>
      <div class="actions" style="margin-top:8px">
        <button class="btn big" data-demo>Explore with demo data</button>
        <a class="btn big" href="#/data" style="text-decoration:none">Enter things by hand</a>
        ${startedEmpty ? '' : '<a class="btn big" href="#/dashboard" style="text-decoration:none">Back to my dashboard</a>'}
      </div>
      <div class="drop" data-drop><b>Drop files here</b><span class="muted">a checkpoint, transactions or standing-rows JSON from your agent</span><input type="file" accept=".json,application/json" multiple data-file hidden><button class="btn" data-pick>Choose files</button></div>
    </div></div>`
    bind()
  }

  function bind() {
    el.querySelectorAll('[data-agent]').forEach((b) => (b.onclick = () => { setSetting('agent', b.dataset.agent); draw() }))
    el.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(el.querySelector(`#${b.dataset.copy}`).textContent, b)))
    el.querySelector('[data-demo]').onclick = () => { loadDemo(); onData() }
    const drop = el.querySelector('[data-drop]'), file = el.querySelector('[data-file]')
    const take = async (files) => {
      const out = []
      for (const f of files) { try { const r = ingestAny(JSON.parse(await f.text())); out.push(`✓ ${f.name}: ${r.kind}${r.as_of_date ? ` ${r.as_of_date}` : ''}`) } catch (e) { out.push(`✗ ${f.name}: ${e.message}`) } }
      alert(out.join('\n')); check()
    }
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over') }
    drop.ondragleave = () => drop.classList.remove('over')
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files) }
    el.querySelector('[data-pick]').onclick = () => file.click()
    file.onchange = () => take(file.files)
  }

  async function check() {
    const r = await syncInbox()
    const status = el.querySelector('[data-status]'), errs = el.querySelector('[data-errs]')
    if (!status) return
    const cp = latestCheckpoint()
    if (!r.available) status.innerHTML = '<span class="spin"></span><span>This page needs a local server to see <code>data/</code>: from the repo folder run <code>python serve.py</code> (or <code>python3 -m http.server 8000 --bind 127.0.0.1</code>) and open <code>http://localhost:8000</code>.</span>'
    else if (cp) { status.classList.add('ok'); status.innerHTML = `<span class="tickmark">✓</span><span>Received a checkpoint as of ${esc(cp.as_of_date)}.</span>` }
    const bad = inboxFailures()
    errs.innerHTML = bad.length ? `<div class="errs"><b>${bad.length} file${bad.length > 1 ? 's' : ''} in data/ couldn't be imported</b>${bad.map((b) => `<div><code>${esc(b.path)}</code> ${esc(b.error)}</div>`).join('')}<div class="muted">Fix the named field and it imports on its own.</div></div>` : ''
    if (startedEmpty && hasData()) { clearInterval(timer); setTimeout(onData, 900) } // first data: go to the dashboard
  }

  draw()
  check()
  timer = setInterval(check, 2500)
  return () => clearInterval(timer)
}
