// Charts as SVG strings. No library: a line chart, stacked bars, a donut and a
// sparkline cover everything the app draws. Colours come from CSS variables, so
// both themes work, and every mark carries a <title> so hovering names it.
import { esc, money } from './format.js'

const W = 900
const mono = 'font-family:inherit'

function niceTicks(min, max, n = 4) {
  if (min === max) { max = min + 1 }
  const step0 = (max - min) / n
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

/** series: [{label, color, points: [[ms, y], ...]}]  x is epoch ms. */
export function lineChart({ series, height = 280, yFormat = String, xFormat, zeroBased = false, baseline = null, labelEnds = true, title = '', fontSize = 11.5 }) {
  const live = series.filter((s) => s.points.length)
  if (!live.length) return ''
  const pad = { l: fontSize > 12 ? 72 : 62, r: labelEnds ? (fontSize > 12 ? 90 : 74) : 16, t: 12, b: fontSize > 12 ? 32 : 28 }
  const all = live.flatMap((s) => s.points)
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
  let ymin = Math.min(...ys), ymax = Math.max(...ys)
  if (zeroBased) ymin = Math.min(0, ymin)
  if (baseline !== null) { ymin = Math.min(ymin, baseline); ymax = Math.max(ymax, baseline) }
  const ticks = niceTicks(ymin, ymax, 4)
  const lo = ticks[0], hi = ticks[ticks.length - 1]
  const xmin = Math.min(...xs), xmax = Math.max(...xs)
  const sx = (x) => pad.l + (xmax === xmin ? (W - pad.l - pad.r) / 2 : ((x - xmin) / (xmax - xmin)) * (W - pad.l - pad.r))
  const sy = (y) => pad.t + (1 - (y - lo) / (hi - lo || 1)) * (height - pad.t - pad.b)

  const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--gridline)"/>` +
    `<text x="${pad.l - 8}" y="${sy(t) + 4}" text-anchor="end" fill="var(--muted)" font-size="${fontSize}" style="${mono}">${esc(yFormat(t))}</text>`).join('')
  const base = baseline !== null ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(baseline)}" y2="${sy(baseline)}" stroke="var(--baseline)" stroke-dasharray="3 4"/>` : ''

  const MIN_GAP = 84
  const uniq = [...new Set(xs)].sort((a, b) => a - b)
  const kept = []
  for (const x of uniq) if (!kept.length || sx(x) - sx(kept[kept.length - 1]) >= MIN_GAP) kept.push(x)
  const lastX = uniq[uniq.length - 1]
  if (kept[kept.length - 1] !== lastX) {
    if (kept.length > 1 && sx(lastX) - sx(kept[kept.length - 1]) < MIN_GAP) kept.pop()
    kept.push(lastX)
  }
  const xl = kept.map((x) => `<text x="${sx(x)}" y="${height - 8}" text-anchor="middle" fill="var(--muted)" font-size="${fontSize}">${esc(xFormat ? xFormat(x) : '')}</text>`).join('')

  const LABEL_GAP = fontSize > 12 ? 18 : 13.5
  const ends = labelEnds ? live.map((s) => { const last = s.points[s.points.length - 1]; return { s, x: sx(last[0]) + 8, y: sy(last[1]) + 4 } }).sort((a, b) => a.y - b.y) : []
  for (let i = 0; i < ends.length; i++) { const min = i ? ends[i - 1].y + LABEL_GAP : pad.t + 6; if (ends[i].y < min) ends[i].y = min }
  for (let i = ends.length - 1; i >= 0; i--) { const max = i < ends.length - 1 ? ends[i + 1].y - LABEL_GAP : height - pad.b; if (ends[i].y > max) ends[i].y = max }
  const endText = ends.map((e) => `<text ${e.s.id ? `data-series-toggle="${e.s.id}"` : ''} x="${e.x}" y="${e.y.toFixed(1)}" fill="${e.s.color}" font-size="${fontSize}" style="cursor:pointer">${esc(e.s.endLabel ?? yFormat(e.s.points[e.s.points.length - 1][1]))}</text>`).join('')

  const lines = live.map((s) => {
    const pts = s.points.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`)
    const path = s.points.length > 1 ? `<polyline ${s.id ? `data-series-toggle="${s.id}"` : ''} points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" style="cursor:pointer"><title>${esc(s.label)} (click line to toggle)</title></polyline>` : ''
    const dots = s.points.map((p) => `<circle ${s.id ? `data-series-toggle="${s.id}"` : ''} cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="${s.points.length === 1 ? 4 : 8}" fill="${s.points.length === 1 ? s.color : 'transparent'}" style="cursor:pointer"><title>${esc(s.label)} · ${esc(xFormat ? xFormat(p[0]) : '')} · ${esc(yFormat(p[1]))} (click line to toggle)</title></circle>`).join('')
    return path + dots
  }).join('')
  return `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}" style="width:100%;height:auto;display:block">${grid}${base}${xl}${lines}${endText}</svg>`
}

