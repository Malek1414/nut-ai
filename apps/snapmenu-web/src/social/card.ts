// The preview picture of a share link: 1200x630, the size messengers show large.
// Drawn on the sharer's phone from the engine's numbers and the brand constant, then stored with the link.
import { BRAND, brandWordmark, taglineParts } from '../../../snapmenu-api/src/brand'
import { n0 } from '../lib/format'
import type { ShareItem } from './client'

const W = 1200
const H = 630
const DISPLAY = "'Bricolage Grotesque', system-ui, sans-serif"
const TEXT = "'Manrope', system-ui, sans-serif"

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Text as lines that fit `maxW`, at most `maxLines`, the last one cut with an ellipsis. */
function lines(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word
    if (g.measureText(test).width <= maxW || !line) { line = test; continue }
    out.push(line)
    line = word
    if (out.length === maxLines) break
  }
  if (out.length < maxLines && line) out.push(line)
  const cut = out.length === maxLines && text.split(/\s+/).filter(Boolean).join(' ') !== out.join(' ')
  let last = out[out.length - 1] ?? ''
  if (cut) last = `${last}…`
  while (last.length > 1 && g.measureText(last).width > maxW) last = `${last.slice(0, -2).trimEnd()}…`
  if (out.length) out[out.length - 1] = last
  return out
}

/** The largest size from `sizes` at which `text` fits in `maxLines` lines without being cut. Falls back to the smallest. */
function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, sizes: number[], maxW: number, maxLines: number): { px: number; rows: string[] } {
  for (const px of sizes) {
    g.font = font(px)
    const rows = lines(g, text, maxW, maxLines)
    if (!rows[rows.length - 1]?.endsWith('…')) return { px, rows }
  }
  const px = sizes[sizes.length - 1]!
  g.font = font(px)
  return { px, rows: lines(g, text, maxW, maxLines) }
}

function wordmark(g: CanvasRenderingContext2D, x: number, y: number) {
  // The logo mark: a menu page with a scan line.
  g.fillStyle = '#F2B33D'
  roundRect(g, x, y, 56, 56, 15)
  g.fill()
  g.fillStyle = '#F3F5EF'
  roundRect(g, x + 17, y + 11, 22, 34, 5)
  g.fill()
  g.fillStyle = '#F2B33D'
  g.fillRect(x + 11, y + 26, 34, 5)
  g.font = `800 40px ${DISPLAY}`
  g.fillStyle = '#F3F5EF'
  g.textBaseline = 'alphabetic'
  g.fillText(brandWordmark(), x + 72, y + 41)
}

