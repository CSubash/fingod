// Income from investments: the dividends and interest that land in your accounts. Pure.
//
// Wallet files these under one category, "Interest, dividends" (a fixed registry id), so that
// is the only signal there is. Money is counted when it arrives, not when it was declared, and
// only what you chose to record: a dividend credited and never entered in Wallet is invisible.
//
// The split into interest / dividends reads the note, because Wallet has nothing finer:
//   interest     the note says so ("FD interest", "credit interest")
//   dividends    the note names something else (a company, "final div")
//   unspecified  no note at all, so it is not guessed either way
import { money, sum } from './num.js'
import { periodOf } from './expenses.js'

export const INCOME_CATEGORY_ID = '5c5c2711-0064-8000-8000-000000000000'
export const INCOME_CATEGORY = 'Interest, dividends'
export const KINDS = ['dividends', 'interest', 'unspecified']
const WINDOW = 12

export const isInvestmentIncome = (t) => !t.is_transfer && Number(t.amount_inr) > 0 && (t.category_id === INCOME_CATEGORY_ID || t.category === INCOME_CATEGORY)

export function kindOf(note) {
  const n = String(note || '').trim()
  if (!n) return 'unspecified'
  return /interest|\bint\b|\bfd\b|\brd\b/i.test(n) ? 'interest' : 'dividends'
}

/** Who paid: the note with the dividend wording stripped, so "ITC" and "ITC dividend" are one payer. */
export function payerOf(note) {
  const n = String(note || '').replace(/\b(final|interim|special)?\s*(dividend|div)\b/gi, '').replace(/[,\-–:]+/g, ' ').replace(/\s+/g, ' ').trim()
  return n ? n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null
}

/** The 12 months up to and including `asOf`'s month, oldest first, empty months kept so a gap is
 * visible as a gap. `months` is trailing-12-month by default; the total never includes anything older. */
export function investmentIncome(txns, { asOf } = {}) {
  const rows = txns.filter(isInvestmentIncome)
  if (!rows.length) return null
  const last = periodOf(asOf || rows.reduce((m, t) => (t.txn_date > m ? t.txn_date : m), ''), 'month')
  const [y, m] = last.split('-').map(Number)
  const periods = Array.from({ length: WINDOW }, (_, i) => new Date(Date.UTC(y, m - 1 - (WINDOW - 1 - i), 1)).toISOString().slice(0, 10))
  const byMonth = new Map(periods.map((p) => [p, { month: p, dividends: 0, interest: 0, unspecified: 0, total: 0 }]))
  const payers = new Map()
  for (const t of rows) {
    const cell = byMonth.get(periodOf(t.txn_date, 'month'))
    if (!cell) continue
    const a = Number(t.amount_inr), k = kindOf(t.note)
    cell[k] += a; cell.total += a
    const p = k === 'dividends' ? payerOf(t.note) : null
    if (p) payers.set(p, (payers.get(p) || 0) + a)
  }
  const months = [...byMonth.values()].map((c) => ({ month: c.month, dividends: money(c.dividends), interest: money(c.interest), unspecified: money(c.unspecified), total: money(c.total) }))
  const total = money(sum(months.map((c) => c.total)))
  const part = (k) => money(sum(months.map((c) => c[k])))
  return {
    from: periods[0], to: last, months, total,
    dividends: part('dividends'), interest: part('interest'), unspecified: part('unspecified'),
    months_paid: months.filter((c) => c.total > 0).length,
    monthly_avg: money(total / WINDOW),
    payers: [...payers.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount: money(amount) })),
  }
}
