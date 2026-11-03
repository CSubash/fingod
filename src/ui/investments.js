import { investmentsView, incomeView, RANGE_IDS } from '../repo.js'
import { paginate, scrollBox, bindPager } from './pager.js'
import { lineChart, stackedBars, interactiveLegend, bindHighlight } from './charts.js'
import { compact, moneyExact, plain, pct, shortDate, monthLabel, sleeveLabel, sleeveColor, delta, esc, money } from './format.js'

const RANGE_LABEL = { '1w': '1 week', '1m': '1 month', '3m': '3 months', '1y': '1 year', all: 'All' }
let range = '3m', open = null
const hidden = new Set() // series keys switched off in the performance chart; kept across range changes

// The portfolio and the two indices ride in the same chart as the sleeves: solid white for the whole portfolio,
// dashed for each index, so the comparison is made on one axis.
const MARKET_STYLE = { portfolio: { color: 'var(--ink)', dash: '' }, nifty50: { color: 'var(--ink-2)', dash: '7 5' }, sp500: { color: 'var(--muted)', dash: '2 5' } }

function indexed(v) {
  if (v.series.length < 2) return `<div class="empty">Indexed performance needs two checkpoints. Take another and the lines appear.</div>`
  const pts = (arr) => arr.map((p) => [Date.parse(p.as_of), p.v])
  const sleeves = Object.entries(v.index).map(([k, p]) => ({ key: k, label: sleeveLabel(k), color: sleeveColor(k), points: pts(p) })).filter((s) => s.points.length > 1)
  const c = v.compare
  const market = (c ? c.series : []).filter((s) => s.points.length > 1).map((s) => ({ key: s.key, label: s.label, color: MARKET_STYLE[s.key].color, dash: MARKET_STYLE[s.key].dash, width: s.key === 'portfolio' ? 3.4 : 2.4, points: pts(s.points) }))
  const all = [...sleeves, ...market]
  const shown = all.filter((s) => !hidden.has(s.key))
  const chart = shown.length
    ? lineChart({ series: shown, yFormat: (n) => String(Math.round(n * 10) / 10), xFormat: (ms) => shortDate(new Date(ms).toISOString().slice(0, 10)), baseline: 100, title: 'Every sleeve, your portfolio and the market indices, indexed to 100' })
    : '<div class="empty">Every line is hidden. Click a name below to bring it back.</div>'
  const hint = !c ? ' To add the Nifty 50 and the S&amp;P 500, load their history (<code>data/benchmarks/</code>, which a refresh writes).'
    : c.missing.length ? ` ${c.missing.map((m) => esc(m.label)).join(' and ')} ${c.missing.length === 1 ? 'is' : 'are'} not shown: the benchmark history does not reach back to ${shortDate(c.since)}.` : ''
  return `<div data-chart>${chart}${interactiveLegend(all, hidden)}</div>
    <p class="note">Click a name to hide its line (the chart rescales); hover a name or a line to light it up. Every line starts at 100 on ${shortDate(v.compared_to || v.series[0].as_of)}, so the lines compare <i>rates</i> of change rather than sizes. They are time-weighted: money you added or took out is left out, so a SIP never reads as a gain and a sale never reads as a crash. The thick white line is your whole portfolio (holdings, not fixed deposits); the dashed lines are the indices, with the S&amp;P 500 converted to rupees at each checkpoint's USD/INR, which is what an Indian investor would have earned. A line above 100 has grown since then.${hint}</p>`
}

const INCOME_KINDS = [['dividends', 'Dividends', 'var(--cat-1)'], ['interest', 'Interest', 'var(--cat-3)'], ['unspecified', 'No note', 'var(--cat-other)']]

