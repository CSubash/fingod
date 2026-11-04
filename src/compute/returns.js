// Returns against cost basis, with optional market/flow/fx attribution.
//
// A group where any holding lacks a cost basis is marked `partial` rather than
// reporting a flattering return: full value over partial invested.
import { num, money, sum, pct } from './num.js'
import { holdingValue } from './networth.js'
import { diff, bySleeve } from './qtydiff.js'
import { accrued, isLive, value as fdValue } from './fd.js'
import { balance as ppfBalance } from './ppf.js'

/** Largest-remainder rounding, so a column of shares totals exactly 100. */
export function shares(values) {
  const total = sum(values)
  if (!total) return values.map(() => 0)
  const raw = values.map((v) => (v / total) * 10000)
  const floor = raw.map(Math.floor)
  let left = 10000 - sum(floor)
  const order = raw.map((r, i) => [r - floor[i], i]).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) { if (left-- <= 0) break; floor[i]++ }
  return floor.map((n) => n / 100)
}

const hasCost = (h) => h.invested_inr !== null && h.invested_inr !== undefined && h.invested_inr !== ''

export function returns(now, prev, threshold = 0.25) {
  const attrByKey = new Map()
  if (prev) for (const a of diff(prev, now)) attrByKey.set(`${a.sleeve}\0${a.symbol}`, a)
  const sleeveAttr = new Map()
  if (prev) for (const s of bySleeve(diff(prev, now), threshold)) sleeveAttr.set(s.sleeve, s)

  const groups = new Map()
  for (const h of now) {
    if (!groups.has(h.sleeve)) groups.set(h.sleeve, [])
    groups.get(h.sleeve).push(h)
  }

  const sleeves = [...groups.entries()].map(([sleeve, hs]) => {
    const sh = shares(hs.map(holdingValue))
    const rows = hs.map((h, i) => {
      const value = money(holdingValue(h))
      const invested = hasCost(h) ? money(num(h.invested_inr)) : null
      const a = attrByKey.get(`${sleeve}\0${h.symbol}`)
      return {
        sleeve, symbol: h.symbol, name: h.name || h.symbol, isin: h.isin || '',
        qty: num(h.qty), price: num(h.price), currency: h.currency || 'INR', avg_cost: h.avg_cost ?? null,
        value, invested, unrealised: invested === null ? null : money(value - invested),
        return_pct: invested ? pct(value - invested, invested) : null,
        share_pct: sh[i], market: a ? a.market : null, flagged: a ? a.flagged : false,
      }
    })
    rows.sort((a, b) => b.value - a.value)
    const value = money(sum(rows.map((r) => r.value)))
    const known = rows.filter((r) => r.invested !== null)
    const invested = money(sum(known.map((r) => r.invested)))
    const sa = sleeveAttr.get(sleeve)
    return {
      sleeve, value, invested, partial: known.length !== rows.length,
      unrealised: money(sum(known.map((r) => r.value)) - invested),
      return_pct: invested ? pct(sum(known.map((r) => r.value)) - invested, invested) : null,
      market: sa ? sa.market : null, flow: sa ? sa.flow : null, fx: sa ? sa.fx : null, delta: sa ? sa.delta : null,
      holdings: rows,
    }
  })
  sleeves.sort((a, b) => b.value - a.value)
  const known = sleeves.filter((s) => !s.partial || s.invested)
  const value = money(sum(sleeves.map((s) => s.value)))
  const invested = money(sum(known.map((s) => s.invested)))
  const unrealised = money(sum(sleeves.map((s) => s.unrealised)))
  return {
    sleeves,
    total: { value, invested, unrealised, return_pct: invested ? pct(unrealised, invested) : null, partial: sleeves.some((s) => s.partial) },
  }
}

/** The FD sleeve: no quantity, so growth is interest (market), not flow - except
 * on the day a deposit opens or closes, which is money moving. */
