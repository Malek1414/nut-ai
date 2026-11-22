import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from '@simplewebauthn/server'
import type { D1Like } from './d1-adapter.js'
import { create, textOf, setAiBaseUrl } from './anthropic.js'
import { modelSettings, thinkingFor } from './models.js'
import { checkNickname, COMMUNITY_IDS } from './community.js'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pp_accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT, password TEXT, snapshot TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS pp_passkeys (id TEXT PRIMARY KEY, account TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pp_sessions (token_hash TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pp_sessions_expiry ON pp_sessions(expires)`,
  `CREATE TABLE IF NOT EXISTS pp_challenges (ticket TEXT PRIMARY KEY, challenge TEXT NOT NULL, username TEXT NOT NULL, purpose TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pp_challenges_expiry ON pp_challenges(expires)`,
  `CREATE TABLE IF NOT EXISTS pp_limits (key TEXT PRIMARY KEY, since INTEGER NOT NULL, hits INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pp_limits_expiry ON pp_limits(since)`,
  `CREATE TABLE IF NOT EXISTS pp_linked_devices (device TEXT PRIMARY KEY, account TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pp_members (community TEXT NOT NULL, actor TEXT NOT NULL, PRIMARY KEY (community, actor))`,
  `CREATE INDEX IF NOT EXISTS pp_members_actor ON pp_members(actor)`,
]
const schemas = new WeakMap<D1Like, Promise<void>>()
export function ensureAccounts(db: D1Like) {
  const ready = schemas.get(db) ?? db.batch(SCHEMA.map((sql) => db.prepare(sql))).then(() => {}).catch((e: unknown) => { schemas.delete(db); throw e })
  schemas.set(db, ready)
  return ready
}

const DAY = 86_400_000
const SESSION_AGE = 30 * DAY
const COOKIE = 'pp_session'
const MAX_BODY = 150_000
const encoder = new TextEncoder()
const json = (data: unknown, status = 200, cookie?: string) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) },
})
const fail = (error: string, status = 400) => json({ error: { message: error } }, status)
const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))
const b64 = (x: Uint8Array) => btoa(String.fromCharCode(...x)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const un64 = (x: string) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), (s) => s.charCodeAt(0))
const hash = async (x: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(x))))
const record = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {}
const usernameOf = (x: unknown) => typeof x === 'string' && /^[a-z0-9_]{3,24}$/i.test(x.trim()) ? x.trim().toLowerCase() : null
const actorId = () => `account-${b64(bytes(24))}`
export const guestDevice = (req: Request) => {
  const d = req.headers.get('x-device')
  return d && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|d-\d{10,16}-[a-z0-9]{5,24})$/i.test(d) ? d : null
}
const sessionToken = (req: Request) => req.headers.get('cookie')?.match(/(?:^|;\s*)pp_session=([\w-]{43})(?:;|$)/)?.[1]
const cookieOf = (url: URL, token: string, maxAge: number) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`
interface Account { id: string; username: string; password: string | null; salt: string | null; snapshot: string; revision: number }
interface Env { DB: D1Like; AUTH_ORIGIN?: string; ANTHROPIC_API_KEY?: string; ANTHROPIC_BASE_URL?: string; MODEL_READ?: string; MODEL_VOICE?: string }

export async function sessionAccount(req: Request, db: D1Like): Promise<Account | null> {
  const token = sessionToken(req)
  if (!token) return null
  await ensureAccounts(db)
  return db.prepare(`SELECT a.* FROM pp_sessions s JOIN pp_accounts a ON s.account=a.id WHERE s.token_hash=? AND s.expires>?`)
    .bind(await hash(token), Date.now()).first<Account>()
}

async function signIn(req: Request, db: D1Like, origin: URL, id: string, username: string) {
  const token = b64(bytes(32))
  const old = sessionToken(req)
  await db.batch([
    db.prepare('DELETE FROM pp_sessions WHERE expires<=? OR token_hash=?').bind(Date.now(), old ? await hash(old) : ''),
    db.prepare('INSERT INTO pp_sessions VALUES (?, ?, ?)').bind(await hash(token), id, Date.now() + SESSION_AGE),
  ])
  return json({ username }, 200, cookieOf(origin, token, SESSION_AGE / 1000))
}

// WebCrypto PBKDF2 is capped at 100,000 iterations by the Workers runtime.
// Use a unique salt, minimum 12 characters, and server-side attempt limits.
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: un64(salt), hash: 'SHA-256', iterations: 100_000 }, key, 256))
}
const equal = (a: Uint8Array, b: Uint8Array) => {
  let diff = a.length ^ b.length
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ (b[i] ?? 0)
  return diff === 0
}

async function allowed(db: D1Like, key: string, max: number, ms: number) {
  const now = Date.now()
  // Do not continually write to a bucket once it reaches its limit.
  const row = await db.prepare(`INSERT INTO pp_limits VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN since<=? THEN 1 ELSE hits+1 END, since=CASE WHEN since<=? THEN excluded.since ELSE since END
    WHERE since<=? OR hits<? RETURNING hits`).bind(key, now, now - ms, now - ms, now - ms, max).first()
  return Boolean(row)
}

async function readBody(req: Request) {
  const reader = req.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder()
  let length = 0, text = ''
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.length
      if (length > MAX_BODY) { await reader.cancel(); return null }
      text += decoder.decode(part.value, { stream: true })
    }
    return record(JSON.parse(text + decoder.decode()))
  } catch { return null }
}

