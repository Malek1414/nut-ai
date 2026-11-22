import { allowed } from '../account.js'
import type { D1Like } from '../d1-adapter.js'
import type { Person } from './types.js'

export type Body = Record<string, unknown>
export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } })
export const fail = (message: string, status = 400) => json({ error: { message } }, status)
export const ok = () => json({ ok: true })
export const gone = () => fail('This chat is unavailable.', 404)
export const limited = () => fail('Please try again later.', 429)
export const accountId = (value: unknown): value is string => typeof value === 'string' && /^account-[\w-]{32}$/.test(value)
export const shortText = (value: unknown, max: number) => typeof value === 'string' && value.trim().length <= max ? value.trim() : ''
export const groupLimit = 12
export const memberSql = 'EXISTS (SELECT 1 FROM chat_members WHERE chat=? AND account=?)'
const friendSql = 'EXISTS (SELECT 1 FROM chat_friends WHERE a=min(?,?) AND b=max(?,?))'

export async function readChatBody(req: Request, limit: number): Promise<Body | Response> {
  const tooLarge = () => fail('This message is too large.', 413)
  if (Number(req.headers.get('content-length')) > limit) return tooLarge()
  const reader = req.body?.getReader()
  if (!reader) return fail('Send a JSON object.')
  const decoder = new TextDecoder()
  let size = 0, data = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > limit) { await reader.cancel(); return tooLarge() }
      data += decoder.decode(chunk.value, { stream: true })
    }
    const body: unknown = JSON.parse(data + decoder.decode())
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Body : fail('Send a JSON object.')
  } catch { return fail('Send a JSON object.') }
}

const digestOf = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function invite(db: D1Like, me: string, path: string, body: Body) {
  if (!await allowed(db, 'chat-invite:' + me, 30, 3_600_000)) return limited()
  if (path === 'invite') {
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    const expiresAt = Date.now() + 900_000
    await db.prepare('INSERT INTO chat_invites VALUES(?,?,?,NULL) ON CONFLICT(owner) DO UPDATE SET digest=excluded.digest, expires=excluded.expires, redeemed_by=NULL')
      .bind(me, await digestOf(token), expiresAt).run()
    return json({ token, expiresAt })
  }
  if (path === 'invite/revoke') {
    await db.prepare('DELETE FROM chat_invites WHERE owner=?').bind(me).run()
    return ok()
  }
  const token = body['token']
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return fail('This friend invite is unavailable.', 404)
  const args = [await digestOf(token), Date.now(), me, me, me]
  const condition = `digest=? AND expires>? AND redeemed_by IS NULL AND owner<>?
    AND NOT EXISTS (SELECT 1 FROM chat_blocks WHERE (actor=owner AND target=?) OR (actor=? AND target=owner))`
  if (path === 'invite/preview') {
    const person = await db.prepare(`SELECT username FROM chat_invites JOIN pp_accounts ON id=owner WHERE ${condition}`).bind(...args).first()
    return person ? json(person) : fail('This friend invite is unavailable.', 404)
  }
  if (path !== 'invite/redeem') return gone()
  const found = await db.prepare(`UPDATE chat_invites SET redeemed_by=? WHERE ${condition} RETURNING owner`).bind(me, ...args).first<{ owner: string }>()
  if (!found) return fail('This friend invite is unavailable.', 404)
  const friend = await db.prepare('SELECT id, username FROM pp_accounts WHERE id=?').bind(found.owner).first<Person>()
  return json({ friend })
}

export async function friends(db: D1Like, me: string) {
  const rows = await db.prepare(`SELECT id,username FROM pp_accounts JOIN (
    SELECT b AS friend FROM chat_friends WHERE a=? UNION ALL SELECT a FROM chat_friends WHERE b=?
    ) ON friend=id ORDER BY username`).bind(me, me).all<Person>()
  return json({ friends: rows.results })
}

export async function removeFriend(db: D1Like, me: string, other: unknown, block: boolean) {
  if (!accountId(other) || other === me) return fail('Choose another member.')
  // A block can also be made against a non-friend from a shared group.
  const directKey = [me, other].sort().join('/')
  const statements = block ? [
    db.prepare(`INSERT OR IGNORE INTO chat_blocks SELECT ?,id FROM pp_accounts WHERE id=?`).bind(me, other),
    db.prepare('DELETE FROM chat_members WHERE account=? AND chat IN (SELECT chat FROM chat_members WHERE account=?)').bind(me, other),
  ] : []
  await db.batch([...statements,
  db.prepare('DELETE FROM chat_friends WHERE a=min(?,?) AND b=max(?,?)').bind(me, other, me, other),
  db.prepare('DELETE FROM chat_threads WHERE direct_key=?').bind(directKey),
  ])
  return ok()
}

