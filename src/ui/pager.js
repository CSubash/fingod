// One way to show a long list everywhere: a scrolling body with a sticky header, and a pager
// underneath. A list is identified by `id`, so its page and page size survive a redraw; a list
// whose length changes (a new drill-down, a new range) goes back to page 1 rather than strand
// you on a page that no longer exists.
import { esc } from './format.js'

const SIZES = [10, 25, 50, 100]
const state = new Map() // id -> { page, size, n }

/** rows → { rows: this page's rows, controls: the pager's HTML, wrap: the scrolling container's attributes } */
export function paginate(id, rows, { size = 25 } = {}) {
  const s = state.get(id) || state.set(id, { page: 0, size, n: rows.length }).get(id)
  if (s.n !== rows.length) { s.page = 0; s.n = rows.length }
  const pages = Math.max(1, Math.ceil(rows.length / s.size))
  s.page = Math.min(s.page, pages - 1)
  const from = s.page * s.size
  const controls = rows.length <= Math.min(...SIZES) ? '' : `<div class="pager" data-pager="${esc(id)}">
    <span class="pager-count">${from + 1}–${Math.min(from + s.size, rows.length)} of ${rows.length.toLocaleString('en-IN')}</span><span class="spacer"></span>
    <label class="pager-size">Rows <select data-pg-size>${SIZES.map((n) => `<option value="${n}" ${n === s.size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <button class="btn" data-pg="-1" ${s.page === 0 ? 'disabled' : ''} aria-label="Previous page">‹</button>
    <span class="pager-page">${s.page + 1} / ${pages}</span>
    <button class="btn" data-pg="1" ${s.page >= pages - 1 ? 'disabled' : ''} aria-label="Next page">›</button></div>`
  return { rows: rows.slice(from, from + s.size), controls }
}

/** Wrap a table in the scrolling container. */
export const scrollBox = (table) => `<div class="table-wrap scroll">${table}</div>`

/** Wire the pager buttons inside `root`; `redraw` is whatever repaints the page. */
export function bindPager(root, redraw) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg]'), box = b && b.closest('[data-pager]')
    if (!b || !box || b.disabled) return
    const s = state.get(box.dataset.pager)
    if (s) { s.page += Number(b.dataset.pg); redraw() }
  })
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-pg-size]'), box = sel && sel.closest('[data-pager]')
    const s = box && state.get(box.dataset.pager)
    if (s) { s.size = Number(sel.value); s.page = 0; redraw() }
  })
}
