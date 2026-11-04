// The two net worth numbers, defined once.
//
//   liquid = cash + investments + FD principal − credit card outstanding
//   total  = liquid + EPF + PPF + FD accrued interest + Splitwise receivable
//            + other assets (NPS, property...) − loans
//
// PPF sits with EPF outside liquid: it is locked for fifteen years.
// Other assets and loans are hand-entered and illiquid, so they move the total only.
import { num, money, sum } from './num.js'
import { accrued, isLive } from './fd.js'
import { balance as ppfBalance } from './ppf.js'

export function holdingValue(h) {
  return num(h.qty) * num(h.price) * (h.fx_rate === undefined || h.fx_rate === null ? 1 : num(h.fx_rate))
}

export function computeNetWorth({ asOf, holdings, balances, fixedDeposits, ppf, assets = [] }) {  const sleeveSums = {}
  let investments = 0
  for (const h of holdings) {
    const v = holdingValue(h)
    investments += v
    sleeveSums[h.sleeve] = (sleeveSums[h.sleeve] || 0) + v
  }
  const byKind = (kind) => sum(balances.filter((b) => b.kind === kind).map((b) => num(b.amount_inr !== undefined ? b.amount_inr : b.balance_inr)))
  const cash = byKind('bank') + byKind('cash')
  const card = Math.abs(byKind('credit_card'))
  const epf = byKind('epf')
  const nps = byKind('nps')
  const splitwise = byKind('splitwise')
  let principal = 0, fdAccrued = 0
  for (const fd of (fixedDeposits || []).filter((f) => isLive(f, asOf))) {
    principal += num(fd.principal)
    fdAccrued += accrued(fd, asOf)
  }
  const ppfValue = ppf && ppf.deposits && ppf.deposits.length ? ppfBalance(ppf.deposits, ppf.rates || [], asOf).value : 0
  const other = sum(assets.filter((a) => !a.liability && (nps === 0 || a.kind !== 'nps')).map((a) => num(a.value_inr)))
  const loans = sum(assets.filter((a) => a.liability).map((a) => num(a.value_inr)))
  const liquid = investments + cash + principal - card
  const total = liquid + epf + nps + ppfValue + fdAccrued + splitwise + other - loans
  return {
    as_of_date: asOf,
    liquid: money(liquid), total: money(total),
    sleeves: Object.fromEntries(Object.entries(sleeveSums).map(([k, v]) => [k, money(v)])),
    cash: money(cash), credit_card: money(card), epf: money(epf), nps: money(nps), ppf: money(ppfValue), splitwise: money(splitwise),
    fd_principal: money(principal), fd_accrued: money(fdAccrued), investments: money(investments),
    other_assets: money(other), loans: money(loans),
  }
}
