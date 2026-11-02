// Hand-entered figures: Bitcoin, fixed deposits, PPF, other assets/loans, Splitwise and allocation targets.
// Your agent can also write these as a file (docs/DATA-FORMAT.md, "Standing rows");
// these forms are for quick edits any time.
import { fixedDeposits, ppfDeposits, ppfRates, splitwise, targets, manualBtc, manualAssets } from '../repo.js'
import { getSetting, setSetting } from '../db.js'
import { setManualHolding, saveFixedDeposit, deleteFixedDeposit, savePpfDeposit, deletePpfDeposit, setPpfRate, saveSplitwise, deleteSplitwise, saveAsset, deleteAsset, IngestError } from '../ingest.js'
import { balance as ppfBalance, quarterLabel, quarterStart, quartersBetween, rateFor } from '../compute/ppf.js'
import { value as fdValue } from '../compute/fd.js'
import { esc, money, sleeveLabel, plain } from './format.js'

const TARGET_KEYS = ['in_equity', 'in_mf', 'us_equity', 'gold', 'debt', 'btc', 'fd', 'liquid', 'epf', 'ppf']
const today = () => new Date().toISOString().slice(0, 10)

const ASSET_KINDS = ['property', 'gold_physical', 'nps', 'epf', 'ppf', 'crypto', 'other']
const LIABILITY_KINDS = ['home', 'education', 'car', 'personal', 'other']
const KIND_LABEL = (k) => ({
  property: 'Real estate', gold_physical: 'Physical gold', nps: 'NPS', epf: 'EPF', ppf: 'PPF',
  home: 'Home loan', education: 'Education loan', car: 'Car loan', personal: 'Personal loan',
}[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')))

let ppfCollapsed = true
let fdCollapsed = true
let btcCollapsed = true
let swCollapsed = true
let targetsCollapsed = true
let assetCollapsed = true

let selectedPpfYears = null
let ppfDropdownOpen = false
let ppfRatesOpen = false

export function getDepositFy(dateStr) {
  const y = Number(dateStr.slice(0, 4))
  const m = Number(dateStr.slice(5, 7))
  const fyStart = m >= 4 ? y : y - 1
  return `FY ${fyStart}-${String(fyStart + 1).slice(2)}`
}

function chevron(collapsed) {
  return collapsed
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="6 9 12 15 18 9"></polyline></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="6 15 12 9 18 15"></polyline></svg>`
}

function fdSection() {
  const fds = fixedDeposits()
  const total = fds.reduce((sum, f) => sum + fdValue(f, today()), 0)

  return `<section class="card" data-card="fd" ${fdCollapsed ? 'data-toggle-fd style="padding: 18px 22px; cursor: pointer;"' : ''}>
    <header style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin:${fdCollapsed ? '0' : '0 0 14px'};" data-toggle-fd>
      <div style="display:flex;align-items:center;gap:10px">
        <h2>Fixed deposits</h2>
        ${fds.length && total > 0 ? `<span class="tag" style="font-weight:600">${money(total)}</span>` : ''}
      </div>
      <span style="display:inline-flex;align-items:center;justify-content:center;color:var(--muted);user-select:none;padding:4px" title="${fdCollapsed ? 'Expand Fixed deposits' : 'Collapse Fixed deposits'}">${chevron(fdCollapsed)}</span>
    </header>
    <div style="display:${fdCollapsed ? 'none' : 'block'};margin-top:10px">
      ${fds.length ? `<ul class="rows">${fds.map((f) => `<li>${esc(f.bank)} · ${money(f.principal)} at ${f.rate_pct}% from ${esc(f.start_date)}${f.maturity_date ? ` to ${esc(f.maturity_date)}` : ''}<button class="btn" data-del-fd="${f.id}">Remove</button></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:0">None yet.</p>'}
      <form class="form inline" data-form="fd"><label>Bank<input name="bank" placeholder="Example Bank" required></label><label>Principal ₹<input name="principal" type="number" step="any" required></label>
        <label>Rate %<input name="rate_pct" type="number" step="0.01" required></label><label>Start<input name="start_date" type="date" required></label><label>Maturity<input name="maturity_date" type="date"></label>
        <button class="btn primary" type="submit">Add deposit</button></form>
      <p class="note">Interest is computed from the rate and dates, so a deposit is valued correctly at every checkpoint, even ones taken before you entered it.</p>
    </div>
  </section>`
}

function ppfSection() {
  const deps = ppfDeposits(), rates = ppfRates()
  const b = deps.length ? ppfBalance(deps, rates, today()) : null

  // Financial year extraction for deposits (e.g. FY 2021-22)
  const depFys = [...new Set(deps.map((d) => getDepositFy(d.deposit_date)))].sort()
  if (selectedPpfYears === null && depFys.length) {
    selectedPpfYears = new Set(depFys)
  }
  const filteredDeps = deps.filter((d) => selectedPpfYears && selectedPpfYears.has(getDepositFy(d.deposit_date)))
  const filteredCount = filteredDeps.length
  const filteredTotal = filteredDeps.reduce((sum, d) => sum + d.amount_inr, 0)

  let summaryText = ''
  if (!selectedPpfYears || selectedPpfYears.size === 0) {
    summaryText = 'No financial years selected'
  } else if (selectedPpfYears.size === 1) {
    const fy = [...selectedPpfYears][0]
    summaryText = `Invested ${money(filteredTotal)} in ${fy} (${filteredCount} deposit${filteredCount === 1 ? '' : 's'})`
  } else if (selectedPpfYears.size === depFys.length) {
    summaryText = `Invested ${money(filteredTotal)} total (${depFys[0]} – ${depFys.at(-1)}) · ${filteredCount} deposits`
  } else {
    summaryText = `Invested ${money(filteredTotal)} in ${selectedPpfYears.size} selected FYs · ${filteredCount} deposits`
  }

  const allPpfSelected = depFys.length > 0 && selectedPpfYears && selectedPpfYears.size === depFys.length
  const noPpfSelected = !selectedPpfYears || selectedPpfYears.size === 0

  let dropdownLabel = 'Filter FY'
  if (!selectedPpfYears || selectedPpfYears.size === 0) {
    dropdownLabel = 'Select FY (0)'
  } else if (selectedPpfYears.size === depFys.length) {
    dropdownLabel = `All FYs (${depFys.length})`
  } else if (selectedPpfYears.size === 1) {
    dropdownLabel = `${[...selectedPpfYears][0]}`
  } else {
    dropdownLabel = `${selectedPpfYears.size} FYs selected`
  }

  // Quarterly rates matrix: columns formatted as FY 2021-22, FY 2022-23, etc., starting from first deposited FY
  const oldestDeposit = deps.length
    ? deps.slice().sort((a, b) => a.deposit_date.localeCompare(b.deposit_date))[0]
    : null
  const startYear = oldestDeposit
    ? (Number(oldestDeposit.deposit_date.slice(5, 7)) >= 4
        ? Number(oldestDeposit.deposit_date.slice(0, 4))
        : Number(oldestDeposit.deposit_date.slice(0, 4)) - 1)
    : 2021
  const currentYear = new Date().getFullYear()
  const currentFyStart = new Date().getMonth() >= 3 ? currentYear : currentYear - 1
  const rateColumns = []
  for (let y = startYear; y <= currentFyStart; y++) {
    rateColumns.push({ label: `FY ${y}-${String(y + 1).slice(2)}`, fyStart: y })
  }

  const QUARTERS = [
    { id: 'Q1', label: 'Q1 (Apr–Jun)', month: '04', isNextYear: false },
    { id: 'Q2', label: 'Q2 (Jul–Sept)', month: '07', isNextYear: false },
    { id: 'Q3', label: 'Q3 (Oct–Dec)', month: '10', isNextYear: false },
    { id: 'Q4', label: 'Q4 (Jan–Mar)', month: '01', isNextYear: true },
  ]

  return `<section class="card" data-card="ppf" ${ppfCollapsed ? 'data-toggle-ppf style="padding: 18px 22px; cursor: pointer;"' : ''}>
    <header style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin:${ppfCollapsed ? '0' : '0 0 14px'};" data-toggle-ppf>
      <div style="display:flex;align-items:center;gap:10px">
        <h2>PPF</h2>
        ${b ? `<span class="tag" style="font-weight:600">${money(b.value)}</span>` : ''}
      </div>
      <span style="display:inline-flex;align-items:center;justify-content:center;color:var(--muted);user-select:none;padding:4px" title="${ppfCollapsed ? 'Expand PPF' : 'Collapse PPF'}">${chevron(ppfCollapsed)}</span>
    </header>
    <div style="display:${ppfCollapsed ? 'none' : 'block'};margin-top:10px">
      <p class="hero-secondary" style="margin-top:0">A 15-year account. Deposits earn government interest compounded yearly on 31 March. Valued by formula at every checkpoint: a deposit by the 5th earns for that month; one after the 5th waits for the next month.</p>
      ${b ? `<div class="hero-secondary" style="margin-bottom:14px"><b>Current balance</b>: ${money(b.value)} · ${money(b.deposited)} deposited · ${money(b.interest)} interest${b.deposited > 0 ? ` <span style="color:var(--good);font-weight:600">+${plain((b.interest / b.deposited) * 100, 2)}%</span>` : ''}</div>` : ''}

      ${deps.length ? `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin:12px 0 8px;" data-ppf-dropdown-container>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="position:relative;display:inline-block">
              <button type="button" class="btn" data-ppf-year-dropdown-btn style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:var(--card);font-size:13px;border-color:var(--ring-strong);color:var(--ink);cursor:pointer">
                <span>${dropdownLabel}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transform:${ppfDropdownOpen ? 'rotate(180deg)' : 'none'};transition:transform .15s"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              ${ppfDropdownOpen ? `
                <div style="position:absolute;top:calc(100% + 4px);left:0;z-index:100;background:var(--card);border:1px solid var(--ring-strong);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.3);min-width:230px;padding:8px">
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px 8px;border-bottom:1px solid var(--gridline);margin-bottom:6px">
                    <button type="button" class="btn ${allPpfSelected ? 'primary' : ''}" data-ppf-select-all style="padding:2px 8px;font-size:11.5px;${allPpfSelected ? 'background:#ffffff;color:#000000;border-color:#ffffff;font-weight:600;' : ''}">Select all</button>
                    <button type="button" class="btn ${noPpfSelected ? 'primary' : ''}" data-ppf-clear-all style="padding:2px 8px;font-size:11.5px;${noPpfSelected ? 'background:#ffffff;color:#000000;border-color:#ffffff;font-weight:600;' : ''}">Clear all</button>
                  </div>
                  <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
                    ${depFys.map((fy) => {
                      const yDeps = deps.filter((d) => getDepositFy(d.deposit_date) === fy)
                      const isChecked = selectedPpfYears && selectedPpfYears.has(fy)
                      const yTotal = yDeps.reduce((s, d) => s + d.amount_inr, 0)
                      return `<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:13px;user-select:none" class="ppf-year-label">
                        <input type="checkbox" data-ppf-year="${fy}" ${isChecked ? 'checked' : ''} style="width:auto;margin:0;cursor:pointer">
                        <span style="font-weight:600;color:var(--ink)">${fy}</span>
                        <span class="muted" style="margin-left:auto;font-size:12px">${yDeps.length} dep. (${money(yTotal)})</span>
                      </label>`
                    }).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
            <span style="font-size:13.5px;font-weight:600;color:var(--ink-2)">${summaryText}</span>
          </div>
        </div>

        ${filteredDeps.length ? `
          <ul class="rows" style="max-height:360px;overflow-y:auto;margin-top:6px;padding-right:18px;box-sizing:border-box;">
            ${filteredDeps.map((d) => `<li style="padding-right:10px">${esc(d.deposit_date)} · ${money(d.amount_inr)}${d.note ? ` <span class="muted">(${esc(d.note)})</span>` : ''}<button class="btn" data-del-ppf="${d.id}">Remove</button></li>`).join('')}
          </ul>
        ` : `<p class="muted" style="margin:12px 0">No deposits match the selected financial year(s).</p>`}
      ` : '<p class="muted" style="margin-top:0">No deposits recorded yet.</p>'}

      <form data-form="ppf" style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:16px">
        <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--ink-2)">Deposit date<input name="deposit_date" type="date" value="${today()}" required style="width:145px;padding:8px 10px;"></label>
        <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--ink-2)">Amount ₹<input name="amount_inr" type="text" inputmode="numeric" placeholder="150000" required style="width:130px;padding:8px 10px;font-variant-numeric:tabular-nums;"></label>
        <button class="btn primary" type="submit" style="padding:8px 16px;white-space:nowrap;height:38px;">Add deposit</button>
      </form>

      ${deps.length ? `
      <details ${ppfRatesOpen ? 'open' : ''} style="margin-top:18px" data-ppf-rates-details>
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--ink-2);user-select:none">Quarterly interest rates (${rates.length} on record)</summary>
        <p class="note" style="margin:8px 0 12px">The government declares the rate each quarter. A missing quarter carries the previous rate forward. Edits auto-save immediately.</p>
        <div class="table-wrap" style="overflow-x:auto;margin:8px 0;border:1px solid var(--ring);border-radius:10px">
          <table class="data" style="width:100%;border-collapse:collapse;min-width:${120 + rateColumns.length * 85}px;margin:0">
            <thead>
              <tr>
                <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:0.02em;background:var(--page)">Quarter</th>
                ${rateColumns.map((c) => `<th style="text-align:center;padding:10px 10px;font-size:13px;font-weight:600;color:var(--ink);background:var(--page);white-space:nowrap">${c.label}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${QUARTERS.map((q) => `
                <tr>
                  <td style="font-weight:600;padding:8px 12px;white-space:nowrap;color:var(--ink)">${q.label}</td>
                  ${rateColumns.map((c) => {
                    const qYear = q.isNextYear ? c.fyStart + 1 : c.fyStart
                    const qs = `${qYear}-${q.month}-01`
                    const r = rateFor(rates, qs)
                    const val = r && r.rate_pct > 0 ? r.rate_pct : ''
                    return `<td style="text-align:center;padding:6px 6px">
                      <input type="text" inputmode="decimal" class="ppf-rate-input" data-qs="${qs}" value="${val}" placeholder="7.1" style="width:58px !important;text-align:center;padding:5px 6px;border-radius:6px;font-variant-numeric:tabular-nums;border:1px solid var(--ring-strong);background:var(--page);color:var(--ink);font-weight:600;margin:0 auto;display:block;">
                    </td>`
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </details>
      ` : ''}
    </div>
  </section>`
}

function assetSection() {
  const assets = manualAssets()
  const latest = new Map()
  for (const a of assets) latest.set(`${a.kind}\0${a.name}`, a)
  const rows = [...latest.values()]

  return `<section class="card" data-card="asset" ${assetCollapsed ? 'data-toggle-asset style="padding: 18px 22px; cursor: pointer;"' : ''}>
    <header style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin:${assetCollapsed ? '0' : '0 0 14px'};" data-toggle-asset>
      <div style="display:flex;align-items:center;gap:10px">
        <h2>Other assets and loans</h2>
        ${rows.length ? `<span class="tag" style="font-weight:600">${rows.length}</span>` : ''}
      </div>
      <span style="display:inline-flex;align-items:center;justify-content:center;color:var(--muted);user-select:none;padding:4px" title="${assetCollapsed ? 'Expand Other assets and loans' : 'Collapse Other assets and loans'}">${chevron(assetCollapsed)}</span>
    </header>
    <div style="display:${assetCollapsed ? 'none' : 'block'};margin-top:10px">
      <p class="hero-secondary" style="margin-top:0">NPS, property, physical gold, and what you owe on a loan. They move your total net worth but not the liquid figure. Enter a newer value any time: earlier checkpoints keep the value that was true then.</p>
      ${rows.length ? `<ul class="rows">${rows.map((a) => `<li>${esc(a.name)} <span class="muted">· ${esc(KIND_LABEL(a.kind))}${a.liability ? ' (loan)' : ''}</span> · ${money(a.value_inr)} <span class="muted">as of ${esc(a.as_of_date)}</span><button class="btn" data-del-asset="${esc(a.kind)}|${esc(a.name)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:0">None yet.</p>'}
      <form class="form inline" data-form="asset"><label>Type<select name="kind">${[...ASSET_KINDS.map((k) => `<option value="${k}">${esc(KIND_LABEL(k))}</option>`), ...LIABILITY_KINDS.map((k) => `<option value="loan:${k}">${esc(KIND_LABEL(k))} (you owe)</option>`)].join('')}</select></label>
        <label>Name<input name="name" placeholder="NPS Tier 1" required></label><label>Value ₹<input name="value" type="number" step="any" min="0" required></label><label>As of<input name="as_of" type="date" value="${today()}"></label>
        <button class="btn primary" type="submit">Save</button></form>
    </div>
  </section>`
}

export function section() {
  const btc = manualBtc(), sw = splitwise(), t = targets(), isDefault = getSetting('target_allocation', null) === null

  return `${fdSection()}
  ${ppfSection()}
  ${assetSection()}

  <section class="card" data-card="btc" ${btcCollapsed ? 'data-toggle-btc style="padding: 18px 22px; cursor: pointer;"' : ''}>
    <header style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin:${btcCollapsed ? '0' : '0 0 14px'};" data-toggle-btc>
      <div style="display:flex;align-items:center;gap:10px">
        <h2>Bitcoin (typed in)</h2>
        ${btc ? `<span class="tag" style="font-weight:600">${money(btc.value)}</span>` : ''}
      </div>
      <span style="display:inline-flex;align-items:center;justify-content:center;color:var(--muted);user-select:none;padding:4px" title="${btcCollapsed ? 'Expand Bitcoin' : 'Collapse Bitcoin'}">${chevron(btcCollapsed)}</span>
    </header>
    <div style="display:${btcCollapsed ? 'none' : 'block'};margin-top:10px">
      <p class="hero-secondary" style="margin-top:0">Use this if you hold Bitcoin somewhere with no read connector (CoinDCX, cold storage, etc.). It is carried forward into later checkpoints until you enter a newer figure.</p>
      <form class="form inline" data-form="btc"><label>Quantity (BTC)<input name="qty" type="number" step="any" value="${btc ? btc.qty : ''}" required></label>
        <label>Current value ₹<input name="value" type="number" step="any" value="${btc ? btc.value : ''}" required></label>
        <label>Total invested ₹ (optional)<input name="invested" type="number" step="any" value="${btc && btc.invested ? btc.invested : ''}"></label>
        <button class="btn primary" type="submit">Save Bitcoin</button></form>
    </div>
  </section>

  <section class="card" data-card="sw" ${swCollapsed ? 'data-toggle-sw style="padding: 18px 22px; cursor: pointer;"' : ''}>
    <header style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin:${swCollapsed ? '0' : '0 0 14px'};" data-toggle-sw>
      <div style="display:flex;align-items:center;gap:10px">
        <h2>Splitwise balances</h2>
        ${sw.length ? `<span class="tag" style="font-weight:600">${sw.length}</span>` : ''}
      </div>
      <span style="display:inline-flex;align-items:center;justify-content:center;color:var(--muted);user-select:none;padding:4px" title="${swCollapsed ? 'Expand Splitwise balances' : 'Collapse Splitwise balances'}">${chevron(swCollapsed)}</span>
    </header>
    <div style="display:${swCollapsed ? 'none' : 'block'};margin-top:10px">
      ${sw.length ? `<ul class="rows">${sw.map((s) => `<li>${esc(s.person)}: ${money(s.amount_inr)} <span class="muted">${s.amount_inr > 0 ? 'owes you' : 'you owe'}</span><button class="btn" data-del-sw="${esc(s.person)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:0">No unsettled balances.</p>'}
      <form class="form inline" data-form="sw"><label>Person<input name="person" required></label><label>Amount ₹ (positive = they owe you)<input name="amount" type="number" step="any" required></label>
        <label>Note<input name="note"></label><button class="btn primary" type="submit">Save person</button></form>
    </div>
  </section>

  <section class="card" data-card="targets" ${targetsCollapsed ? 'data-toggle-targets style="padding: 18px 22px; cursor: pointer;"' : ''}>
    <header style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin:${targetsCollapsed ? '0' : '0 0 14px'};" data-toggle-targets>
      <div style="display:flex;align-items:center;gap:10px">
        <h2>Allocation targets</h2>
        ${isDefault ? '<span class="tag muted" style="font-weight:600">defaults</span>' : '<span class="tag" style="font-weight:600">Custom</span>'}
      </div>
      <span style="display:inline-flex;align-items:center;justify-content:center;color:var(--muted);user-select:none;padding:4px" title="${targetsCollapsed ? 'Expand Allocation targets' : 'Collapse Allocation targets'}">${chevron(targetsCollapsed)}</span>
    </header>
    <div style="display:${targetsCollapsed ? 'none' : 'block'};margin-top:10px">
      <p class="hero-secondary" style="margin-top:0">Where do you want your money to be? The dashboard shows the drift. Percentages should total 100. Set an asset to 0 to keep it out of the rebalance (EPF, say).${isDefault ? ' <b>These are the defaults; you have not set your own.</b>' : ''}</p>
      <form class="form targets" data-form="targets">${TARGET_KEYS.map((k) => `<label>${esc(sleeveLabel(k))}<input name="${k}" type="number" step="1" min="0" max="100" value="${t[k] ?? 0}"></label>`).join('')}
        <div class="total">Total <b data-total>100</b>% <span class="saved" data-saved></span></div></form>
    </div>
  </section>`
}

/** Wire the forms inside `el` once; `redraw` re-renders the page after a change. */
export function bind(el, redraw) {
  const total = () => {
    const form = el.querySelector('form[data-form="targets"]')
    if (!form) return
    let sum = 0
    form.querySelectorAll('input[type="number"]').forEach((i) => (sum += Number(i.value) || 0))
    const b = form.querySelector('[data-total]')
    if (b) { b.textContent = sum; b.style.color = sum === 100 ? 'var(--good)' : 'var(--critical)' }
  }
  el.addEventListener('input', (e) => { if (e.target.closest('form[data-form="targets"]')) total() })
  el.addEventListener('change', (e) => {
    const chk = e.target.closest('input[data-ppf-year]')
    if (chk) {
      const fy = chk.dataset.ppfYear
      if (!selectedPpfYears) selectedPpfYears = new Set()
      if (chk.checked) selectedPpfYears.add(fy)
      else selectedPpfYears.delete(fy)
      redraw()
      return
    }
    const rateInput = e.target.closest('.ppf-rate-input')
    if (rateInput) {
      const qs = rateInput.dataset.qs
      const val = Number(rateInput.value.trim())
      if (isNaN(val) || val <= 0 || val > 20) {
        alert('PPF rate must be a valid percentage between 0 and 20 (e.g. 7.1)')
        rateInput.style.borderColor = 'var(--critical)'
        return
      }
      try {
        setPpfRate(qs, val)
        redraw()
      } catch (err) {
        alert(err instanceof IngestError ? err.message : String(err))
      }
      return
    }
  })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('.ppf-rate-input')) {
      e.preventDefault()
      e.target.blur()
    }
  })
  el.addEventListener('toggle', (e) => {
    const d = e.target.closest('[data-ppf-rates-details]')
    if (d) ppfRatesOpen = d.open
  }, true)
  el.addEventListener('submit', (e) => {
    const f = e.target.closest('form')
    if (!f) return
    e.preventDefault()
    const d = Object.fromEntries(new FormData(f).entries())
    try {
      if (f.dataset.form === 'btc') setManualHolding({ qty: d.qty, value: d.value, invested_inr: d.invested || null })
      else if (f.dataset.form === 'fd') saveFixedDeposit(d)
      else if (f.dataset.form === 'ppf') {
        const amt = Number(String(d.amount_inr || '').replace(/,/g, '').trim())
        if (isNaN(amt) || amt < 500 || amt > 150000) {
          throw new IngestError('PPF deposit amount must be between ₹500 and ₹1,50,000')
        }
        savePpfDeposit({ deposit_date: d.deposit_date, amount_inr: amt })
        if (d.deposit_date && selectedPpfYears) selectedPpfYears.add(getDepositFy(d.deposit_date))
      }
      else if (f.dataset.form === 'ppf-edit') savePpfDeposit({ ...d, id: Number(f.dataset.id) })
      else if (f.dataset.form === 'ppf-rate') setPpfRate(d.quarter_start, d.rate_pct)
      else if (f.dataset.form === 'sw') saveSplitwise(d.person, d.amount, d.note)
      else if (f.dataset.form === 'asset') { const loan = d.kind.startsWith('loan:'); saveAsset({ kind: loan ? d.kind.slice(5) : d.kind, name: d.name, value_inr: d.value, as_of_date: d.as_of, liability: loan }) }
      else if (f.dataset.form === 'targets') saveTargets(f)
      redraw()
    } catch (err) { alert(err instanceof IngestError ? err.message : String(err)) }
  })
  el.addEventListener('click', (e) => {
    if (ppfDropdownOpen && !e.target.closest('[data-ppf-dropdown-container]')) {
      ppfDropdownOpen = false
      redraw()
      return
    }
    const togglePpfDropdown = e.target.closest('[data-ppf-year-dropdown-btn]')
    if (togglePpfDropdown) {
      ppfDropdownOpen = !ppfDropdownOpen
      redraw()
      return
    }
    const selectAllPpf = e.target.closest('[data-ppf-select-all]')
    if (selectAllPpf) {
      const deps = ppfDeposits()
      const depFys = [...new Set(deps.map((d) => getDepositFy(d.deposit_date)))]
      selectedPpfYears = new Set(depFys)
      redraw()
      return
    }
    const clearAllPpf = e.target.closest('[data-ppf-clear-all]')
    if (clearAllPpf) {
      selectedPpfYears = new Set()
      redraw()
      return
    }
    const togglePpf = e.target.closest('[data-toggle-ppf]')
    if (togglePpf) { ppfCollapsed = !ppfCollapsed; redraw(); return }
    const toggleFd = e.target.closest('[data-toggle-fd]')
    if (toggleFd) { fdCollapsed = !fdCollapsed; redraw(); return }
    const toggleAsset = e.target.closest('[data-toggle-asset]')
    if (toggleAsset) { assetCollapsed = !assetCollapsed; redraw(); return }
    const toggleBtc = e.target.closest('[data-toggle-btc]')
    if (toggleBtc) { btcCollapsed = !btcCollapsed; redraw(); return }
    const toggleSw = e.target.closest('[data-toggle-sw]')
    if (toggleSw) { swCollapsed = !swCollapsed; redraw(); return }
    const toggleTargets = e.target.closest('[data-toggle-targets]')
    if (toggleTargets) { targetsCollapsed = !targetsCollapsed; redraw(); return }
    const cardEl = e.target.closest('[data-card]')
    if (cardEl) {
      const isInteractive = e.target.closest('button, input, select, textarea, a, label, form, .rows li, table, details, summary')
      if (!isInteractive) {
        const rect = cardEl.getBoundingClientRect()
        const clickY = e.clientY - rect.top
        if (clickY <= 50 || clickY >= rect.height - 40) {
          const id = cardEl.dataset.card
          if (id === 'fd' && !fdCollapsed) { fdCollapsed = true; redraw(); return }
          if (id === 'ppf' && !ppfCollapsed) { ppfCollapsed = true; redraw(); return }
          if (id === 'asset' && !assetCollapsed) { assetCollapsed = true; redraw(); return }
          if (id === 'btc' && !btcCollapsed) { btcCollapsed = true; redraw(); return }
          if (id === 'sw' && !swCollapsed) { swCollapsed = true; redraw(); return }
          if (id === 'targets' && !targetsCollapsed) { targetsCollapsed = true; redraw(); return }
        }
      }
    }
    const fd = e.target.closest('[data-del-fd]'); if (fd) { deleteFixedDeposit(Number(fd.dataset.delFd)); redraw(); return }
    const ppf = e.target.closest('[data-del-ppf]'); if (ppf && confirm('Remove this PPF deposit?')) { deletePpfDeposit(Number(ppf.dataset.delPpf)); redraw(); return }
    const sw = e.target.closest('[data-del-sw]'); if (sw) { deleteSplitwise(sw.dataset.delSw); redraw(); return }
    const as = e.target.closest('[data-del-asset]'); if (as) { const [kind, ...name] = as.dataset.delAsset.split('|'); deleteAsset(kind, name.join('|')); redraw(); return }
  })
  total()
}

function saveTargets(form) {
  let sum = 0
  const t = {}
  form.querySelectorAll('input[type="number"]').forEach((i) => {
    const v = Number(i.value) || 0
    t[i.name] = v
    sum += v
  })
  if (sum !== 100) throw new IngestError(`Allocation targets must total 100% (currently ${sum}%)`)
  setSetting('target_allocation', t)
  const saved = form.querySelector('[data-saved]')
  if (saved) { saved.textContent = 'Saved ✓'; setTimeout(() => (saved.textContent = ''), 2000) }
}
