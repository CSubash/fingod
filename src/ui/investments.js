import { investmentsView, RANGE_IDS } from '../repo.js'
import { lineChart } from './charts.js'
import { compact, moneyExact, plain, pct, shortDate, sleeveLabel, sleeveColor, delta, esc, money } from './format.js'
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
        title: 'Every sleeve indexed to 100',
      })
    : `<div class="empty" style="padding:40px 0">Click on any series in the legend below to display the chart.</div>`

  const isInvested = (opt) => (HISTORICAL_INDEX[opt.id]?.length || 0) > 1
  const holdingsRaw = COMPARISON_OPTIONS.filter((opt) => !opt.label.endsWith('Index'))
  const holdingsOpts = [
    ...holdingsRaw.filter(isInvested),
    ...holdingsRaw.filter((opt) => !isInvested(opt)),
  ]
  const indexOpts = COMPARISON_OPTIONS.filter((opt) => opt.label.endsWith('Index'))

  const renderLegendItem = (opt) => {
    const hasPoints = isInvested(opt)
    const on = enabledSeries.has(opt.id) && hasPoints
    if (!hasPoints) {
      return `<span data-series-toggle="${opt.id}" data-disabled="true" title="Not invested" style="display:inline-flex;align-items:center;gap:6px;cursor:not-allowed;user-select:none;opacity:0.3;text-decoration:line-through">
        <i class="swatch" style="background:${sleeveColor(opt.id)};width:10px;height:10px;border-radius:2px;display:inline-block"></i>
        <span style="color:var(--muted)">${esc(opt.label)} (not invested)</span>
      </span>`
    }
    return `<span data-series-toggle="${opt.id}" title="Click to ${on ? 'hide' : 'show'}" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;opacity:${on ? '1' : '0.35'};${on ? '' : 'text-decoration:line-through'}">
      <i class="swatch" style="background:${sleeveColor(opt.id)};width:10px;height:10px;border-radius:2px;display:inline-block"></i>
      <span style="color:${on ? 'var(--ink)' : 'var(--muted)'}">${esc(opt.label)}</span>
    </span>`
  }

  return `
    ${chart}
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
      <div class="legend" style="display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center">
        ${holdingsOpts.map(renderLegendItem).join('')}
      </div>
      <div class="legend" style="display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center">
        ${indexOpts.map(renderLegendItem).join('')}
      </div>
    </div>
    <p class="note" style="margin-top:14px">Each sleeve starts at 100 on the date of its first investment (or ${shortDate(startDate)} for overall portfolio and benchmark indices), so the lines compare <i>rates</i> of growth rather than portfolio size. Click on any graph line or legend label to toggle it. Sleeves without investments are marked (not invested).</p>`
}

function holdingsTable(s) {
  const hasMarket = s.holdings.some((h) => h.market !== null)

  const sortedHoldings = [...s.holdings].sort((a, b) => {
    let va, vb
    if (holdingsSort.col === 'name') { va = a.name || a.symbol || ''; vb = b.name || b.symbol || ''; return holdingsSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va) }
    if (holdingsSort.col === 'bought_on') {
      va = getBuyDate(a) || ''; vb = getBuyDate(b) || ''
      return holdingsSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    if (holdingsSort.col === 'holding_days') { va = getHoldingDays(a) ?? -1; vb = getHoldingDays(b) ?? -1 }
    else if (holdingsSort.col === 'qty') { va = Number(a.qty) || 0; vb = Number(b.qty) || 0 }
    else if (holdingsSort.col === 'price') { va = Number(a.price) || 0; vb = Number(b.price) || 0 }
    else if (holdingsSort.col === 'value') { va = Number(a.value) || 0; vb = Number(b.value) || 0 }
    else if (holdingsSort.col === 'invested') { va = a.invested === null ? -1 : Number(a.invested); vb = b.invested === null ? -1 : Number(b.invested) }
    else if (holdingsSort.col === 'return_pct') { va = a.return_pct === null ? -999 : Number(a.return_pct); vb = b.return_pct === null ? -999 : Number(b.return_pct) }
    else if (holdingsSort.col === 'share_pct') { va = Number(a.share_pct) || 0; vb = Number(b.share_pct) || 0 }
    else if (holdingsSort.col === 'market') { va = a.market === null ? -999999 : Number(a.market); vb = b.market === null ? -999999 : Number(b.market) }
    else { va = 0; vb = 0 }
    return holdingsSort.dir === 'asc' ? va - vb : vb - va
  })

  return `<section class="card"><header><h2>${esc(sleeveLabel(s.sleeve))} - holdings (${sortedHoldings.length})</h2></header><div class="table-wrap"><table class="data"><thead><tr>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="name">Stock ${holdingsSortIcon('name')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="bought_on">Bought on ${holdingsSortIcon('bought_on')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="holding_days">Holding for ${holdingsSortIcon('holding_days')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="qty">Qty ${holdingsSortIcon('qty')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="price">Price ${holdingsSortIcon('price')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="value">Value ${holdingsSortIcon('value')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="invested">Invested ${holdingsSortIcon('invested')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="return_pct">Since bought ${holdingsSortIcon('return_pct')}</th>
    <th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="share_pct">Share ${holdingsSortIcon('share_pct')}</th>
    ${hasMarket ? `<th style="cursor:pointer;user-select:none;text-align:center" data-holdings-sort="market">Market ${holdingsSortIcon('market')}</th>` : ''}</tr></thead><tbody>
    ${sortedHoldings.map((h) => {
      const days = getHoldingDays(h)
      const buyDate = getBuyDate(h)
      return `<tr>
        <td style="text-align:center">${esc(h.name || h.symbol)}${h.flagged ? ' <span class="tag" title="Flow above 25% of the sleeve: a split or bonus?">flow flag</span>' : ''}</td>
        <td style="text-align:center">${formatDdmmyy(buyDate)}</td>
        <td style="text-align:center">${days !== null ? `${days}d` : '-'}</td>
        <td style="text-align:center">${plain(h.qty, h.qty % 1 ? 4 : 0)}</td>
        <td style="text-align:center">${plain(h.price)}${h.currency !== 'INR' ? ` ${esc(h.currency)}` : ''}</td>
        <td style="text-align:center">${money(h.value)}</td>
        <td style="text-align:center">${h.invested === null ? '-' : money(h.invested)}</td>
        <td style="text-align:center">${h.return_pct === null ? '-' : delta(h.return_pct, (v) => `${plain(v)}%`)}</td>
        <td style="text-align:center">${plain(h.share_pct, 1)}%</td>
        ${hasMarket ? `<td style="text-align:center">${h.market === null ? '-' : delta(h.market)}</td>` : ''}
      </tr>`
    }).join('')}
    </tbody></table></div></section>`
}

