import { investmentsView, incomeView, RANGE_IDS } from '../repo.js'
import { getSetting } from '../db.js'
import { paginate, scrollBox, bindPager } from './pager.js'
import { lineChart, stackedBars, bindHighlight, bindChartDrag } from './charts.js'
import { compact, moneyExact, plain, pct, shortDate, monthLabel, sleeveLabel, sleeveColor, delta, esc, money, formatPrice } from './format.js'

const RANGE_LABEL = { '1w': '1 week', '1m': '1 month', '3m': '3 months', '1y': '1 year', all: 'All' }
let range = '3m', open = null
const PERF_RANGES = [
  { id: '1m', label: '1 month', days: 30 },
  { id: '6m', label: '6 months', days: 180 },
  { id: '1y', label: '1 year', days: 365 },
  { id: '5y', label: '5 years', days: 1825 },
  { id: '10y', label: '10 years', days: 3650 },
  { id: 'all', label: 'All', days: null },
]
let perfRange = 'all'
let currentShownSeries = []
const ALL_BENCHMARK_KEYS = ['nifty50', 'nifty_midcap150', 'nifty_smallcap250', 'sp500', 'nasdaq100', 'nyse_composite']
const hidden = new Set(ALL_BENCHMARK_KEYS)

let holdingsSortCol = 'buy_date'
let holdingsSortDir = 'desc'

function holdingsSortIcon(col) {
  if (holdingsSortCol !== col) return `<span style="opacity:0.3;font-size:11px;margin-left:4px">↕</span>`
  return `<span style="color:var(--ink);font-size:11px;margin-left:4px">${holdingsSortDir === 'asc' ? '▲' : '▼'}</span>`
}

const MARKET_STYLE = {
  portfolio: { color: '#ffffff', dash: '', width: 3.4 },
  overall: { color: '#ffffff', dash: '', width: 3.4 },
  nifty50: { color: '#ffe119', dash: '7 5', width: 2.2 },
  nifty_midcap150: { color: '#e6194B', dash: '7 5', width: 2.2 },
  nifty_smallcap250: { color: '#fabed4', dash: '7 5', width: 2.2 },
  sp500: { color: '#fffac8', dash: '2 5', width: 2.2 },
  nasdaq100: { color: '#42d4f4', dash: '2 5', width: 2.2 },
  nyse_composite: { color: '#bfef45', dash: '2 5', width: 2.2 },
}