const array = (x: unknown): unknown[] => Array.isArray(x) ? x : []
function snapshotOf(value: unknown) {
  const s = record(value)
  return {
    goals: record(s['goals']), favorites: array(s['favorites']).slice(0, 60), places: array(s['places']).slice(0, 60),
  }
}
const packed = (value: unknown) => {
  const text = JSON.stringify(snapshotOf(value))
  return encoder.encode(text).length <= MAX_BODY - 1000 ? text : null
}
function union(local: unknown[], remote: unknown[], key: string) {
  return Array.from(new Map([...local, ...remote].flatMap((entry) => {
    const id = record(entry)[key]
    return typeof id === 'string' ? [[id, entry] as const] : []
  })).values()).slice(0, 60)
}

// Keep the anonymous identity out of future authenticated ownership checks. Its UUID was already
// the guest app's bearer credential; it is never accepted as an account or session credential.
function claimDevice(db: D1Like, device: string, account: Account) {
  const id = account.id
  const owns = 'EXISTS (SELECT 1 FROM pp_linked_devices WHERE device=? AND account=?)'
  const rows = ['posts', 'comments'].map((table) => db.prepare(`UPDATE ${table} SET device=? WHERE device=? AND ${owns}`).bind(id, device, device, id))
  return [db.prepare('INSERT OR IGNORE INTO pp_linked_devices SELECT ?, id FROM pp_accounts WHERE id=? AND revision=?').bind(device, id, account.revision), ...rows,
    db.prepare(`INSERT OR IGNORE INTO saves SELECT ?, post_id, ts FROM saves WHERE device=? AND ${owns}`).bind(id, device, device, id),
    db.prepare(`DELETE FROM saves WHERE device=? AND ${owns}`).bind(device, device, id),
    db.prepare(`INSERT OR IGNORE INTO pp_members SELECT community, ? FROM pp_members WHERE actor=? AND ${owns}`).bind(id, device, device, id),
    db.prepare(`DELETE FROM pp_members WHERE actor=? AND ${owns}`).bind(device, device, id),
    // Usually votes can move unchanged (including the author's initial vote). If both
    // identities voted on the same thread, keep the account's vote and undo the guest's.
    // The cached hot rank is refreshed by the next vote; D1 has no logarithm function.
    ...(['post', 'comment'] as const).map((kind) => {
      const table = kind === 'post' ? 'posts' : 'comments'
      const overlaps = `votes g JOIN votes a ON a.kind=g.kind AND a.target=g.target AND a.device=? WHERE g.kind='${kind}' AND g.device=?`
      return db.prepare(`UPDATE ${table} AS t SET ups=ups-(g.value=1), downs=downs-(g.value=-1), score=score-g.value
        FROM (SELECT g.target, g.value FROM ${overlaps}) g WHERE g.target=t.id AND ${owns}`).bind(id, device, device, id)
    }),
    db.prepare(`UPDATE OR IGNORE votes SET device=? WHERE device=? AND ${owns}`).bind(id, device, device, id),
    db.prepare(`DELETE FROM votes WHERE device=? AND ${owns}`).bind(device, device, id),
  ]
}

