import { BRAND } from '../brand.js'
import type { D1Like } from '../d1-adapter.js'
import type { Range } from '../types.js'
import type { SharedDish, SharedPlace, ShareKind, ShareView } from './types.js'
import { saySocial } from './copy.js'
import { isShareId, sharePath } from './links.js'
import { bad, logSocial, recentCount, SOCIAL_LIMITS, type Out } from './schema.js'

/**
 * Friend sharing: a dish, a pick or a restaurant as a short link.
 *
 * The link opens the app straight to what was shared, and a messenger shows it
 * with a rich preview: the Worker answers /s/<id> with OpenGraph tags and the
 * preview picture the sharer's phone drew.
 *
 * What a link carries is a snapshot of numbers the Nut AI engine computed on
 * the sharer's scan. Nothing here is written by a model, and everything that
 * comes in is cut to plain, bounded fields before it is stored.
 */

const MAX_IMAGE = 420_000
const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return [...bytes].map((b) => (b % 36).toString(36)).join('')
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

function range(v: unknown, max: number): Range | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const low = Number(r['low']), high = Number(r['high']), mid = Number(r['mid'])
  if (![low, high, mid].every((n) => Number.isFinite(n) && n >= 0 && n <= max)) return null
  if (low > mid || mid > high) return null
  return { low: Math.round(low), high: Math.round(high), mid: Math.round(mid) }
}

export function cleanDish(v: unknown): SharedDish | null {
  if (!v || typeof v !== 'object') return null
  const d = v as Record<string, unknown>
  const name = text(d['name'], 120)
  const kcal = range(d['kcal'], 6000), protein = range(d['protein'], 600), carbs = range(d['carbs'], 1000), fat = range(d['fat'], 600)
  if (!name || !kcal || !protein || !carbs || !fat) return null
  const translated = text(d['translated'], 120)
  return {
    name,
    translated: translated && translated.toLowerCase() !== name.toLowerCase() ? translated : null,
    description: text(d['description'], 200),
    kcal, protein, carbs, fat,
    bandTier: text(d['bandTier'], 16) ?? 'wide',
    why: text(d['why'], 240),
    price: text(d['price'], 24),
    vegetarian: d['vegetarian'] === true,
    vegan: d['vegan'] === true,
    allergens: (Array.isArray(d['allergens']) ? d['allergens'] : []).map((a) => text(a, 40)).filter((a): a is string => Boolean(a)).slice(0, 14),
  }
}

export function cleanPlace(v: unknown): SharedPlace | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const id = typeof p['id'] === 'string' && /^[nwr]\d{1,15}$/.test(p['id']) ? p['id'] : null
  const name = text(p['name'], 80)
  const lat = Number(p['lat']), lng = Number(p['lng'])
  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { id, name, lat, lng, cuisine: text(p['cuisine'], 60), address: text(p['address'], 120) }
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-US')

/** The two lines a messenger shows next to the picture. Language-neutral on purpose: names and the engine's numbers. */
export function shareWords(s: Pick<ShareView, 'kind' | 'dish' | 'place' | 'restaurant'>): { title: string; summary: string } {
  const where = s.place?.name ?? s.restaurant
  if (s.dish) {
    const nums = `${n0(s.dish.kcal.low)}–${n0(s.dish.kcal.high)} kcal · ${n0(s.dish.protein.mid)} g protein`
    return { title: where ? `${s.dish.name} · ${where}` : s.dish.name, summary: `${nums} · ${BRAND.name}` }
  }
  const about = [s.place?.cuisine, s.place?.address].filter(Boolean).join(' · ')
  return { title: where ?? BRAND.name, summary: about ? `${about} · ${BRAND.name}` : BRAND.tagline }
}

export interface Sharer { device: string | null; team: boolean; lang?: string | undefined }

