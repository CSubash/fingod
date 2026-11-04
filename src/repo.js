import { HISTORICAL_INDEX } from './data_benchmarks.js'
// Read models: everything the UI shows, derived from the database.
import { all, first, getSetting } from './db.js'
import { computeNetWorth } from './compute/networth.js'
import { allocate, DEFAULT_TARGET } from './compute/allocation.js'
import { quarterStart } from './compute/ppf.js'
import { returns, fixedDepositReturns, ppfReturns, epfReturns, npsReturns } from './compute/returns.js'
import { isLive } from './compute/fd.js'
import { setFxRate } from './ui/format.js'
import { findDisposals } from './compute/realised.js'
import { money } from './compute/num.js'
import { diff, bySleeve } from './compute/qtydiff.js'
import { xirr, sleeveFlows } from './compute/xirr.js'
import { BENCHMARKS, levelAt, compareToBenchmarks } from './compute/benchmark.js'
import { fifo, summariseGains, reconcile, ledgerXirr, termOf } from './compute/gains.js'
import { cashflow } from './compute/cashflow.js'
import { investmentIncome } from './compute/income.js'

const parse = (r) => ({ ...r, sources: JSON.parse(r.sources || '{}'), benchmarks: JSON.parse(r.benchmarks || '{}') })

export const checkpoints = () => all('SELECT * FROM checkpoints ORDER BY as_of_date').map(parse)
export const latestCheckpoint = () => { const r = first('SELECT * FROM checkpoints ORDER BY as_of_date DESC LIMIT 1'); return r ? parse(r) : null }
export const hasData = () => !!first('SELECT 1 AS x FROM checkpoints LIMIT 1')

export const holdingsOf = (id) => all('SELECT * FROM holdings WHERE checkpoint_id = ?', [id])
export const balancesOf = (id) => all('SELECT * FROM balances WHERE checkpoint_id = ?', [id])
export const fixedDeposits = () => all('SELECT * FROM fixed_deposits ORDER BY start_date')
export const ppfDeposits = () => all('SELECT * FROM ppf_deposits ORDER BY deposit_date, id')
export const ppfRates = () => all('SELECT * FROM ppf_rates ORDER BY quarter_start')
const ppfState = () => ({ deposits: ppfDeposits(), rates: ppfRates() })
export const splitwise = () => all('SELECT * FROM splitwise_balances ORDER BY ABS(amount_inr) DESC')
export const targets = () => getSetting('target_allocation', DEFAULT_TARGET)
export const trades = () => all('SELECT * FROM trades ORDER BY exit_date DESC')
/** The quarter whose PPF rate the user still has to enter, or null: only once they
 * have a PPF, only while today's quarter has no rate, and not after they dismissed it. */
export function ppfRateDue(today = new Date().toISOString().slice(0, 10)) {
  if (!first('SELECT 1 AS x FROM ppf_deposits LIMIT 1')) return null
  const qs = quarterStart(today)
  if (first('SELECT 1 AS x FROM ppf_rates WHERE quarter_start = ?', [qs])) return null
  if (getSetting('ppf_rate_dismissed', null) === qs) return null
  const last = first('SELECT rate_pct FROM ppf_rates WHERE quarter_start < ? ORDER BY quarter_start DESC LIMIT 1', [qs])
  return { quarter_start: qs, last_rate: last ? last.rate_pct : null }
}
/** The Bitcoin position: the hand-entered one, else the latest checkpoint's (an agent may have written it). */
export const manualBtc = () => first("SELECT * FROM manual_holdings WHERE symbol = 'BTC' ORDER BY as_of_date DESC LIMIT 1")
  || first("SELECT h.qty, h.price, h.avg_cost, h.invested_inr FROM holdings h JOIN checkpoints c ON c.id = h.checkpoint_id WHERE h.symbol = 'BTC' ORDER BY c.as_of_date DESC LIMIT 1")

/** Benchmark history as {key: [{date, level}]}, sorted by date. */
export function benchmarkHistory() {
  const out = {}
  for (const r of all('SELECT key, as_of_date, level FROM benchmark_levels ORDER BY as_of_date')) (out[r.key] || (out[r.key] = [])).push({ date: r.as_of_date, level: r.level })
  return out
}
export const ledgerRows = () => all('SELECT * FROM ledger ORDER BY trade_date')
export const manualAssets = () => all('SELECT * FROM manual_assets ORDER BY liability, kind, name, as_of_date')

/** What each hand-entered asset or loan was worth on a date: its latest entry on or before it. */
function assetsAt(rows, asOf) {
  const latest = new Map()
  for (const r of rows) if (r.as_of_date <= asOf) { const k = `${r.kind}\0${r.name}`; if (!latest.has(k) || latest.get(k).as_of_date < r.as_of_date) latest.set(k, r) }
  return [...latest.values()]
}

/** One networth point per checkpoint, oldest first. */
export function networthSeries() {
  const cps = checkpoints()
  const fds = fixedDeposits(), ppf = ppfState()
  const hs = new Map(), bs = new Map()
  for (const h of all('SELECT * FROM holdings')) (hs.get(h.checkpoint_id) || hs.set(h.checkpoint_id, []).get(h.checkpoint_id)).push(h)
  for (const b of all('SELECT * FROM balances')) (bs.get(b.checkpoint_id) || bs.set(b.checkpoint_id, []).get(b.checkpoint_id)).push(b)
  const assets = manualAssets()
  return cps.map((c) => ({ ...computeNetWorth({ asOf: c.as_of_date, holdings: hs.get(c.id) || [], balances: bs.get(c.id) || [], fixedDeposits: fds, ppf, assets: assetsAt(assets, c.as_of_date) }), sources: c.sources }))
}

export function allocationNow() {
  const s = networthSeries()
  if (!s.length) return null
  return allocate(s[s.length - 1], targets())
}

const MIN_XIRR_DAYS = 90
const RANGES = { '1w': 7, '1m': 30, '3m': 91, '1y': 365, all: null }
export const RANGE_IDS = Object.keys(RANGES)

// Which source owns which sleeve: a stale source is excluded from that period's
// attribution rather than booked as a move to zero.
const SOURCE_OF = { in_equity: ['kite', 'groww'], in_mf: ['kite'], gold: ['kite', 'groww'], debt: ['kite', 'groww'], us_equity: ['indmoney'], btc: ['manual', 'coinbase', 'binance'], epf: ['indmoney'] }

/** Sleeve returns and attribution between the latest checkpoint and the one a
 * range ago, plus a series for the indexed chart. */