function indexed(v) {
  if (v.series.length < 2 && (!v.compare || !v.compare.series || v.compare.series.length < 1)) {
    return `<div class="empty">Indexed performance needs two checkpoints. Take another and the lines appear.</div>`
  }
  const pts = (arr) => arr.map((p) => [Date.parse(p.as_of), p.v])

  const cutoffDays = PERF_RANGES.find((r) => r.id === perfRange)?.days
  const cutoffMs = cutoffDays ? Date.parse(v.as_of) - cutoffDays * 86400000 : null
  const filterAndRebase = (ptsArr) => {
    if (!ptsArr || ptsArr.length < 2) return null
    if (!cutoffMs) return ptsArr
    const inRangePts = ptsArr.filter((p) => p[0] >= cutoffMs)
    if (inRangePts.length < 2) {
      return ptsArr.length >= 2 ? ptsArr.slice(-2) : null
    }
    const baseVal = inRangePts[0][1] || 100
    return inRangePts.map((p) => [p[0], (p[1] / baseVal) * 100])
  }

  // Desired order of instruments:
  // 1. Overall Portfolio, 2. IN Stocks, 3. US Stocks, 4. IN Mutual Funds, 5. Gold, 6. Bitcoin, 7. PPF, 8. FD, (EPF)
  const INSTRUMENT_ORDER = [
    { key: 'portfolio', label: 'Overall Portfolio', color: '#ffffff', dash: '', width: 3.4 },
    { key: 'in_equity', label: 'IN Stocks', color: '#4363d8', dash: '', width: 2.4 },
    { key: 'us_equity', label: 'US Stocks', color: '#3cb44b', dash: '', width: 2.4 },
    { key: 'in_mf', label: 'IN Mutual Funds', color: '#f58231', dash: '', width: 2.4 },
    { key: 'gold', label: 'Gold', color: sleeveColor('gold'), dash: '', width: 2.4 },
    { key: 'btc', label: 'Bitcoin', color: '#911eb4', dash: '', width: 2.4 },
    { key: 'fd', label: 'Fixed Deposits', color: '#f032e6', dash: '', width: 2.4 },
    { key: 'ppf', label: 'PPF', color: '#9A6324', dash: '', width: 2.4 },
    { key: 'epf', label: 'EPF', color: '#469990', dash: '', width: 2.4 },
  ]

  const activeInstruments = []
  for (const item of INSTRUMENT_ORDER) {
    if (item.key === 'portfolio') {
      const match = v.compare?.series?.find((s) => s.key === 'portfolio')
      if (match && match.points.length > 1) {
        const rebased = filterAndRebase(pts(match.points))
        if (rebased && rebased.length > 1) {
          activeInstruments.push({ ...item, points: rebased })
        }
      }
    } else {
      const sl = v.sleeves?.find((s) => s.sleeve === item.key)
      const isInvested = sl && (sl.value > 0 || sl.invested > 0 || (sl.holdings && sl.holdings.length > 0))
      if (isInvested && v.index[item.key] && v.index[item.key].length > 1) {
        const rebased = filterAndRebase(pts(v.index[item.key]))
        if (rebased && rebased.length > 1) {
          activeInstruments.push({ ...item, points: rebased })
        }
      }
    }
  }

  // Benchmark indices
  const INDEX_ORDER = [
    { key: 'nifty50', label: 'Nifty 50', color: '#ffe119', dash: '7 5', width: 2.2 },
    { key: 'nifty_midcap150', label: 'Nifty Midcap 150', color: '#e6194B', dash: '7 5', width: 2.2 },
    { key: 'nifty_smallcap250', label: 'Nifty Smallcap 250', color: '#fabed4', dash: '7 5', width: 2.2 },
    { key: 'sp500', label: 'S&P 500', color: '#fffac8', dash: '2 5', width: 2.2 },
    { key: 'nasdaq100', label: 'Nasdaq 100', color: '#42d4f4', dash: '2 5', width: 2.2 },
    { key: 'nyse_composite', label: 'NYSE Composite', color: '#bfef45', dash: '2 5', width: 2.2 },
  ]

  const activeIndices = []
  for (const idx of INDEX_ORDER) {
    const match = v.compare?.series?.find((s) => s.key === idx.key)
    if (match && match.points.length > 1) {
      const rebased = filterAndRebase(pts(match.points))
      if (rebased && rebased.length > 1) {
        activeIndices.push({ ...idx, points: rebased })
      }
    }
  }

  const all = [...activeInstruments, ...activeIndices]
  const shown = all.filter((s) => !hidden.has(s.key))
  currentShownSeries = shown
  const chart = shown.length
    ? lineChart({ series: shown, yFormat: (n) => String(Math.round(n * 10) / 10), xFormat: (ms) => shortDate(new Date(ms).toISOString().slice(0, 10)), baseline: 100, title: 'Every sleeve, your portfolio and the market indices, indexed to 100' })
    : '<div class="empty">Every line is hidden. Click a name below to bring it back.</div>'

  const firstDate = shown[0]?.points?.[0] ? shortDate(new Date(shown[0].points[0][0]).toISOString().slice(0, 10)) : 'invested date'

  const renderToggle = (s) => {
    const off = hidden.has(s.key)
    return `<button type="button" class="legend-toggle lg${off ? ' off' : ''}" data-key="${esc(s.key)}" data-toggle="${esc(s.key)}" aria-pressed="${!off}" style="--lg-color:${s.color}" title="${off ? 'Show' : 'Hide'} ${esc(s.label)}">` +
      `<i class="swatch" style="background:${s.color}"></i>${esc(s.label)}</button>`
  }

  const legendHtml = `
    <div class="legend legend-instruments" style="margin-top:12px">${activeInstruments.map(renderToggle).join('')}</div>
    <div class="legend legend-indices" style="margin-top:8px">${activeIndices.map(renderToggle).join('')}${hidden.size ? '<button type="button" class="legend-toggle lg-reset" data-show-all>Show all</button>' : ''}</div>
  `

  return `<div data-chart style="position:relative">
    ${chart}
    <div class="drag-tooltip" style="display:none;position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:#18181b;border:1px solid #3f3f46;border-radius:6px;padding:6px 14px;font-size:12.5px;color:var(--ink);box-shadow:0 4px 16px rgba(0,0,0,0.6);pointer-events:none;z-index:10;white-space:nowrap;align-items:center;gap:8px"></div>
    ${legendHtml}
  </div>
    <p class="note">Click a name to hide its line (the chart rescales); hover a name or a line to light it up. Drag across the chart to measure change. Each sleeve line starts at 100 on its invested date (${firstDate}), so the lines compare <i>rates</i> of change rather than sizes. They are time-weighted: money you added or took out is left out, so a SIP never reads as a gain and a sale never reads as a crash. The thick white line is your overall portfolio; dashed lines are benchmark indices.</p>`
}

