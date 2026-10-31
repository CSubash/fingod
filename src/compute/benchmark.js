// Set your portfolio against an index. Pure.
//
// Each checkpoint can carry the level of a benchmark (docs/DATA-FORMAT.md). The portfolio
// side is the time-weighted index the Investments page already draws, so the comparison is
// like for like: neither side is moved by money you added or took out.
import { money, daysBetween } from './num.js'

export const BENCHMARKS = {
  nifty50: { label: 'Nifty 50', usd: false },
  sp500: { label: 'S&P 500 (in ₹)', usd: true }, // SPY's price: a dollar level, converted at that checkpoint's USD/INR so it is what an Indian investor would have earned
}

export const MAX_GAP_DAYS = 7 // a checkpoint on a Sunday reads Friday's close; a month-old level would be a guess

/** The latest level on or before `date` within MAX_GAP_DAYS, from a date-sorted list [{date, level}]. */
function nearest(list, date) {
  let hit = null
  for (const p of list || []) { if (p.date <= date) hit = p; else break }
  return hit && daysBetween(hit.date, date) <= MAX_GAP_DAYS ? hit.level : null
}

/** The level of one benchmark at a checkpoint, in rupees, or null when there is none to use. A level
 * recorded in the checkpoint wins; otherwise the benchmark history supplies the nearest earlier close.
 * history: {key: [{date, level}]} sorted by date. */
export function levelAt(checkpoint, key, history = {}) {
  const own = Number((checkpoint.benchmarks || {})[key])
  const v = own > 0 ? own : nearest(history[key], checkpoint.as_of_date)
  if (!(v > 0)) return null
  if (!BENCHMARKS[key].usd) return v
  const fx = Number(checkpoint.usd_inr)
  return fx > 0 ? v * fx : null
}

/** totalIndex: [{as_of, v}] starting at 100 on the first date of the range. levels: {key: [{as_of, level}]}.
 * Every line is drawn from that same first date, so a benchmark is rebased to 100 there; one with no close on
 * that date cannot be drawn honestly (it would start mid-chart at 100), so it is listed in `missing` instead.
 * Returns null when there is no benchmark data at all. */
export function compareToBenchmarks(totalIndex, levels) {
  const keys = Object.keys(levels).filter((k) => levels[k].length)
  if (!keys.length || totalIndex.length < 2) return null
  const start = totalIndex[0].as_of
  const series = [{ key: 'portfolio', label: 'Your portfolio', points: totalIndex }]
  const missing = []
  for (const k of keys) {
    const base = levels[k].find((p) => p.as_of === start)
    const pts = base ? levels[k].filter((p) => p.as_of >= start).map((p) => ({ as_of: p.as_of, v: (p.level / base.level) * 100 })) : []
    if (pts.length >= 2) series.push({ key: k, label: BENCHMARKS[k].label, points: pts })
    else missing.push({ key: k, label: BENCHMARKS[k].label })
  }
  return { since: start, series: series.map((s) => ({ ...s, change_pct: money(s.points.at(-1).v - 100) })), missing }
}
