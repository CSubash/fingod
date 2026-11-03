// Display formatting. Indian digit grouping, and compact lakh/crore forms.
import { num } from '../compute/num.js'

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inrPaise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const money = (v) => `₹${inr.format(Math.round(num(v)))}`
export const moneyExact = (v) => `₹${inrPaise.format(num(v))}`
export const plain = (v, dp = 2) => num(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })

/** ₹1.2 Cr · ₹4.50 L · ₹12.3k */
export function compact(v) {
  const n = num(v), abs = Math.abs(n), sign = n < 0 ? '−' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`
  return `${sign}₹${Math.round(abs)}`
}
export const pct = (v, dp = 2) => (v === null || v === undefined ? '-' : `${num(v).toFixed(dp)}%`)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
export const shortDate = (d) => { const [y, m, day] = d.split('-'); return `${Number(day)} ${MONTHS[Number(m) - 1]} '${y.slice(2)}` }
export const monthLabel = (d) => { const [y, m] = d.split('-'); return `${MONTHS[Number(m) - 1]} '${y.slice(2)}` }

export const SLEEVE_LABEL = {
  in_equity: 'IN Equity', in_mf: 'IN Mutual Funds', us_equity: 'US Equity', gold: 'Gold', debt: 'Debt',
  btc: 'Crypto', fd: 'Fixed Deposits', epf: 'EPF', ppf: 'PPF', liquid: 'Bank balances', cash: 'Bank balances', insurance: 'Insurance',
  overall: 'Overall Portfolio',
  nifty50: 'Nifty 50',
  nifty_midcap150: 'Nifty Midcap 150',
  nifty_smallcap250: 'Nifty Smallcap 250',
  sp500: 'S&P 500',
  nasdaq100: 'Nasdaq 100',
  nyse_composite: 'NYSE Composite',
}
const EXTRA_COLORS = {
  overall: '#ffffff',
  nifty50: '#ffe119',
  nifty_midcap150: '#e6194B',
  nifty_smallcap250: '#fabed4',
  sp500: '#fffac8',
  nasdaq100: '#42d4f4',
  nyse_composite: '#bfef45',
  in_equity: '#4363d8',
  in_mf: '#f58231',
  us_equity: '#3cb44b',
  btc: '#911eb4',
  ppf: '#9A6324',
  fd: '#f032e6',
  epf: '#469990',
}
export const sleeveLabel = (s) => SLEEVE_LABEL[s] || s
export const sleeveColor = (s) => EXTRA_COLORS[s] || `var(--sleeve-${s === 'liquid' ? 'liquid' : s})`

/** A label keeps its colour whatever else is on screen: slot by a hash of its name. */
export const CATEGORY_COLORS = {
  'Food & Drinks': '#f58231',
  'Shopping': '#f032e6',
  'Housing': '#9A6324',
  'Transportation': '#4363d8',
  'Life & Entertainment': '#3cb44b',
  'PC, Communication': '#42d4f4',
  'Financial expenses': '#ffe119',
  'Vehicle': '#e6194B',
  'Income': '#469990',
  'Others': '#a9a9a9',
}

const slots = new Map()
const catSlots = new Map()
export function categoryColor(category) {
  if (!category || category === 'Untagged') return 'var(--cat-untagged)'
  if (category === 'Other') return 'var(--cat-other)'
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category]
  if (!catSlots.has(category)) catSlots.set(category, catSlots.size % 8)
  return `var(--cat-${catSlots.get(category) + 1})`
}

export function labelColor(label) {
  if (label === 'Untagged') return 'var(--cat-untagged)'
  if (label === 'Other') return 'var(--cat-other)'
  if (CATEGORY_COLORS[label]) return CATEGORY_COLORS[label]
  if (!slots.has(label)) slots.set(label, slots.size % 8) // first come, first slot: no two visible labels share a hue
  return `var(--cat-${slots.get(label) + 1})`
}

export function deltaIcon(positive) {
  return positive
    ? `<svg width="0.72em" height="0.72em" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.05em;flex-shrink:0"><polygon points="12,5 3.5,19 20.5,19"/></svg>`
    : `<svg width="0.72em" height="0.72em" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.05em;flex-shrink:0"><polygon points="12,19 3.5,5 20.5,5"/></svg>`
}

/** ▲ +₹4.2k  /  ▼ −₹974 - status is icon + signed value + colour, never colour alone. */
export function delta(v, fmt = compact) {
  const n = num(v)
  if (n === 0) return `<span class="tnum">${fmt(0)}</span>`
  const isPos = n > 0
  const icon = deltaIcon(isPos)
  return `<span class="tnum" style="color:var(--${isPos ? 'good' : 'critical'});display:inline-flex;align-items:center;gap:0.2em">${icon}<span>${isPos ? '+' : '−'}${fmt(Math.abs(n)).replace('−', '')}</span></span>`
}