const INCOME_KINDS = [['dividends', 'Dividends', 'var(--cat-1)'], ['interest', 'Interest', 'var(--cat-3)'], ['unspecified', 'No note', 'var(--cat-other)']]

function incomeCard() {
  if (getSetting('wallet_has_dividends', true) === false) return ''
  const i = incomeView()
  if (!i) return ''
  const pg = paginate('income-payers', i.payers, { size: 10 })
  const kinds = INCOME_KINDS.filter(([k]) => i[k] > 0)
  const chart = stackedBars({
    periods: i.months.map((m) => ({ period: m.month, label: monthLabel(m.month), segments: Object.fromEntries(kinds.map(([k]) => [k, m[k]])) })),
    keys: kinds.map(([k]) => k).reverse(), color: (k) => INCOME_KINDS.find(([x]) => x === k)[2], yFormat: compact, title: 'Dividends and interest received by month', link: false,
  })
  const stat = (label, value, sub) => `<div><div class="hero-label">${label}</div><div class="hero-figure">${value}</div><div class="hero-secondary" style="margin-top:2px;font-size:13px">${sub}</div></div>`
  return `<section class="card"><header><h2>Income from investments - last 12 months</h2></header>
    <div class="grid stats" style="margin-bottom:12px">
      ${stat('Received', moneyExact(i.total), `${monthLabel(i.from)} to ${monthLabel(i.to)}`)}
      ${stat('A month', compact(i.monthly_avg), `paid in ${i.months_paid} of 12 months`)}
      ${stat('Dividends', compact(i.dividends), i.payers.length ? `from ${i.payers.length} payer${i.payers.length === 1 ? '' : 's'}` : 'none noted')}
      ${stat('Interest', compact(i.interest), i.unspecified ? `plus ${compact(i.unspecified)} with no note` : 'bank and FD interest')}
    </div>${chart}
    <div class="legend">${kinds.map(([, l, c]) => `<span><i class="swatch" style="background:${c}"></i>${l}</span>`).join('')}</div>
    ${i.payers.length ? `<div style="margin-top:12px">${scrollBox(`<table class="data"><thead><tr><th>Biggest dividend payers</th><th class="num">Received</th><th class="num">Allocation</th></tr></thead><tbody>${pg.rows.map((p) => { const payerName = esc((p.name || '').replace(/\bstocks?\b/gi, '').replace(/\s+/g, ' ').trim().toUpperCase()); return `<tr><td class="name">${payerName}</td><td class="num">${compact(p.amount)}</td><td class="num">${plain((p.amount / i.dividends) * 100, 0)}%</td></tr>` }).join('')}</tbody></table>`)}${pg.controls}</div>` : ''}
    <p class="note">Everything Wallet files under "Interest, dividends", counted when the money arrived. A credit you never entered in Wallet is not here. Wallet has no field for which it was, so the split reads the note: "interest" or "FD" means interest, any other note is read as a dividend from that name, and a credit with no note is shown separately rather than guessed. This is cash received, not a yield, and it makes no forecast.</p></section>`
}