export function fixedDepositReturns(fds, at, prevAt) {
  const live = fds.filter((f) => isLive(f, at))
  const sh = shares(live.map((f) => fdValue(f, at)))
  const rows = live.map((f, i) => ({
    sleeve: 'fd', symbol: `${f.bank}-${f.id}`, name: `${f.rate_pct}% ${f.bank}${f.note ? ` · ${f.note}` : ''}`,
    qty: 1, price: fdValue(f, at), currency: 'INR', share_pct: sh[i] || 0, market: null, flagged: false,
    value: fdValue(f, at), invested: money(num(f.principal)), unrealised: accrued(f, at),
    return_pct: pct(accrued(f, at), num(f.principal)),
  }))
  const value = money(sum(rows.map((r) => r.value)))
  const invested = money(sum(rows.map((r) => r.invested)))
  const out = { sleeve: 'fd', value, invested, unrealised: money(value - invested), return_pct: pct(value - invested, invested), partial: false, holdings: rows, market: null, flow: null, fx: null, delta: null }
  if (prevAt) {
    const prevValue = sum(fds.map((f) => fdValue(f, prevAt)))
    const prevPrincipal = sum(fds.filter((f) => isLive(f, prevAt)).map((f) => num(f.principal)))
    const flow = money(sum(live.map((f) => num(f.principal))) - prevPrincipal)
    const delta = money(value - prevValue)
    Object.assign(out, { delta, flow, fx: 0, market: money(delta - flow) })
  }
  return out
}

/** The PPF sleeve, one row for the account: growth is interest (market), and a
 * deposit is money you added (flow). */
export function ppfReturns(deposits, rates, at, prevAt) {
  const b = ppfBalance(deposits, rates, at)
  const rows = b.deposited ? [{
    sleeve: 'ppf', symbol: 'PPF', name: `PPF · ${deposits.filter((d) => d.deposit_date <= at).length} deposits`,
    qty: 1, price: b.value, currency: 'INR', share_pct: 100, market: null, flagged: false,
    value: b.value, invested: b.deposited, unrealised: b.interest, return_pct: pct(b.interest, b.deposited),
  }] : []
  const out = { sleeve: 'ppf', value: b.value, invested: b.deposited, unrealised: b.interest, return_pct: pct(b.interest, b.deposited), partial: false, holdings: rows, market: null, flow: null, fx: null, delta: null }
  if (prevAt) {
    const p = ppfBalance(deposits, rates, prevAt)
    const flow = money(b.deposited - p.deposited)
    const delta = money(b.value - p.value)
    Object.assign(out, { delta, flow, fx: 0, market: money(delta - flow) })
  }
  return out
}

/** The EPF sleeve, built from balances (kind='epf'). Contributions are flow,
 * and growth above invested amount is interest (market). */
export function epfReturns(balances, at, prevBalances) {
  const epf = (balances || []).filter((b) => b.kind === 'epf')
  const sh = shares(epf.map((b) => num(b.amount_inr)))
  const rows = epf.map((b, i) => {
    const val = money(num(b.amount_inr))
    let meta = {}
    if (b.meta) {
      try { meta = typeof b.meta === 'string' ? JSON.parse(b.meta) : b.meta } catch {}
    }
    const inv = money(meta && meta.invested_inr !== undefined && meta.invested_inr !== null
      ? num(meta.invested_inr)
      : (b.invested_inr !== undefined && b.invested_inr !== null ? num(b.invested_inr) : num(b.amount_inr)))
    const unrealised = money(val - inv)
    return {
      sleeve: 'epf', symbol: b.ref, name: b.ref,
      qty: 1, price: val, currency: 'INR',
      value: val, invested: inv, unrealised,
      return_pct: inv ? pct(unrealised, inv) : 0,
      share_pct: sh[i] || 0, market: null, flagged: false,
    }
  })
  rows.sort((a, b) => b.value - a.value)
  const value = money(sum(rows.map((r) => r.value)))
  const invested = money(sum(rows.map((r) => r.invested)))
  const unrealised = money(value - invested)
  const out = {
    sleeve: 'epf', value, invested, unrealised,
    return_pct: invested ? pct(unrealised, invested) : 0,
    partial: false, holdings: rows, market: null, flow: null, fx: null, delta: null,
  }
  if (prevBalances) {
    const prevEpf = prevBalances.filter((b) => b.kind === 'epf')
    const prevVal = money(sum(prevEpf.map((b) => num(b.amount_inr))))
    const prevInv = money(sum(prevEpf.map((b) => {
      let meta = {}
      if (b.meta) {
        try { meta = typeof b.meta === 'string' ? JSON.parse(b.meta) : b.meta } catch {}
      }
      return meta && meta.invested_inr !== undefined && meta.invested_inr !== null
        ? num(meta.invested_inr)
        : (b.invested_inr !== undefined && b.invested_inr !== null ? num(b.invested_inr) : num(b.amount_inr))
    })))
    const flow = money(invested - prevInv)
    const delta = money(value - prevVal)
    Object.assign(out, { delta, flow, fx: 0, market: money(delta - flow) })
  }
  return out
}

