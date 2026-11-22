import { BRAND } from '../brand.js'
import { cleanUrl, isShortLink, platformOf, safeUrl, type Platform } from './links.js'

/**
 * What a link says about itself in public: the preview a messenger would show.
 *
 * Only two polite sources are read, both made for exactly this:
 *   - oEmbed, where a platform offers it without a login (YouTube, TikTok);
 *   - the page's own OpenGraph tags and JSON-LD, fetched once like any link
 *     preview does.
 * Nothing is fetched behind a login, no wall is worked around and no page is
 * crawled. When a platform does not answer (Instagram and Facebook usually send
 * a login page), the link is "blocked" and the person is asked what the meal is.
 */

export interface LinkMeta {
  platform: Platform
  /** The link without tracking parameters. */
  url: string
  title: string | null
  description: string | null
  author: string | null
  site: string | null
  /** The preview picture, an absolute https link, when the source names one. */
  image: string | null
  /** What a recipe or restaurant page states about itself (JSON-LD), as short text. */
  extra: string | null
  via: 'oembed' | 'opengraph'
}

export type MetaFailure = 'blocked' | 'not_found' | 'unreachable'
export type MetaOut = { ok: true; meta: LinkMeta } | { ok: false; platform: Platform; url: string; reason: MetaFailure }

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Says who is asking. No contact details: this is a one-off preview fetch a person asked for, not a crawler. */
export const USER_AGENT = `${BRAND.name}/1.0 (link preview)`

const MAX_HTML = 400_000
const TIMEOUT_MS = 7000
const MAX_HOPS = 4

const clip = (s: unknown, max: number): string | null => {
  if (typeof s !== 'string') return null
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' }
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      try { return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m } catch { return m }
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/** Where a platform sends a visitor it wants to log in or to consent first. */
const isWallUrl = (u: URL): boolean => /^\/(?:accounts\/login|login|checkpoint)(?:[/.]|$)/i.test(u.pathname) || /^consent\./i.test(u.hostname)

/** A fetch that follows redirects by hand, so every hop is checked like the first link was. */
async function fetchPublic(start: URL, doFetch: FetchLike, accept: string): Promise<{ res: Response; url: URL } | MetaFailure> {
  let url = start
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res: Response
    try {
      res = await doFetch(url.toString(), {
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en;q=0.9,*;q=0.5' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return 'unreachable'
    }
    if (res.status >= 300 && res.status < 400) {
      const next = safeUrl(absolute(res.headers.get('location'), url))
      try { await res.body?.cancel() } catch { /* nothing to cancel */ }
      if (!next) return 'blocked'
      // A redirect to a login or consent page is a wall, not the post.
      if (isWallUrl(next)) return 'blocked'
      url = next
      continue
    }
    if (res.status === 404 || res.status === 410) return 'not_found'
    if (!res.ok) return res.status >= 500 ? 'unreachable' : 'blocked'
    return { res, url }
  }
  return 'blocked'
}

function absolute(href: string | null | undefined, base: URL): string | null {
  if (!href) return null
  try { return new URL(href, base).toString() } catch { return null }
}

/** The start of a page as text: OpenGraph lives in <head>, so reading stops there (or at the size cap). */
async function readHead(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_HTML)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (html.length >= MAX_HTML) break
    }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
  return html.slice(0, MAX_HTML)
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag)
  return m ? m[1] ?? m[2] ?? m[3] ?? null : null
}

/** A JSON-LD node as one short line: a recipe's name and ingredients, a restaurant's name and town, a menu item. */
function describeLd(node: unknown, out: string[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 3 || out.length >= 6) return
  if (Array.isArray(node)) { for (const n of node.slice(0, 12)) describeLd(n, out, depth + 1); return }
  const o = node as Record<string, unknown>
  if (Array.isArray(o['@graph'])) describeLd(o['@graph'], out, depth + 1)
  const types = (Array.isArray(o['@type']) ? o['@type'] : [o['@type']]).filter((t): t is string => typeof t === 'string')
  const name = clip(o['name'], 120)
  if (!name) return
  if (types.includes('Recipe')) {
    const ing = Array.isArray(o['recipeIngredient']) ? o['recipeIngredient'].filter((i): i is string => typeof i === 'string').slice(0, 14).map((i) => clip(i, 60)).filter(Boolean).join('; ') : ''
    const serves = clip(typeof o['recipeYield'] === 'number' ? String(o['recipeYield']) : Array.isArray(o['recipeYield']) ? o['recipeYield'][0] : o['recipeYield'], 30)
    out.push(`Recipe: ${name}${serves ? ` (makes ${serves})` : ''}${ing ? `. Ingredients for the whole recipe: ${ing}` : ''}`)
  } else if (types.some((t) => /Restaurant|FoodEstablishment|CafeOrCoffeeShop|Bakery|BarOrPub|FastFoodRestaurant|IceCreamShop/.test(t))) {
    const addr = o['address'] && typeof o['address'] === 'object' ? (o['address'] as Record<string, unknown>) : null
    const town = clip(addr?.['addressLocality'], 60)
    const cuisine = clip(Array.isArray(o['servesCuisine']) ? o['servesCuisine'].join(', ') : o['servesCuisine'], 60)
    out.push(`Restaurant: ${name}${town ? `, ${town}` : ''}${cuisine ? ` (${cuisine})` : ''}`)
  } else if (types.includes('MenuItem')) {
    out.push(`Menu item: ${name}`)
  }
}

