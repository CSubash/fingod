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
  const endText = ends.map((e) => `<text class="lc-end" data-key="${esc(e.s.id ?? e.s.key ?? e.s.label)}" x="${e.x}" y="${e.y.toFixed(1)}" fill="${e.s.color}" font-size="${fontSize}" style="cursor:pointer">${esc(e.s.endLabel ?? yFormat(e.s.points[e.s.points.length - 1][1]))}</text>`).join('')

  // Each series is a group keyed for the legend, with a wide invisible line on top so a thin line is easy to hover.
  const lines = live.map((s) => {
    const pts = s.points.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`)
    const key = esc(s.id ?? s.key ?? s.label)
    const path = s.points.length > 1
      ? `<polyline class="lc-path" data-key="${key}" points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.4}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} style="cursor:pointer"><title>${esc(s.label)} (click line to toggle)</title></polyline>` +
        `<polyline data-key="${key}" points="${pts.join(' ')}" fill="none" stroke="transparent" stroke-width="14" stroke-linejoin="round" pointer-events="stroke" style="cursor:pointer"/>`
      : ''
    const dots = s.points.map((p) => `<circle data-key="${key}" cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="${s.points.length === 1 ? 4 : 7}" fill="${s.points.length === 1 ? s.color : 'transparent'}" style="cursor:pointer"><title>${esc(s.label)} · ${esc(xFormat ? xFormat(p[0]) : '')} · ${esc(yFormat(p[1]))}</title></circle>`).join('')
    return `<g class="lc-line" data-key="${key}" style="color:${s.color}">${path}${dots}</g>`
  }).join('')
    const dragOverlay = `<g class="drag-overlay" style="display:none;pointer-events:none">
    <rect class="drag-shade" x="0" y="${pad.t}" width="0" height="${height - pad.t - pad.b}" fill="rgba(255, 255, 255, 0.08)"/>
    <line class="drag-line-start" x1="0" x2="0" y1="${pad.t}" y2="${height - pad.b}" stroke="var(--ink)" stroke-dasharray="3 3" stroke-width="1.3"/>
    <line class="drag-line-end" x1="0" x2="0" y1="${pad.t}" y2="${height - pad.b}" stroke="var(--ink)" stroke-dasharray="3 3" stroke-width="1.3"/>
    <circle class="drag-dot-start" cx="0" cy="0" r="4.5" fill="var(--ink)" stroke="var(--bg)" stroke-width="1.5"/>
    <circle class="drag-dot-end" cx="0" cy="0" r="4.5" fill="var(--ink)" stroke="var(--bg)" stroke-width="1.5"/>
  </g>`
  return `<svg viewBox="0 0 ${W} ${height}" data-y-lo="${lo}" data-y-hi="${hi}" data-x-min="${xmin}" data-x-max="${xmax}" data-pad-l="${pad.l}" data-pad-r="${pad.r}" data-pad-t="${pad.t}" data-pad-b="${pad.b}" data-height="${height}" role="img" aria-label="${esc(title)}" style="width:100%;height:auto;display:block;user-select:none;-webkit-user-select:none">${grid}${base}${xl}${lines}${endText}${dragOverlay}</svg>`
}

/** periods: [{period, label, segments: {key: n}}]; keys in stacking order. */
export function stackedBars({ periods, keys, color, height = 300, yFormat = String, title = '', link = true }) {
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
      return `<rect ${link ? `data-period="${esc(p.period)}" data-label="${esc(k)}" ` : ''}x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h - 1, 0.5).toFixed(1)}" fill="${color(k)}"${link ? ' style="cursor:pointer"' : ''}><title>${esc(p.label)} · ${esc(k)} · ${esc(yFormat(v))}</title></rect>`
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
  return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${size}px;height:auto;display:block;margin:0 auto" role="img" aria-label="Allocation">${rings}</svg>`
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


/** A legend whose items toggle their series, and light the matching line on hover or focus.
 * series: [{key, label, color, dash?}]; hidden: Set of keys currently off. */
export function interactiveLegend(series, hidden = new Set()) {
  const items = series.map((s) => {
    const off = hidden.has(s.key)
    return `<button type="button" class="legend-toggle lg${off ? ' off' : ''}" data-key="${esc(s.key)}" data-toggle="${esc(s.key)}" aria-pressed="${!off}" style="--lg-color:${s.color}" title="${off ? 'Show' : 'Hide'} ${esc(s.label)}">` +
      `<i class="swatch" style="background:${s.color}"></i>${esc(s.label)}</button>`
  }).join('')
  return `<div class="legend">${items}${hidden.size ? '<button type="button" class="legend-toggle lg-reset" data-show-all>Show all</button>' : ''}</div>`
}