const xirrCell = (x) => (x ? delta(x.pct, (n) => `${plain(n, 1)}%`) : '-')

function holdingsTable(s) {
  const isMf = s.sleeve === 'in_mf'
  const isPpfOrFd = s.sleeve === 'ppf' || s.sleeve === 'fd'
  const isEpf = s.sleeve === 'epf'
  const isNps = s.sleeve === 'nps'

  const sortedHoldings = [...s.holdings].sort((a, b) => {
    let cmp = 0
    if (holdingsSortCol === 'name') {
      const na = a.name || a.symbol || ''
      const nb = b.name || b.symbol || ''
      cmp = na.localeCompare(nb)
    } else if (holdingsSortCol === 'qty') {
      cmp = (Number(a.qty) || 0) - (Number(b.qty) || 0)
    } else if (holdingsSortCol === 'price') {
      const pa = a.avg_cost !== null && a.avg_cost !== undefined ? Number(a.avg_cost) : (Number(a.price) || 0)
      const pb = b.avg_cost !== null && b.avg_cost !== undefined ? Number(b.avg_cost) : (Number(b.price) || 0)
      cmp = pa - pb
    } else if (holdingsSortCol === 'invested') {
      const ia = a.invested !== null && a.invested !== undefined ? Number(a.invested) : (Number(a.invested_inr) || 0)
      const ib = b.invested !== null && b.invested !== undefined ? Number(b.invested) : (Number(b.invested_inr) || 0)
      cmp = ia - ib
    } else if (holdingsSortCol === 'value') {
      cmp = (Number(a.value) || 0) - (Number(b.value) || 0)
    } else if (holdingsSortCol === 'return_pct') {
      const ra = a.return_pct !== null && a.return_pct !== undefined ? Number(a.return_pct) : -9999
      const rb = b.return_pct !== null && b.return_pct !== undefined ? Number(b.return_pct) : -9999
      cmp = ra - rb
    } else if (holdingsSortCol === 'buy_date') {
      if (!a.buy_date && !b.buy_date) return 0
      if (!a.buy_date) return 1
      if (!b.buy_date) return -1
      cmp = a.buy_date.localeCompare(b.buy_date)
    } else if (holdingsSortCol === 'share_pct') {
      cmp = (Number(a.share_pct) || 0) - (Number(b.share_pct) || 0)
    }
    return holdingsSortDir === 'asc' ? cmp : -cmp
  })

  const pg = paginate(`holdings-${s.sleeve}`, sortedHoldings, { size: 25 })

  const th = (label, colKey) => `<th style="cursor:pointer;user-select:none;text-align:center" data-sort-holdings="${colKey}">${label} ${holdingsSortIcon(colKey)}</th>`

  const showInvestedOn = getSetting('wallet_has_stock_buys', true) !== false
  let ths = ''
  if (isEpf) {
    ths = `${th('Holding', 'name')}${th('Curr. Value', 'value')}${th('Allocation', 'share_pct')}`
  } else if (isNps) {
    ths = `${th('Holding', 'name')}${th('Invested', 'invested')}${th('Curr. Value', 'value')}${th('Since bought', 'return_pct')}${th('Allocation', 'share_pct')}`
  } else if (isMf) {
    ths = `${th('Holding', 'name')}${th('Units', 'qty')}${th('Curr. NAV', 'price')}${th('Invested', 'invested')}${th('Current', 'value')}${th('Since bought', 'return_pct')}${showInvestedOn ? th('Invested on', 'buy_date') : ''}${th('Allocation', 'share_pct')}`
  } else if (isPpfOrFd) {
    ths = `${th('Holding', 'name')}${th('Invested', 'invested')}${th('Curr. Value', 'value')}${th('Since bought', 'return_pct')}${showInvestedOn ? th('Invested on', 'buy_date') : ''}`
  } else {
    ths = `${th('Holding', 'name')}${th('Qty', 'qty')}${th('Avg. Price', 'price')}${th('Invested', 'invested')}${th('Curr. Value', 'value')}${th('Since bought', 'return_pct')}${showInvestedOn ? th('Invested on', 'buy_date') : ''}${th('Allocation', 'share_pct')}`
  }

  return `<section class="card"><header><h2>${esc(sleeveLabel(s.sleeve))} - Holdings</h2><span class="spacer"></span><span class="hero-label">${s.holdings.length}</span></header>${scrollBox(`<table class="data holdings-data"><thead><tr>${ths}</tr></thead><tbody>
    ${pg.rows.map((h) => {
      let holdingName = h.name || h.symbol || ''
      if (s.sleeve === 'fd') {
        holdingName = h.bank || holdingName.replace(/^[0-9.]+%?\s*/, '').replace(/\s*FD.*$/i, '').trim() || h.symbol
      } else if (s.sleeve === 'btc') {
        holdingName = holdingName.toLowerCase().includes('manual') ? 'Bitcoin (Manual)' : (h.source ? `Bitcoin (${h.source})` : 'Bitcoin')
      } else if (s.sleeve === 'us_equity') {
        holdingName = h.name || h.symbol
      } else if (s.sleeve === 'ppf') {
        holdingName = h.name || 'PPF'
      }

      const avgBuyPrice = h.avg_cost !== null && h.avg_cost !== undefined ? h.avg_cost : (h.invested && h.qty ? h.invested / h.qty : h.price)
      const isNativeUsd = h.currency === 'USD'
      const displayPrice = isMf ? formatPrice(h.price, isNativeUsd) : formatPrice(avgBuyPrice, isNativeUsd)
      const investedVal = h.invested !== null && h.invested !== undefined ? money(h.invested) : '-'
      const investOnDate = h.buy_date ? shortDate(h.buy_date) : '-'

      let sinceBoughtHtml = '-'
      if (h.return_pct !== null && h.return_pct !== undefined) {
        sinceBoughtHtml = `${delta(h.return_pct, (v) => `${plain(v)}%`)}<div style="color:var(--muted);font-size:12px">${compact(h.unrealised)}</div>`
      }

      if (isEpf) {
        return `<tr>
          <td class="name">${esc(holdingName)}</td>
          <td>${money(h.value)}</td>
          <td>${plain(h.share_pct, 1)}%</td>
        </tr>`
      } else if (isNps) {
        return `<tr>
          <td class="name">${esc(holdingName)}</td>
          <td>${investedVal}</td>
          <td>${money(h.value)}</td>
          <td>${sinceBoughtHtml}</td>
          <td>${plain(h.share_pct, 1)}%</td>
        </tr>`
      } else if (isMf) {
        return `<tr>
          <td class="name">${esc(holdingName)}</td>
          <td>${plain(h.qty, h.qty % 1 ? 4 : 0)}</td>
          <td>${displayPrice}</td>
          <td>${investedVal}</td>
          <td>${money(h.value)}</td>
          <td>${sinceBoughtHtml}</td>
          ${showInvestedOn ? `<td>${investOnDate}</td>` : ''}
          <td>${plain(h.share_pct, 1)}%</td>
        </tr>`
      } else if (isPpfOrFd) {
        return `<tr>
          <td class="name">${esc(holdingName)}</td>
          <td>${investedVal}</td>
          <td>${money(h.value)}</td>
          <td>${sinceBoughtHtml}</td>
          ${showInvestedOn ? `<td>${investOnDate}</td>` : ''}
        </tr>`
      } else {
        return `<tr>
          <td class="name">${esc(holdingName)}${h.flagged ? ' <span class="tag" title="Flow above 25% of the sleeve: a split or bonus?">flow flag</span>' : ''}</td>
          <td>${plain(h.qty, h.qty % 1 ? 4 : 0)}</td>
          <td>${displayPrice}</td>
          <td>${investedVal}</td>
          <td>${money(h.value)}</td>
          <td>${sinceBoughtHtml}</td>
          ${showInvestedOn ? `<td>${investOnDate}</td>` : ''}
          <td>${plain(h.share_pct, 1)}%</td>
        </tr>`
      }
    }).join('')}
    </tbody></table>`)}${pg.controls}</section>`
}