export async function createShare(db: D1Like, body: Record<string, unknown>, who: Sharer): Promise<Out<{ id: string; path: string; title: string; summary: string }>> {
  const kind: ShareKind | null = body['kind'] === 'dish' || body['kind'] === 'pick' || body['kind'] === 'place' ? body['kind'] : null
  const dish = cleanDish(body['dish'])
  const place = cleanPlace(body['place'])
  if (!kind || (kind === 'place' ? !place : !dish)) return bad(400, 'bad_share', saySocial(who.lang, 'share_failed'))

  const { max, windowMs } = SOCIAL_LIMITS.share
  if ((await recentCount(db, 'share_link', who.device, Date.now() - windowMs)) >= max) return bad(429, 'rate_limited', saySocial(who.lang, 'slow'))

  let image: string | null = null
  if (typeof body['image'] === 'string' && body['image']) {
    // A picture that is too big or not a picture is left out: the link still works, with the app's own preview.
    if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body['image']) && body['image'].length <= MAX_IMAGE) image = body['image']
  }

  const view = { kind, dish: kind === 'place' ? null : dish, place, restaurant: text(body['restaurant'], 80), goal: text(body['goal'], 40) }
  const { title, summary } = shareWords(view)
  const id = newId()
  const ts = Date.now()
  await db.prepare('INSERT INTO shares (id, ts, device, team, kind, title, summary, payload, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, ts, who.device, who.team ? 1 : 0, kind, title, summary, JSON.stringify(view), image)
    .run()
  await logSocial(db, 'share_link', who.device, who.team, { kind, image: Boolean(image) })
  return { ok: true, data: { id, path: sharePath(id), title, summary } }
}

interface ShareRow { id: string; ts: number; kind: string; title: string; summary: string; payload: string; has_image: number }

export async function getShare(db: D1Like, id: unknown): Promise<(ShareView & { title: string; summary: string }) | null> {
  if (!isShareId(id)) return null
  const row = await db.prepare('SELECT id, ts, kind, title, summary, payload, (image IS NOT NULL) AS has_image FROM shares WHERE id = ?').bind(id).first<ShareRow>()
  if (!row) return null
  let p: Record<string, unknown>
  try { p = JSON.parse(row.payload) as Record<string, unknown> } catch { return null }
  return {
    id: row.id, ts: row.ts, kind: row.kind as ShareKind, title: row.title, summary: row.summary,
    dish: cleanDish(p['dish']), place: cleanPlace(p['place']), restaurant: text(p['restaurant'], 80), goal: text(p['goal'], 40),
    hasImage: Boolean(row.has_image),
  }
}

/** The preview picture of a share, as bytes. */
export async function shareImage(db: D1Like, id: unknown): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!isShareId(id)) return null
  const row = await db.prepare('SELECT image FROM shares WHERE id = ?').bind(id).first<{ image: string | null }>()
  const m = row?.image ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(row.image) : null
  if (!m) return null
  const bin = atob(m[2]!)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, type: m[1]! }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * The page behind a share link. A messenger reads its OpenGraph tags for the
 * preview; a person's browser is sent on to the app, which opens the shared
 * thing. An unknown id gets the app's own preview and lands on the start page.
 */
export function sharePage(origin: string, share: (ShareView & { title: string; summary: string }) | null, id: string | null): string {
  const known = share && id && isShareId(id)
  const title = known ? share.title : BRAND.name
  const summary = known ? share.summary : BRAND.tagline
  const url = known ? `${origin}${sharePath(id)}` : `${origin}/`
  const image = known && share.hasImage ? `${origin}/api/share/${id}.jpg` : `${origin}/og.png`
  const open = known ? `/?s=${id}` : '/'
  const tags = [
    `<title>${esc(title)} · ${esc(BRAND.name)}</title>`,
    `<meta name="description" content="${esc(summary)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${esc(BRAND.name)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(summary)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(title)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(summary)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
  ]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${tags.join('\n')}
<meta http-equiv="refresh" content="0; url=${open}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:${BRAND.background};color:#14221b;font:600 17px system-ui,sans-serif}a{color:${BRAND.accent}}</style>
</head>
<body>
<p><a href="${open}">Open in ${esc(BRAND.name)}</a></p>
<script>location.replace(${JSON.stringify(open)})</script>
</body>
</html>
`
}

export type { SharedDish, SharedPlace, ShareKind, ShareView }