/** Hovering or focusing a legend item or a line lights both. Wire once on a stable ancestor; it
 * works on anything inside a [data-chart] whose parts carry the same data-key. */
export function bindHighlight(root) {
  const set = (scope, key) => scope.querySelectorAll('[data-key]').forEach((n) => {
    if (n.dataset.disabled === 'true' || n.classList.contains('disabled')) {
      n.classList.remove('glow', 'dim')
      return
    }
    const on = key !== null && n.dataset.key === key
    n.classList.toggle('glow', on)
    n.classList.toggle('dim', key !== null && !on)
  })
  const scopeOf = (n) => n.closest && n.closest('[data-chart]')
  root.addEventListener('mouseover', (e) => {
    const sc = scopeOf(e.target)
    if (!sc) return
    const t = e.target.closest('[data-key]')
    if (!t || t.dataset.disabled === 'true' || t.classList.contains('disabled')) {
      set(sc, null)
      return
    }
    set(sc, t.dataset.key)
  })
  root.addEventListener('mouseout', (e) => {
    const sc = scopeOf(e.target)
    if (sc && !sc.contains(e.relatedTarget)) set(sc, null)
  })
  root.addEventListener('focusin', (e) => {
    const sc = scopeOf(e.target)
    const t = e.target.closest && e.target.closest('[data-key]')
    if (sc && t && t.dataset.disabled !== 'true' && !t.classList.contains('disabled')) set(sc, t.dataset.key)
  })
  root.addEventListener('focusout', (e) => {
    const sc = scopeOf(e.target)
    if (sc) set(sc, null)
  })
}