export function investmentsView(range = '3m') {
  const cps = checkpoints()
  if (!cps.length) return null
  const latest = cps[cps.length - 1]
  if (latest.usd_inr) setFxRate(latest.usd_inr)
  const days = RANGES[range]
  let compared = null
  if (cps.length > 1) {
    if (days === null) compared = cps[0]
    else {
      const startMs = Date.parse(latest.as_of_date) - days * 86400000
      const before = cps.filter((c) => Date.parse(c.as_of_date) <= startMs && c.id !== latest.id)
      compared = before.length ? before[before.length - 1] : cps[0]
    }
    if (compared && compared.id === latest.id) compared = null
  }
  const cutoff = (days === null || range === 'all')
    ? null
    : new Date(Date.parse(latest.as_of_date) - days * 86400000).toISOString().slice(0, 10)
  const fds = fixedDeposits()
  const now = holdingsOf(latest.id)
  const prev = compared ? holdingsOf(compared.id) : null

  // Fallback cost basis for holdings: carry forward from earlier checkpoints, trades, or ledger
  const fillMissingCost = (list) => {
    for (const h of list) {
      if (h.avg_cost === null || h.avg_cost === undefined || h.invested_inr === null || h.invested_inr === undefined) {
        const prevH = first(
          'SELECT avg_cost, invested_inr, fx_rate FROM holdings WHERE symbol = ? AND avg_cost IS NOT NULL ORDER BY checkpoint_id DESC LIMIT 1',
          [h.symbol]
        )
        if (prevH) {
          if (h.avg_cost === null || h.avg_cost === undefined) h.avg_cost = prevH.avg_cost
          if (h.invested_inr === null || h.invested_inr === undefined) {
            if (h.avg_cost && h.qty) {
              h.invested_inr = Number(h.qty) * Number(h.avg_cost) * (Number(h.fx_rate || prevH.fx_rate) || 1)
            } else if (prevH.invested_inr) {
              h.invested_inr = prevH.invested_inr
            }
          }
        }
      }
    }
  }
  fillMissingCost(now)
  if (prev) fillMissingCost(prev)

  const led = ledgerRows()
  for (const h of now) {
    if (h.invested_inr === null || h.invested_inr === undefined) {
      const sym = h.symbol || ''
      const baseSym = sym.split('.')[0]
      const matches = led.filter((l) => l.side === 'buy' && (l.symbol === sym || l.symbol === baseSym || (h.sleeve === 'btc' && l.sleeve === 'btc')))
      if (matches.length) {
        const totalQty = matches.reduce((sum, m) => sum + Number(m.qty), 0)
        const totalInvestedInr = matches.reduce((sum, m) => sum + Number(m.qty) * Number(m.price) * (Number(m.fx_rate) || 1), 0)
        const totalInvestedNative = matches.reduce((sum, m) => sum + Number(m.qty) * Number(m.price), 0)
        if (totalQty > 0) {
          h.invested_inr = totalInvestedInr
          h.avg_cost = totalInvestedNative / totalQty
        }
      }
    }
  }
  if (prev) {
    for (const h of prev) {
      if (h.invested_inr === null || h.invested_inr === undefined) {
        const sym = h.symbol || ''
        const baseSym = sym.split('.')[0]
        const matches = led.filter((l) => l.side === 'buy' && (l.symbol === sym || l.symbol === baseSym || (h.sleeve === 'btc' && l.sleeve === 'btc')))
        if (matches.length) {
          const totalQty = matches.reduce((sum, m) => sum + Number(m.qty), 0)
          const totalInvestedInr = matches.reduce((sum, m) => sum + Number(m.qty) * Number(m.price) * (Number(m.fx_rate) || 1), 0)
          const totalInvestedNative = matches.reduce((sum, m) => sum + Number(m.qty) * Number(m.price), 0)
          if (totalQty > 0) {
            h.invested_inr = totalInvestedInr
            h.avg_cost = totalInvestedNative / totalQty
          }
        }
      }
    }
  }

  const r = returns(now, prev)

  // Drop attribution for sleeves whose source went stale on either side.
  const stale = (s) => (SOURCE_OF[s] || []).some((src) => latest.sources[src] === 'stale' || (compared && compared.sources[src] === 'stale'))
  for (const s of r.sleeves) if (stale(s.sleeve)) Object.assign(s, { market: null, flow: null, fx: null, delta: null, stale: true })

  const fdSleeve = fds.length ? fixedDepositReturns(fds, latest.as_of_date, compared && compared.as_of_date) : null
  const ppf = ppfState()
  const ppfSleeve = ppf.deposits.length ? ppfReturns(ppf.deposits, ppf.rates, latest.as_of_date, compared && compared.as_of_date) : null
  const epfSleeve = epfReturns(balancesOf(latest.id), latest.as_of_date, compared ? balancesOf(compared.id) : null)
  if (epfSleeve && stale('epf')) Object.assign(epfSleeve, { market: null, flow: null, fx: null, delta: null, stale: true })
  const npsSleeve = npsReturns(balancesOf(latest.id), latest.as_of_date, compared ? balancesOf(compared.id) : null, manualAssets())
  const SLEEVE_RANK = {
    in_equity: 1,
    us_equity: 2,
    in_mf: 3,
    gold: 4,
    btc: 5,
    fd: 6,
    ppf: 7,
    epf: 8,
    nps: 9,
  }
  const sleeves = [...r.sleeves, ...[fdSleeve, ppfSleeve, epfSleeve, npsSleeve].filter((s) => s && s.holdings.length)].sort(
    (a, b) => (SLEEVE_RANK[a.sleeve] || 99) - (SLEEVE_RANK[b.sleeve] || 99)
  )

  // Dynamically resolve buy dates:
  // Tier 1: Check for past trades which have NOT sold from broker ledger (Zerodha, INDmoney, Binance, etc.) via FIFO
  // Tier 2: If not available, check from Wallet transactions (filtering out already-sold positions)
  // If no broker trade or wallet buy is found, left as null so UI displays '-' and sorts to bottom
  const buyDates = {}
  try {
    // Tier 1: Broker trade ledger unsold lots
    const led = ledgerRows()
    if (led && led.length > 0) {
      const { lots } = fifo(led.map(ledgerRow))
      if (lots) {
        for (const [key, book] of lots) {
          const unsold = (book || []).filter((l) => l.qty > 0)
          if (unsold.length > 0) {
            unsold.sort((a, b) => a.date.localeCompare(b.date))
            const earliest = unsold[0].date
            for (const r of led) {
              const k = r.isin ? `isin\0${r.isin}` : `sym\0${r.sleeve}\0${r.symbol}`
              if (k === key) {
                if (r.symbol) buyDates[r.symbol] = earliest
                if (r.isin) buyDates[r.isin] = earliest
              }
            }
          }
        }
      }
    }

    // Tier 2: Wallet transactions (for holdings not yet resolved from broker unsold trades)
    const walletHasBuys = getSetting('wallet_has_stock_buys', true) !== false
    if (walletHasBuys) {
      const ALIASES = {
        'AARTIDRUGS': ['AARTI DRUGS'],
        'AARTIIND': ['AARTI INDUSTRIES', 'AARTI IND'],
        'ATULAUTO': ['ATUL AUTO'],
        'BAJAJHFL': ['BAJAJ HOUSING FINANCE'],
        'BANDHANBNK': ['BANDHAN BANK'],
        'BAYERCROP': ['BAYER CROP'],
        'BIRLAMONEY': ['BIRLA MONEY'],
        'BRITANNIA': ['BRITANNIA'],
        'CAMS': ['CAMS'],
        'DABUR': ['DABUR'],
        'DMART': ['DMART', 'AVENUE SUPERMARTS'],
        'EASEMYTRIP': ['EASE MY TRIP', 'EASEMYTRIP'],
        'ESCORTS': ['ESCORTS'],
        'GODREJCP': ['GODREJ CONSUMER'],
        'GOLDBEES': ['GOLDBEES', 'GOLD BEES'],
        'HAVELLS': ['HAVELLS'],
        'HDFCBANK': ['HDFC BANK'],
        'HDFCLIFE': ['HDFC LIFE'],
        'HINDUNILVR': ['HINDUSTAN UNILEVER'],
        'ICICILIFE': ['ICICI PRUDENTIAL LIFE'],
        'JIOFIN': ['JIO FINANCE', 'JIO FINANCIAL'],
        'JPL': ['JIO PLATFORMS', 'JPL'],
        'JUNIORBEES': ['JUNIORBEES', 'JUNIOR BEES'],
        'KANSAINER': ['KANSAINER', 'KANSAI NEROLAC'],
        'KWIL': ['KWIL'],
        'PFC': ['PFC', 'POWER FINANCE'],
        'PNB': ['PNB', 'PUNJAB NATIONAL BANK'],
        'RECLTD': ['RECLTD', 'REC LIMITED'],
        'SSFL-ST': ['SSFL-ST', 'SSFL'],
        'TCS': ['TCS', 'TATA CONSULTANCY'],
        'TITAGARH': ['TITAGARH'],
        'TMPV': ['TATA MOTORS', 'TMPV'],
        'UNITDSPR': ['UNITED SPIRITS'],
        'UTIAMC': ['UTI AMC'],
        'VBL': ['VBL', 'VARUN BEVERAGES'],
        'GOOGL': ['GOOGLE'],
        'ASTS': ['ASTS', 'AST SPACEMOBILE', 'AST SPACE MOBILE'],
        'SOFI': ['SOFI'],
        'NBIS': ['NEBIUS'],
        'INF247L01BY3': ['MOTILAL OSWAL SMALL CAP'],
        'INF846K01EH3': ['AXIS MID CAP', 'AXIS MIDCAP'],
        'INF879O01027': ['PARAG PARIKH'],
        'INF204K01XI3': ['NIPPON INDIA LARGE CAP'],
        'INF769K01DM9': ['MIRAE ASSEST TAX SAVER', 'MIRAE ASSET TAX SAVER', 'MIRAE ASSET ELSS'],
        'INF247L01445': ['MOTILAL OSWAL MID CAP', 'MOTILAL OSWAL MIDCAP'],
        'INF760K01FR2': ['CANARA ROBECO LARGE CAP'],
        'INF966L01689': ['QUANT SMALL CAP'],
      }

      const txns = all("SELECT txn_date, amount_inr, note, account, category FROM transactions WHERE note IS NOT NULL ORDER BY txn_date ASC")
      if (txns.length > 0) {
        for (const s of sleeves) {
          for (const h of s.holdings || []) {
            if (buyDates[h.symbol] || (h.isin && buyDates[h.isin])) continue

            const sym = (h.symbol || '').toUpperCase().split('.')[0]
            const name = (h.name || '').toUpperCase()
            const terms = [...(ALIASES[h.symbol] || []), ...(ALIASES[sym] || []), ...(h.isin && ALIASES[h.isin] ? ALIASES[h.isin] : [])]
            if (sym.length >= 2) terms.push(sym)
            if (name.length >= 4) terms.push(name)
            if (s.sleeve === 'in_mf' && name) {
              const cleanMf = name.replace(/\s*-\s*(DIRECT|REGULAR).*$/i, '').replace(/\s*MUTUAL\s*FUND/i, '').replace(/\s*FUND/i, '').trim()
              if (cleanMf.length >= 4) terms.push(cleanMf)
            }

            const norm = (str) => (str || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

            const matched = txns.filter((t) => {
              const note = (t.note || '').toUpperCase()
              if (!note) return false
              const normNote = norm(note)
              const hasTerm = terms.some((term) => {
                const idx = note.indexOf(term.toUpperCase())
                if (idx !== -1) {
                  const before = idx > 0 ? note[idx - 1] : ' '
                  const after = idx + term.length < note.length ? note[idx + term.length] : ' '
                  if (/[^A-Z0-9]/.test(before) && /[^A-Z0-9]/.test(after)) return true
                }
                const normTerm = norm(term)
                if (normTerm.length >= 4 && normNote.includes(normTerm)) return true
                return false
              })
              if (!hasTerm) return false
              if (/SUBSCRIPTION|CREDIT CARD|PARKING|LOCK REPAIR|CLINDAC|ANTMAN|SMS CHARGE|INTEREST|DIVIDEND|GOOGLE PLAY/i.test(note)) return false
              return true
            })

            if (matched.length > 0) {
              const sales = matched.filter((t) => {
                const note = (t.note || '').toLowerCase()
                return note.includes('selling') || note.includes('sold') || (t.amount_inr > 0 && (note.includes('stock') || note.includes('fund')))
              })
              const lastSaleDate = sales.length > 0 ? sales[sales.length - 1].txn_date : null

              const buys = matched.filter((t) => {
                if (t.amount_inr >= 0) return false
                if (lastSaleDate && t.txn_date <= lastSaleDate) return false
                const note = (t.note || '').toLowerCase()
                return note.includes('stock') || note.includes('fund') || note.includes('etf') || note.includes('ipo') || t.account === 'IndMoney' || t.category === 'Investments'
              })

              if (buys.length > 0) {
                buyDates[h.symbol] = buys[0].txn_date
              }
            }
          }
        }
      }
    }

  } catch (_) {}

  for (const s of sleeves) {
    for (const h of s.holdings || []) {
      if (!h.buy_date) {
        if (s.sleeve === 'fd') {
          const match = fds.find((f) => `${f.bank}-${f.id}` === h.symbol)
          if (match) h.buy_date = match.start_date
        } else if (s.sleeve === 'ppf') {
          if (ppf.deposits.length) {
            h.buy_date = ppf.deposits.slice().sort((a, b) => a.deposit_date.localeCompare(b.deposit_date))[0].deposit_date
          }
        } else {
          const sym = h.symbol || ''
          const baseSym = sym.split('.')[0]
          h.buy_date = buyDates[sym] || (h.isin ? buyDates[h.isin] : null) || buyDates[baseSym] || null
        }
      }
    }
  }

  const inRange = cps.filter((c) => !compared || c.as_of_date >= compared.as_of_date)
  const series = inRange.map((c) => {
    const values = {}
    for (const h of all('SELECT sleeve, SUM(value_inr) AS v FROM holdings WHERE checkpoint_id = ? GROUP BY sleeve', [c.id])) values[h.sleeve] = h.v
    const fd = fds.reduce((s, f) => s + (new Date(f.start_date) <= new Date(c.as_of_date) && !(f.closed_at && f.closed_at <= c.as_of_date) ? f.principal : 0), 0)
    if (fd) values.fd = money(fdSleeve ? fixedDepositReturns(fds, c.as_of_date, null).value : fd)
    if (ppfSleeve) { const v = ppfReturns(ppf.deposits, ppf.rates, c.as_of_date, null).value; if (v) values.ppf = v }
    if (npsSleeve && npsSleeve.value) values.nps = npsSleeve.value
    return { as_of: c.as_of_date, values }
  })

  // PPF historical index built directly from user's deposits and official rates
  const buildPpfSeries = (cutoffDate = null) => {
    if (!ppf.deposits.length) return null
    const sortedDeps = ppf.deposits.slice().sort((a, b) => a.deposit_date.localeCompare(b.deposit_date))
    const firstDate = cutoffDate && cutoffDate > sortedDeps[0].deposit_date ? cutoffDate : sortedDeps[0].deposit_date
    const lastDate = cps.length ? cps[cps.length - 1].as_of_date : new Date().toISOString().slice(0, 10)
    if (firstDate > lastDate) return null

    const dateSet = new Set()
    for (const d of ppf.deposits) {
      if (d.deposit_date >= firstDate && d.deposit_date <= lastDate) dateSet.add(d.deposit_date)
    }
    let cur = new Date(firstDate)
    const end = new Date(lastDate)
    while (cur < end) {
      cur.setMonth(cur.getMonth() + 1)
      const dStr = cur.toISOString().slice(0, 10)
      if (dStr >= firstDate && dStr <= lastDate) dateSet.add(dStr)
    }
    for (const c of cps) if (c.as_of_date >= firstDate && c.as_of_date <= lastDate) dateSet.add(c.as_of_date)
    dateSet.add(firstDate)
    dateSet.add(lastDate)

    const dates = [...dateSet].sort()
    if (dates.length < 2) return null

    const pts = [{ as_of: dates[0], v: 100 }]
    for (let i = 1; i < dates.length; i++) {
      const asOf = dates[i], prevAt = dates[i - 1]
      const f = ppfReturns(ppf.deposits, ppf.rates, asOf, prevAt)
      const prevVal = ppfReturns(ppf.deposits, ppf.rates, prevAt, null).value
      const last = pts.at(-1).v
      pts.push({ as_of: asOf, v: prevVal ? last * (1 + f.market / prevVal) : last })
    }
    return pts
  }

  // FD historical index built directly from user's fixed deposits
  const buildFdSeries = (cutoffDate = null) => {
    if (!fds.length) return null
    const sortedFds = fds.slice().sort((a, b) => a.start_date.localeCompare(b.start_date))
    const firstDate = cutoffDate && cutoffDate > sortedFds[0].start_date ? cutoffDate : sortedFds[0].start_date
    const lastDate = cps.length ? cps[cps.length - 1].as_of_date : new Date().toISOString().slice(0, 10)
    if (firstDate > lastDate) return null

    const dateSet = new Set()
    for (const f of fds) {
      if (f.start_date && f.start_date >= firstDate && f.start_date <= lastDate) dateSet.add(f.start_date)
      if (f.maturity_date && f.maturity_date >= firstDate && f.maturity_date <= lastDate) dateSet.add(f.maturity_date)
      if (f.closed_at && f.closed_at >= firstDate && f.closed_at <= lastDate) dateSet.add(f.closed_at)
    }
    let cur = new Date(firstDate)
    const end = new Date(lastDate)
    while (cur < end) {
      cur.setMonth(cur.getMonth() + 1)
      const dStr = cur.toISOString().slice(0, 10)
      if (dStr >= firstDate && dStr <= lastDate) dateSet.add(dStr)
    }
    for (const c of cps) if (c.as_of_date >= firstDate && c.as_of_date <= lastDate) dateSet.add(c.as_of_date)
    dateSet.add(firstDate)
    dateSet.add(lastDate)

    const dates = [...dateSet].sort()
    if (dates.length < 2) return null

    const pts = [{ as_of: dates[0], v: 100 }]
    for (let i = 1; i < dates.length; i++) {
      const asOf = dates[i], prevAt = dates[i - 1]
      const f = fixedDepositReturns(fds, asOf, prevAt)
      const prevVal = fixedDepositReturns(fds, prevAt, null).value
      const last = pts.at(-1).v
      pts.push({ as_of: asOf, v: prevVal ? last * (1 + f.market / prevVal) : last })
    }
    return pts
  }

  // Time-weighted index: chain each period's (market + fx) / opening value, leaving
  // flow out, so a SIP or a sale never reads as a gain or a crash. Starts at 100.
  const index = {}
  const chain = inRange.map((c) => ({ c, h: holdingsOf(c.id) }))
  let totalIndex = chain.length ? [{ as_of: chain[0].c.as_of_date, v: 100 }] : []
  for (let i = 0; i < chain.length; i++) {
    const asOf = chain[i].c.as_of_date
    if (i === 0) { for (const s of new Set(chain[0].h.map((x) => x.sleeve))) index[s] = [{ as_of: asOf, v: 100 }]; if (fds.length) index.fd = [{ as_of: asOf, v: 100 }]; if (ppfSleeve) index.ppf = [{ as_of: asOf, v: 100 }]; continue }
    const parts = bySleeve(diff(chain[i - 1].h, chain[i].h))
    for (const s of parts) {
      if (!index[s.sleeve]) { index[s.sleeve] = [{ as_of: asOf, v: 100 }]; continue }
      const last = index[s.sleeve].at(-1).v
      index[s.sleeve].push({ as_of: asOf, v: s.value_prev ? last * (1 + (s.market + s.fx) / s.value_prev) : last })
    }
    const opening = parts.reduce((a, s) => a + s.value_prev, 0), gain = parts.reduce((a, s) => a + s.market + s.fx, 0)
    totalIndex.push({ as_of: asOf, v: opening ? totalIndex.at(-1).v * (1 + gain / opening) : totalIndex.at(-1).v })
    if (index.fd && fds.length) {
      const f = fixedDepositReturns(fds, asOf, chain[i - 1].c.as_of_date)
      const prev = fixedDepositReturns(fds, chain[i - 1].c.as_of_date, null).value
      index.fd.push({ as_of: asOf, v: prev ? index.fd.at(-1).v * (1 + f.market / prev) : index.fd.at(-1).v })
    }
    if (index.ppf) {
      const f = ppfReturns(ppf.deposits, ppf.rates, asOf, chain[i - 1].c.as_of_date)
      const prev = ppfReturns(ppf.deposits, ppf.rates, chain[i - 1].c.as_of_date, null).value
      index.ppf.push({ as_of: asOf, v: prev ? index.ppf.at(-1).v * (1 + f.market / prev) : index.ppf.at(-1).v })
    }
  }

  // Equity historical index built from trades, ledger, and open holdings
  const buildEquitySeries = (sleeve, cutoffDate = null) => {
    const sTrades = all('SELECT symbol, exit_date, invested_inr, realised_inr, holding_days FROM trades WHERE sleeve = ? ORDER BY exit_date', [sleeve])
    const sHoldings = now.filter((h) => h.sleeve === sleeve)
    if (!sTrades.length && !sHoldings.length) return null

    const positions = []
    for (const t of sTrades) {
      const exitDt = new Date(t.exit_date)
      const hDays = t.holding_days || 30
      const buyDt = new Date(exitDt.getTime() - hDays * 86400000)
      positions.push({
        symbol: t.symbol,
        buy_date: buyDt.toISOString().slice(0, 10),
        exit_date: t.exit_date,
        invested: Number(t.invested_inr || 0),
        realised: Number(t.realised_inr || 0),
        is_closed: true,
      })
    }

    for (const h of sHoldings) {
      const inv = Number(h.invested_inr || h.invested || 0)
      const val = Number(h.value_inr || h.value || 0)
      const buyD = h.buy_date || (sTrades.length ? sTrades[sTrades.length - 1].exit_date : (cps[0] ? cps[0].as_of_date : latest.as_of_date))
      positions.push({
        symbol: h.symbol,
        buy_date: buyD,
        exit_date: latest.as_of_date,
        invested: inv,
        realised: val - inv,
        is_closed: false,
      })
    }

    if (!positions.length) return null
    const sortedBuy = positions.map((p) => p.buy_date).sort()
    const earliest = sortedBuy[0]
    const firstDate = cutoffDate && cutoffDate > earliest ? cutoffDate : earliest
    const lastDate = latest.as_of_date
    if (firstDate > lastDate) return null

    const bDates = (HISTORICAL_INDEX.nifty50 || []).map((p) => p.as_of)
    const dateSet = new Set([firstDate, lastDate])
    for (const p of positions) {
      if (p.buy_date >= firstDate && p.buy_date <= lastDate) dateSet.add(p.buy_date)
      if (p.exit_date >= firstDate && p.exit_date <= lastDate) dateSet.add(p.exit_date)
    }
    for (const bd of bDates) {
      if (bd >= firstDate && bd <= lastDate) dateSet.add(bd)
    }
    for (const c of cps) {
      if (c.as_of_date >= firstDate && c.as_of_date <= lastDate) dateSet.add(c.as_of_date)
    }

    const dates = [...dateSet].sort()
    if (dates.length < 2) return null

    const pts = []
    for (const d of dates) {
      const closed = positions.filter((p) => p.is_closed && p.exit_date <= d)
      const active = positions.filter((p) => p.buy_date <= d && (!p.is_closed || p.exit_date > d))

      const realisedPnl = closed.reduce((sum, p) => sum + p.realised, 0)
      const activeCost = active.reduce((sum, p) => sum + p.invested, 0)

      let activeUnrealised = 0
      for (const p of active) {
        const bTime = new Date(p.buy_date).getTime()
        const eTime = new Date(p.exit_date).getTime()
        const curTime = new Date(d).getTime()
        const totalDays = Math.max(1, (eTime - bTime) / 86400000)
        const elapsedDays = Math.min(totalDays, Math.max(0, (curTime - bTime) / 86400000))
        activeUnrealised += p.realised * (elapsedDays / totalDays)
      }

      const totalPnl = realisedPnl + activeUnrealised
      const totalInvested = closed.reduce((sum, p) => sum + p.invested, 0) + activeCost
      const retPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0
      pts.push({ as_of: d, v: Math.round((100 + retPct) * 100) / 100 })
    }

    const baseV = pts[0].v || 100
    return pts.map((p) => ({ as_of: p.as_of, v: Math.round(((p.v / baseV) * 100) * 100) / 100 }))
  }

  // Mutual Funds historical index built from past SIP/investment transactions and current holdings
  const buildMfSeries = (cutoffDate = null) => {
    const mfHoldings = now.filter((h) => h.sleeve === 'in_mf')
    if (!mfHoldings.length) return null
    const mfTxns = all(
      "SELECT id, txn_date, amount_inr, note FROM transactions WHERE (note LIKE '%fund%' OR note LIKE '%mutual%') AND (category LIKE '%invest%' OR category_top LIKE '%invest%') ORDER BY txn_date"
    )
    const totalMfInv = mfHoldings.reduce((sum, h) => sum + Number(h.invested_inr || h.invested || 0), 0)
    const totalMfVal = mfHoldings.reduce((sum, h) => sum + Number(h.value_inr || h.value || 0), 0)
    if (!totalMfInv) return null

    const firstDateRaw = mfTxns.length ? mfTxns[0].txn_date : (cps[0] ? cps[0].as_of_date : latest.as_of_date)
    const firstDate = cutoffDate && cutoffDate > firstDateRaw ? cutoffDate : firstDateRaw
    const lastDate = latest.as_of_date
    if (firstDate > lastDate) return null

    const bDates = (HISTORICAL_INDEX.nifty50 || []).map((p) => p.as_of)
    const dateSet = new Set([firstDate, lastDate])
    for (const t of mfTxns) {
      if (t.txn_date >= firstDate && t.txn_date <= lastDate) dateSet.add(t.txn_date)
    }
    for (const bd of bDates) {
      if (bd >= firstDate && bd <= lastDate) dateSet.add(bd)
    }
    for (const c of cps) {
      if (c.as_of_date >= firstDate && c.as_of_date <= lastDate) dateSet.add(c.as_of_date)
    }

    const sortedDates = [...dateSet].sort()
    if (sortedDates.length < 2) return null

    const startMs = Date.parse(firstDate)
    const endMs = Date.parse(lastDate)
    const totalSpan = Math.max(1, endMs - startMs)
    const totalGain = totalMfVal - totalMfInv

    const pts = []
    for (const d of sortedDates) {
      const curMs = Date.parse(d)
      const timeFrac = Math.min(1, Math.max(0, (curMs - startMs) / totalSpan))
      const txnsUpToD = mfTxns.filter((t) => t.txn_date <= d)
      const investedUpToD = txnsUpToD.reduce((sum, t) => sum + Math.abs(Number(t.amount_inr || 0)), 0)
      const invRatio = totalMfInv > 0 && investedUpToD > 0 ? Math.min(1, investedUpToD / totalMfInv) : timeFrac
      const gainAtD = totalGain * invRatio * timeFrac
      const cap = investedUpToD > 0 ? investedUpToD : totalMfInv
      const retPct = cap > 0 ? (gainAtD / cap) * 100 : 0
      pts.push({ as_of: d, v: Math.round((100 + retPct) * 100) / 100 })
    }

    const baseV = pts[0].v || 100
    return pts.map((p) => ({ as_of: p.as_of, v: Math.round(((p.v / baseV) * 100) * 100) / 100 }))
  }

  // Gold historical index built from past purchase transactions and holdings
  const buildGoldSeries = (cutoffDate = null) => {
    const goldHoldings = now.filter((h) => h.sleeve === 'gold')
    if (!goldHoldings.length) return null
    const goldTxn = first(
      "SELECT txn_date, amount_inr FROM transactions WHERE (note LIKE '%gold%' OR note LIKE '%goldbees%') AND (category LIKE '%invest%' OR category_top LIKE '%invest%') ORDER BY txn_date LIMIT 1"
    )
    const goldTrades = all("SELECT exit_date, holding_days FROM trades WHERE sleeve = 'gold' ORDER BY exit_date")
    let firstDateRaw = goldTxn ? goldTxn.txn_date : null
    if (!firstDateRaw && goldTrades.length) {
      const gt = goldTrades[0]
      const hDays = gt.holding_days || 30
      firstDateRaw = new Date(Date.parse(gt.exit_date) - hDays * 86400000).toISOString().slice(0, 10)
    }
    if (!firstDateRaw) firstDateRaw = cps[0] ? cps[0].as_of_date : latest.as_of_date

    const firstDate = cutoffDate && cutoffDate > firstDateRaw ? cutoffDate : firstDateRaw
    const lastDate = latest.as_of_date
    if (firstDate > lastDate) return null

    const goldInv = goldHoldings.reduce((sum, h) => sum + Number(h.invested_inr || h.invested || 0), 0)
    const goldVal = goldHoldings.reduce((sum, h) => sum + Number(h.value_inr || h.value || 0), 0)
    if (!goldInv) return null

    const bDates = (HISTORICAL_INDEX.nifty50 || []).map((p) => p.as_of)
    const dateSet = new Set([firstDate, lastDate])
    if (goldTxn && goldTxn.txn_date >= firstDate && goldTxn.txn_date <= lastDate) dateSet.add(goldTxn.txn_date)
    for (const bd of bDates) {
      if (bd >= firstDate && bd <= lastDate) dateSet.add(bd)
    }
    for (const c of cps) {
      if (c.as_of_date >= firstDate && c.as_of_date <= lastDate) dateSet.add(c.as_of_date)
    }

    const sortedDates = [...dateSet].sort()
    if (sortedDates.length < 2) return null

    const startMs = Date.parse(firstDate)
    const endMs = Date.parse(lastDate)
    const totalSpan = Math.max(1, endMs - startMs)
    const totalGain = goldVal - goldInv

    const pts = []
    for (const d of sortedDates) {
      const curMs = Date.parse(d)
      const timeFrac = Math.min(1, Math.max(0, (curMs - startMs) / totalSpan))
      const gainAtD = totalGain * timeFrac
      const retPct = (gainAtD / goldInv) * 100
      pts.push({ as_of: d, v: Math.round((100 + retPct) * 100) / 100 })
    }

    const baseV = pts[0].v || 100
    return pts.map((p) => ({ as_of: p.as_of, v: Math.round(((p.v / baseV) * 100) * 100) / 100 }))
  }

  // Bitcoin historical index built from past trades, ledger, and transactions
  const buildBtcSeries = (cutoffDate = null) => {
    const btcHoldings = now.filter((h) => h.sleeve === 'btc')
    const btcTrades = all("SELECT * FROM trades WHERE sleeve = 'btc' ORDER BY exit_date")
    const btcLedger = led.filter((r) => r.sleeve === 'btc' && r.side === 'buy')
    const btcTxn = first("SELECT txn_date, amount_inr FROM transactions WHERE (note LIKE '%btc%' OR note LIKE '%bitcoin%') ORDER BY txn_date LIMIT 1")

    if (!btcHoldings.length && !btcTrades.length && !btcLedger.length) return null

    let firstDateRaw = btcTxn ? btcTxn.txn_date : null
    if (!firstDateRaw && btcTrades.length) {
      const bt = btcTrades[0]
      const hDays = bt.holding_days || 30
      firstDateRaw = new Date(Date.parse(bt.exit_date) - hDays * 86400000).toISOString().slice(0, 10)
    }
    if (!firstDateRaw && btcLedger.length) {
      firstDateRaw = btcLedger[0].trade_date
    }
    if (!firstDateRaw) firstDateRaw = cps[0] ? cps[0].as_of_date : latest.as_of_date

    const firstDate = cutoffDate && cutoffDate > firstDateRaw ? cutoffDate : firstDateRaw
    const lastDate = latest.as_of_date
    if (firstDate > lastDate) return null

    const btcInv = btcHoldings.reduce((sum, h) => sum + Number(h.invested_inr || h.invested || 0), 0)
    const btcVal = btcHoldings.reduce((sum, h) => sum + Number(h.value_inr || h.value || 0), 0)
    if (!btcInv && !btcTrades.length) return null

    const bDates = (HISTORICAL_INDEX.nifty50 || []).map((p) => p.as_of)
    const dateSet = new Set([firstDate, lastDate])
    if (btcTxn && btcTxn.txn_date >= firstDate && btcTxn.txn_date <= lastDate) dateSet.add(btcTxn.txn_date)
    for (const t of btcTrades) {
      if (t.exit_date >= firstDate && t.exit_date <= lastDate) dateSet.add(t.exit_date)
    }
    for (const l of btcLedger) {
      if (l.trade_date >= firstDate && l.trade_date <= lastDate) dateSet.add(l.trade_date)
    }
    for (const bd of bDates) {
      if (bd >= firstDate && bd <= lastDate) dateSet.add(bd)
    }
    for (const c of cps) {
      if (c.as_of_date >= firstDate && c.as_of_date <= lastDate) dateSet.add(c.as_of_date)
    }

    const sortedDates = [...dateSet].sort()
    if (sortedDates.length < 2) return null

    const closedGain = btcTrades.reduce((sum, t) => sum + Number(t.realised_inr || 0), 0)
    const closedInv = btcTrades.reduce((sum, t) => sum + Number(t.invested_inr || 0), 0)
    const tradeExitDate = btcTrades.length ? btcTrades[btcTrades.length - 1].exit_date : null

    const pts = []
    const startMs = Date.parse(firstDate)
    const exitMs = tradeExitDate ? Date.parse(tradeExitDate) : null
    const endMs = Date.parse(lastDate)

    for (const d of sortedDates) {
      const curMs = Date.parse(d)
      let v = 100
      if (exitMs && curMs <= exitMs) {
        const frac = Math.min(1, Math.max(0, (curMs - startMs) / Math.max(1, exitMs - startMs)))
        const ret = closedInv > 0 ? (closedGain / closedInv) * 100 : 0
        v = 100 + ret * frac
      } else {
        const baseLevel = exitMs && closedInv > 0 ? 100 + (closedGain / closedInv) * 100 : 100
        const postStartMs = exitMs || startMs
        const frac = Math.min(1, Math.max(0, (curMs - postStartMs) / Math.max(1, endMs - postStartMs)))
        const curRet = btcInv > 0 ? ((btcVal - btcInv) / btcInv) * 100 : 0
        v = baseLevel * (1 + (curRet / 100) * frac)
      }
      pts.push({ as_of: d, v: Math.round(v * 100) / 100 })
    }

    const baseV = pts[0].v || 100
    return pts.map((p) => ({ as_of: p.as_of, v: Math.round(((p.v / baseV) * 100) * 100) / 100 }))
  }

  // When range is 'all' or spans earlier history, build series starting from each sleeve's invested date
  const inSeries = buildEquitySeries('in_equity', null)
  if (inSeries && inSeries.length > 1) index.in_equity = inSeries
  const usSeries = buildEquitySeries('us_equity', null)
  if (usSeries && usSeries.length > 1) index.us_equity = usSeries
  const mfSeries = buildMfSeries(null)
  if (mfSeries && mfSeries.length > 1) index.in_mf = mfSeries
  const goldSeries = buildGoldSeries(null)
  if (goldSeries && goldSeries.length > 1) index.gold = goldSeries
  const btcSeries = buildBtcSeries(null)
  if (btcSeries && btcSeries.length > 1) index.btc = btcSeries
  const ppfSeries = buildPpfSeries(null)
  if (ppfSeries && ppfSeries.length > 1) index.ppf = ppfSeries
  const fdSeries = buildFdSeries(null)
  if (fdSeries && fdSeries.length > 1) index.fd = fdSeries

  // Overall Portfolio curve spanning all active sleeves
  if (Object.keys(index).length > 0) {
    const allDates = new Set()
    for (const sPts of Object.values(index)) {
      for (const p of sPts) allDates.add(p.as_of)
    }
    const sortedDates = [...allDates].sort()
    if (sortedDates.length > 1) {
      const portfolioPts = [{ as_of: sortedDates[0], v: 100 }]
      for (let i = 1; i < sortedDates.length; i++) {
        const d = sortedDates[i]
        let sumV = 0, count = 0
        for (const sPts of Object.values(index)) {
          const match = sPts.find((p) => p.as_of === d) || (sPts[0].as_of <= d ? sPts.filter((p) => p.as_of <= d).at(-1) : null)
          if (match) { sumV += match.v; count++ }
        }
        portfolioPts.push({ as_of: d, v: count ? sumV / count : portfolioPts.at(-1).v })
      }
      totalIndex = portfolioPts
    }
  }

  // Money-weighted return: compute accurate XIRR for each sleeve from trades and deposits
  const flows = sleeveFlows(chain.map(({ c, h }) => ({ date: c.as_of_date, holdings: h })))
  const staleInRange = (s) => (SOURCE_OF[s] || []).some((src) => inRange.some((c) => c.sources[src] === 'stale'))
  const byCheckpoints = {}, allFlows = []
  for (const [s, f] of flows) { byCheckpoints[s] = staleInRange(s) ? null : xirr(f, { minDays: MIN_XIRR_DAYS }); if (!staleInRange(s)) allFlows.push(...f) }
  const byLedger = led.length ? ledgerXirr(led.map(ledgerRow), now, latest.as_of_date) : {}

  const tradeRows = all('SELECT * FROM trades')
  const tradeXirrBySleeve = {}
  for (const s of sleeves) {
    if (s.sleeve === 'ppf' && ppf.deposits.length && s.value) {
      const ppfFlows = ppf.deposits.map((d) => ({ date: d.deposit_date, amount: -Number(d.amount_inr || d.amount) }))
      ppfFlows.push({ date: latest.as_of_date, amount: Number(s.value) })
      const px = xirr(ppfFlows, { minDays: 90 })
      if (px !== null && px !== undefined) tradeXirrBySleeve.ppf = px
    } else if (s.sleeve === 'fd' && fds.length && s.value) {
      const fdFlows = fds.map((f) => ({ date: f.start_date, amount: -Number(f.principal) }))
      fdFlows.push({ date: latest.as_of_date, amount: Number(s.value) })
      const fx = xirr(fdFlows, { minDays: 30 })
      if (fx !== null && fx !== undefined) tradeXirrBySleeve.fd = fx
    } else if (['in_equity', 'us_equity', 'in_mf', 'gold'].includes(s.sleeve) && s.value) {
      const sFlows = []
      for (const t of tradeRows.filter((tr) => tr.sleeve === s.sleeve)) {
        if (t.invested_inr && t.exit_date) {
          const hDays = t.holding_days || 30
          const bDate = new Date(Date.parse(t.exit_date) - hDays * 86400000).toISOString().slice(0, 10)
          sFlows.push({ date: bDate, amount: -Number(t.invested_inr) })
          sFlows.push({ date: t.exit_date, amount: Number(t.invested_inr) + Number(t.realised_inr || 0) })
        }
      }
      for (const h of s.holdings || []) {
        const inv = Number(h.invested_inr || h.invested || 0)
        const bDate = h.buy_date || (cps[0] ? cps[0].as_of_date : latest.as_of_date)
        if (inv > 0) sFlows.push({ date: bDate, amount: -inv })
      }
      sFlows.push({ date: latest.as_of_date, amount: Number(s.value) })
      const sx = xirr(sFlows, { minDays: 60 })
      if (sx !== null && sx !== undefined) tradeXirrBySleeve[s.sleeve] = sx
    }
  }

  for (const s of sleeves) {
    const l = byLedger[s.sleeve], c = byCheckpoints[s.sleeve], t = tradeXirrBySleeve[s.sleeve]
    s.xirr = l !== null && l !== undefined ? { pct: l, basis: 'ledger' }
      : t !== null && t !== undefined ? { pct: t, basis: 'since first trade' }
      : c !== null && c !== undefined ? { pct: c, basis: 'checkpoints' }
      : null
  }

  const combinedAllFlows = []
  for (const s of sleeves) {
    if (s.sleeve === 'ppf') {
      for (const d of ppf.deposits) combinedAllFlows.push({ date: d.deposit_date, amount: -Number(d.amount_inr || d.amount) })
    } else if (s.sleeve === 'fd') {
      for (const f of fds) combinedAllFlows.push({ date: f.start_date, amount: -Number(f.principal) })
    } else if (s.sleeve === 'btc' && led.length) {
      for (const l of led.filter((r) => r.sleeve === 'btc' && r.side === 'buy')) {
        combinedAllFlows.push({ date: l.trade_date, amount: -Number(l.qty) * Number(l.price) * (Number(l.fx_rate) || 1) })
      }
    } else {
      for (const t of tradeRows.filter((tr) => tr.sleeve === s.sleeve)) {
        if (t.invested_inr && t.exit_date) {
          const hDays = t.holding_days || 30
          const bDate = new Date(Date.parse(t.exit_date) - hDays * 86400000).toISOString().slice(0, 10)
          combinedAllFlows.push({ date: bDate, amount: -Number(t.invested_inr) })
          combinedAllFlows.push({ date: t.exit_date, amount: Number(t.invested_inr) + Number(t.realised_inr || 0) })
        }
      }
      for (const h of s.holdings || []) {
        const inv = Number(h.invested_inr || h.invested || 0)
        const bDate = h.buy_date || (cps[0] ? cps[0].as_of_date : latest.as_of_date)
        if (inv > 0) combinedAllFlows.push({ date: bDate, amount: -inv })
      }
    }
  }
  const totalPortVal = sleeves.reduce((sum, s) => sum + Number(s.value || 0), 0)
  if (totalPortVal > 0) combinedAllFlows.push({ date: latest.as_of_date, amount: totalPortVal })
  const xirrTotal = xirr(allFlows, { minDays: MIN_XIRR_DAYS }) || xirr(combinedAllFlows, { minDays: 60 })

  // Compare series: Overall Portfolio + 6 benchmark indices
  const BENCHMARK_META = {
    nifty50: { label: 'Nifty 50', color: '#ffe119', dash: '7 5' },
    nifty_midcap150: { label: 'Nifty Midcap 150', color: '#e6194B', dash: '7 5' },
    nifty_smallcap250: { label: 'Nifty Smallcap 250', color: '#fabed4', dash: '7 5' },
    sp500: { label: 'S&P 500', color: '#fffac8', dash: '2 5' },
    nasdaq100: { label: 'Nasdaq 100', color: '#42d4f4', dash: '2 5' },
    nyse_composite: { label: 'NYSE Composite', color: '#bfef45', dash: '2 5' },
  }
  const compareSeries = []
  if (totalIndex.length > 1) {
    compareSeries.push({
      key: 'portfolio',
      label: 'Overall Portfolio',
      color: '#ffffff',
      dash: '',
      width: 3.4,
      points: totalIndex,
    })
  }
  for (const [k, meta] of Object.entries(BENCHMARK_META)) {
    const raw = HISTORICAL_INDEX[k] || []
    const startD = totalIndex[0] ? totalIndex[0].as_of : '2021-11-01'
    const filtered = raw.filter((p) => p.as_of >= startD)
    if (filtered.length > 1) {
      const baseV = filtered[0].v
      const pts = filtered.map((p) => ({ as_of: p.as_of, v: (p.v / baseV) * 100 }))
      if (!pts.some((p) => p.as_of === latest.as_of_date)) {
        pts.push({ as_of: latest.as_of_date, v: pts.at(-1).v })
      }
      compareSeries.push({
        key: k,
        label: meta.label,
        color: meta.color,
        dash: meta.dash,
        points: pts,
      })
    }
  }
  const compare = { series: compareSeries }

  const total = sleeves.reduce((a, s) => ({ value: a.value + s.value, invested: a.invested + s.invested, unrealised: a.unrealised + s.unrealised }), { value: 0, invested: 0, unrealised: 0 })
  total.return_pct = total.invested ? money((total.unrealised / total.invested) * 100) : null
  total.partial = sleeves.some((s) => s.partial)
  return { as_of: latest.as_of_date, compared_to: compared && compared.as_of_date, checkpoints_in_range: inRange.length, sleeves, total, series, index, xirr: xirrTotal, compare }
}

const ledgerRow = (r) => ({ ...r })

/** Capital gains from the trade ledger: FIFO lots, their terms, a yearly estimate of tax, and
 * every place the ledger disagrees with what the latest checkpoint says you hold. */
export function ledgerView() {
  const rows = ledgerRows()
  if (!rows.length) return null
  const { disposals, unmatched, open } = fifo(rows)
  const latest = latestCheckpoint()
  const mismatches = latest ? reconcile(open, holdingsOf(latest.id)) : []
  return {
    trades: rows.length, from: rows[0].trade_date, to: rows.at(-1).trade_date,
    years: summariseGains(disposals).reverse(),
    disposals: disposals.map((d) => ({ ...d, term: termOf(d) })).sort((a, b) => b.sell_date.localeCompare(a.sell_date)),
    unmatched, mismatches,
  }
}

/** Income, spend, savings rate and runway from Wallet, against today's net worth. */
export function cashflowView() {
  if (!transactionCount()) return null
  const series = networthSeries()
  const latest = series.at(-1)
  return cashflow(transactionsAll(), labelsMap(), { asOf: latest ? latest.as_of_date : null, liquid: latest ? latest.liquid : null, total: latest ? latest.total : null })
}

/** Dividends and interest received over the trailing 12 months, from Wallet. */
export function incomeView() {
  if (!transactionCount()) return null
  const latest = networthSeries().at(-1)
  return investmentIncome(transactionsAll(), { asOf: latest ? latest.as_of_date : null })
}

/** Sales detected between the last two checkpoints. */
export function disposals() {
  const cps = checkpoints()
  if (cps.length < 2) return { between: null, disposals: [] }
  const [a, b] = cps.slice(-2)
  const found = findDisposals(holdingsOf(a.id), holdingsOf(b.id), a.as_of_date, b.as_of_date)
  const recorded = new Set(trades().map((t) => `${t.sleeve}\0${t.symbol}\0${t.exit_date}`))
  return { between: [a.as_of_date, b.as_of_date], disposals: found.filter((d) => !recorded.has(`${d.sleeve}\0${d.symbol}\0${b.as_of_date}`)) }
}

// --- expenses ----------------------------------------------------------------------
export function transactionsAll() { return all('SELECT * FROM transactions ORDER BY txn_date') }
export function labelsMap() {
  const m = new Map()
  for (const r of all('SELECT transaction_id, label FROM transaction_labels')) (m.get(r.transaction_id) || m.set(r.transaction_id, []).get(r.transaction_id)).push(r.label)
  return m
}
export const transactionCount = () => first('SELECT COUNT(*) AS n FROM transactions').n

/** What has been delivered so far, per source (used by the Data page). */
export function connectorStatus() {
  const latest = latestCheckpoint()
  const src = latest ? latest.sources : {}
  const hold = latest ? holdingsOf(latest.id) : []
  const bal = latest ? balancesOf(latest.id) : []
  const has = (s) => hold.some((h) => h.sleeve === s)
  return {
    wallet: { ok: transactionCount() > 0 || bal.some((b) => b.kind === 'cash' || b.kind === 'credit_card'), transactions: transactionCount(), balances: bal.filter((b) => b.kind === 'cash' || b.kind === 'credit_card').length },
    kite: { ok: has('in_equity') || has('in_mf'), equity: hold.filter((h) => h.sleeve === 'in_equity').length, funds: hold.filter((h) => h.sleeve === 'in_mf').length },
    indmoney: { ok: has('us_equity'), us: hold.filter((h) => h.sleeve === 'us_equity').length, epf: bal.filter((b) => b.kind === 'epf').length },
    epf: { ok: bal.some((b) => b.kind === 'epf') },
    btc: { ok: has('btc') || !!manualBtc() },
    coinbase: { ok: hold.some((h) => h.sleeve === 'btc' && h.symbol.endsWith('.coinbase')) },
    binance: { ok: hold.some((h) => h.sleeve === 'btc' && h.symbol.endsWith('.binance')) },
    fd: { ok: fixedDeposits().length > 0 },
    ppf: { ok: ppfDeposits().length > 0 },
    splitwise: { ok: splitwise().length > 0 },
    checkpoint: latest ? latest.as_of_date : null,
  }
}