export async function createChat(db: D1Like, me: string, body: Body) {
  const kind = body['kind'], peers = body['memberIds'], title = shortText(body['title'], 70)
  if (!Array.isArray(peers) || peers.length < 1 || peers.length >= groupLimit || !peers.every(accountId) ||
    peers.includes(me) || new Set(peers).size !== peers.length) return fail('Choose up to 11 different friends.')
  if (kind !== 'direct' && kind !== 'group' || kind === 'direct' && peers.length !== 1 || kind === 'group' && !title) return fail('Choose a chat type and a group name.')
  const everyone = JSON.stringify([me, ...peers]), others = JSON.stringify(peers)
  const id = crypto.randomUUID(), key = kind === 'direct' ? [me, peers[0]!].sort().join('/') : null
  const noBlocks = 'NOT EXISTS (SELECT 1 FROM chat_blocks WHERE actor IN (SELECT value FROM json_each(?)) AND target IN (SELECT value FROM json_each(?)))'
  const batch = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chat_threads SELECT ?,?,?,?,? WHERE
      (SELECT count(*) FROM json_each(?) AS peer JOIN chat_friends ON a=min(peer.value,?) AND b=max(peer.value,?))=?
      AND ${noBlocks}
      AND NOT EXISTS(SELECT 1 FROM chat_members WHERE account IN (SELECT value FROM json_each(?)) GROUP BY account HAVING count(*)>=100)`)
      .bind(id, kind, title, Date.now(), key, others, me, me, peers.length, everyone, everyone, everyone),
    db.prepare(`INSERT INTO chat_members(chat,account) SELECT chat_threads.id,value FROM chat_threads,json_each(?) WHERE chat_threads.id=? ORDER BY json_each.key`)
      .bind(everyone, id),
  ]) as { meta: { changes: number } }[]
  if (batch[0]?.meta.changes) return json({ id })
  if (key) {
    const existing = await db.prepare(`SELECT id FROM chat_threads WHERE direct_key=? AND ${friendSql}`).bind(key, me, peers[0], me, peers[0]).first()
    if (existing) return json(existing)
  }
  return fail('Choose available friends who can join this chat.', 403)
}

export async function membership(db: D1Like, me: string, id: string, action: string, body: Body) {
  const other = body['memberId']
  if (action === 'leave') {
    // Deleting a direct thread removes its unique pair key so a new chat can be started.
    await db.batch([
      db.prepare(`DELETE FROM chat_threads WHERE id=? AND kind='direct' AND ${memberSql}`).bind(id, id, me),
      db.prepare('DELETE FROM chat_members WHERE chat=? AND account=?').bind(id, me),
      db.prepare('DELETE FROM chat_threads WHERE id=? AND NOT EXISTS(SELECT 1 FROM chat_members WHERE chat=?)').bind(id, id),
    ])
    return ok()
  }
  if (!accountId(other) || me === other) return fail('Choose another member.')
  if (action === 'members/add') {
    const writes = await db.prepare(`INSERT OR IGNORE INTO chat_members(chat,account,last_read)
      SELECT ?,?,coalesce((SELECT max(id) FROM chat_messages WHERE chat=?),0)
      FROM chat_threads WHERE id=? AND kind='group' AND ${memberSql} AND ${friendSql}
      AND (SELECT count(*) FROM chat_members WHERE chat=?)<? AND (SELECT count(*) FROM chat_members WHERE account=?)<100
      AND NOT EXISTS (SELECT 1 FROM chat_members m JOIN chat_blocks b ON
       (b.actor=m.account AND b.target=?) OR (b.target=m.account AND b.actor=?) WHERE m.chat=?)`)
      .bind(id, other, id, id, id, me, me, other, me, other, id, groupLimit, other, other, other, id).run()
    return writes.meta.changes ? ok() : fail('This friend cannot be added to the group.', 403)
  }
  if (action === 'members/remove') {
    const removed = await db.prepare(`DELETE FROM chat_members WHERE chat=? AND account=?
      AND (SELECT kind FROM chat_threads WHERE id=?)='group' AND (SELECT account FROM chat_members WHERE chat=? ORDER BY rowid LIMIT 1)=?`)
      .bind(id, other, id, id, me).run()
    return removed.meta.changes ? ok() : fail('Only the group owner can remove a member.', 403)
  }
  return gone()
}
