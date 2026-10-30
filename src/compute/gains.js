// Capital gains from a trade ledger: FIFO lots, the holding period of each, and an
// estimate of Indian tax. Pure: pass ledger rows in, get disposals out.
//
// The ledger is what the checkpoint engine cannot see: a snapshot only knows what is
// still held, so it cannot date a purchase or price a sale. With every buy and sell,
// the cost of each lot, how long it was held, and what it sold for are all exact.
//
// The tax part is an ESTIMATE of listed-securities rules as they stand after the July
// 2024 change, before surcharge and cess. It is information, not tax advice, and what it
// cannot model it leaves out and says so rather than guessing (see `slab_gain`).
import { num, money, sum, daysBetween } from './num.js'
import { xirr } from './xirr.js'

/** Per sleeve: how long a lot must be held to count as long-term, and which tax rules apply.
 *   equity        listed equity and equity-oriented funds
 *   foreign       foreign listed shares
 *   listed_other  other listed units, gold ETFs included
 *   slab          debt funds and liquid ETFs: taxed at your slab rate whatever the period
 *   vda           virtual digital assets: 30% flat, losses cannot be set off */
export const RULES = {
  in_equity: { lt_days: 365, klass: 'equity' },
  in_mf: { lt_days: 365, klass: 'equity', assumed: 'treated as an equity-oriented fund; a debt fund is taxed at your slab rate' },
  us_equity: { lt_days: 730, klass: 'foreign' },
  gold: { lt_days: 365, klass: 'listed_other' },
  debt: { klass: 'slab' },
  btc: { klass: 'vda' },
}
export const REFORM_DATE = '2024-07-23' // sales on or after this date: 12.5% long-term, 20% short-term, ₹1.25L exemption

const keyOf = (r) => (r.isin ? `isin\0${r.isin}` : `sym\0${r.sleeve}\0${r.symbol}`)
const gross = (r) => num(r.qty) * num(r.price) * (r.fx_rate === undefined || r.fx_rate === null ? 1 : num(r.fx_rate))

/** FIFO over the whole ledger. A sale with no purchase behind it (the ledger starts
 * after the position was opened) is reported as unmatched, never as a gain on a cost of zero. */
export function fifo(rows) {
  const ordered = [...rows].sort((a, b) => a.trade_date.localeCompare(b.trade_date) || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1) || String(a.id).localeCompare(String(b.id)))
  const lots = new Map() // key -> [{date, qty, unit_cost}]
  const info = new Map()
  const disposals = [], unmatched = []
  for (const r of ordered) {
    const key = keyOf(r)
    info.set(key, { key, sleeve: r.sleeve, symbol: r.symbol, name: r.name || r.symbol, isin: r.isin || '' })
    const qty = num(r.qty), fees = num(r.fees_inr)
    if (!(qty > 0)) continue
    if (r.side === 'buy') {
      if (!lots.has(key)) lots.set(key, [])
      lots.get(key).push({ date: r.trade_date, qty, unit_cost: (gross(r) + fees) / qty })
      continue
    }
    const unitProceeds = (gross(r) - fees) / qty
    const book = lots.get(key) || []
    let left = qty
    while (left > 1e-9 && book.length) {
      const lot = book[0]
      const take = Math.min(left, lot.qty)
      const cost = money(take * lot.unit_cost), proceeds = money(take * unitProceeds)
      disposals.push({ ...info.get(key), buy_date: lot.date, sell_date: r.trade_date, qty: take, cost, proceeds, gain: money(proceeds - cost), holding_days: daysBetween(lot.date, r.trade_date) })
      lot.qty -= take; left -= take
      if (lot.qty <= 1e-9) book.shift()
    }
    if (left > 1e-9) unmatched.push({ ...info.get(key), sell_date: r.trade_date, qty: left })
  }
  const open = new Map()
  for (const [key, book] of lots) open.set(key, { ...info.get(key), qty: sum(book.map((l) => l.qty)), cost: money(sum(book.map((l) => l.qty * l.unit_cost))) })
  for (const [key, i] of info) if (!open.has(key)) open.set(key, { ...i, qty: 0, cost: 0 })
  return { disposals, unmatched, open }
}

export function termOf(d) {
  const rule = RULES[d.sleeve]
  if (!rule || !rule.lt_days) return null
  return d.holding_days > rule.lt_days ? 'LT' : 'ST'
}

/** Indian financial year of a date: April to March, labelled 'FY 2026-27'. */
export function fyOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7))
  const start = m >= 4 ? y : y - 1
  return `FY ${start}-${String(start + 1).slice(2)}`
}

/** Set a year's gains against each other as the rules allow: a short-term loss can absorb
 * long-term gains, a long-term loss only long-term ones. A loss left over would be carried
 * forward, which this does not model, so it is reported. */
function setOff(st, lt) {
  if (st < 0) { lt += st; st = 0 }
  let carry = 0
  if (lt < 0) { carry = -lt; lt = 0 }
  return { st, lt, carry }
}