/** periods: [{period, label, segments: {key: n}}]; keys in stacking order. */
export function stackedBars({ periods, keys, color, height = 300, yFormat = String, title = '' }) {
  if (!periods.length) return ''
  const pad = { l: 62, r: 12, t: 12, b: 28 }
  const totals = periods.map((p) => keys.reduce((s, k) => s + (p.segments[k] || 0), 0))
  const ticks = niceTicks(0, Math.max(...totals, 1), 4)
  const hi = ticks[ticks.length - 1]
  const bw = (W - pad.l - pad.r) / periods.length
  const sy = (v) => pad.t + (1 - v / hi) * (height - pad.t - pad.b)
  const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}" stroke="${t === 0 ? 'var(--baseline)' : 'var(--gridline)'}"/>` +
    `<text x="${pad.l - 8}" y="${sy(t) + 4}" text-anchor="end" fill="var(--muted)" font-size="11.5">${esc(yFormat(t))}</text>`).join('')
  const step = Math.ceil(periods.length / 12)
  const bars = periods.map((p, i) => {
    const w = Math.min(bw * 0.68, 64), x = pad.l + i * bw + (bw - w) / 2
    let acc = 0
    const segs = keys.filter((k) => p.segments[k] > 0).map((k) => {
      const v = p.segments[k], y0 = sy(acc + v), h = sy(acc) - y0
      acc += v
      return `<rect data-period="${esc(p.period)}" data-label="${esc(k)}" x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h - 1, 0.5).toFixed(1)}" fill="${color(k)}" style="cursor:pointer"><title>${esc(p.label)} · ${esc(k)} · ${esc(yFormat(v))}</title></rect>`
    }).join('')
    const lab = i % step === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="var(--muted)" font-size="11.5">${esc(p.label)}</text>` : ''
    return segs + lab
  }).join('')
  return `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}" style="width:100%;height:auto;display:block">${grid}${bars}</svg>`
}

/** rows: [{key, value, color}] */
export function donut({ rows, size = 240, thickness = 30 }) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!total) return ''
  const r = (size - thickness) / 2, c = 2 * Math.PI * r, mid = size / 2
  let offset = 0
  const rings = rows.filter((d) => d.value > 0).map((d) => {
    const frac = d.value / total, dash = frac * c, gap = c - dash, off = offset
    offset -= dash
    return `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${thickness}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"><title>${esc(d.key)} · ${money(d.value)} · ${(frac * 100).toFixed(1)}%</title></circle>`
  }).join('')
  return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;display:block">${rings}</svg>`
}

export function sparkline(values, color = 'var(--sleeve-in_equity)', height = 44) {
  if (values.length < 2) return ''
  const w = 400, min = Math.min(...values), max = Math.max(...values)
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(height - 4 - ((v - min) / (max - min || 1)) * (height - 8)).toFixed(1)}`).join(' ')
  return `<svg viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" style="width:100%;height:${height}px;display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`
}

/** Fractions → a labelled proportion bar. */
export function proportionBar(rows) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  if (!total) return ''
  return `<div class="proportion-bar">${rows.filter((r) => r.value > 0).map((r) => `<span class="seg" title="${esc(r.label)}" style="width:${(r.value / total) * 100}%;background:${r.color}"></span>`).join('')}</div>`
}
