import { trades, disposals, ledgerView } from '../repo.js'
import { summarise, byPeriod } from '../compute/realised.js'
import { recordTrade, deleteTrade, IngestError } from '../ingest.js'
import { compact, moneyExact, money, plain, pct, shortDate, monthLabel, sleeveLabel, delta, esc } from './format.js'
import { daysBetween } from '../compute/num.js'

let gran = 'month'
let activeSleeves = new Set(['in_equity', 'in_mf', 'us_equity', 'btc'])
let sortCol = 'exit_date'
let sortDir = 'desc'
let dropdownOpen = false
let selectedPeriod = null

const SLEEVE_FILTERS = [
  { id: 'in_equity', label: 'IN Stocks' },
  { id: 'in_mf', label: 'IN Mutual Funds' },
  { id: 'us_equity', label: 'US Stocks' },
  { id: 'btc', label: 'Bitcoin' },
]

function sortIcon(col) {
  if (sortCol !== col) return `<span style="opacity:0.3;font-size:11px;margin-left:4px">↕</span>`
  return `<span style="color:var(--ink);font-size:11px;margin-left:4px">${sortDir === 'asc' ? '▲' : '▼'}</span>`
}

function detected(d) {
  if (!d.disposals.length) return ''
  return `<section class="card" style="border-color:var(--ring-strong)"><header><h2>Sales detected between ${shortDate(d.between[0])} and ${shortDate(d.between[1])}</h2></header>
    <p class="note" style="margin-top:0">A quantity that fell is a sale. A snapshot only sees what is still held, so the <b>price it sold at</b> is the one number it cannot know. The estimate uses the previous checkpoint's price - enter the real proceeds to record it.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Position</th><th class="num">Sold</th><th class="num">Cost of shares sold</th><th class="num">Estimated proceeds</th><th class="num">Actual proceeds (₹)</th><th></th></tr></thead><tbody>
    ${d.disposals.map((x, i) => `<tr><td class="name">${esc(x.name || x.symbol)} <span class="tag">${esc(sleeveLabel(x.sleeve))}</span>${x.full_exit ? ' <span class="tag">full exit</span>' : ''}</td>
      <td class="num">${plain(x.qty_sold, x.qty_sold % 1 ? 4 : 0)}</td><td class="num">${x.invested_sold === null ? '-' : money(x.invested_sold)}</td><td class="num">${money(x.estimated_proceeds)}</td>
      <td class="num"><input id="proc-${i}" type="number" step="0.01" value="${x.estimated_proceeds}" style="width:120px"></td>
      <td><button class="btn" data-record="${i}" ${x.invested_sold === null ? 'disabled title="No cost basis to compute profit from"' : ''}>Record</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">Two blind spots are structural: a stock bought <i>and</i> sold between two checkpoints never appears in a snapshot, and a week with both a sale and a purchase of the same stock nets to one disposal. Weekly checkpoints mean weekly resolution.</p></section>`
}

