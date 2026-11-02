import { investmentsView, incomeView, RANGE_IDS } from '../repo.js'
import { lineChart, stackedBars, bindHighlight } from './charts.js'
import { compact, moneyExact, plain, pct, shortDate, monthLabel, sleeveLabel, sleeveColor, delta, esc, money } from './format.js'
import { HISTORICAL_INDEX } from '../data_benchmarks.js'
import { daysBetween } from '../compute/num.js'

const RANGE_LABEL = { '1w': '1 week', '1m': '1 month', '3m': '3 months', '1y': '1 year', all: 'All' }
let range = '3m', open = null

let holdingsSort = { col: 'value', dir: 'desc' }

export const COMPARISON_OPTIONS = [
  { id: 'overall', label: 'Overall Portfolio', default: true },
  { id: 'in_equity', label: 'IN Stocks', default: true },
  { id: 'in_mf', label: 'IN Mutual Funds', default: true },
  { id: 'us_equity', label: 'US Stocks', default: false },
  { id: 'btc', label: 'Bitcoin (Binance)', default: true },
  { id: 'ppf', label: 'PPF', default: false },
  { id: 'fd', label: 'Fixed Deposits', default: false },
  { id: 'epf', label: 'EPF', default: false },
  { id: 'nifty50', label: 'Nifty 50 Index', default: true },
  { id: 'nifty_midcap150', label: 'Nifty Midcap 150 Index', default: false },
  { id: 'nifty_smallcap250', label: 'Nifty Smallcap 250 Index', default: false },
  { id: 'nasdaq100', label: 'Nasdaq 100 Index', default: false },
  { id: 'nyse_composite', label: 'NYSE Composite Index', default: false },
]

export const STOCK_BUY_DATES = {
  '5PAISA': '2023-12-26',
  'AARTIDRUGS': '2024-08-22',
  'AARTIIND': '2024-08-07',
  'ATULAUTO': '2024-09-02',
  'BAJAJHFL': '2025-07-07',
  'BANDHANBNK': '2024-10-31',
  'BAYERCROP': '2023-12-26',
  'BIRLAMONEY': '2025-10-16',
  'BRITANNIA': '2026-06-30',
  'CAMS': '2025-11-07',
  'DABUR': '2025-02-06',
  'DMART': '2026-08-04',
  'EASEMYTRIP': '2024-10-09',
  'ESCORTS': '2026-07-22',
  'GODREJCP': '2026-06-30',
  'GOLDBEES': '2026-02-05',
  'HAVELLS': '2025-11-24',
  'HDFCBANK': '2022-03-14',
  'HDFCLIFE': '2026-07-24',
  'HINDUNILVR': '2025-11-17',
  'ICICILIFE': '2023-09-18',
  'JIOFIN': '2023-09-29',
  'JPL': '2026-10-27',
  'JUNIORBEES': '2026-03-23',
  'KANSAINER': '2025-02-06',
  'KWIL': '2025-11-17',
  'PFC': '2026-09-04',
  'PNB': '2026-03-23',
  'RECLTD': '2025-11-24',
  'SSFL-ST': '2026-06-10',
  'TCS': '2025-08-04',
  'TITAGARH': '2024-10-14',
  'TMPV': '2024-12-27',
  'UNITDSPR': '2025-08-04',
  'UTIAMC': '2026-09-04',
  'VBL': '2025-06-23',
}

const todayIso = () => new Date().toISOString().slice(0, 10)

function getBuyDate(h) {
  return h.buy_date || STOCK_BUY_DATES[h.symbol] || null
}

function formatDdmmyy(isoDate) {
  if (!isoDate) return '-'
  const parts = isoDate.slice(0, 10).split('-')
  if (parts.length < 3) return isoDate
  const [y, m, d] = parts
  return `${d}/${m}/${y.slice(2)}`
}

function getHoldingDays(h) {
  const buyDate = getBuyDate(h)
  if (!buyDate) return null
  return daysBetween(buyDate, todayIso())
}

let enabledSeries = new Set(COMPARISON_OPTIONS.filter((o) => o.default && (HISTORICAL_INDEX[o.id]?.length || 0) > 1).map((o) => o.id))