/** What a page says about itself in its <head>: OpenGraph first, then the plain title and description, then JSON-LD. */
export function parseOpenGraph(html: string, pageUrl: URL): Omit<LinkMeta, 'platform' | 'url' | 'via'> {
  const meta = new Map<string, string>()
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0]
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? attr(tag, 'itemprop'))?.toLowerCase()
    const content = attr(tag, 'content')
    if (key && content && !meta.has(key)) meta.set(key, content)
  }
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v && v.trim()) ?? null
  const titleTag = /<title[^>]*>([^<]{1,400})<\/title>/i.exec(html)?.[1] ?? null

  const ld: string[] = []
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (ld.length >= 6) break
    try { describeLd(JSON.parse(m[1]!.trim()), ld) } catch { /* not JSON: skip */ }
  }

  const image = safeUrl(absolute(pick('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'), pageUrl))
  return {
    title: clip(pick('og:title', 'twitter:title') ?? titleTag, 300),
    description: clip(pick('og:description', 'twitter:description', 'description'), 1200),
    author: clip(pick('author', 'article:author', 'og:article:author', 'twitter:creator'), 80),
    site: clip(pick('og:site_name', 'application-name'), 80),
    image: image ? image.toString() : null,
    extra: ld.length ? ld.join('\n').slice(0, 1500) : null,
  }
}

/** A login or consent page wearing the post's address: it has a title, but not the post's. */
const isWall = (m: { title: string | null; description: string | null }, platform: Platform): boolean => {
  const t = `${m.title ?? ''}`.trim().toLowerCase()
  if (!t && !m.description) return true
  if (platform === 'instagram') return /^(instagram|login • instagram|log in • instagram)$/.test(t) || (!m.description && /instagram/.test(t))
  if (platform === 'facebook') return /^(facebook|log in to facebook|facebook – log in or sign up|log in or sign up to view)/.test(t) || /log into facebook|log in to facebook/.test((m.description ?? '').toLowerCase())
  if (platform === 'tiktok') return /^tiktok( - make your day)?$/.test(t)
  return false
}

const OEMBED: Partial<Record<Platform, (url: string) => string>> = {
  youtube: (url) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
}

async function viaOembed(url: URL, platform: Platform, doFetch: FetchLike): Promise<LinkMeta | MetaFailure | null> {
  const endpoint = OEMBED[platform]?.(url.toString())
  if (!endpoint) return null
  const got = await fetchPublic(new URL(endpoint), doFetch, 'application/json')
  if (typeof got === 'string') return got
  let data: Record<string, unknown>
  try { data = (await got.res.json()) as Record<string, unknown> } catch { return 'blocked' }
  const title = clip(data['title'], 600)
  const author = clip(data['author_name'], 80)
  if (!title && !author) return 'blocked'
  const image = safeUrl(typeof data['thumbnail_url'] === 'string' ? data['thumbnail_url'] : null)
  return {
    platform, url: cleanUrl(url), title, description: null, author,
    site: clip(data['provider_name'], 40), image: image ? image.toString() : null, extra: null, via: 'oembed',
  }
}

/**
 * The public preview of a link, or why there is none. `doFetch` is the
 * platform's fetch; tests hand in their own.
 */
export async function fetchMeta(link: URL, doFetch: FetchLike = fetch): Promise<MetaOut> {
  let url = link
  let platform = platformOf(url)
  const failed = (reason: MetaFailure): MetaOut => ({ ok: false, platform, url: cleanUrl(url), reason })

  // A short link says where the post is only after its redirect.
  if (isShortLink(url)) {
    const got = await fetchPublic(url, doFetch, 'text/html')
    if (typeof got !== 'string') {
      try { await got.res.body?.cancel() } catch { /* nothing to cancel */ }
      url = got.url
      platform = platformOf(url)
    }
  }

  const embedded = await viaOembed(url, platform, doFetch)
  if (embedded && typeof embedded !== 'string') return { ok: true, meta: embedded }
  if (embedded === 'not_found') return failed('not_found')
  // A platform with oEmbed that did not answer is not asked a second way.
  if (embedded) return failed(embedded)

  const got = await fetchPublic(url, doFetch, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5')
  if (typeof got === 'string') return failed(got)
  const type = got.res.headers.get('content-type') ?? ''
  if (type && !/html|xml/i.test(type)) {
    try { await got.res.body?.cancel() } catch { /* nothing to cancel */ }
    // A bare picture or PDF has no preview text of its own.
    return failed('blocked')
  }
  const parsed = parseOpenGraph(await readHead(got.res), got.url)
  if (isWall(parsed, platform)) return failed('blocked')
  return { ok: true, meta: { platform, url: cleanUrl(got.url), ...parsed, site: parsed.site ?? got.url.hostname.replace(/^www\./, ''), via: 'opengraph' } }
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE = 700_000

/** The preview picture as base64 for the model, when it is small enough and a plain image. Null on any doubt. */
export async function fetchPreviewImage(src: string | null, doFetch: FetchLike = fetch): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' } | null> {
  const url = safeUrl(src)
  if (!url) return null
  const got = await fetchPublic(url, doFetch, 'image/webp,image/jpeg,image/png')
  if (typeof got === 'string') return null
  try {
    const type = (got.res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const declared = Number(got.res.headers.get('content-length') ?? 0)
    if (!IMAGE_TYPES.has(type) || declared > MAX_IMAGE) { await got.res.body?.cancel(); return null }
    const bytes = new Uint8Array(await got.res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE) return null
    return { data: toBase64(bytes), mediaType: type as 'image/jpeg' | 'image/png' | 'image/webp' }
  } catch {
    return null
  }
}

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
