import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import worker from '../src/index.js'
import type { Chat, Message, Person } from '../src/chats/types.js'
import { memoryD1 } from './d1-shim.js'

const origin = 'https://platepal.example'
const migration = readFileSync(new URL('../migrations/0160_chats.sql', import.meta.url), 'utf8')

async function fixture() {
  const DB = memoryD1(), env = { DB, AUTH_ORIGIN: origin }
  DB.raw.exec(migration)
  const call = (path: string, cookie = '', body?: unknown, from = origin) => worker.fetch(new Request(origin + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: from, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env)
  async function account(username: string) {
    const res = await call('account/password', '', { mode: 'signup', username, password: 'this-is-a-test-passphrase' })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    const id = DB.raw.prepare('SELECT id FROM pp_accounts WHERE username=?').get(username)!['id'] as string
    return { id, username, chat: (path = '', body?: unknown) => call('chats' + path, cookie, body), cookie }
  }
  const alice = await account('alice'), bob = await account('bobby'), carol = await account('carol')
  async function connect(owner: typeof alice, friend: typeof bob) {
    const { token } = await (await owner.chat('/invite', {})).json()
    const response = await friend.chat('/invite/redeem', { token })
    expect(await response.json()).toEqual({ friend: { id: owner.id, username: owner.username } })
  }
  return { DB, alice, bob, carol, connect, call }
}

describe('account-backed chats', () => {
  it('requires the session and origin, exchanges one hashed invite once and makes the friendship mutual', async () => {
    const { DB, alice, bob, carol, call } = await fixture()
    expect((await call('chats')).status).toBe(401)
    expect((await call('chats/invite', alice.cookie, {}, 'https://other.example')).status).toBe(403)
    const { token, expiresAt } = await (await alice.chat('/invite', {})).json()
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(token).toHaveLength(43)
    expect(DB.raw.prepare('SELECT digest FROM chat_invites').get()?.['digest']).not.toBe(token)
    expect(await (await bob.chat('/invite/preview', { token })).json()).toEqual({ username: 'alice' })
    expect((await alice.chat('/invite/redeem', { token })).status).toBe(404)
    const responses = await Promise.all([bob, carol].map(person => person.chat('/invite/redeem', { token })))
    expect(responses.map(r => r.status).sort()).toEqual([200, 404])
    const winner = responses[0]!.ok ? bob : carol
    expect(await (await winner.chat('/friends')).json()).toEqual({ friends: [{ id: alice.id, username: alice.username }] })
    expect(await (await alice.chat('/friends')).json()).toEqual({ friends: [{ id: winner.id, username: winner.username }] })
    const mint = async () => (await (await alice.chat('/invite', {})).json()).token
    const old = await mint(), fresh = await mint()
    expect((await bob.chat('/invite/redeem', { token: old })).status).toBe(404)
    await alice.chat('/invite/revoke', {})
    expect((await bob.chat('/invite/redeem', { token: fresh })).status).toBe(404)
    const expired = await mint()
    DB.raw.prepare('UPDATE chat_invites SET expires=0 WHERE owner=?').run(alice.id)
    expect((await bob.chat('/invite/redeem', { token: expired })).status).toBe(404)
  })

  it('guards direct messages, unread cursors, private voice playback, card data, reporting and deletion', async () => {
    const { DB, alice, bob, carol, connect } = await fixture()
    expect((await alice.chat('', { kind: 'direct', memberIds: [bob.id] })).status).toBe(403)
    await connect(alice, bob)
    const direct = { kind: 'direct', memberIds: [bob.id] }
    const { id } = await (await alice.chat('', direct)).json()
    expect(await (await bob.chat('', { kind: 'direct', memberIds: [alice.id] })).json()).toEqual({ id })
    const path = '/' + id
    expect((await carol.chat(path)).status).toBe(404)
    expect((await carol.chat(path + '/messages', { type: 'text', text: 'secret' })).status).toBe(404)
    const sent = await (await alice.chat(path + '/messages', { type: 'text', text: 'Lunch?' })).json()
    expect(await (await bob.chat()).json()).toMatchObject({ unread: 1, chats: [{ id, title: 'alice', lastMessage: 'Lunch?', kind: 'direct', unread: 1 }] })
    expect(await (await alice.chat()).json()).toMatchObject({ unread: 0, chats: [{ title: 'bobby' }] })
    expect((await bob.chat(path + '/read', { through: sent.id })).status).toBe(200)
    expect(await (await bob.chat()).json()).toMatchObject({ unread: 0 })
    expect(await (await alice.chat(path)).json()).toMatchObject({ reads: { [bob.id]: sent.id } })
    expect((await bob.chat(path + '/report', { messageId: sent.id, reason: 'Spam' })).status).toBe(200)
    expect(DB.raw.prepare('SELECT reason FROM chat_reports').get()?.['reason']).toBe('Spam')
    expect((await bob.chat(path + '/delete', { messageId: sent.id })).status).toBe(403)
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])
    const voice = await bob.chat(path + '/messages', { type: 'voice', audio: audio.toString('base64'), mime: 'audio/webm', durationMs: 1200 })
    expect(voice.status).toBe(200)
    const { id: voiceId } = await voice.json()
    const playback = await alice.chat(path + '/voice/' + voiceId)
    expect(playback.headers.get('content-type')).toBe('audio/webm')
    expect(Buffer.from(await playback.arrayBuffer())).toEqual(audio)
    expect((await carol.chat(path + '/voice/' + voiceId)).status).toBe(404)
    const card = { kind: 'restaurant', title: 'Kitchen', placeId: 'node/123', lat: 52, lng: 13 }
    expect((await alice.chat(path + '/messages', { type: 'card', card })).status).toBe(200)
    const view = await (await bob.chat(path + '?after=' + sent.id)).json() as { messages: Message[] }
    expect(view.messages.map(m => m.type)).toEqual(['voice', 'card'])
    expect(view.messages[1]?.card).toEqual(card)
    const menu = { kind: 'menu', title: 'Friday menu', picks: [{ name: 'Rice bowl', low: 400, high: 540 }] }
    expect((await alice.chat(path + '/messages', { type: 'card', card: menu })).status).toBe(200)
    expect((await (await bob.chat(path)).json()).messages.at(-1).card).toEqual(menu)
    expect((await alice.chat(path + '/messages', { type: 'card', card: { ...menu, picks: [null] } })).status).toBe(400)
    expect((await alice.chat(path + '/delete', { messageId: sent.id })).status).toBe(200)
    expect((await bob.chat(path + '/delete', { messageId: voiceId })).status).toBe(200)
    expect((await alice.chat(path + '/voice/' + voiceId)).status).toBe(404)
    expect(DB.raw.prepare('SELECT count(*) AS n FROM chat_audio').get()?.['n']).toBe(0)
  })

  it('restricts additions to friends, removes access immediately, transfers ownership, and prevents blocked pairs rejoining', async () => {
    const { alice, bob, carol, connect } = await fixture()
    await connect(alice, bob)
    const { id } = await (await alice.chat('', { kind: 'group', title: 'Dinner', memberIds: [bob.id] })).json()
    const path = '/' + id
    expect((await bob.chat(path + '/members/add', { memberId: carol.id })).status).toBe(403)
    await connect(bob, carol)
    expect((await bob.chat(path + '/members/add', { memberId: carol.id })).status).toBe(200)
    expect((await bob.chat(path + '/members/remove', { memberId: alice.id })).status).toBe(403)
    expect((await alice.chat(path + '/members/remove', { memberId: carol.id })).status).toBe(200)
    expect((await carol.chat(path)).status).toBe(404)
    await bob.chat(path + '/members/add', { memberId: carol.id })
    await alice.chat(path + '/leave', {})
    expect((await bob.chat(path)).status).toBe(200)
    const view = await (await bob.chat(path)).json() as { chat: Chat; members: Person[] }
    expect(view.chat.ownerId).toBe(bob.id)
    expect(view.members.map(m => m.id)).toEqual([bob.id, carol.id])
    const dm = await (await bob.chat('', { kind: 'direct', memberIds: [carol.id] })).json()
    expect((await carol.chat('/block', { memberId: bob.id })).status).toBe(200)
    expect((await bob.chat('/' + dm.id)).status).toBe(404)
    expect((await carol.chat(path)).status).toBe(404)
    await connect(alice, carol)
    await bob.chat(path + '/members/add', { memberId: alice.id })
    expect((await alice.chat(path + '/members/add', { memberId: carol.id })).status).toBe(403)
    expect((await alice.chat('', { kind: 'group', title: 'More', memberIds: [bob.id, carol.id] })).status).toBe(403)
    const { token } = await (await bob.chat('/invite', {})).json()
    expect((await carol.chat('/invite/redeem', { token })).status).toBe(404)
  })

  it('caps text, audio, JSON bytes, write frequency and assistant calls while preserving a sent mention', async () => {
    const { DB, alice, bob, connect } = await fixture()
    await connect(alice, bob)
    const { id } = await (await alice.chat('', { kind: 'direct', memberIds: [bob.id] })).json()
    const path = '/' + id + '/messages'
    expect((await alice.chat(path, { type: 'text', text: 'x'.repeat(2001) })).status).toBe(400)
    expect((await alice.chat(path, { type: 'text', text: 'x'.repeat(352_001) })).status).toBe(413)
    expect((await alice.chat(path, { type: 'voice', audio: 'abcdabcd', mime: 'audio/webm', durationMs: 30_001 })).status).toBe(400)
    expect((await alice.chat(path, { type: 'voice', audio: 'abcdabcd', mime: 'audio/webm', durationMs: 2 })).status).toBe(400)
    DB.raw.prepare('INSERT INTO pp_limits VALUES(?,?,?)').run('chat:' + alice.id, Date.now(), 24)
    expect(await (await alice.chat(path, { type: 'text', text: '@PlatePal lunch?' })).json()).toMatchObject({ assistantError: expect.any(String) })
    expect(await (await bob.chat('/' + id)).json()).toMatchObject({ messages: [{ type: 'text', text: '@PlatePal lunch?' }] })
    DB.raw.prepare('UPDATE pp_limits SET hits=60 WHERE key=?').run('chat-write:' + alice.id)
    expect((await alice.chat(path, { type: 'text', text: 'over limit' })).status).toBe(429)
    expect((await bob.chat(path, { type: 'text', text: 'ok' })).status).toBe(200)
  })

  it('persists meal plans and validates one vote per member against actual plan option IDs', async () => {
    const { DB, alice, bob, carol, connect } = await fixture()
    await connect(alice, bob)
    const { id } = await (await alice.chat('', { kind: 'group', title: 'Dinner', memberIds: [bob.id] })).json()
    const path = '/' + id
    const res = await alice.chat(path + '/plan', {})
    expect(res.status).toBe(200)
    const { id: messageId } = await res.json()
    const view = await (await bob.chat(path)).json()
    expect(view.messages).toMatchObject([{ type: 'plan', plan: { missingProfiles: ['alice', 'bobby'] }, votes: {}, myVote: null }])
    // Provider-independent vote fixture. Matching with actual verified menus is tested in chat-planner.test.ts.
    DB.raw.prepare('UPDATE chat_messages SET payload=? WHERE id=?').run(JSON.stringify({ options: [{ id: 'A' }, { id: 'B' }] }), messageId)
    const vote = (optionId: string) => ({ messageId, optionId })
    expect((await carol.chat(path + '/vote', vote('A'))).status).toBe(404)
    expect((await alice.chat(path + '/vote', vote('C'))).status).toBe(400)
    for (const [person, choice] of [[alice, 'A'], [alice, 'B'], [bob, 'B']] as const)
      expect((await person.chat(path + '/vote', vote(choice))).status).toBe(200)
    expect((await (await alice.chat(path)).json()).messages).toMatchObject([{ votes: { B: 2 }, myVote: 'B' }])
  })
})
