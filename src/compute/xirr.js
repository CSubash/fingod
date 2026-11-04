// Money-weighted return (XIRR): the single annual rate that makes every cash flow
// you made, and what it is worth now, net to zero.
//
// The index on the Investments page is time-weighted: it asks how the holdings did,
// whatever you added. XIRR asks how *you* did, given when you added it, so it is the
// number to set against an FD rate. Two honest limits:
//   * from checkpoints alone, a week's flow is dated at the middle of that week;
//   * annualising a few weeks of movement is noise, so callers pass `minDays`.
import { money, sum, daysBetween, dayMs } from './num.js'
import { diff, bySleeve } from './qtydiff.js'
import { holdingValue } from './networth.js'

export const midpoint = (a, b) => new Date((dayMs(a) + dayMs(b)) / 2).toISOString().slice(0, 10)

/** flows: [{date: 'YYYY-MM-DD', amount}]. Money you put in is negative; money you
 * got back, and what you still hold, is positive. Returns a percent, or null. */
export function xirr(flows, { minDays = 0 } = {}) {
  const fs = flows.filter((f) => f.amount && f.date).sort((a, b) => a.date.localeCompare(b.date))
  if (fs.length < 2 || !fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return null
  if (daysBetween(fs[0].date, fs[fs.length - 1].date) < minDays) return null
  const t0 = fs[0].date
  const yrs = fs.map((f) => daysBetween(t0, f.date) / 365)
  const npv = (r) => sum(fs.map((f, i) => f.amount / (1 + r) ** yrs[i]))

  const n0 = npv(0)
  if (Math.abs(n0) < 1e-7) return 0

  let lo = -0.9999, hi = 10
  if (n0 > 0) {
    lo = 0
    let curHi = hi
    while (npv(curHi) > 0 && curHi < 1e6) curHi *= 10
    if (npv(curHi) > 0) return null
    hi = curHi
  } else {
    hi = 0
    let curLo = -0.5
    while (npv(curLo) < 0 && curLo > -0.9999) {
      curLo = 1 - (1 - curLo) * 2
      if (curLo < -0.9999) curLo = -0.9999
    }
    if (npv(curLo) < 0) {
      if (npv(lo) <= 0) return null
      curLo = lo
    }
    lo = curLo
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid
  }
  return money(((lo + hi) / 2) * 100)
}

/** Per-sleeve cash flows read off a run of checkpoints: [{date, holdings}], oldest first.
 * What you held at the start goes in, each period's flow goes in at the period's middle,
 * and what you hold at the end comes out. Market and FX never count as flow, which is
 * the whole point. Returns Map<sleeve, [{date, amount}]>. */
export function sleeveFlows(chain) {
  const out = new Map()
  const add = (s, date, amount) => { if (amount) (out.get(s) || out.set(s, []).get(s)).push({ date, amount }) }
  if (chain.length < 2) return out
  const first = chain[0]
  const opening = new Map()
  for (const h of first.holdings) opening.set(h.sleeve, (opening.get(h.sleeve) || 0) + holdingValue(h))
  for (const [s, v] of opening) add(s, first.date, -v)
  let last = []
  for (let i = 1; i < chain.length; i++) {
    last = bySleeve(diff(chain[i - 1].holdings, chain[i].holdings))
    const at = midpoint(chain[i - 1].date, chain[i].date)
    for (const s of last) add(s.sleeve, at, -s.flow)
  }
  for (const s of last) add(s.sleeve, chain[chain.length - 1].date, s.value_now)
  return out
}