function holdingsSortIcon(col) {
  if (holdingsSort.col !== col) return `<span style="opacity:0.3;font-size:11px;margin-left:4px">↕</span>`
  return `<span style="color:var(--ink);font-size:11px;margin-left:4px">${holdingsSort.dir === 'asc' ? '▲' : '▼'}</span>`
}

function indexed(v) {
  const selectedSeries = COMPARISON_OPTIONS
    .filter((opt) => enabledSeries.has(opt.id) && (HISTORICAL_INDEX[opt.id]?.length || 0) > 1)
    .map((opt) => ({
      id: opt.id,
      label: opt.label,
      color: sleeveColor(opt.id),
      points: HISTORICAL_INDEX[opt.id].map((p) => [Date.parse(p.as_of), p.v]),
    }))
    .filter((s) => s.points.length > 1)

  const startDate = HISTORICAL_INDEX.nifty50?.[0]?.as_of || '2021-11-01'

  const chart = selectedSeries.length
    ? lineChart({
        series: selectedSeries,
        yFormat: (n) => String(Math.round(n * 10) / 10),
        xFormat: (ms) => shortDate(new Date(ms).toISOString().slice(0, 10)),
        baseline: 100,
        title: 'Performance - every sleeve indexed to 100',
        labelEnds: true,
      })
    : '<div class="empty">No series selected. Click any badge below to display its performance line.</div>'

  const holdingsList = [
    { id: 'overall', label: 'Overall Portfolio' },
    { id: 'in_equity', label: 'IN Stocks' },
    { id: 'in_mf', label: 'IN Mutual Funds' },
    { id: 'us_equity', label: 'US Stocks' },
    { id: 'btc', label: 'Bitcoin (Binance)' },
    { id: 'ppf', label: 'PPF' },
    { id: 'fd', label: 'Fixed Deposits' },
    { id: 'epf', label: 'EPF' },
  ]

  const indicesList = [
    { id: 'nifty50', label: 'Nifty 50 Index' },
    { id: 'nifty_midcap150', label: 'Nifty Midcap 150 Index' },
    { id: 'nifty_smallcap250', label: 'Nifty Smallcap 250 Index' },
    { id: 'nasdaq100', label: 'Nasdaq 100 Index' },
    { id: 'nyse_composite', label: 'NYSE Composite Index' },
  ]

  const hasInvested = (id) => (HISTORICAL_INDEX[id]?.length || 0) > 1
  const ppfInvested = hasInvested('ppf')
  const fdInvested = hasInvested('fd')

  holdingsList.sort((a, b) => {
    const aInv = hasInvested(a.id)
    const bInv = hasInvested(b.id)
    if (aInv && !bInv) return -1
    if (!aInv && bInv) return 1
    if (!aInv && !bInv) {
      if (a.id === 'fd' && b.id === 'ppf') return ppfInvested ? 1 : -1
      if (a.id === 'ppf' && b.id === 'fd') return fdInvested ? 1 : -1
    }
    return 0
  })

  const renderBadge = (opt) => {
    const hasData = (HISTORICAL_INDEX[opt.id]?.length || 0) > 1
    const isChecked = enabledSeries.has(opt.id) && hasData
    const isInvested = hasData
    const labelText = isInvested ? opt.label : `${opt.label} (not invested)`
    const col = sleeveColor(opt.id)

    return `<span data-series-toggle="${opt.id}" data-disabled="${!hasData}" style="display:inline-flex;align-items:center;gap:7px;cursor:${hasData ? 'pointer' : 'default'};opacity:${hasData ? (isChecked ? '1' : '0.45') : '0.25'};user-select:none;font-size:12.5px;padding:3px 6px;border-radius:4px;border:1px solid ${isChecked ? col : 'transparent'}">
      <i style="width:11px;height:11px;border-radius:2px;background:${isChecked ? col : 'transparent'};border:1.5px solid ${col};display:inline-block"></i>
      <span style="color:${isChecked ? 'var(--ink)' : 'var(--muted)'};font-weight:${isChecked ? '600' : '400'}">${esc(labelText)}</span>
    </span>`
  }

  const holdingsBadges = holdingsList.map(renderBadge).join('')
  const indicesBadges = indicesList.map(renderBadge).join('')

  return `${chart}
    <div style="border:1px solid #ff0000;padding:10px;border-radius:6px;margin:12px 0 8px;">
      <div class="legend" style="margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.07)">
        ${holdingsBadges}
      </div>
      <div class="legend" style="margin-top:0">
        ${indicesBadges}
      </div>
    </div>
    <p class="note">Each sleeve starts at 100 on the date of its first investment (or ${shortDate(startDate)} for overall portfolio and benchmark indices), so the lines compare <i>rates</i> of growth rather than portfolio size. Click on any graph line or legend label to toggle it. Sleeves without investments are marked (not invested).</p>`
}