export function render(el) {
  let current = null
  const draw = () => {
    const x = current = investmentsView(range)
    if (!x) { el.innerHTML = '<div class="empty">No investments data available.</div>'; return }
    el.innerHTML = `<div class="grid" style="gap:16px">
    <section class="card"><header><h2>Investments - ${x.checkpoints_in_range} checkpoint${x.checkpoints_in_range === 1 ? '' : 's'} in range</h2><span class="spacer"></span>
      <div class="tabs">${RANGE_IDS.map((r) => `<button class="btn" data-range="${r}" aria-pressed="${r === range}">${RANGE_LABEL[r]}</button>`).join(' ')}</div></header>
      <div class="grid cols-2" style="gap:28px"><div><div class="hero-label">Current value</div><div class="hero-figure">${moneyExact(x.total.value)}</div><div class="hero-secondary">${moneyExact(x.total.invested)} invested${x.total.partial ? ' (some holdings have no cost basis)' : ''}</div></div>
      <div><div class="hero-label">Since bought</div><div class="hero-figure" style="font-size:36px">${x.total.return_pct === null ? '-' : delta(x.total.return_pct, (n) => `${plain(n)}%`)}</div><div class="hero-secondary">${compact(x.total.unrealised)} unrealised${x.xirr === null ? '' : ` · <span title="Money-weighted: the annual rate that accounts for when you added money. Set it against an FD rate.">XIRR ${delta(x.xirr, (n) => `${plain(n, 1)}%`)} a year</span>`}</div></div></div>
      <p class="note">${x.compared_to ? `Comparing ${shortDate(x.compared_to)} with ${shortDate(x.as_of)}.` : `As of ${shortDate(x.as_of)}. Market / Flow / FX appear once there are two checkpoints.`}</p></section>
    <section class="card"><header><h2>Performance - every sleeve, your portfolio and the market, indexed to 100</h2><span class="spacer"></span>
      <div class="tabs">${PERF_RANGES.map((r) => `<button class="btn" data-perf-range="${r.id}" aria-pressed="${r.id === perfRange}">${r.label}</button>`).join(' ')}</div></header>
      <div data-perf-body>${indexed(x)}</div></section>
    <section class="card"><header><h2>By sleeve</h2></header><div class="table-wrap"><table class="data"><thead><tr><th>Sleeve</th><th class="num">Value</th><th class="num">Invested</th><th class="num">Since bought</th><th class="num" title="Money-weighted annual return">XIRR</th><th class="num">Market</th><th class="num">Flow</th><th class="num">FX</th></tr></thead><tbody>
      ${x.sleeves.map((s) => {
        const isEpf = s.sleeve === 'epf'
        return `<tr><td class="name"><button class="row-btn" data-open="${s.sleeve}" title="Show the holdings"><i class="dot" style="background:${sleeveColor(s.sleeve)}"></i><span class="name">${esc(sleeveLabel(s.sleeve))}</span> <span style="color:var(--muted);margin-left:6px">▸ ${s.holdings.length}</span></button></td>
        <td class="num">${compact(s.value)}</td><td class="num">${compact(s.invested)}${s.partial ? '*' : ''}</td>
        <td class="num">${isEpf || s.return_pct === null ? '-' : `${delta(s.return_pct, (n) => `${plain(n)}%`)}<div style="color:var(--muted);font-size:12px">${compact(s.unrealised)}</div>`}</td>
        <td class="num">${isEpf ? '-' : xirrCell(s.xirr)}</td>
        <td class="num">${isEpf || s.market === null ? '-' : delta(s.market)}</td>
        <td class="num">${isEpf || s.flow === null || s.flow === 0 ? '-' : delta(s.flow)}</td>
        <td class="num">${isEpf || s.fx === null || s.fx === 0 ? '-' : delta(s.fx)}</td></tr>`
      }).join('')}
      </tbody></table></div>
      <p class="note"><b>Since bought</b> is cost basis against today's value. <b>Market / Flow / FX</b> is what happened between the two checkpoints: the price moving, money you added or took out, and the rupee moving. They sum to the change exactly, which is what stops a SIP looking like a gain. <b>XIRR</b> is the annual rate that accounts for when you added money; it needs about three months of history, or a trade ledger for the exact dates.${x.sleeves.some((s) => s.stale) ? ' A sleeve whose source was stale is left out of the split rather than booked as a crash.' : ''}</p></section>
    ${open && x.sleeves.find((s) => s.sleeve === open) ? holdingsTable(x.sleeves.find((s) => s.sleeve === open)) : ''}
    ${incomeCard()}</div>`
  }

  const drawPerf = () => {
    const perfBody = el.querySelector('[data-perf-body]')
    if (!perfBody || !current) return
    perfBody.innerHTML = indexed(current)
    for (const btn of el.querySelectorAll('[data-perf-range]')) {
      btn.setAttribute('aria-pressed', btn.dataset.perfRange === perfRange ? 'true' : 'false')
    }
    bindHighlight(el)
    if (currentShownSeries.length) {
      bindChartDrag(el, currentShownSeries, (n) => String(Math.round(n * 10) / 10), (ms) => shortDate(new Date(ms).toISOString().slice(0, 10)))
    }
  }

  draw()
  bindHighlight(el)
  bindPager(el, draw)
  if (currentShownSeries.length) {
    bindChartDrag(el, currentShownSeries, (n) => String(Math.round(n * 10) / 10), (ms) => shortDate(new Date(ms).toISOString().slice(0, 10)))
  }

  el.addEventListener('click', (e) => {
    const pr = e.target.closest('[data-perf-range]')
    if (pr) {
      perfRange = pr.dataset.perfRange
      drawPerf()
      return
    }
    const sh = e.target.closest('[data-sort-holdings]')
    if (sh) {
      const col = sh.dataset.sortHoldings
      if (holdingsSortCol === col) {
        holdingsSortDir = holdingsSortDir === 'asc' ? 'desc' : 'asc'
      } else {
        holdingsSortCol = col
        holdingsSortDir = col === 'name' ? 'asc' : 'desc'
      }
      draw()
      return
    }
    const t = e.target.closest('[data-toggle]'), all = e.target.closest('[data-show-all]')
    if (t || all) { // redraw only the chart: the rest of the page has not changed
      if (t) {
        const k = t.dataset.toggle
        if (!hidden.delete(k)) hidden.add(k)
      } else {
        if (hidden.size === 0) {
          for (const k of ALL_BENCHMARK_KEYS) hidden.add(k)
        } else {
          hidden.clear()
        }
      }
      drawPerf()
      return
    }
    const r = e.target.closest('[data-range]'); if (r) { range = r.dataset.range; draw() }
    const o = e.target.closest('[data-open]')
    if (o) {
      open = open === o.dataset.open ? null : o.dataset.open
      holdingsSortCol = 'buy_date'
      holdingsSortDir = 'desc'
      draw()
    }
  })
}