/** The NPS sleeve, built from balances (kind='nps') or manual_assets (kind='nps').
 * Contributions are flow, and growth above invested amount is interest (market). */
export function npsReturns(balances, at, prevBalances, assets = []) {
  const npsBalances = (balances || []).filter((b) => b.kind === 'nps')
  const npsAssets = (assets || []).filter((a) => a.kind === 'nps' && !a.liability && a.as_of_date <= at)

  let rows = []
  if (npsBalances.length) {
    const sh = shares(npsBalances.map((b) => num(b.amount_inr)))
    rows = npsBalances.map((b, i) => {
      const val = money(num(b.amount_inr))
      let meta = {}
      if (b.meta) {
        try { meta = typeof b.meta === 'string' ? JSON.parse(b.meta) : b.meta } catch {}
      }
      const inv = money(meta && meta.invested_inr !== undefined && meta.invested_inr !== null
        ? num(meta.invested_inr)
        : (b.invested_inr !== undefined && b.invested_inr !== null ? num(b.invested_inr) : num(b.amount_inr)))
      const unrealised = money(val - inv)
      return {
        sleeve: 'nps', symbol: b.ref || 'NPS', name: b.ref || 'NPS',
        qty: 1, price: val, currency: 'INR',
        value: val, invested: inv, unrealised,
        return_pct: inv ? pct(unrealised, inv) : 0,
        share_pct: sh[i] || 0, market: null, flagged: false,
      }
    })
  } else if (npsAssets.length) {
    const latestByName = new Map()
    for (const a of npsAssets) {
      if (!latestByName.has(a.name) || latestByName.get(a.name).as_of_date < a.as_of_date) {
        latestByName.set(a.name, a)
      }
    }
    const list = [...latestByName.values()]
    const sh = shares(list.map((a) => num(a.value_inr)))
    rows = list.map((a, i) => {
      const val = money(num(a.value_inr))
      const inv = val
      return {
        sleeve: 'nps', symbol: a.name, name: a.name,
        qty: 1, price: val, currency: 'INR',
        value: val, invested: inv, unrealised: 0,
        return_pct: 0, share_pct: sh[i] || 0, market: null, flagged: false,
      }
    })
  }
  if (!rows.length) return null
  rows.sort((a, b) => b.value - a.value)
  const value = money(sum(rows.map((r) => r.value)))
  const invested = money(sum(rows.map((r) => r.invested)))
  const unrealised = money(value - invested)
  const out = {
    sleeve: 'nps', value, invested, unrealised,
    return_pct: invested ? pct(unrealised, invested) : 0,
    partial: false, holdings: rows, market: unrealised, flow: invested, fx: null, delta: unrealised,
  }
  if (prevBalances) {
    const prevNps = prevBalances.filter((b) => b.kind === 'nps')
    if (prevNps.length) {
      const prevVal = money(sum(prevNps.map((b) => num(b.amount_inr))))
      const prevInv = money(sum(prevNps.map((b) => {
        let meta = {}
        if (b.meta) {
          try { meta = typeof b.meta === 'string' ? JSON.parse(b.meta) : b.meta } catch {}
        }
        return meta && meta.invested_inr !== undefined && meta.invested_inr !== null ? num(meta.invested_inr) : num(b.amount_inr)
      })))
      const flow = money(invested - prevInv)
      const delta = money(value - prevVal)
      Object.assign(out, { delta, flow, fx: 0, market: money(delta - flow) })
    }
  }
  return out
}