function incomeCard() {
  const i = incomeView()
  if (!i) return ''
  const pg = paginate('income-payers', i.payers, { size: 10 })
  const kinds = INCOME_KINDS.filter(([k]) => i[k] > 0)
  const chart = stackedBars({
    periods: i.months.map((m) => ({ period: m.month, label: monthLabel(m.month), segments: Object.fromEntries(kinds.map(([k]) => [k, m[k]])) })),
    keys: kinds.map(([k]) => k).reverse(), color: (k) => INCOME_KINDS.find(([x]) => x === k)[2], yFormat: compact, title: 'Dividends and interest received by month', link: false,
  })
  const stat = (label, value, sub) => `<div><div class="hero-label">${label}</div><div class="hero-figure" style="font-size:28px">${value}</div><div class="hero-secondary" style="margin-top:2px;font-size:13px">${sub}</div></div>`
  return `<section class="card"><header><h2>Income from investments — last 12 months</h2></header>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:20px;margin-bottom:12px">
      ${stat('Received', moneyExact(i.total), `${monthLabel(i.from)} to ${monthLabel(i.to)}`)}
      ${stat('A month', compact(i.monthly_avg), `paid in ${i.months_paid} of 12 months`)}
      ${stat('Dividends', compact(i.dividends), i.payers.length ? `from ${i.payers.length} payer${i.payers.length === 1 ? '' : 's'}` : 'none noted')}
      ${stat('Interest', compact(i.interest), i.unspecified ? `plus ${compact(i.unspecified)} with no note` : 'bank and FD interest')}
    </div>${chart}
    <div class="legend">${kinds.map(([, l, c]) => `<span><i class="swatch" style="background:${c}"></i>${l}</span>`).join('')}</div>
    ${i.payers.length ? `<div style="margin-top:12px">${scrollBox(`<table class="data"><thead><tr><th>Biggest dividend payers</th><th class="num">Received</th><th class="num">Share</th></tr></thead><tbody>${pg.rows.map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="num">${compact(p.amount)}</td><td class="num">${plain((p.amount / i.dividends) * 100, 0)}%</td></tr>`).join('')}</tbody></table>`)}${pg.controls}</div>` : ''}
    <p class="note">Everything Wallet files under "Interest, dividends", counted when the money arrived. A credit you never entered in Wallet is not here. Wallet has no field for which it was, so the split reads the note: "interest" or "FD" means interest, any other note is read as a dividend from that name, and a credit with no note is shown separately rather than guessed. This is cash received, not a yield, and it makes no forecast.</p></section>`
}

const xirrCell = (x) => (x ? `${delta(x.pct, (n) => `${plain(n, 1)}%`)}<div style="color:var(--muted);font-size:12px">${x.basis === 'ledger' ? 'since first trade' : 'annualised'}</div>` : '—')

function holdingsTable(s) {
  const pg = paginate(`holdings-${s.sleeve}`, s.holdings, { size: 25 })
  return `<section class="card"><header><h2>${esc(sleeveLabel(s.sleeve))} — holdings</h2><span class="spacer"></span><span class="hero-label">${s.holdings.length}</span></header>${scrollBox(`<table class="data"><thead><tr>
    <th>Holding</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Value</th><th class="num">Invested</th><th class="num">Since bought</th><th class="num">Share</th>${s.holdings.some((h) => h.market !== null) ? '<th class="num">Market</th>' : ''}</tr></thead><tbody>
    ${pg.rows.map((h) => `<tr><td class="name">${esc(h.name)}${h.flagged ? ' <span class="tag" title="Flow above 25% of the sleeve: a split or bonus?">flow flag</span>' : ''}</td>
      <td class="num">${plain(h.qty, h.qty % 1 ? 4 : 0)}</td><td class="num">${plain(h.price)}${h.currency !== 'INR' ? ` ${esc(h.currency)}` : ''}</td><td class="num">${money(h.value)}</td>
      <td class="num">${h.invested === null ? '—' : money(h.invested)}</td><td class="num">${h.return_pct === null ? '—' : delta(h.return_pct, (v) => `${plain(v)}%`)}</td><td class="num">${plain(h.share_pct, 1)}%</td>
      ${s.holdings.some((x) => x.market !== null) ? `<td class="num">${h.market === null ? '—' : delta(h.market)}</td>` : ''}</tr>`).join('')}
    </tbody></table>`)}${pg.controls}</section>`
}

export function render(el) {
  let current = null
  const draw = () => {
    const x = current = investmentsView(range)
    el.innerHTML = `<div class="grid" style="gap:16px">
    <section class="card"><header><h2>Investments — ${x.checkpoints_in_range} checkpoint${x.checkpoints_in_range === 1 ? '' : 's'} in range</h2><span class="spacer"></span>
      <div class="tabs">${RANGE_IDS.map((r) => `<button class="btn" data-range="${r}" aria-pressed="${r === range}">${RANGE_LABEL[r]}</button>`).join(' ')}</div></header>
      <div class="grid cols-2" style="gap:28px"><div><div class="hero-label">Current value</div><div class="hero-figure">${moneyExact(x.total.value)}</div><div class="hero-secondary">${moneyExact(x.total.invested)} invested${x.total.partial ? ' (some holdings have no cost basis)' : ''}</div></div>
      <div><div class="hero-label">Since bought</div><div class="hero-figure" style="font-size:36px">${x.total.return_pct === null ? '—' : delta(x.total.return_pct, (n) => `${plain(n)}%`)}</div><div class="hero-secondary">${compact(x.total.unrealised)} unrealised${x.xirr === null ? '' : ` · <span title="Money-weighted: the annual rate that accounts for when you added money. Set it against an FD rate.">XIRR ${delta(x.xirr, (n) => `${plain(n, 1)}%`)} a year</span>`}</div></div></div>
      <p class="note">${x.compared_to ? `Comparing ${shortDate(x.compared_to)} with ${shortDate(x.as_of)}.` : `As of ${shortDate(x.as_of)}. Market / flow / FX appear once there are two checkpoints.`}</p></section>
    <section class="card"><header><h2>Performance — every sleeve, your portfolio and the market, indexed to 100</h2></header><div data-perf-body>${indexed(x)}</div></section>
    <section class="card"><header><h2>By sleeve</h2></header><div class="table-wrap"><table class="data"><thead><tr><th>Sleeve</th><th class="num">Value</th><th class="num">Invested</th><th class="num">Since bought</th><th class="num" title="Money-weighted annual return">XIRR</th><th class="num">Market</th><th class="num">Flow</th><th class="num">FX</th></tr></thead><tbody>
      ${x.sleeves.map((s) => `<tr><td class="name"><button class="row-btn" data-open="${s.sleeve}" title="Show the holdings"><i class="dot" style="background:${sleeveColor(s.sleeve)}"></i><span class="name">${esc(sleeveLabel(s.sleeve))}</span> <span style="color:var(--muted);margin-left:6px">▸ ${s.holdings.length}</span></button></td>
        <td class="num">${compact(s.value)}</td><td class="num">${compact(s.invested)}${s.partial ? '*' : ''}</td>
        <td class="num">${s.return_pct === null ? '—' : `${delta(s.return_pct, (n) => `${plain(n)}%`)}<div style="color:var(--muted);font-size:12px">${compact(s.unrealised)}</div>`}</td>
        <td class="num">${xirrCell(s.xirr)}</td>
        <td class="num">${s.market === null ? '—' : delta(s.market)}</td><td class="num">${s.flow === null ? '—' : delta(s.flow)}</td><td class="num">${s.fx === null ? '—' : delta(s.fx)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note"><b>Since bought</b> is cost basis against today's value. <b>Market / flow / fx</b> is what happened between the two checkpoints: the price moving, money you added or took out, and the rupee moving. They sum to the change exactly, which is what stops a SIP looking like a gain. <b>XIRR</b> is the annual rate that accounts for when you added money; it needs about three months of history, or a trade ledger for the exact dates.${x.sleeves.some((s) => s.stale) ? ' A sleeve whose source was stale is left out of the split rather than booked as a crash.' : ''}</p></section>
    ${incomeCard()}
    ${open && x.sleeves.find((s) => s.sleeve === open) ? holdingsTable(x.sleeves.find((s) => s.sleeve === open)) : ''}</div>`
  }
  draw()
  bindHighlight(el)
  bindPager(el, draw)
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]'), all = e.target.closest('[data-show-all]')
    if (t || all) { // redraw only the chart: the rest of the page has not changed
      if (t) { const k = t.dataset.toggle; if (!hidden.delete(k)) hidden.add(k) } else hidden.clear()
      el.querySelector('[data-perf-body]').innerHTML = indexed(current)
      return
    }
    const r = e.target.closest('[data-range]'); if (r) { range = r.dataset.range; draw() }
    const o = e.target.closest('[data-open]'); if (o) { open = open === o.dataset.open ? null : o.dataset.open; draw() }
  })
}