/** Gains and an estimated tax per financial year, from FIFO disposals. */
export function summariseGains(disposals) {
  const years = new Map()
  const bucket = (fy) => years.get(fy) || years.set(fy, { fy, disposals: 0, st: 0, lt: 0, other: 0, slab_gain: 0, est_tax: 0, carry_forward: 0, notes: [], _eq: { st: 0, lt: 0, ltOld: 0, ltNew: 0, stOld: 0, stNew: 0 } }).get(fy)
  for (const d of disposals) {
    const y = bucket(fyOf(d.sell_date)), rule = RULES[d.sleeve] || { klass: 'slab' }
    const term = termOf(d), post = d.sell_date >= REFORM_DATE
    y.disposals++
    if (term === 'ST') y.st += d.gain; else if (term === 'LT') y.lt += d.gain; else y.other += d.gain
    if (rule.klass === 'equity') {
      const e = y._eq
      if (term === 'ST') { e.st += d.gain; if (post) e.stNew += d.gain; else e.stOld += d.gain } else { e.lt += d.gain; if (post) e.ltNew += d.gain; else e.ltOld += d.gain }
    } else if (rule.klass === 'foreign' || rule.klass === 'listed_other') {
      if (term === 'LT' && post) y.est_tax += Math.max(0, d.gain) * 0.125
      else if (term === 'LT') y.notes.push(`${d.symbol}: a long-term sale before ${REFORM_DATE} used indexation, which is not modelled`)
      else y.slab_gain += d.gain
    } else if (rule.klass === 'vda') {
      y.est_tax += Math.max(0, d.gain) * 0.3 // losses on virtual digital assets cannot be set off
    } else y.slab_gain += d.gain
  }
  const out = [...years.values()].sort((a, b) => a.fy.localeCompare(b.fy)).map((y) => {
    const { st, lt, carry } = setOff(y._eq.st, y._eq.lt)
    // Rates follow the date of each sale; the exemption comes off the higher-rate bucket first.
    const pos = (x) => Math.max(0, x), e = y._eq
    const stRate = pos(e.stNew) + pos(e.stOld) ? (pos(e.stNew) * 0.2 + pos(e.stOld) * 0.15) / (pos(e.stNew) + pos(e.stOld)) : 0.2
    const stTax = st * stRate
    const exempt = Number(y.fy.slice(3, 7)) >= 2024 ? 125000 : 100000
    const ltNew = pos(Math.min(lt, e.ltNew)), ltOld = pos(lt - ltNew)
    const ltTax = pos(ltNew - exempt) * 0.125 + pos(ltOld - pos(exempt - ltNew)) * 0.1
    if (carry > 0) y.notes.push(`a long-term loss of ₹${Math.round(carry).toLocaleString('en-IN')} is left over; carrying it forward is not modelled`)
    if (y.slab_gain) y.notes.push('gains taxed at your slab rate are not estimated')
    const est = y.est_tax + stTax + ltTax
    return { fy: y.fy, disposals: y.disposals, st: money(y.st), lt: money(y.lt), other: money(y.other), slab_gain: money(y.slab_gain), est_tax: money(est), carry_forward: money(carry), notes: y.notes }
  })
  return out
}

/** Does the ledger agree with what the latest checkpoint says you hold? A ledger that
 * starts late, or misses a bonus or a split, shows up here instead of as a wrong gain. */
export function reconcile(open, holdings) {
  const held = new Map()
  for (const h of holdings) held.set(keyOf(h), h)
  const out = []
  for (const [key, o] of open) {
    const h = held.get(key), have = h ? num(h.qty) : 0
    if (Math.abs(o.qty - have) > Math.max(0.001, Math.abs(have) * 1e-4)) out.push({ symbol: o.symbol, name: o.name, sleeve: o.sleeve, ledger_qty: o.qty, held_qty: have })
  }
  return out
}

/** XIRR per sleeve straight from trade dates, for sleeves the ledger covers completely:
 * every instrument held now is in the ledger and the quantities agree. Since inception. */
export function ledgerXirr(rows, holdings, asOf) {
  const { open } = fifo(rows)
  const bad = new Set(reconcile(open, holdings).map((m) => m.sleeve))
  const inLedger = new Set(rows.map(keyOf))
  const out = {}
  const sleeves = new Set([...rows.map((r) => r.sleeve), ...holdings.map((h) => h.sleeve)])
  for (const s of sleeves) {
    if (bad.has(s) || holdings.some((h) => h.sleeve === s && !inLedger.has(keyOf(h)))) { out[s] = null; continue }
    const flows = rows.filter((r) => r.sleeve === s).map((r) => ({ date: r.trade_date, amount: r.side === 'buy' ? -(gross(r) + num(r.fees_inr)) : gross(r) - num(r.fees_inr) }))
    const value = sum(holdings.filter((h) => h.sleeve === s).map((h) => num(h.qty) * num(h.price) * (h.fx_rate === undefined || h.fx_rate === null ? 1 : num(h.fx_rate))))
    if (value) flows.push({ date: asOf, amount: value })
    out[s] = xirr(flows, { minDays: 60 })
  }
  return out
}
