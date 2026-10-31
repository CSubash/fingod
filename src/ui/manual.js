// Hand-entered figures: Bitcoin, fixed deposits, PPF, Splitwise and allocation targets.
// Your agent can also write these as a file (docs/DATA-FORMAT.md, "Standing rows");
// these forms are for quick edits any time.
import { fixedDeposits, ppfDeposits, ppfRates, splitwise, targets, manualBtc } from '../repo.js'
import { getSetting, setSetting } from '../db.js'
import { setManualHolding, saveFixedDeposit, deleteFixedDeposit, savePpfDeposit, deletePpfDeposit, setPpfRate, saveSplitwise, deleteSplitwise, IngestError } from '../ingest.js'
import { balance as ppfBalance, quarterLabel, quarterStart, quartersBetween, rateFor } from '../compute/ppf.js'
import { esc, money, sleeveLabel } from './format.js'

const TARGET_KEYS = ['in_equity', 'in_mf', 'us_equity', 'gold', 'debt', 'btc', 'fd', 'liquid', 'epf', 'ppf']
const today = () => new Date().toISOString().slice(0, 10)

function ppfSection() {
  const deps = ppfDeposits(), rates = ppfRates()
  const b = deps.length ? ppfBalance(deps, rates, today()) : null
  // Newest quarter first: the one that needs a rate is usually the current one.
  const quarters = deps.length ? quartersBetween(deps[0].deposit_date, today()).reverse() : [quarterStart(today())]
  return `<section class="card"><header><h2>PPF</h2></header>
    <p class="hero-secondary" style="margin-top:0">Every deposit with its date, and the rate the government set for each quarter. Interest is worked out monthly on the balance on the 5th and credited every 31 March, as the scheme does it.</p>
    ${b ? `<p class="hero-secondary">Today: <b>${money(b.value)}</b> = ${money(b.deposited)} deposited + ${money(b.credited)} interest credited + ${money(b.accrued)} earned since 1 April.${b.missing.length ? ` <span style="color:var(--critical)">${b.missing.length} quarter${b.missing.length > 1 ? 's have' : ' has'} no rate of ${b.missing.length > 1 ? 'their' : 'its'} own and use${b.missing.length > 1 ? '' : 's'} the one before.</span>` : ''}</p>` : ''}
    ${deps.length ? `<ul class="rows">${deps.map((d) => `<li><form class="form inline" data-form="ppf-edit" data-id="${d.id}" style="margin:0">
      <label>Date<input name="deposit_date" type="date" value="${esc(d.deposit_date)}" required></label><label>Amount ₹<input name="amount_inr" type="number" step="any" min="0" value="${d.amount_inr}" required></label><label>Note<input name="note" value="${esc(d.note || '')}"></label>
      <button class="btn" type="submit">Save</button><button class="btn" type="button" data-del-ppf="${d.id}">Remove</button></form></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:0">No deposits yet.</p>'}
    <form class="form inline" data-form="ppf"><label>Date<input name="deposit_date" type="date" required></label><label>Amount ₹<input name="amount_inr" type="number" step="any" min="0" placeholder="150000" required></label><label>Note <span class="muted">(optional)</span><input name="note" placeholder="opening balance"></label>
      <button class="btn primary" type="submit">Add deposit</button></form>
    <form class="form inline" data-form="ppf-rate" style="margin-top:14px"><label>Quarter<select name="quarter_start">${quarters.map((q) => `<option value="${q}">${esc(quarterLabel(q))}</option>`).join('')}</select></label>
      <label>Rate %<input name="rate_pct" type="number" step="0.01" min="0" max="20" placeholder="7.1" required></label><button class="btn primary" type="submit">Set rate</button></form>
    ${deps.length ? `<table class="data" style="margin-top:12px"><tbody>${quarters.map((q) => { const r = rateFor(rates, q); return `<tr><td class="name">${esc(quarterLabel(q))}</td><td class="num">${r.assumed ? `<span class="muted">${r.rate_pct ? `${r.rate_pct}% (not set, using the quarter before)` : 'not set'}</span>` : `${r.rate_pct}%`}</td></tr>` }).join('')}</tbody></table>` : ''}
    <p class="note">To bring in an account you already have, add its balance on a past date as one deposit (say, your passbook balance on 1 April), then the deposits since. Change any amount or date here at any time.</p></section>`
}

export function section() {
  const m = manualBtc(), fds = fixedDeposits(), sw = splitwise(), t = targets()
  const isDefault = getSetting('target_allocation', null) === null
  return `<section class="card"><header><h2>Bitcoin, typed in</h2></header>
    <p class="hero-secondary" style="margin-top:0">For Bitcoin held somewhere with no MCP (CoinDCX, a hardware wallet): you type two numbers. Coins on Coinbase or Binance are read by your agent instead. The quantity is carried into later checkpoints; next time only the value changes.</p>
    <form class="form inline" data-form="btc"><label>Quantity<input name="qty" type="number" step="any" min="0" placeholder="0.0125" value="${m ? m.qty : ''}" required></label>
      <label>Current value ₹<input name="value" type="number" step="any" min="0" placeholder="106000" value="${m ? Math.round(m.qty * m.price) : ''}" required></label>
      <label>Total you paid ₹ <span class="muted">(optional)</span><input name="invested" type="number" step="any" min="0" value="${m && m.invested_inr ? m.invested_inr : ''}"></label>
      <button class="btn primary" type="submit">Save Bitcoin</button></form></section>

  <section class="card"><header><h2>Fixed deposits</h2></header>
    ${fds.length ? `<ul class="rows">${fds.map((f) => `<li>${esc(f.bank)} · ${money(f.principal)} at ${f.rate_pct}% from ${esc(f.start_date)}${f.maturity_date ? ` to ${esc(f.maturity_date)}` : ''}<button class="btn" data-del-fd="${f.id}">Remove</button></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:0">None yet.</p>'}
    <form class="form inline" data-form="fd"><label>Bank<input name="bank" placeholder="Example Bank" required></label><label>Principal ₹<input name="principal" type="number" step="any" required></label>
      <label>Rate %<input name="rate_pct" type="number" step="0.01" required></label><label>Start<input name="start_date" type="date" required></label><label>Maturity<input name="maturity_date" type="date"></label>
      <button class="btn primary" type="submit">Add deposit</button></form>
    <p class="note">Interest is computed from the rate and dates, so a deposit is valued correctly at every checkpoint, even ones taken before you entered it.</p></section>

  ${ppfSection()}

  <section class="card"><header><h2>Splitwise</h2></header>
    <p class="hero-secondary" style="margin-top:0">Just the bottom line per person. Positive means they owe you; negative means you owe them.</p>
    ${sw.length ? `<ul class="rows">${sw.map((p) => `<li>${esc(p.person)} · ${money(p.amount_inr)}<button class="btn" data-del-sw="${esc(p.person)}">Remove</button></li>`).join('')}</ul>` : ''}
    <form class="form inline" data-form="sw"><label>Person<input name="person" required></label><label>Amount ₹<input name="amount" type="number" step="any" required></label><label>Note<input name="note"></label><button class="btn primary" type="submit">Add</button></form></section>

  <section class="card"><header><h2>Allocation targets</h2></header>
    <p class="hero-secondary" style="margin-top:0">Where do you want your money to be? The dashboard shows the drift. Percentages should total 100. Set an asset to 0 to keep it out of the rebalance (EPF, say).${isDefault ? ' <b>These are the defaults; you have not set your own.</b>' : ''}</p>
    <form class="form targets" data-form="targets">${TARGET_KEYS.map((k) => `<label>${esc(sleeveLabel(k))}<input name="${k}" type="number" step="1" min="0" max="100" value="${t[k] ?? 0}"></label>`).join('')}
      <div class="total">Total <b data-total>100</b>% <span class="saved" data-saved></span></div></form></section>`
}

/** Wire the forms inside `el` once; `redraw` re-renders the page after a change. */
export function bind(el, redraw) {
  const total = () => { const f = el.querySelector('[data-form="targets"]'); if (f) f.querySelector('[data-total]').textContent = [...f.querySelectorAll('input')].reduce((a, i) => a + Number(i.value || 0), 0) }
  const saveTargets = (f) => { const t = {}; for (const [k, v] of new FormData(f)) if (Number(v) > 0) t[k] = Number(v); setSetting('target_allocation', t) }
  let timer
  el.addEventListener('input', (e) => {
    const f = e.target.closest('[data-form="targets"]'); if (!f) return
    total(); clearTimeout(timer)
    timer = setTimeout(() => { saveTargets(f); const n = f.querySelector('[data-saved]'); if (n) { n.textContent = 'Saved ✓'; setTimeout(() => (n.textContent = ''), 2000) } }, 400) // autosave as you type
  })
  el.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]'); if (!f) return
    e.preventDefault()
    const d = Object.fromEntries(new FormData(f))
    try {
      if (f.dataset.form === 'btc') setManualHolding({ qty: d.qty, value: d.value, invested_inr: d.invested || null })
      else if (f.dataset.form === 'fd') saveFixedDeposit(d)
      else if (f.dataset.form === 'ppf') savePpfDeposit(d)
      else if (f.dataset.form === 'ppf-edit') savePpfDeposit({ ...d, id: Number(f.dataset.id) })
      else if (f.dataset.form === 'ppf-rate') setPpfRate(d.quarter_start, d.rate_pct)
      else if (f.dataset.form === 'sw') saveSplitwise(d.person, d.amount, d.note)
      else if (f.dataset.form === 'targets') saveTargets(f)
      redraw()
    } catch (err) { alert(err instanceof IngestError ? err.message : String(err)) }
  })
  el.addEventListener('click', (e) => {
    const fd = e.target.closest('[data-del-fd]'); if (fd) { deleteFixedDeposit(Number(fd.dataset.delFd)); redraw() }
    const ppf = e.target.closest('[data-del-ppf]'); if (ppf && confirm('Remove this PPF deposit?')) { deletePpfDeposit(Number(ppf.dataset.delPpf)); redraw() }
    const sw = e.target.closest('[data-del-sw]'); if (sw) { deleteSplitwise(sw.dataset.delSw); redraw() }
  })
  total()
}