function capitalGains(v) {
  if (!v) return ''
  const yr = (y) => `<tr><td class="name">${esc(y.fy)}</td><td class="num">${y.disposals}</td><td class="num">${delta(y.st)}</td><td class="num">${delta(y.lt)}</td><td class="num">${y.slab_gain ? delta(y.slab_gain) : '—'}</td><td class="num">${y.est_tax ? money(y.est_tax) : '—'}${y.notes.length ? `<div style="color:var(--muted);font-size:12px;max-width:260px;margin-left:auto">${esc(y.notes.join('; '))}</div>` : ''}</td></tr>`
  const warn = [
    v.mismatches.length ? `<p class="note" style="color:var(--critical)">The ledger disagrees with what you hold for ${v.mismatches.length} position${v.mismatches.length === 1 ? '' : 's'}: ${esc(v.mismatches.slice(0, 5).map((m) => `${m.symbol} (ledger ${plain(m.ledger_qty, 3)}, held ${plain(m.held_qty, 3)})`).join(', '))}${v.mismatches.length > 5 ? ', …' : ''}. A trade is missing, or a bonus or split is not in the ledger. Gains on those positions may be wrong, and XIRR is left blank for their sleeves.</p>` : '',
    v.unmatched.length ? `<p class="note" style="color:var(--critical)">${v.unmatched.length} sale${v.unmatched.length === 1 ? '' : 's'} had no purchase behind ${v.unmatched.length === 1 ? 'it' : 'them'} (${esc(v.unmatched.slice(0, 4).map((u) => u.symbol).join(', '))}${v.unmatched.length > 4 ? ', …' : ''}): the ledger starts after the position was opened. They are left out rather than counted as pure profit.</p>` : '',
  ].join('')
  return `<section class="card"><header><h2>Capital gains, from your trade ledger</h2></header>
    <p class="note" style="margin-top:0">${v.trades.toLocaleString('en-IN')} trades from ${shortDate(v.from)} to ${shortDate(v.to)}, matched first-in first-out. Unlike the sales above, which are inferred from two snapshots, these have exact dates and prices.</p>${warn}
    ${v.years.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Financial year</th><th class="num">Sales</th><th class="num">Short-term</th><th class="num">Long-term</th><th class="num">At slab rate</th><th class="num">Estimated tax</th></tr></thead><tbody>${v.years.map(yr).join('')}</tbody></table></div>` : '<div class="empty">No sales in the ledger yet.</div>'}
    <p class="note"><b>An estimate, not tax advice.</b> Listed equity and equity funds: long-term after 12 months, 12.5% above a ₹1.25 lakh yearly exemption, short-term 20% (15% and 10% with ₹1 lakh before 23 Jul 2024). Foreign shares are long-term after 24 months, gold ETFs after 12. It is before surcharge and cess, and it does not model indexation or carrying losses forward. Debt funds and short-term gains on foreign shares and gold are taxed at your slab rate, so they show as gains but not as tax. Mutual funds are assumed to be equity-oriented.</p>
    ${v.disposals.length ? `<details><summary>Every sale (${v.disposals.length})</summary><div class="table-wrap"><table class="data"><thead><tr><th>Holding</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">Qty</th><th class="num">Cost</th><th class="num">Proceeds</th><th class="num">Gain</th><th>Term</th></tr></thead><tbody>
      ${v.disposals.slice(0, 200).map((d) => `<tr><td class="name">${esc(d.name)}</td><td class="num">${shortDate(d.buy_date)}</td><td class="num">${shortDate(d.sell_date)}</td><td class="num">${plain(d.qty, d.qty % 1 ? 3 : 0)}</td><td class="num">${money(d.cost)}</td><td class="num">${money(d.proceeds)}</td><td class="num">${delta(d.gain)}</td><td>${d.term || 'slab'}</td></tr>`).join('')}
    </tbody></table></div>${v.disposals.length > 200 ? '<p class="note">The latest 200 are shown.</p>' : ''}</details>` : ''}</section>`
}

export function render(el) {
  const draw = () => {
    const allTs = trades()
    const ts = allTs.filter((t) => activeSleeves.has(t.sleeve))
    const s = summarise(ts)
    const d = disposals()
    const periods = byPeriod([...ts].reverse(), gran)
    // Filter trades if a period is selected
    let displayedTrades = ts
    if (selectedPeriod && gran !== 'all') {
      displayedTrades = ts.filter((t) => {
        if (gran === 'year') return (t.exit_date || '').startsWith(selectedPeriod.slice(0, 4))
        return (t.exit_date || '').startsWith(selectedPeriod.slice(0, 7))
      })
    }

    // Sort trades for the table
    const sortedTrades = [...displayedTrades].sort((a, b) => {
      let va, vb
      if (sortCol === 'symbol') { va = a.symbol || ''; vb = b.symbol || ''; return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va) }
      if (sortCol === 'sleeve') { va = sleeveLabel(a.sleeve); vb = sleeveLabel(b.sleeve); return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va) }
      if (sortCol === 'exit_date') { va = a.exit_date || ''; vb = b.exit_date || ''; return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va) }
      if (sortCol === 'holding_days') { va = a.holding_days ?? -1; vb = b.holding_days ?? -1 }
      else if (sortCol === 'invested_inr') { va = Number(a.invested_inr); vb = Number(b.invested_inr) }
      else if (sortCol === 'realised_inr') { va = Number(a.realised_inr); vb = Number(b.realised_inr) }
      else if (sortCol === 'return_pct') {
        va = a.invested_inr ? a.realised_inr / a.invested_inr : -999
        vb = b.invested_inr ? b.realised_inr / b.invested_inr : -999
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })

    // Realised profit value without triangle, colored red or green
    const realisedValueStr = s.realised >= 0
      ? `<span style="color:var(--good)">+${moneyExact(s.realised)}</span>`
      : `<span style="color:var(--critical)">−${moneyExact(Math.abs(s.realised))}</span>`

    const tableTitle = (gran === 'all' || !selectedPeriod)
      ? `All trades (${sortedTrades.length})`
      : `Trades (${sortedTrades.length})`

    // Sleeve dropdown state & label
    let sleeveDropdownLabel = 'Filter sleeves'
    if (activeSleeves.size === 0) {
      sleeveDropdownLabel = 'Select sleeves (0)'
    } else if (activeSleeves.size === SLEEVE_FILTERS.length) {
      sleeveDropdownLabel = `All sleeves (${SLEEVE_FILTERS.length})`
    } else if (activeSleeves.size === 1) {
      const sf = SLEEVE_FILTERS.find((f) => activeSleeves.has(f.id))
      sleeveDropdownLabel = sf ? sf.label : '1 sleeve'
    } else {
      sleeveDropdownLabel = `${activeSleeves.size} sleeves selected`
    }

    const allSleevesSelected = activeSleeves.size === SLEEVE_FILTERS.length
    const noSleevesSelected = activeSleeves.size === 0

    el.innerHTML = `<div class="grid" style="gap:16px">${detected(d)}${capitalGains(ledgerView())}
    <section class="card">
      <header style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;position:relative">
        <h2>Realised profit</h2>
        <div class="dropdown" style="position:relative;display:inline-block">
          <button class="btn" id="sleeve-dropdown-btn" type="button" style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:var(--card);font-size:13px;border-color:var(--ring-strong);color:var(--ink);cursor:pointer">
            <span>${sleeveDropdownLabel}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transform:${dropdownOpen ? 'rotate(180deg)' : 'none'};transition:transform .15s"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          ${dropdownOpen ? `
            <div id="sleeve-dropdown-menu" style="position:absolute;top:calc(100% + 4px);right:0;z-index:200;background:var(--card);border:1px solid var(--ring-strong);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.3);min-width:230px;padding:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px 8px;border-bottom:1px solid var(--gridline);margin-bottom:6px">
                <button type="button" class="btn ${allSleevesSelected ? 'primary' : ''}" data-action="select-all" style="padding:2px 8px;font-size:11.5px;${allSleevesSelected ? 'background:#ffffff;color:#000000;border-color:#ffffff;font-weight:600;' : ''}">Select all</button>
                <button type="button" class="btn ${noSleevesSelected ? 'primary' : ''}" data-action="clear-all" style="padding:2px 8px;font-size:11.5px;${noSleevesSelected ? 'background:#ffffff;color:#000000;border-color:#ffffff;font-weight:600;' : ''}">Clear all</button>
              </div>
              <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
                ${SLEEVE_FILTERS.map((f) => {
                  const isChecked = activeSleeves.has(f.id)
                  const sTrades = allTs.filter((t) => t.sleeve === f.id)
                  return `<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:13px;user-select:none" class="ppf-year-label">
                    <input type="checkbox" data-sleeve-filter="${f.id}" ${isChecked ? 'checked' : ''} style="width:auto;margin:0;cursor:pointer">
                    <span style="font-weight:600;color:var(--ink)">${f.label}</span>
                    <span class="muted" style="margin-left:auto;font-size:12px">${sTrades.length} trade${sTrades.length === 1 ? '' : 's'}</span>
                  </label>`
                }).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </header>
      ${ts.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:36px;align-items:flex-start;margin-top:16px">
        <div style="min-width:260px;margin-right:8px">
          <div class="hero-label">Realised</div>
          <div class="hero-figure" style="font-size:28px;white-space:nowrap">${realisedValueStr}</div>
          ${s.return_pct === null ? '' : `<div class="hero-secondary" style="margin-top:2px;font-size:13px">${plain(s.return_pct)}% on ${compact(s.invested)} invested</div>`}
        </div>
        <div style="min-width:110px">
          <div class="hero-label">Trades</div>
          <div class="hero-figure" style="font-size:28px">${s.trades}</div>
          <div class="hero-secondary" style="margin-top:2px;font-size:13px">${s.winners} won · ${s.losers} lost</div>
        </div>
        <div style="min-width:110px">
          <div class="hero-label">Win rate</div>
          <div class="hero-figure" style="font-size:28px">${s.win_rate_pct === null ? '-' : `${s.win_rate_pct}%`}</div>
        </div>
        <div style="min-width:120px">
          <div class="hero-label">Gross wins</div>
          <div class="hero-figure" style="font-size:28px;color:var(--good)">${compact(s.gross_wins)}</div>
          <div class="hero-secondary" style="margin-top:2px;font-size:13px">${s.winners} won</div>
        </div>
        <div style="min-width:120px">
          <div class="hero-label">Gross losses</div>
          <div class="hero-figure" style="font-size:28px;color:var(--critical)">${s.gross_losses === 0 ? '₹0' : `−${compact(Math.abs(s.gross_losses)).replace('−', '')}`}</div>
          <div class="hero-secondary" style="margin-top:2px;font-size:13px">${s.losers} lost</div>
        </div>
        <div style="min-width:120px">
          <div class="hero-label">Avg holding</div>
          <div class="hero-figure" style="font-size:28px">${s.avg_holding_days === null ? '-' : `${s.avg_holding_days} days`}</div>
          <div class="hero-secondary" style="margin-top:2px;font-size:13px">from buy to exit</div>
        </div>
      </div>
      <p class="note" style="margin-top:18px">Break-even counts as a loser: it consumed the position and returned nothing, and calling it a win would flatter the hit rate. Gross wins and gross losses are shown apart so a big win can't hide behind many small losses.</p>` : `<div class="empty">No realised trades matching selected filters.</div>`}</section>
    ${ts.length ? `<section class="card"><header><h2>By ${gran === 'all' ? 'All time' : gran === 'year' ? 'Year' : 'Month'}</h2><span class="spacer"></span>
      <div class="tabs">${[
        { id: 'month', label: 'Monthly' },
        { id: 'year', label: 'Yearly' },
        { id: 'all', label: 'All time' },
      ].map((g) => `<button class="btn" data-gran="${g.id}" aria-pressed="${g.id === gran}">${g.label}</button>`).join(' ')}</div></header>
      ${stackedBarsSigned(periods, gran, selectedPeriod)}</section>
    <section class="card"><header style="display:flex;align-items:center;justify-content:space-between">
      <h2>${tableTitle}</h2>
      ${selectedPeriod && gran !== 'all' ? `<button class="btn" data-clear-period style="font-size:12px">${gran === 'year' ? selectedPeriod.slice(0, 4) : monthLabel(selectedPeriod)} ✕</button>` : ''}
    </header><div class="table-wrap"><table class="data"><thead><tr>
      <th style="cursor:pointer;user-select:none;text-align:center" data-sort="symbol">Stock ${sortIcon('symbol')}</th>
      <th style="cursor:pointer;user-select:none;text-align:center" data-sort="sleeve">Sleeve ${sortIcon('sleeve')}</th>
      <th style="cursor:pointer;user-select:none;text-align:center" data-sort="exit_date">Exited ${sortIcon('exit_date')}</th>
      <th style="cursor:pointer;user-select:none;text-align:center" data-sort="holding_days">Held for ${sortIcon('holding_days')}</th>
      <th style="cursor:pointer;user-select:none;text-align:center" data-sort="invested_inr">Invested ${sortIcon('invested_inr')}</th>
      <th style="cursor:pointer;user-select:none;text-align:center" data-sort="realised_inr">Realised ${sortIcon('realised_inr')}</th>
      <th style="cursor:pointer;user-select:none;text-align:center" data-sort="return_pct">Return ${sortIcon('return_pct')}</th>
    </tr></thead><tbody>
      ${sortedTrades.map((t) => `<tr>
        <td style="text-align:center">${esc(t.symbol)}</td>
        <td style="text-align:center">${esc(sleeveLabel(t.sleeve))}</td>
        <td style="text-align:center">${shortDate(t.exit_date)}</td>
        <td style="text-align:center">${t.holding_days === null ? '-' : `${t.holding_days}d`}</td>
        <td style="text-align:center">${money(t.invested_inr)}</td>
        <td style="text-align:center">${delta(t.realised_inr)}</td>
        <td style="text-align:center">${t.invested_inr ? `${plain((t.realised_inr / t.invested_inr) * 100)}%` : '-'}</td>
      </tr>`).join('')}
      </tbody></table></div></section>` : ''}</div>`
  }
  draw()

  el.addEventListener('change', (e) => {
    const chk = e.target.closest('input[data-sleeve-filter]')
    if (chk) {
      const sleeve = chk.dataset.sleeveFilter
      if (chk.checked) activeSleeves.add(sleeve)
      else activeSleeves.delete(sleeve)
      draw()
      return
    }
  })

  el.addEventListener('click', (e) => {
    // Dropdown toggle
    if (e.target.closest('#sleeve-dropdown-btn')) {
      dropdownOpen = !dropdownOpen
      draw()
      return
    }

    // Select all / Clear all
    const act = e.target.closest('[data-action]')
    if (act) {
      if (act.dataset.action === 'select-all') {
        activeSleeves = new Set(SLEEVE_FILTERS.map((f) => f.id))
      } else if (act.dataset.action === 'clear-all') {
        activeSleeves.clear()
      }
      draw()
      return
    }

    // Close dropdown on outside click
    if (dropdownOpen && !e.target.closest('.dropdown')) {
      dropdownOpen = false
      draw()
      return
    }

    const sortTh = e.target.closest('[data-sort]')
    if (sortTh) {
      const col = sortTh.dataset.sort
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc'
      } else {
        sortCol = col
        sortDir = ['symbol', 'sleeve'].includes(col) ? 'asc' : 'desc'
      }
      draw()
      return
    }

    const bar = e.target.closest('rect[data-period]')
    if (bar) {
      const p = bar.dataset.period
      if (gran === 'all' || p === 'All time') {
        selectedPeriod = null
      } else {
        selectedPeriod = selectedPeriod === p ? null : p
      }
      draw()
      return
    }

    if (e.target.closest('[data-clear-period]')) {
      selectedPeriod = null
      draw()
      return
    }

    const g = e.target.closest('[data-gran]')
    if (g) {
      gran = g.dataset.gran
      selectedPeriod = null
      draw()
      return
    }

    const rec = e.target.closest('[data-record]')
    if (rec) {
      const d = disposals(), x = d.disposals[Number(rec.dataset.record)]
      const proceeds = Number(el.querySelector(`#proc-${rec.dataset.record}`).value)
      if (!Number.isFinite(proceeds)) return alert('Enter the proceeds in rupees.')
      try {
        recordTrade({ sleeve: x.sleeve, symbol: x.symbol, exit_date: d.between[1], invested_inr: x.invested_sold, realised_inr: proceeds - x.invested_sold, holding_days: null, source: 'refresh' })
        draw()
      } catch (err) { alert(err instanceof IngestError ? err.message : String(err)) }
    }
  })
}

