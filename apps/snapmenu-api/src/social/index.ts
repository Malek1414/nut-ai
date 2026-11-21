import { userLanguage, type Lang } from '../voice/index.js'
import { saySocial } from './copy.js'
import { importLink, type ImportEnv } from './import.js'
import { shareIdFrom } from './links.js'
import { joinPremium, leavePremium, premiumState } from './premium.js'
import { ensureSocialSchema, type Out } from './schema.js'
import { createShare, getShare, shareImage, sharePage } from './share.js'

export { socialNumbers, type SocialNumbers } from './numbers.js'

/**
 * Sharing, link imports and the Premium list: every route of this folder.
 * The Worker's router calls `handleSocial` once and gets null for anything
 * that is not one of these:
 *
 *   POST /api/share               a dish, pick or restaurant -> a short link
 *   GET  /api/share?id=           what a link opens to
 *   GET  /api/share/<id>.jpg      its preview picture
 *   GET  /s/<id>, /api/s/<id>     the page a messenger reads for the rich preview; a browser is sent on to the app
 *   POST /api/import              a link (Instagram, TikTok, YouTube, Facebook, web) -> the meal, with the engine's numbers
 *   POST /api/premium-interest    "Get Premium early": put an address on the list, or take it off
 *   GET  /api/premium-interest    whether this phone is on the list
 */

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-device, x-team, x-lang',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } })
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status)
const out = <T,>(o: Out<T>) => (o.ok ? json(o.data) : fail(o.status, o.code, o.message))

interface Who { device: string | null; team: boolean; lang: Lang }

/** No accounts: the app sends its random device id, the team flag and the phone's language. A body may carry them too. */
function whoIs(req: Request, body?: Record<string, unknown> | null): Who {
  const d = (typeof body?.['deviceId'] === 'string' ? body['deviceId'] : null) ?? req.headers.get('x-device')
  const profile = body?.['profile']
  return {
    device: d && /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null,
    team: body?.['team'] === true || req.headers.get('x-team') === '1',
    lang: userLanguage({
      saved: profile && typeof profile === 'object' ? (profile as Record<string, unknown>)['language'] : undefined,
      locale: body?.['locale'] ?? req.headers.get('x-lang'),
      acceptLanguage: req.headers.get('accept-language'),
    }),
  }
}

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = (await req.json()) as unknown
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function handleSocial(req: Request, env: ImportEnv, url: URL): Promise<Response | null> {
  const p = url.pathname
  const pageId = /^\/(?:api\/)?s\//.test(p) ? shareIdFrom(p) : null
  const imageId = /^\/api\/share\/([a-z0-9]{8,16})\.(?:jpg|jpeg|png|webp)$/.exec(p)?.[1] ?? null
  const mine = pageId !== null || imageId !== null || /^\/(?:api\/)?s\//.test(p) || p === '/api/share' || p === '/api/import' || p === '/api/premium-interest'
  if (!mine) return null

  await ensureSocialSchema(env.DB)

  if (req.method === 'GET') {
    if (/^\/(?:api\/)?s\//.test(p)) {
      const share = pageId ? await getShare(env.DB, pageId) : null
      return new Response(sharePage(url.origin, share, pageId), {
        status: share ? 200 : 404,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': share ? 'public, max-age=300' : 'no-store' },
      })
    }
    if (imageId) {
      const img = await shareImage(env.DB, imageId)
      return img
        ? new Response(img.bytes as unknown as BodyInit, { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=604800, immutable' } })
        : fail(404, 'not_found', 'No picture.')
    }
    if (p === '/api/share') {
      const share = await getShare(env.DB, url.searchParams.get('id'))
      return share ? json(share, 200, { 'cache-control': 'public, max-age=60' }) : fail(404, 'not_found', saySocial(whoIs(req).lang, 'failed'))
    }
    if (p === '/api/premium-interest') return json(await premiumState(env.DB, whoIs(req)))
    return null
  }

  if (req.method !== 'POST') return null
  const body = await bodyOf(req)
  if (!body) return fail(400, 'bad_json', 'Request body must be JSON.')
  const who = whoIs(req, body)
  if (p === '/api/share') return out(await createShare(env.DB, body, who))
  if (p === '/api/import') return out(await importLink(env, body, who))
  if (p === '/api/premium-interest') return body['remove'] === true ? out(await leavePremium(env.DB, who)) : out(await joinPremium(env.DB, body, who))
  return null
}