export function render(el) {
  const draw = () => {
    const x = investmentsView(range)
    if (!x) {
      el.innerHTML = `<div class="empty">No investments data available. Take a checkpoint to see your portfolio.</div>`
      return
    }
    el.innerHTML = `<div class="grid" style="gap:16px">
    <section class="card"><header><h2>Investments - ${x.checkpoints_in_range} checkpoint${x.checkpoints_in_range === 1 ? '' : 's'} in range</h2><span class="spacer"></span>
      <div class="tabs">${RANGE_IDS.map((r) => `<button class="btn" data-range="${r}" aria-pressed="${r === range}">${RANGE_LABEL[r]}</button>`).join(' ')}</div></header>
      <div class="grid cols-2" style="gap:28px"><div><div class="hero-label">Current value</div><div class="hero-figure">${moneyExact(x.total.value)}</div><div class="hero-secondary">${moneyExact(x.total.invested)} invested${x.total.partial ? ' (some holdings have no cost basis)' : ''}</div></div>
      <div><div class="hero-label">Since bought</div><div class="hero-figure" style="font-size:36px">${x.total.return_pct === null ? '-' : delta(x.total.return_pct, (n) => `${plain(n)}%`)}</div><div class="hero-secondary">${compact(x.total.unrealised)} unrealised</div></div></div>
      <p class="note">${x.compared_to ? `Comparing ${shortDate(x.compared_to)} with ${shortDate(x.as_of)}.` : `As of ${shortDate(x.as_of)}. Market / Flow / FX appear once there are two checkpoints.`}</p></section>
    <section class="card"><header><h2>Performance - every sleeve indexed to 100</h2></header>${indexed(x)}</section>
    <section class="card"><header><h2>By sleeve</h2></header><div class="table-wrap"><table class="data"><thead><tr><th>Sleeve</th><th class="num">Value</th><th class="num">Invested</th><th class="num">Since bought</th><th class="num">Market</th><th class="num">Flow</th><th class="num">FX</th></tr></thead><tbody>
      ${x.sleeves.map((s) => `<tr><td class="name"><button class="row-btn" data-open="${s.sleeve}" title="Show the holdings"><i class="dot" style="background:${sleeveColor(s.sleeve)}"></i><span class="name">${esc(sleeveLabel(s.sleeve))}</span> <span style="color:var(--muted);margin-left:6px">▸ ${s.holdings.length}</span></button></td>
        <td class="num">${compact(s.value)}</td><td class="num">${compact(s.invested)}${s.partial ? '*' : ''}</td>
        <td class="num">${s.return_pct === null ? '-' : `${delta(s.return_pct, (n) => `${plain(n)}%`)}<div style="color:var(--muted);font-size:12px">${compact(s.unrealised)}</div>`}</td>
        <td class="num">${s.market === null ? '-' : delta(s.market)}</td><td class="num">${s.flow === null ? '-' : delta(s.flow)}</td><td class="num">${s.fx === null ? '-' : delta(s.fx)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note"><b>Since bought</b> is cost basis against today's value. <b>Market / flow / fx</b> is what happened between the two checkpoints: the price moving, money you added or took out, and the rupee moving. They sum to the change exactly, which is what stops a SIP looking like a gain.${x.sleeves.some((s) => s.stale) ? ' A sleeve whose source was stale is left out of the split rather than booked as a crash.' : ''}</p></section>
    ${open && x.sleeves.find((s) => s.sleeve === open) ? holdingsTable(x.sleeves.find((s) => s.sleeve === open)) : ''}</div>`
  }
  draw()

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