function background(g: CanvasRenderingContext2D) {
  g.fillStyle = '#123F2E'
  g.fillRect(0, 0, W, H)
  const glow = g.createRadialGradient(W * 0.86, H * 0.05, 30, W * 0.86, H * 0.05, 760)
  glow.addColorStop(0, 'rgba(242,179,61,0.22)')
  glow.addColorStop(1, 'rgba(242,179,61,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, W, H)
}

/** Draws the card and returns it as a JPEG data URL, small enough to store with the link. */
export async function renderLinkCard(item: ShareItem): Promise<string> {
  try {
    await Promise.all([document.fonts.load(`800 72px ${DISPLAY}`), document.fonts.load(`700 30px ${TEXT}`), document.fonts.ready])
  } catch { /* fonts optional: the system face still draws a clean card */ }
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas')
  background(g)
  wordmark(g, 64, 56)

  const tagline = taglineParts()[0] ?? BRAND.tagline
  g.font = `700 26px ${TEXT}`
  g.fillStyle = 'rgba(243,245,239,0.62)'
  g.fillText(tagline, 64, H - 56)

  if (item.kind === 'place') {
    const p = item.place
    g.font = `700 30px ${TEXT}`
    g.fillStyle = '#F2B33D'
    g.fillText('A place to try', 64, 232)
    const name = fit(g, p.name, (px) => `800 ${px}px ${DISPLAY}`, [96, 84, 72, 60], W - 128, 2)
    g.fillStyle = '#FFFFFF'
    let y = 232 + name.px * 1.08
    for (const row of name.rows) { g.fillText(row, 64, y); y += name.px * 1.06 }
    const meta = [p.cuisine?.replace(/[_;]/g, ' '), p.address].filter(Boolean).join(' · ')
    if (meta) {
      g.font = `600 32px ${TEXT}`
      g.fillStyle = 'rgba(243,245,239,0.78)'
      g.fillText(lines(g, meta, W - 128, 1)[0] ?? '', 64, y + 6)
    }
    return c.toDataURL('image/jpeg', 0.86)
  }

  const d = item.dish
  const where = item.place?.name ?? item.restaurant
  const left = 64
  const colW = 600

  g.font = `700 30px ${TEXT}`
  g.fillStyle = '#F2B33D'
  const eyebrow = item.kind === 'pick' ? (where ? `My pick at ${where}` : 'My pick') : where ? `At ${where}` : 'On the menu'
  g.fillText(lines(g, eyebrow, colW, 1)[0] ?? '', left, 214)

  const name = fit(g, d.name, (px) => `800 ${px}px ${DISPLAY}`, [84, 72, 62, 54], colW, 3)
  g.fillStyle = '#FFFFFF'
  let y = 214 + name.px * 1.1
  for (const row of name.rows) { g.fillText(row, left, y); y += name.px * 1.06 }
  if (d.translated && d.translated.toLowerCase() !== d.name.toLowerCase() && y < H - 110) {
    g.font = `600 30px ${TEXT}`
    g.fillStyle = 'rgba(243,245,239,0.74)'
    g.fillText(lines(g, d.translated, colW, 1)[0] ?? '', left, y - name.px * 0.06 + 14)
  }

  // The numbers card: the range, never one point.
  const cx = 716, cy = 150, cw = 420, ch = 372
  g.fillStyle = '#F3F5EF'
  roundRect(g, cx, cy, cw, ch, 40)
  g.fill()
  g.fillStyle = '#6B776F'
  g.font = `700 21px ${TEXT}`
  g.fillText('ENERGY, AS A RANGE', cx + 36, cy + 62)
  const kcal = `${n0(d.kcal.low)}–${n0(d.kcal.high)}`
  // `fit` leaves the canvas on the size it chose.
  fit(g, kcal, (px) => `800 ${px}px ${DISPLAY}`, [92, 80, 68], cw - 72 - 74, 1)
  g.fillStyle = '#14221B'
  g.fillText(kcal, cx + 32, cy + 158)
  const kw = g.measureText(kcal).width
  g.font = `700 30px ${TEXT}`
  g.fillStyle = '#6B776F'
  g.fillText('kcal', cx + 44 + kw, cy + 158)

  const tx = cx + 36, tw = cw - 72, ty = cy + 192
  g.fillStyle = '#E1E6DB'
  roundRect(g, tx, ty, tw, 18, 9)
  g.fill()
  const px = (v: number) => tx + Math.min(1, v / 1500) * tw
  g.fillStyle = '#6553CF'
  roundRect(g, px(d.kcal.low), ty, Math.max(18, px(d.kcal.high) - px(d.kcal.low)), 18, 9)
  g.fill()
  g.fillStyle = '#14221B'
  roundRect(g, px(d.kcal.mid) - 3, ty - 7, 6, 32, 3)
  g.fill()

  // Protein, carbs and fat as three cells, like the dish screen.
  const cells: Array<[string, number, string, string]> = [
    ['Protein', d.protein.mid, '#E5EBFB', '#22408F'],
    ['Carbs', d.carbs.mid, '#FBEEDB', '#7D4F07'],
    ['Fat', d.fat.mid, '#F9E3EA', '#8E2547'],
  ]
  const gw = (tw - 20) / 3
  cells.forEach(([label, v, bg, fg], i) => {
    const x = tx + i * (gw + 10)
    g.fillStyle = bg
    roundRect(g, x, cy + 240, gw, 96, 18)
    g.fill()
    g.fillStyle = fg
    g.font = `700 19px ${TEXT}`
    g.fillText(label, x + 14, cy + 273)
    g.font = `800 32px ${DISPLAY}`
    g.fillText(`${n0(v)} g`, x + 14, cy + 316)
  })

  if (item.goal) {
    g.font = `700 26px ${TEXT}`
    g.fillStyle = '#F2B33D'
    const label = `Picked for: ${item.goal}`
    g.fillText(label, W - 64 - g.measureText(label).width, H - 56)
  }
  return c.toDataURL('image/jpeg', 0.86)
}