export async function communityMembership(db: D1Like, actor: string | null) {
  await ensureAccounts(db)
  const rows = (await db.prepare('SELECT community, COUNT(*) members, MAX(actor=?) joined FROM pp_members GROUP BY community').bind(actor ?? '').all<{ community: string; members: number; joined: number }>()).results
  return Object.fromEntries(rows.map((r) => [r.community, { members: r.members, joined: Boolean(r.joined) }]))
}
export async function setMembership(req: Request, db: D1Like, actor: string | null) {
  if (!actor || (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') return fail('Could not change membership.', 403)
  const body = await readBody(req)
  const id = body?.['community']
  if (typeof id !== 'string' || !COMMUNITY_IDS.has(id)) return fail('Choose a community.')
  await ensureAccounts(db)
  const join = body?.['join'] === true
  if (join) await db.prepare('INSERT OR IGNORE INTO pp_members VALUES (?, ?)').bind(id, actor).run()
  else await db.prepare('DELETE FROM pp_members WHERE community=? AND actor=?').bind(id, actor).run()
  return json({ joined: join })
}

export async function handleAccount(req: Request, env: Env, url: URL, ensureCommunity: () => Promise<void>): Promise<Response> {
  // RP ID and origin are deployment configuration, never a host supplied in JSON.
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  const origin = env.AUTH_ORIGIN ? new URL(env.AUTH_ORIGIN) : local ? url : null
  if (!origin || origin.origin !== url.origin || req.headers.get('sec-fetch-site') === 'cross-site') return fail('Open PlatePal directly in your browser.', 403)
  const db = env.DB, path = url.pathname.slice('/api/account/'.length)
  if (path === 'session' && req.method === 'GET' && !sessionToken(req)) return json(null)
  if (req.method !== 'GET' && (req.method !== 'POST' || req.headers.get('origin') !== origin.origin || !req.headers.get('content-type')?.startsWith('application/json'))) return fail('Open PlatePal directly in your browser.', 403)
  await ensureAccounts(db)
  const session = await sessionAccount(req, db)
  const view = (a: Account) => ({ username: a.username, ...snapshotOf(JSON.parse(a.snapshot)), revision: a.revision })
  if (path === 'session' && req.method === 'GET') return json(session ? view(session) : null)
  if (req.method !== 'POST') return fail('Not found.', 404)
  const body = await readBody(req)
  if (!body) return fail('That request could not be read.')
  if (path === 'logout') {
    const t = sessionToken(req)
    if (t) await db.prepare('DELETE FROM pp_sessions WHERE token_hash=?').bind(await hash(t)).run()
    return json({ ok: true }, 200, cookieOf(origin, '', 0))
  }
  if (path === 'sync' || path === 'link') {
    if (!session) return fail('Please log in again.', 401)
    const incoming = snapshotOf(body['snapshot'])
    if (path === 'link') {
      const device = guestDevice(req)
      if (device) {
        await ensureCommunity()
        const claimed = await db.prepare('SELECT account FROM pp_linked_devices WHERE device=?').bind(device).first<{ account: string }>()
        if (claimed) return json(view(session))
        const existing = snapshotOf(JSON.parse(session.snapshot))
        const merged = packed({ goals: Object.keys(existing.goals).length ? existing.goals : incoming.goals, favorites: union(incoming.favorites, existing.favorites, 'key'), places: union(incoming.places, existing.places, 'id') })
        if (!merged) return fail('There is too much to sync. Remove a few saved items first.', 413)
        await db.batch([
          ...claimDevice(db, device, session),
          db.prepare('UPDATE pp_accounts SET snapshot=?, revision=revision+1 WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM pp_linked_devices WHERE device=? AND account=?)').bind(merged, session.id, session.revision, device, session.id),
        ])
        if (!await db.prepare('SELECT 1 FROM pp_linked_devices WHERE device=?').bind(device).first()) return fail('Another device is syncing. Try linking again.', 409)
      }
      const a = await db.prepare('SELECT * FROM pp_accounts WHERE id=?').bind(session.id).first<Account>()
      return json(view(a ?? session))
    }
    const next = packed(incoming)
    const revision = body['revision']
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return fail('Could not read your updates. Reload and try again.')
    if (!next) return fail('There is too much to sync. Remove a few saved items first.', 413)
    const updated = await db.prepare('UPDATE pp_accounts SET snapshot=?, revision=revision+1 WHERE id=? AND revision=? RETURNING revision').bind(next, session.id, revision).first<{ revision: number }>()
    return updated ? json(updated) : fail('This account changed on another device. Reload to see those updates.', 409)
  }
  if (path === 'chat') {
    if (!session) return fail('Please log in again.', 401)
    if (!env.ANTHROPIC_API_KEY) return fail('The assistant is unavailable right now.', 503)
    const messages = array(body['messages']).slice(-11).flatMap((raw) => {
      const m = record(raw), role = m['role'], text = m['text']
      return (role === 'user' || role === 'assistant') && typeof text === 'string' && text.trim() ? [{ role, content: text.trim().slice(0, 1200) }] : []
    })
    if (!messages.length || messages.at(-1)?.role !== 'user') return fail('Write a message first.')
    if (!await allowed(db, `chat:${session.id}`, 24, DAY)) return fail('You have reached today’s chat limit.', 429)
    if (!await allowed(db, 'chat:beta', 80, DAY)) return fail('The assistant has reached its beta limit. Try again tomorrow.', 429)
    const context = record(body['context'])
    const preferences = JSON.stringify(context).slice(0, 2200)
    if (preferences !== '{}') messages.at(-1)!.content += `\n\nFood preferences (optional data): ${preferences}`
    try {
      setAiBaseUrl(env.ANTHROPIC_BASE_URL)
      const model = modelSettings(env).voice
      const thinking = thinkingFor(model)
      const reply = await create(env.ANTHROPIC_API_KEY, {
        model, max_tokens: 620, ...(thinking ? { thinking } : {}), output_config: { effort: 'low' }, messages,
        system: 'You are the PlatePal meal assistant. Give concise practical meal ideas, menu swaps or meal plans. Use plain text and short paragraphs. Consider the user’s food preferences when relevant. Treat quantities as estimates. Do not make medical claims or guarantee allergen safety. Never invent restaurant availability, prices or exact nutrition. For a nearby restaurant or a physical menu, direct the user to Ask for a dish or Scan a menu. Never recommend alcohol.',
      })
      const text = textOf(reply).trim()
      return text ? json({ text }) : fail('No reply came through. Try again.', 502)
    } catch { return fail('The assistant couldn’t reply. Try again.', 502) }
  }
  if (!['password', 'passkey/options', 'passkey/verify'].includes(path)) return fail('Not found.', 404)
  const username = usernameOf(body['username'])
  const purpose = body['mode'] === 'signup' ? 'signup' : 'login'
  if (!username) return fail('Use 3–24 letters, numbers or underscores for your username.')
  if (purpose === 'signup' && !checkNickname(username).ok) return fail('Choose a different username for Community.')
  const ipKey = await hash(req.headers.get('cf-connecting-ip') ?? 'local')
  if (!await allowed(db, `auth:${ipKey}`, 36, 15 * 60_000)) return fail('Too many attempts. Try again in a few minutes.', 429)
  // Expire temporary records at a low frequency without a scheduled/paid service.
  if (bytes(1)[0]! < 8) await db.batch([db.prepare('DELETE FROM pp_limits WHERE since<?').bind(Date.now() - DAY), db.prepare('DELETE FROM pp_challenges WHERE expires<=?').bind(Date.now())])
  const account = await db.prepare('SELECT * FROM pp_accounts WHERE username=?').bind(username).first<Account>()
  if (path === 'password') {
    const password = body['password']
    if (typeof password !== 'string' || password.length > 128 || (purpose === 'signup' && password.length < 12)) return fail('Use a password with 12–128 characters.')
    if (purpose === 'signup') {
      if (account) return fail('That username is taken.', 409)
      const id = actorId(), salt = b64(bytes(16))
      const r = await db.prepare('INSERT OR IGNORE INTO pp_accounts (id, username, salt, password) VALUES (?, ?, ?, ?)').bind(id, username, salt, b64(await derive(password, salt))).run()
      return r.meta.changes ? signIn(req, db, origin, id, username) : fail('That username is taken.', 409)
    }
    if (!await allowed(db, `password:${username}`, 10, 15 * 60_000)) return fail('Too many attempts. Try again in a few minutes.', 429)
    const actual = await derive(password, account?.salt ?? b64(bytes(16)))
    const valid = equal(actual, account?.password ? un64(account.password) : bytes(32))
    return account?.password && valid ? signIn(req, db, origin, account.id, username) : fail('Username or password is incorrect.', 401)
  }
  if (path === 'passkey/options') {
    if (purpose === 'signup' && account) return fail('That username is taken.', 409)
    const options = purpose === 'signup'
      ? await generateRegistrationOptions({ rpName: 'PlatePal', rpID: origin.hostname, userName: username, attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, supportedAlgorithmIDs: [-7, -257] })
      : await generateAuthenticationOptions({ rpID: origin.hostname, userVerification: 'required' })
    const ticket = b64(bytes(24))
    await db.prepare('INSERT INTO pp_challenges VALUES (?, ?, ?, ?, ?)').bind(ticket, options.challenge, username, purpose, Date.now() + 5 * 60_000).run()
    return json({ ticket, options })
  }
  const ticket = body['ticket']
  if (typeof ticket !== 'string' || !/^[\w-]{32}$/.test(ticket)) return fail('Start again to use your passkey.')
  const saved = await db.prepare('DELETE FROM pp_challenges WHERE ticket=? AND username=? AND purpose=? AND expires>? RETURNING challenge').bind(ticket, username, purpose, Date.now()).first<{ challenge: string }>()
  if (!saved) return fail('That passkey request expired. Try again.')
  const opts = { expectedChallenge: saved.challenge, expectedOrigin: origin.origin, expectedRPID: origin.hostname, requireUserVerification: true }
  try {
    if (purpose === 'signup') {
      if (account) return fail('That username is taken.', 409)
      const checked = await verifyRegistrationResponse({ ...opts, response: body['credential'] as RegistrationResponseJSON })
      if (!checked.verified || !checked.registrationInfo) return fail('That passkey did not work.', 401)
      const c = checked.registrationInfo.credential, id = actorId()
      await db.batch([
        db.prepare('INSERT INTO pp_accounts (id, username) VALUES (?, ?)').bind(id, username),
        db.prepare('INSERT INTO pp_passkeys VALUES (?, ?, ?, ?)').bind(c.id, id, b64(c.publicKey), c.counter),
      ])
      return signIn(req, db, origin, id, username)
    }
    const response = body['credential'] as AuthenticationResponseJSON | undefined
    const key = account && typeof response?.id === 'string' && response.id.length < 1400 && await db.prepare('SELECT id, public_key, counter FROM pp_passkeys WHERE id=? AND account=?').bind(response.id, account.id).first<{ id: string; public_key: string; counter: number }>()
    if (!key || !response || !account) return fail('No matching passkey. Check your username.', 401)
    const checked = await verifyAuthenticationResponse({ ...opts, response, credential: { id: key.id, publicKey: un64(key.public_key), counter: key.counter } })
    if (!checked.verified) return fail('That passkey did not work.', 401)
    const counter = await db.prepare('UPDATE pp_passkeys SET counter=? WHERE id=? AND counter=?').bind(checked.authenticationInfo.newCounter, key.id, key.counter).run()
    if (!counter.meta.changes) return fail('Start again to use your passkey.', 409)
    return signIn(req, db, origin, account.id, username)
  } catch { return fail('That passkey couldn’t be verified. Try again.', 401) }
}
