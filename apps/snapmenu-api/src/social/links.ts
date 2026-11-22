/**
 * Links, as pure functions: which link a person pasted, where it points, and
 * the app's own share links. No imports from the Worker: the web app reads this
 * file too (like voice/).
 */

export type Platform = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'web'

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  web: 'Web',
}

const TRAILING = /[)\]}>.,;:!?'"»”’]+$/
const WITH_SCHEME = /https?:\/\/[^\s<>"']+/i
const BARE = /(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\/[^\s<>"']*)/i

/**
 * The first link in what a person pasted or shared. A share sheet often hands
 * over a whole sentence ("Look at this https://… "), and people type links
 * without "https://".
 */
export function extractUrl(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const t = text.trim().slice(0, 4000)
  if (!t) return null
  const full = WITH_SCHEME.exec(t)?.[0]
  if (full) return full.replace(TRAILING, '')
  const bare = BARE.exec(t)?.[1]
  if (bare) return `https://${bare.replace(TRAILING, '')}`
  // A lone domain ("goldies-berlin.de") is a link too.
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(t)) return `https://${t}`
  return null
}

const PRIVATE_SUFFIX = /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|invalid|example|onion)$/i

/**
 * A link the server may fetch: http(s), a public domain name, the default
 * port, no login in it. Never an IP address or a private name, so a pasted link
 * cannot point the server at a machine of its own network.
 */
export function safeUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,23}$/.test(host)) return null
  if (PRIVATE_SUFFIX.test(host)) return null
  u.protocol = 'https:'
  return u
}

const on = (host: string, ...domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`))

export function platformOf(url: URL): Platform {
  const h = url.hostname.toLowerCase()
  if (on(h, 'instagram.com', 'instagr.am')) return 'instagram'
  if (on(h, 'tiktok.com')) return 'tiktok'
  if (on(h, 'youtube.com', 'youtu.be', 'youtube-nocookie.com')) return 'youtube'
  if (on(h, 'facebook.com', 'fb.watch', 'fb.com')) return 'facebook'
  return 'web'
}

/** Short links that only say where the post is after a redirect. */
export const isShortLink = (url: URL): boolean => on(url.hostname.toLowerCase(), 'vm.tiktok.com', 'vt.tiktok.com', 'fb.watch', 'instagr.am') || /^\/t\//.test(url.pathname) && on(url.hostname.toLowerCase(), 'tiktok.com')

const TRACKING = /^(?:utm_.+|igsh|igshid|ig_rid|ig_mid|fbclid|gclid|mibextid|si|feature|pp|_t|_r|is_from_webapp|sender_device|share_.+|refer|ref|ref_src|rdid|sfnsn)$/i

/** The link without tracking parameters and without the fragment: what is shown, stored and cached. */
export function cleanUrl(url: URL): string {
  const u = new URL(url.toString())
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key)
  u.hash = ''
  return u.toString()
}

// ---------- The app's own share links ----------

const SHARE_ID = /^[a-z0-9]{8,16}$/

export const isShareId = (id: unknown): id is string => typeof id === 'string' && SHARE_ID.test(id)

/** The path a shared dish, pick or restaurant lives at. Short on purpose: it is what people see in a chat. */
export const sharePath = (id: string): string => `/s/${id}`

/** The share id in a location: "/s/abc12345", "/api/s/abc12345" (always reaches the Worker) or "/?s=abc12345". */
export function shareIdFrom(pathname: string, search = ''): string | null {
  const m = /^\/(?:api\/)?s\/([a-z0-9]{8,16})\/?$/.exec(pathname)
  if (m) return m[1]!
  try {
    const q = new URLSearchParams(search).get('s')
    return isShareId(q) ? q : null
  } catch {
    return null
  }
}

/**
 * The link handed to the app from outside: the phone's share sheet opens
 * "/import?url=…&text=…&title=…" (the manifest's share target; Android puts
 * the link in `text` more often than in `url`). Null when the location is not
 * the import page; `url` is null when it is the page without a link.
 */
export function importTargetFrom(pathname: string, search = ''): { url: string | null } | null {
  if (pathname.replace(/\/$/, '') !== '/import') return null
  try {
    const q = new URLSearchParams(search)
    return { url: extractUrl(q.get('url')) ?? extractUrl(q.get('text')) ?? extractUrl(q.get('title')) }
  } catch {
    return { url: null }
  }
}

/** Where a visitor came from, when the link said so: "instagram" from `?utm_source=instagram` (or the short `?src=ig`). */
export function visitSource(search: string): string | null {
  try {
    const q = new URLSearchParams(search)
    const raw = (q.get('utm_source') ?? q.get('src') ?? '').trim().toLowerCase()
    if (!raw) return null
    const s = raw === 'ig' || raw === 'insta' ? 'instagram' : raw
    return /^[a-z0-9_.-]{2,32}$/.test(s) ? s : null
  } catch {
    return null
  }
}