const INCOME_KINDS = [['dividends', 'Dividends', 'var(--cat-1)'], ['interest', 'Interest', 'var(--cat-3)'], ['unspecified', 'No note', 'var(--cat-other)']]

function incomeCard() {
  const i = incomeView()
  if (!i) return ''
  const kinds = INCOME_KINDS.filter(([k]) => i[k] > 0)
  const chart = stackedBars({
    periods: i.months.map((m) => ({ period: m.month, label: monthLabel(m.month), segments: Object.fromEntries(kinds.map(([k]) => [k, m[k]])) })),
    keys: kinds.map(([k]) => k).reverse(),
    color: (k) => (INCOME_KINDS.find(([id]) => id === k) || [])[2] || 'var(--cat-other)',
    yFormat: compact,
    title: 'Income from investments, last 12 months',
  })
  return `<section class="card"><header><h2>Income from investments - last 12 months</h2><span class="spacer"></span>
    <span class="tag" style="font-size:15px;font-weight:600">${money(i.total)}</span></header>
    ${kinds.length ? chart : '<p class="note" style="margin-top:0">No investment income recorded yet.</p>'}
    <div class="legend">${kinds.map(([k, label, col]) => `<span><i class="swatch" style="background:${col}"></i>${esc(label)}: ${compact(i[k])}</span>`).join('')}</div>
    <p class="note">Dividends and interest from your holdings and bank interest, read from your transactions. It excludes investment sales and transfers.</p></section>`
}

function xirrCell(x) {
  if (!x || x.pct === null || x.pct === undefined) return '<span style="color:var(--muted)">-</span>'
  const title = x.basis === 'ledger' ? 'Exact XIRR from trade ledger dates' : 'Estimated XIRR from checkpoints'
  return `<span title="${esc(title)}">${delta(x.pct, (n) => `${plain(n, 1)}%`)}</span>`
}