/** Bars: when all positive, baseline is at bottom so no empty negative space is drawn. */
function stackedBarsSigned(periods, granularity = 'month', selectedPeriod = null) {
  if (!periods.length) return ''
  const W = 900, H = 260, pad = { l: 62, r: 12, t: 12, b: 28 }
  const hasNeg = periods.some((p) => p.realised < 0)
  const maxPos = Math.max(...periods.map((p) => Math.max(p.realised, 0)), 1)
  const maxNeg = hasNeg ? Math.max(...periods.map((p) => Math.max(-p.realised, 0)), 0) : 0
  const chartHeight = H - pad.t - pad.b

  let midY, posScale, negScale
  if (hasNeg) {
    const totalSpan = maxPos + maxNeg
    midY = pad.t + (maxPos / totalSpan) * chartHeight
    posScale = (midY - pad.t) / maxPos
    negScale = (H - pad.b - midY) / maxNeg
  } else {
    midY = H - pad.b
    posScale = chartHeight / maxPos
    negScale = 0
  }

  const bw = (W - pad.l - pad.r) / periods.length
  const step = Math.ceil(periods.length / 12)
  const bars = periods.map((p, i) => {
    const w = Math.min(bw * 0.68, 64), x = pad.l + i * bw + (bw - w) / 2
    const up = p.realised >= 0
    let y, h
    if (up) {
      h = Math.max(p.realised * posScale, p.realised > 0 ? 2 : 0)
      y = midY - h
    } else {
      h = Math.max(Math.abs(p.realised) * negScale, 2)
      y = midY
    }
    const labelText = granularity === 'all' ? 'All time' : granularity === 'year' ? p.period.slice(0, 4) : monthLabel(p.period)
    const isSelected = selectedPeriod && p.period === selectedPeriod
    return `<rect data-period="${p.period}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="2" fill="var(--${up ? 'good' : 'critical'})" style="cursor:pointer;${isSelected ? 'outline:2px solid var(--ink);outline-offset:1px;' : ''}"><title>${labelText} · ${compact(p.realised)} · ${p.trades} trade${p.trades === 1 ? '' : 's'}</title></rect>` +
      (i % step === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--muted)" font-size="11.5">${labelText}</text>` : '')
  }).join('')

  const yLabels = `<line x1="${pad.l}" x2="${W - pad.r}" y1="${midY.toFixed(1)}" y2="${midY.toFixed(1)}" stroke="var(--baseline)"/>` +
    `<text x="${pad.l - 8}" y="${(midY + 4).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="11.5">₹0</text>` +
    `<text x="${pad.l - 8}" y="${pad.t + 10}" text-anchor="end" fill="var(--muted)" font-size="11.5">${compact(maxPos)}</text>` +
    (hasNeg && maxNeg > 0 ? `<text x="${pad.l - 8}" y="${H - pad.b}" text-anchor="end" fill="var(--muted)" font-size="11.5">−${compact(maxNeg).replace('−', '')}</text>` : '')

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${yLabels}${bars}</svg>`
}