/** Drag across the chart to measure period and return, exactly like Google Finance. */
export function bindChartDrag(root, seriesData, yFormat = String, xFormat) {
  const svg = root.querySelector('svg[data-y-lo]') || root.querySelector('svg')
  const tooltip = root.querySelector('.drag-tooltip')
  if (!svg || !tooltip || !seriesData || !seriesData.length) return

  const dragOverlay = svg.querySelector('.drag-overlay')
  const dragShade = svg.querySelector('.drag-shade')
  const lineStart = svg.querySelector('.drag-line-start')
  const lineEnd = svg.querySelector('.drag-line-end')
  const dotStart = svg.querySelector('.drag-dot-start')
  const dotEnd = svg.querySelector('.drag-dot-end')

  if (!dragOverlay || !dragShade || !lineStart || !lineEnd || !dotStart || !dotEnd) return

  let isDragging = false
  let startX = 0
  let activeSeriesKey = null

  const getSvgX = (e) => {
    const rect = svg.getBoundingClientRect()
    return ((e.clientX - rect.left) / rect.width) * 900
  }

  const getMeasureSeries = () => {
    if (activeSeriesKey) {
      const match = seriesData.find((s) => (s.id ?? s.key ?? s.label) === activeSeriesKey)
      if (match && match.points && match.points.length >= 2) return match
    }
    const portfolio = seriesData.find((s) => (s.id ?? s.key) === 'portfolio' || s.label === 'Overall Portfolio')
    if (portfolio && portfolio.points && portfolio.points.length >= 2) return portfolio
    return seriesData.find((s) => s.points && s.points.length >= 2)
  }

  svg.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-key]')
    if (el) activeSeriesKey = el.dataset.key
  })

  const padL = Number(svg.dataset.padL || 40)
  const padR = Number(svg.dataset.padR || 80)
  const padT = Number(svg.dataset.padT || 12)
  const padB = Number(svg.dataset.padB || 28)
  const H = Number(svg.dataset.height || 280)
  const plotW = 900 - padL - padR
  const plotH = H - padT - padB
  const lo = Number(svg.dataset.yLo)
  const hi = Number(svg.dataset.yHi)
  const xmin = Number(svg.dataset.xMin)
  const xmax = Number(svg.dataset.xMax)

  svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    const sx = getSvgX(e)
    if (sx < padL || sx > 900 - padR) return
    isDragging = true
    startX = sx
    dragOverlay.style.display = 'none'
    tooltip.style.display = 'none'
  })

  const onMouseMove = (e) => {
    if (!isDragging) return
    const curX = getSvgX(e)
    const clampedCurX = Math.max(padL, Math.min(900 - padR, curX))
    if (Math.abs(clampedCurX - startX) < 4) return

    const x1 = Math.min(startX, clampedCurX)
    const x2 = Math.max(startX, clampedCurX)

    const s = getMeasureSeries()
    if (!s || !s.points || s.points.length < 2) return

    const ms1 = xmin + ((x1 - padL) / plotW) * (xmax - xmin)
    const ms2 = xmin + ((x2 - padL) / plotW) * (xmax - xmin)

    const findNearest = (targetMs) => {
      let best = s.points[0], bestDiff = Math.abs(s.points[0][0] - targetMs)
      for (let i = 1; i < s.points.length; i++) {
        const diff = Math.abs(s.points[i][0] - targetMs)
        if (diff < bestDiff) {
          best = s.points[i]
          bestDiff = diff
        }
      }
      return best
    }

    const pt1 = findNearest(ms1)
    const pt2 = findNearest(ms2)
    if (pt1[0] === pt2[0]) return

    const sx = (x) => padL + (xmax === xmin ? plotW / 2 : ((x - xmin) / (xmax - xmin)) * plotW)
    const sy = (y) => padT + (1 - (y - lo) / (hi - lo || 1)) * plotH

    const px1 = sx(pt1[0])
    const py1 = sy(pt1[1])
    const px2 = sx(pt2[0])
    const py2 = sy(pt2[1])

    const minPx = Math.min(px1, px2)
    const maxPx = Math.max(px1, px2)

    dragShade.setAttribute('x', minPx)
    dragShade.setAttribute('y', padT)
    dragShade.setAttribute('width', maxPx - minPx)
    dragShade.setAttribute('height', plotH)
    dragShade.setAttribute('fill', s.color ? `color-mix(in srgb, ${s.color} 18%, transparent)` : 'rgba(255, 255, 255, 0.08)')

    lineStart.setAttribute('x1', px1)
    lineStart.setAttribute('x2', px1)
    lineStart.setAttribute('y1', padT)
    lineStart.setAttribute('y2', H - padB)

    lineEnd.setAttribute('x1', px2)
    lineEnd.setAttribute('x2', px2)
    lineEnd.setAttribute('y1', padT)
    lineEnd.setAttribute('y2', H - padB)

    dotStart.setAttribute('cx', px1)
    dotStart.setAttribute('cy', py1)
    dotStart.setAttribute('fill', s.color || 'var(--ink)')
    dotStart.setAttribute('stroke', '#ffffff')
    dotStart.setAttribute('stroke-width', '2')
    dotStart.setAttribute('r', '5')

    dotEnd.setAttribute('cx', px2)
    dotEnd.setAttribute('cy', py2)
    dotEnd.setAttribute('fill', s.color || 'var(--ink)')
    dotEnd.setAttribute('stroke', '#ffffff')
    dotEnd.setAttribute('stroke-width', '2')
    dotEnd.setAttribute('r', '5')

    dragOverlay.style.display = ''

    const deltaVal = pt2[1] - pt1[1]
    const deltaPct = pt1[1] > 0 ? ((pt2[1] - pt1[1]) / pt1[1]) * 100 : 0
    const isPos = deltaVal >= 0

    const formatDragDate = (ms) => {
      const d = new Date(ms)
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
    }

    const d1Str = formatDragDate(pt1[0])
    const d2Str = formatDragDate(pt2[0])

    const sign = isPos ? '+' : '-'
    const arrow = isPos ? '↑' : '↓'
    const diffVal = `${sign}${Math.abs(deltaVal).toFixed(2)}`
    const diffPct = `(${Math.abs(deltaPct).toFixed(2)}%)`

    tooltip.innerHTML = `<span style="color:${isPos ? 'var(--good)' : 'var(--critical)'};font-weight:600">${diffVal} ${diffPct} ${arrow}</span><span style="color:var(--ink-2);margin-left:8px">${d1Str}-${d2Str}</span>${s.label && s.label !== 'Overall Portfolio' ? `<span style="font-size:11px;color:${s.color || 'var(--ink)'};margin-left:6px">(${esc(s.label)})</span>` : ''}`
    tooltip.style.display = 'inline-flex'

    const rect = svg.getBoundingClientRect()
    const pctMid = ((px1 + px2) / 2) / 900
    const pixelLeft = pctMid * rect.width
    tooltip.style.left = `${Math.max(140, Math.min(rect.width - 140, pixelLeft))}px`
  }

  const onMouseUp = (e) => {
    if (!isDragging) return
    isDragging = false
    const curX = getSvgX(e)
    if (Math.abs(curX - startX) < 6) {
      dragOverlay.style.display = 'none'
      tooltip.style.display = 'none'
    }
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