function holdingsTable(s) {
  let list = [...s.holdings]
  const dirMultiplier = holdingsSort.dir === 'asc' ? 1 : -1

  list.sort((a, b) => {
    const col = holdingsSort.col
    if (col === 'name') return dirMultiplier * (a.name || a.symbol).localeCompare(b.name || b.symbol)
    if (col === 'qty') return dirMultiplier * (Number(a.qty || 0) - Number(b.qty || 0))
    if (col === 'price') return dirMultiplier * (Number(a.price || 0) - Number(b.price || 0))
    if (col === 'value') return dirMultiplier * (Number(a.value || 0) - Number(b.value || 0))
    if (col === 'invested') return dirMultiplier * (Number(a.invested || 0) - Number(b.invested || 0))
    if (col === 'return_pct') {
      const retA = a.return_pct !== null && a.return_pct !== undefined ? a.return_pct : -999999
      const retB = b.return_pct !== null && b.return_pct !== undefined ? b.return_pct : -999999
      return dirMultiplier * (retA - retB)
    }
    if (col === 'bought_on') {
      const dateA = getBuyDate(a) || ''
      const dateB = getBuyDate(b) || ''
      return dirMultiplier * dateA.localeCompare(dateB)
    }
    if (col === 'holding_days') {
      const daysA = getHoldingDays(a) !== null ? getHoldingDays(a) : -1
      const daysB = getHoldingDays(b) !== null ? getHoldingDays(b) : -1
      return dirMultiplier * (daysA - daysB)
    }
    if (col === 'account') return dirMultiplier * (a.account || '').localeCompare(b.account || '')
    if (col === 'currency') return dirMultiplier * (a.currency || 'INR').localeCompare(b.currency || 'INR')
    return 0
  })

  return `<section class="card"><header><h2>${esc(sleeveLabel(s.sleeve))} - holdings</h2><span class="spacer"></span>
    <button class="btn" data-open="${s.sleeve}">Hide holdings</button></header>
    <div class="table-wrap"><table class="data"><thead><tr>
      <th style="cursor:pointer;user-select:none" data-holdings-sort="name">Holding ${holdingsSortIcon('name')}</th>
      <th class="num" style="cursor:pointer;user-select:none" data-holdings-sort="qty">Qty ${holdingsSortIcon('qty')}</th>
      <th class="num" style="cursor:pointer;user-select:none" data-holdings-sort="price">Price ${holdingsSortIcon('price')}</th>
      <th class="num" style="cursor:pointer;user-select:none" data-holdings-sort="value">Value ${holdingsSortIcon('value')}</th>
      <th class="num" style="cursor:pointer;user-select:none" data-holdings-sort="invested">Invested ${holdingsSortIcon('invested')}</th>
      <th class="num" style="cursor:pointer;user-select:none" data-holdings-sort="return_pct">Since bought ${holdingsSortIcon('return_pct')}</th>
      <th class="num" style="cursor:pointer;user-select:none" data-holdings-sort="bought_on">Bought on ${holdingsSortIcon('bought_on')}</th>
      <th class="num" style="cursor:pointer;user-select:none" data-holdings-sort="holding_days">Holding days ${holdingsSortIcon('holding_days')}</th>
      <th style="cursor:pointer;user-select:none" data-holdings-sort="account">Account ${holdingsSortIcon('account')}</th>
      <th style="cursor:pointer;user-select:none" data-holdings-sort="currency">Currency ${holdingsSortIcon('currency')}</th>
    </tr></thead><tbody>
    ${list.map((h) => {
      const buyDate = getBuyDate(h)
      const hDays = getHoldingDays(h)
      return `<tr><td class="name"><b>${esc(h.symbol)}</b> <span style="color:var(--muted)">${esc(h.name && h.name !== h.symbol ? h.name : '')}</span></td>
      <td class="num">${plain(h.qty, 4)}</td>
      <td class="num">${moneyExact(h.price, h.currency)}</td>
      <td class="num">${money(h.value)}</td>
      <td class="num">${h.invested === null ? '-' : money(h.invested)}</td>
      <td class="num">${h.return_pct === null ? '-' : `${delta(h.return_pct, (n) => `${plain(n)}%`)}<div style="color:var(--muted);font-size:12px">${compact(h.unrealised)}</div>`}</td>
      <td class="num" style="color:${buyDate ? 'var(--ink)' : 'var(--muted)'};font-size:12.5px">${buyDate ? formatDdmmyy(buyDate) : '-'}</td>
      <td class="num" style="color:${hDays !== null ? 'var(--ink)' : 'var(--muted)'};font-size:12.5px">${hDays !== null ? `${hDays} days` : '-'}</td>
      <td>${esc(h.account || '-')}</td>
      <td>${esc(h.currency || 'INR')}</td></tr>`
    }).join('')}
    </tbody></table></div></section>`
}

