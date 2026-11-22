import { BRAND, brandFile, brandWordmark, taglineParts } from '../../../snapmenu-api/src/brand'
import type { DishEstimate } from '../../../snapmenu-api/src/types'
import { n0 } from './format'

/** Renders a 1080x1920 story card: "My best order: 620-720 kcal, 48 g protein". */
export async function renderShareCard(d: DishEstimate, restaurant: string | null, goalLabel: string): Promise<Blob> {
  try { await document.fonts.ready } catch { /* fonts optional */ }
  const W = 1080, H = 1920
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const D = "'Bricolage Grotesque', system-ui, sans-serif"
  const T = "'Manrope', system-ui, sans-serif"

  // Background: deep basil with a soft light pool.
  g.fillStyle = '#123F2E'
  g.fillRect(0, 0, W, H)
  const rg = g.createRadialGradient(W * 0.8, H * 0.12, 50, W * 0.8, H * 0.12, 1100)
  rg.addColorStop(0, 'rgba(242,179,61,0.18)')
  rg.addColorStop(1, 'rgba(242,179,61,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, W, H)

  const wrap = (text: string, x: number, y: number, maxW: number, lh: number, maxLines = 3) => {
    const words = text.split(' ')
    let line = ''
    let lines = 0
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, x, y)
        y += lh
        line = w
        if (++lines >= maxLines - 1) { /* last line */ }
      } else line = test
    }
    g.fillText(line, x, y)
    return y + lh
  }

  // Wordmark
  g.fillStyle = '#F2B33D'
  roundRect(g, 96, 120, 72, 72, 20)
  g.fill()
  g.fillStyle = '#F3F5EF'
  roundRect(g, 117, 134, 30, 44, 6)
  g.fill()
  g.fillStyle = '#F2B33D'
  g.fillRect(110, 152, 44, 6)
  g.font = `800 54px ${D}`
  g.fillStyle = '#F3F5EF'
  g.fillText(brandWordmark(), 192, 174)

  g.font = `700 40px ${T}`
  g.fillStyle = 'rgba(243,245,239,0.7)'
  g.fillText(restaurant ? `My best order at ${restaurant}` : 'My best order tonight', 96, 420)

  g.font = `800 112px ${D}`
  g.fillStyle = '#FFFFFF'
  let y = wrap(d.name, 96, 560, W - 192, 118, 3)
  if (d.translated && d.translated.toLowerCase() !== d.name.toLowerCase()) {
    g.font = `600 40px ${T}`
    g.fillStyle = 'rgba(243,245,239,0.7)'
    y = wrap(d.translated, 96, y - 30, W - 192, 52, 2) + 20
  }

  // The numbers card
  const cardY = Math.max(y + 40, 980)
  g.fillStyle = '#F3F5EF'
  roundRect(g, 72, cardY, W - 144, 560, 56)
  g.fill()
  g.fillStyle = '#44524A'
  g.font = `700 34px ${T}`
  g.fillText('ENERGY, AS A RANGE', 132, cardY + 96)
  g.fillStyle = '#14221B'
  g.font = `800 150px ${D}`
  const kcal = `${n0(d.kcal.low)}–${n0(d.kcal.high)}`
  g.fillText(kcal, 126, cardY + 250)
  const kw = g.measureText(kcal).width
  g.font = `700 44px ${T}`
  g.fillStyle = '#6B776F'
  g.fillText('kcal', 140 + kw, cardY + 250)

  // range track
  const tx = 132, tw = W - 264, ty = cardY + 300
  g.fillStyle = '#E7EBE1'
  roundRect(g, tx, ty, tw, 26, 13)
  g.fill()
  const px = (v: number) => tx + Math.min(1, v / 1500) * tw
  g.fillStyle = '#6553CF'
  roundRect(g, px(d.kcal.low), ty, Math.max(26, px(d.kcal.high) - px(d.kcal.low)), 26, 13)
  g.fill()
  g.fillStyle = '#14221B'
  roundRect(g, px(d.kcal.mid) - 5, ty - 10, 10, 46, 5)
  g.fill()

  // macro pills
  const pills: Array<[string, string, string]> = [
    [`${n0(d.protein.mid)} g protein`, '#E5EBFB', '#22408F'],
    [`${n0(d.carbs.mid)} g carbs`, '#FBEEDB', '#7D4F07'],
    [`${n0(d.fat.mid)} g fat`, '#F9E3EA', '#8E2547'],
  ]
  let pxp = 132
  g.font = `800 38px ${T}`
  for (const [t, bg, fg] of pills) {
    const w = g.measureText(t).width + 56
    g.fillStyle = bg
    roundRect(g, pxp, cardY + 400, w, 84, 42)
    g.fill()
    g.fillStyle = fg
    g.fillText(t, pxp + 28, cardY + 455)
    pxp += w + 16
  }

  g.font = `700 40px ${T}`
  g.fillStyle = '#F2B33D'
  g.fillText(`Picked for: ${goalLabel}`, 96, cardY + 660)
  g.font = `600 34px ${T}`
  g.fillStyle = 'rgba(243,245,239,0.72)'
  g.fillText('Ranges from USDA and Open Food Facts data,', 96, H - 220)
  g.fillText('computed by the open-source Nut AI engine.', 96, H - 170)
  g.font = `800 40px ${D}`
  g.fillStyle = '#FFFFFF'
  g.fillText(`${taglineParts()[0] ?? BRAND.tagline} ${brandWordmark()}`, 96, H - 96)

  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'))
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Native share sheet with the image when the phone supports it; download otherwise. */
export async function shareCard(blob: Blob, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], brandFile('best-order.png'), { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = brandFile('best-order.png')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}
