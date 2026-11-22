import type { D1Like } from '../d1-adapter.js'
import { saySocial } from './copy.js'
import { PREMIUM_CONSENT, PREMIUM_CONSENT_VERSION, PREMIUM_WANTS } from './premium-terms.js'
import { bad, logSocial, recentCount, SOCIAL_LIMITS, type Out } from './schema.js'

/**
 * "Get Premium early": the app is a free beta with no paywall. Someone who
 * wants to hear when a paid plan starts leaves an email, optionally a name and
 * what they would pay for. That is all this stores.
 *
 * The sentence a person agrees to is PREMIUM_CONSENT (premium-terms.ts): the sheet shows
 * exactly this text and the row keeps a copy of it, so it is always known what
 * each address was given for. An address is never sent back out of the API;
 * /numbers only counts. The same phone can take its address off the list again.
 */

const WANT_IDS: ReadonlySet<string> = new Set(PREMIUM_WANTS.map((w) => w.id))
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"'.]{2,24}$/

export const cleanEmail = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return e.length <= 254 && EMAIL.test(e) && !e.includes('..') ? e : null
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

export interface Asker { device: string | null; team: boolean; lang?: string | undefined }

/** Put an address on the list (or update what it asked for). */
export async function joinPremium(db: D1Like, body: Record<string, unknown>, who: Asker): Promise<Out<{ ok: true }>> {
  const email = cleanEmail(body['email'])
  if (!email) return bad(400, 'bad_email', saySocial(who.lang, 'bad_email'))
  // Without a yes to the sentence above nothing is stored.
  if (body['consent'] !== true) return bad(400, 'no_consent', saySocial(who.lang, 'failed'))

  const { max, windowMs } = SOCIAL_LIMITS.premium
  if ((await recentCount(db, 'premium_interest', who.device, Date.now() - windowMs)) >= max) return bad(429, 'rate_limited', saySocial(who.lang, 'slow'))

  const wants = (Array.isArray(body['wants']) ? body['wants'] : []).filter((w): w is string => typeof w === 'string' && WANT_IDS.has(w))
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  await db.prepare(`INSERT INTO premium_interest (id, ts, device, team, email, name, wants, note, consent, source, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET ts = excluded.ts, device = excluded.device, name = excluded.name, wants = excluded.wants, note = excluded.note, consent = excluded.consent, lang = excluded.lang`)
    .bind(id, Date.now(), who.device, who.team ? 1 : 0, email, text(body['name'], 60), JSON.stringify([...new Set(wants)]), text(body['note'], 280),
      `${PREMIUM_CONSENT_VERSION}: ${PREMIUM_CONSENT}`, text(body['source'], 32), text(who.lang, 20))
    .run()
  // The event carries no address: it is what /numbers and the rate limit count.
  await logSocial(db, 'premium_interest', who.device, who.team, { wants: wants.length, source: text(body['source'], 32) })
  return { ok: true, data: { ok: true } }
}

/** Take this phone's address off the list. */
export async function leavePremium(db: D1Like, who: Asker): Promise<Out<{ removed: number }>> {
  if (!who.device) return bad(400, 'no_device', saySocial(who.lang, 'failed'))
  const r = await db.prepare('DELETE FROM premium_interest WHERE device = ?').bind(who.device).run()
  await logSocial(db, 'premium_leave', who.device, who.team, {})
  return { ok: true, data: { removed: r.meta.changes ?? 0 } }
}

/** Whether this phone is on the list. Never the address itself. */
export async function premiumState(db: D1Like, who: Asker): Promise<{ joined: boolean }> {
  if (!who.device) return { joined: false }
  const row = await db.prepare('SELECT 1 AS one FROM premium_interest WHERE device = ? LIMIT 1').bind(who.device).first<{ one: number }>()
  return { joined: Boolean(row) }
}

export { PREMIUM_CONSENT, PREMIUM_CONSENT_VERSION, PREMIUM_WANTS }