export function render(el) {
  const draw = () => {
    const x = investmentsView(range)
    if (!x) { el.innerHTML = '<div class="empty">No checkpoints yet.</div>'; return }
    el.innerHTML = `<div class="grid" style="gap:16px">
    <section class="card"><header><h2>Investments - ${x.checkpoints_in_range} checkpoint${x.checkpoints_in_range === 1 ? '' : 's'} in range</h2><span class="spacer"></span>
      <div class="tabs">${RANGE_IDS.map((r) => `<button class="btn" data-range="${r}" aria-pressed="${r === range}">${RANGE_LABEL[r]}</button>`).join(' ')}</div></header>
      <div class="hero"><div class="hero-primary"><div><div class="hero-label">Total investments</div><div class="hero-figure">${money(x.total.value)}</div><div class="hero-secondary">${moneyExact(x.total.invested)} invested${x.total.partial ? ' (some holdings have no cost basis)' : ''}</div></div>
      <div><div class="hero-label">Since bought</div><div class="hero-figure" style="font-size:36px">${x.total.return_pct === null ? '-' : delta(x.total.return_pct, (n) => `${plain(n)}%`)}</div><div class="hero-secondary">${compact(x.total.unrealised)} unrealised${x.xirr === null || x.xirr === undefined ? '' : ` · <span title="Money-weighted: the annual rate that accounts for when you added money. Set it against an FD rate.">XIRR ${delta(x.xirr, (n) => `${plain(n, 1)}%`)} a year</span>`}</div></div></div>
      <p class="note">${x.compared_to ? `Comparing ${shortDate(x.compared_to)} with ${shortDate(x.as_of)}.` : `As of ${shortDate(x.as_of)}. Market / flow / FX appear once there are two checkpoints.`}</p></section>
    <section class="card"><header><h2>Performance - every sleeve indexed to 100</h2></header>${indexed(x)}</section>
    <section class="card"><header><h2>By sleeve</h2></header><div class="table-wrap"><table class="data"><thead><tr><th>Sleeve</th><th class="num">Value</th><th class="num">Invested</th><th class="num">Since bought</th><th class="num" title="Money-weighted annual return">XIRR</th><th class="num">Market</th><th class="num">Flow</th><th class="num">FX</th></tr></thead><tbody>
      ${x.sleeves.map((s) => `<tr><td class="name"><button class="row-btn" data-open="${s.sleeve}" title="Show the holdings"><i class="dot" style="background:${sleeveColor(s.sleeve)}"></i><span class="name">${esc(sleeveLabel(s.sleeve))}</span> <span style="color:var(--muted);margin-left:6px">▸ ${s.holdings.length}</span></button></td>
        <td class="num">${compact(s.value)}</td><td class="num">${compact(s.invested)}${s.partial ? '*' : ''}</td>
        <td class="num">${s.return_pct === null ? '-' : `${delta(s.return_pct, (n) => `${plain(n)}%`)}<div style="color:var(--muted);font-size:12px">${compact(s.unrealised)}</div>`}</td>
        <td class="num">${xirrCell(s.xirr)}</td>
        <td class="num">${s.market === null ? '-' : delta(s.market)}</td><td class="num">${s.flow === null ? '-' : delta(s.flow)}</td><td class="num">${s.fx === null ? '-' : delta(s.fx)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note"><b>Since bought</b> is cost basis against today's value. <b>Market / flow / fx</b> is what happened between the two checkpoints: the price moving, money you added or took out, and the rupee moving. They sum to the change exactly, which is what stops a SIP looking like a gain. <b>XIRR</b> is the annual rate that accounts for when you added money; it needs about three months of history, or a trade ledger for the exact dates.${x.sleeves.some((s) => s.stale) ? ' A sleeve whose source was stale is left out of the split rather than booked as a crash.' : ''}</p></section>
    ${incomeCard()}
    ${open && x.sleeves.find((s) => s.sleeve === open) ? holdingsTable(x.sleeves.find((s) => s.sleeve === open)) : ''}</div>`
  }
  draw()
  bindHighlight(el)

  el.addEventListener('click', (e) => {
    const sToggle = e.target.closest('[data-series-toggle]')
    if (sToggle) {
      const id = sToggle.dataset.seriesToggle
      if (sToggle.dataset.disabled === 'true' || !(HISTORICAL_INDEX[id]?.length > 1)) return
      if (enabledSeries.has(id)) {
        if (enabledSeries.size > 1) enabledSeries.delete(id)
      } else {
        enabledSeries.add(id)
      }
      draw()
      return
    }
    const hSort = e.target.closest('[data-holdings-sort]')
    if (hSort) {
      const col = hSort.dataset.holdingsSort
      if (holdingsSort.col === col) {
        holdingsSort.dir = holdingsSort.dir === 'asc' ? 'desc' : 'asc'
      } else {
        holdingsSort.col = col
        holdingsSort.dir = ['name', 'currency', 'bought_on'].includes(col) ? 'asc' : 'desc'
      }
      draw()
      return
    }
    const r = e.target.closest('[data-range]'); if (r) { range = r.dataset.range; draw(); return }
    const o = e.target.closest('[data-open]'); if (o) { open = open === o.dataset.open ? null : o.dataset.open; draw(); return }
  })
}
