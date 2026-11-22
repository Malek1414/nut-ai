import { describe, expect, it } from 'vitest'
import { communityMembership, handleAccount } from '../src/account.js'
import { COMMUNITY_SCHEMA, createPost, listPosts, save, vote } from '../src/community-api.js'
import { memoryD1 } from './d1-shim.js'

const origin = 'https://platepal.example'
const device = 'a141c1c0-516a-4ffc-be38-2bd478ffd1b0'
const password = 'just-a-local-test-password'

function setup(hasMockAi = false) {
  const DB = memoryD1()
  const env = { DB, AUTH_ORIGIN: origin, ...(hasMockAi ? { ANTHROPIC_API_KEY: 'local-fixture', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } : {}) }
  const ready = async () => { for (const sql of COMMUNITY_SCHEMA) await DB.prepare(sql).run() }
  function call(path: string, body?: Record<string, unknown>, cookie?: string, from = origin) {
    const url = new URL(`/api/account/${path}`, origin)
    const request = new Request(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-device': device, origin: from, ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return handleAccount(request, env, url, ready)
  }
  return { DB, call, ready }
}

const cookie = (r: Response) => r.headers.get('set-cookie')!.split(';')[0]!
describe('optional PlatePal account', () => {
  it('links guest posts, vote, saves, memberships and snapshots without sharing the account credential', async () => {
    const { DB, call, ready } = setup()
    await ready()
    const v = { device, team: false }
    const post = await createPost(DB, { nickname: 'GuestPal', title: 'A vegetarian lunch', community: 'Vegan' }, v)
    expect(post.ok).toBe(true)
    if (!post.ok) throw Error(post.code)
    await save(DB, { postId: post.data.id }, v)
    await communityMembership(DB, device)
    DB.raw.prepare('INSERT INTO pp_members VALUES (?, ?)').run('Vegan', device)

    const start = await call('password', { mode: 'signup', username: 'Miso', password })
    expect(start.status).toBe(200)
    expect(start.headers.get('set-cookie')).toMatch(/HttpOnly.*SameSite=Strict.*Secure/)
    const c = cookie(start)
    const stored = DB.raw.prepare('SELECT id, salt, password FROM pp_accounts').get()!
    expect(stored['password']).not.toBe(password)
    expect(String(stored['password'])).toHaveLength(43)
    expect(String(stored['salt'])).toHaveLength(22)
    expect(DB.raw.prepare('SELECT token_hash FROM pp_sessions').get()?.['token_hash']).not.toBe(c.split('=')[1])
    expect(await (await call('session')).json()).toBeNull()
    expect((await call('link', { snapshot: {} }, c, 'https://other.example')).status).toBe(403)
    const account = await (await call('link', { snapshot: { goals: { profile: { goal: 'balanced' } }, favorites: [{ key: 'falafel' }] } }, c)).json()
    expect(account).toMatchObject({ username: 'miso', revision: 1, favorites: [{ key: 'falafel' }] })
    const official = { device: String(stored['id']), team: false }
    const feed = new URL(`${origin}/api/feed?mine=1`)
    expect(await listPosts(DB, feed, v)).toEqual([])
    expect(await listPosts(DB, feed, official)).toMatchObject([{ title: post.data.title, mine: true, myVote: 1, saved: true }])
    expect(await communityMembership(DB, official.device)).toMatchObject({ Vegan: { members: 1, joined: true } })
    const sync = await call('sync', { revision: 1, snapshot: { goals: { targets: { kcal: 2000 } } } }, c)
    expect(await sync.json()).toEqual({ revision: 2 })
    expect((await call('sync', { revision: {}, snapshot: {} }, c)).status).toBe(400)
    expect((await call('sync', { revision: 1, snapshot: {} }, c)).status).toBe(409)
    expect((await call('logout', {}, c)).headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await (await call('session', undefined, c)).json()).toBeNull()
    expect((await call('password', { username: 'miso', password: 'wrong' })).status).toBe(401)
    const back = await call('password', { username: 'miso', password })
    expect(back.status).toBe(200)
    expect(await (await call('session', undefined, cookie(back))).json()).toMatchObject({ goals: { targets: { kcal: 2000 } } })
  })

  it('deduplicates a vote when the device and account both voted and does not relink to another account', async () => {
    const { DB, call, ready } = setup()
    await ready()
    const signup = await call('password', { mode: 'signup', username: 'voter', password })
    const official = String(DB.raw.prepare('SELECT id FROM pp_accounts').get()!['id'])
    const v = { device, team: false }
    const post = await createPost(DB, { nickname: 'GuestPal', title: 'Try the noodle soup', community: 'Mitte' }, v)
    if (!post.ok) throw Error(post.code)
    await vote(DB, { kind: 'post', id: post.data.id, value: -1 }, { device: official, team: false })
    expect((await call('link', { snapshot: {} }, cookie(signup))).status).toBe(200)
    expect(DB.raw.prepare('SELECT device, score FROM posts').get()).toMatchObject({ device: official, score: -1 })
    const second = await call('password', { mode: 'signup', username: 'guest2', password })
    expect(await (await call('link', { snapshot: { favorites: [{ key: 'private' }] } }, cookie(second))).json()).toMatchObject({ revision: 0, favorites: [] })
    expect(DB.raw.prepare('SELECT device FROM posts').get()?.['device']).toBe(official)
  })

  it('blocks assistant requests without a session and when the shared beta quota is exhausted', async () => {
    const { DB, call } = setup(true)
    const body = { messages: [{ role: 'user', text: 'Lunch ideas' }] }
    expect((await call('chat', body)).status).toBe(401)
    const start = await call('password', { mode: 'signup', username: 'reader', password })
    DB.raw.prepare('INSERT INTO pp_limits VALUES (?, ?, ?)').run('chat:beta', Date.now(), 80)
    expect((await call('chat', body, cookie(start))).status).toBe(429)
  })

  it('pins passkey challenges to the configured origin and consumes them once', async () => {
    const { call } = setup()
    const options = await call('passkey/options', { mode: 'signup', username: 'passkey_a' })
    const { ticket, options: challenge } = await options.json()
    expect(challenge).toMatchObject({ rp: { id: 'platepal.example' }, authenticatorSelection: { userVerification: 'required' } })
    const verify = { mode: 'signup', username: 'passkey_a', ticket, credential: { response: {} } }
    expect((await call('passkey/verify', { ...verify, username: 'passkey_b' })).status).toBe(400)
    expect((await call('passkey/verify', verify)).status).toBe(401)
    expect((await call('passkey/verify', verify)).status).toBe(400)
  })
})
