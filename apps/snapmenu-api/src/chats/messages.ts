import { allowed } from '../account.js'
import type { AiEnv } from '../ai-config.js'
import type { D1Like } from '../d1-adapter.js'
import { chatGroupLanguage, generateChatPlan, generateChatReply, type PlanData } from './planner.js'
import { fail, gone, json, limited, memberSql, ok, shortText, type Body } from './access.js'
import type { Card, Chat, Message, Person } from './types.js'

const CHAT_SELECT = `SELECT t.id,t.kind,
 CASE WHEN t.kind='group' THEN title ELSE coalesce((SELECT username FROM chat_members p JOIN pp_accounts a ON a.id=p.account WHERE p.chat=t.id AND p.account<>m.account LIMIT 1),'Direct chat') END AS title,
 CASE WHEN t.kind='group' THEN (SELECT account FROM chat_members WHERE chat=t.id ORDER BY rowid LIMIT 1) END AS ownerId,
 (SELECT count(*) FROM chat_messages WHERE chat=t.id AND id>m.last_read AND sender IS NOT m.account) AS unread,
 coalesce(last.created,t.created) AS updatedAt,coalesce(last.text,'') AS lastMessage
 FROM chat_members m JOIN chat_threads t ON t.id=m.chat
 LEFT JOIN chat_messages last ON last.id=(SELECT max(id) FROM chat_messages WHERE chat=t.id)
 WHERE m.account=?`

export async function listChats(db: D1Like, me: string) {
  const chats = (await db.prepare(CHAT_SELECT + ' ORDER BY updatedAt DESC,t.id').bind(me).all<Chat>()).results
  return json({ chats, unread: chats.reduce((count, c) => count + c.unread, 0) })
}

interface Row {
  id: number; sender: string | null; username: string | null; kind: Message['type']; text: string; created: number; payload: string | null
}
const numericId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

export async function readChat(db: D1Like, me: Person, id: string, url: URL) {
  const after = url.searchParams.get('after'), before = url.searchParams.get('before')
  if (after !== null && before !== null || [after, before].some(v => v !== null && !/^\d{1,15}$/.test(v))) return fail('Invalid message cursor.')
  const chat = await db.prepare(CHAT_SELECT + ' AND t.id=?').bind(me.id, id).first<Chat>()
  if (!chat) return gone()
  const roster = (await db.prepare(`SELECT id,username,m.last_read FROM chat_members m JOIN pp_accounts p ON p.id=m.account WHERE chat=? AND ${memberSql} ORDER BY m.rowid`).bind(id, id, me.id).all<Person & { last_read: number }>()).results
  const members = roster.map(({ id, username }) => ({ id, username }))
  const reads = Object.fromEntries(roster.map(member => [member.id, member.last_read]))
  const rows = (await db.prepare(`SELECT m.id,m.sender,a.username,m.kind,m.text,m.created,m.payload FROM chat_messages m LEFT JOIN pp_accounts a ON m.sender=a.id
    WHERE chat=? AND ${memberSql} AND m.id ${after === null ? '<' : '>'} ? ORDER BY m.id ${after === null ? 'DESC' : 'ASC'} LIMIT 50`)
    .bind(id, id, me.id, Number(after ?? before ?? Number.MAX_SAFE_INTEGER)).all<Row>()).results
  if (after === null) rows.reverse()
  const messages: Message[] = rows.map(row => {
    const msg: Message = { id: row.id, sender: row.sender && row.username ? { id: row.sender, username: row.username } : null, type: row.kind, text: row.text, createdAt: row.created }
    if (row.payload && (row.kind === 'card' || row.kind === 'plan' || row.kind === 'voice')) {
      Object.assign(msg, { [row.kind]: JSON.parse(row.payload) })
      if (msg.plan) { msg.votes = {}; msg.myVote = null }
    }
    return msg
  })
  const plans = messages.filter(m => m.plan)
  if (plans.length) {
    const votes = (await db.prepare(`SELECT message,option_id,count(*) AS total,max(account=?) AS mine FROM chat_votes
      WHERE message IN (SELECT value FROM json_each(?)) AND account IN (SELECT account FROM chat_members WHERE chat=?)
      AND ${memberSql} GROUP BY message,option_id`).bind(me.id, JSON.stringify(plans.map(m => m.id)), id, id, me.id)
      .all<{ message: number; option_id: string; total: number; mine: number }>()).results
    for (const v of votes) {
      const plan = plans.find(m => m.id === v.message)!
      plan.votes![v.option_id] = v.total
      if (v.mine) plan.myVote = v.option_id
    }
  }
  return json({ chat, members, me, messages, reads })
}

function cardOf(raw: unknown): Card | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const card = raw as Body, kind = card['kind'], title = shortText(card['title'], 150)
    if (kind !== 'restaurant' && kind !== 'menu' && kind !== 'dish' || !title) return null
  const out: Card = { kind, title }
  if (card['picks'] !== undefined) {
    const picks = card['picks']
    if (kind !== 'menu' || !Array.isArray(picks) || picks.length > 12) return null
    out.picks = []
    for (const pick of picks) {
      const name = shortText(pick?.name, 150)
      if (!name || !Number.isSafeInteger(pick.low) || !Number.isSafeInteger(pick.high) ||
          pick.low < 0 || pick.high < pick.low || pick.high > 100000) return null
      out.picks.push({ name, low: pick.low, high: pick.high })
    }
  }
  if (typeof card['subtitle'] === 'string') {
    if (card['subtitle'].length > 600) return null
    out.subtitle = card['subtitle'].trim()
  }
  for (const key of ['placeId', 'scanId', 'dishId'] as const) {
    const value = card[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !/^[\w./:-]{1,140}$/.test(value)) return null
    out[key] = value
  }
  if (card['sharePath'] !== undefined) {
    if (typeof card['sharePath'] !== 'string' || !/^\/s\/[\w-]{1,100}$/.test(card['sharePath'])) return null
    out.sharePath = card['sharePath']
  }
  const lat = card['lat'], lng = card['lng']
  if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { out.lat = lat; out.lng = lng }
  return out
}

interface AudioNote { mime: string; durationMs: number; bytes: Uint8Array }
function audioOf(body: Body): AudioNote | null {
  const { mime, durationMs, audio } = body
  if (mime !== 'audio/webm' && mime !== 'audio/ogg' && mime !== 'audio/mp4' || !numericId(durationMs) || durationMs > 30_000 ||
    typeof audio !== 'string' || audio.length < 8 || audio.length > 349_528 || audio.length % 4 || !/^[a-zA-Z0-9+/]+=*$/.test(audio)) return null
  try {
    const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0))
    if (bytes.length > 262_144) return null
    const magic = mime === 'audio/webm' ? [0x1a, 0x45, 0xdf, 0xa3] : mime === 'audio/ogg' ? [79, 103, 103, 83] : [102, 116, 121, 112]
    const offset = mime === 'audio/mp4' ? 4 : 0
    return magic.every((v, i) => bytes[offset + i] === v) ? { mime, durationMs, bytes } : null
  } catch { return null }
}

export async function readVoice(db: D1Like, id: string, me: string, message: number) {
  const audio = await db.prepare(`SELECT audio,mime FROM chat_audio JOIN chat_messages ON id=message WHERE chat=? AND message=? AND ${memberSql}`)
    .bind(id, message, id, me).first<{ audio: number[] | ArrayBuffer; mime: string }>()
  if (!audio) return gone()
  return new Response(new Uint8Array(audio.audio), { headers: { 'content-type': audio.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
}

const profiles = async (db: D1Like, id: string, me: string) =>
  (await db.prepare(`SELECT a.username,json_object('goals',json_object('profile',json_extract(a.snapshot,'$.goals.profile'))) AS snapshot FROM chat_members m JOIN pp_accounts a ON a.id=m.account WHERE m.chat=? AND ${memberSql} ORDER BY m.rowid`)
    .bind(id, id, me).all<{ username: string; snapshot: string }>()).results

// Bind authority to the INSERT as membership can change while generating a reply.
async function insert(db: D1Like, chat: string, me: string, type: Message['type'], text: string, payload: unknown = null, audio?: AudioNote) {
  const add = db.prepare(`INSERT INTO chat_messages(chat,sender,kind,text,payload,created) SELECT ?,?,?,?,?,? WHERE ${memberSql}`)
    .bind(chat, type === 'assistant' ? null : me, type, text, payload ? JSON.stringify(payload) : null, Date.now(), chat, me)
  if (audio) {
    const result = await db.batch([add,
      db.prepare('INSERT INTO chat_audio(message,audio,mime) SELECT last_insert_rowid(),?,? WHERE changes()>0').bind(audio.bytes.buffer, audio.mime),
    ]) as { meta: { changes: number; last_row_id: number } }[]
    return result[0]?.meta.changes ? result[0].meta.last_row_id : null
  }
  const out = await add.run()
  return out.meta.changes ? out.meta.last_row_id : null
}

export async function postMessage(env: AiEnv & { DB: D1Like }, me: string, id: string, body: Body) {
  const db = env.DB, type = body['type']
  if (type === 'voice') {
    const audio = audioOf(body)
    if (!audio) return fail('Send an audio recording of up to 30 seconds and 256 KB.')
    if (!await allowed(db, 'chat-voice:' + me, 12, 86_400_000)) return limited()
    const out = await insert(db, id, me, type, 'Voice note', { mime: audio.mime, durationMs: audio.durationMs }, audio)
    return out ? json({ id: out }) : gone()
  }
  if (type === 'card') {
    const card = cardOf(body['card'])
    if (!card) return fail('Choose a valid PlatePal card.')
    const out = await insert(db, id, me, type, card.title, card)
    return out ? json({ id: out }) : gone()
  }
  const text = shortText(body['text'], 2000)
  if (type !== 'text' || !text) return fail('Write a message of up to 2,000 characters.')
  const messageId = await insert(db, id, me, type, text)
  if (!messageId) return gone()
  if (!/(?:^|[^\p{L}\p{N}_@])@platepal(?![\p{L}\p{N}_])/iu.test(text)) return json({ id: messageId })
  if (!await allowed(db, 'chat:' + me, 24, 86_400_000) || !await allowed(db, 'chat:beta', 80, 86_400_000))
    return json({ id: messageId, assistantError: 'PlatePal has reached its daily reply limit.' })
  try {
    const history = (await db.prepare(`SELECT coalesce(a.username,'PlatePal') AS author,m.text FROM chat_messages m
      LEFT JOIN pp_accounts a ON a.id=m.sender WHERE chat=? AND m.kind IN ('text','assistant') AND m.id<=? AND ${memberSql} ORDER BY m.id DESC LIMIT 8`)
      .bind(id, messageId, id, me).all<{ author: string; text: string }>()).results.reverse()
    const plan = await db.prepare(`SELECT payload FROM chat_messages WHERE chat=? AND kind='plan' AND id<=? AND ${memberSql} ORDER BY id DESC LIMIT 1`)
      .bind(id, messageId, id, me).first<{ payload: string }>()
    if (history.length) {
      const reply = await generateChatReply(env, { history, language: chatGroupLanguage(await profiles(db, id, me)), plan: plan ? JSON.parse(plan.payload) as PlanData : null })
      if (reply) await insert(db, id, me, 'assistant', reply.slice(0, 4000))
    }
    return json({ id: messageId })
  } catch { return json({ id: messageId, assistantError: 'PlatePal couldn’t reply. Your message was sent.' }) }
}

export async function createPlan(db: D1Like, me: string, id: string, body: Body) {
  const lat = body['lat'], lng = body['lng'], language = shortText(body['language'], 12)
  if ((lat !== undefined || lng !== undefined) && (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180)) return fail('Choose a valid area.')
  if (!await allowed(db, 'chat-plan:' + me, 16, 86_400_000)) return limited()
  const members = await profiles(db, id, me)
  if (!members.length) return gone()
  const plan = await generateChatPlan(db, members, { ...(typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : {}), language })
  // Recheck the entire roster. Results computed for someone who left should never enter a chat.
  const roster = JSON.stringify(members.map(m => m.username))
  const out = await db.prepare(`INSERT INTO chat_messages(chat,sender,kind,text,payload,created)
    SELECT ?,?,'plan','Dinner plan',?,? WHERE ${memberSql} AND
    (SELECT json_group_array(username) FROM (SELECT username FROM chat_members JOIN pp_accounts ON account=id WHERE chat=? ORDER BY chat_members.rowid))=?`)
    .bind(id, me, JSON.stringify(plan), Date.now(), id, me, id, roster).run()
  return out.meta.changes ? json({ id: out.meta.last_row_id }) : fail('The group changed. Try planning again.', 409)
}

export async function modifyMessage(db: D1Like, me: string, id: string, action: string, body: Body) {
  if (action === 'read') {
    const through = body['through']
    if (!numericId(through)) return fail('Choose a message.')
    await db.prepare('UPDATE chat_members SET last_read=? WHERE chat=? AND account=? AND last_read<? AND EXISTS(SELECT 1 FROM chat_messages WHERE id=? AND chat=?)')
      .bind(through, id, me, through, through, id).run()
    return ok()
  }
  const msg = body['messageId']
  if (!numericId(msg)) return fail('Choose a message.')
  if (action === 'vote') {
    const option = shortText(body['optionId'], 140)
    const result = await db.prepare(`INSERT INTO chat_votes(message,account,option_id)
      SELECT id,?,? FROM chat_messages WHERE id=? AND chat=? AND kind='plan' AND ${memberSql}
      AND EXISTS(SELECT 1 FROM json_each(payload,'$.options') WHERE json_extract(value,'$.id')=?)
      ON CONFLICT(message,account) DO UPDATE SET option_id=excluded.option_id`)
      .bind(me, option, msg, id, id, me, option).run()
    return result.meta.changes ? ok() : fail('Choose an option in this plan.')
  }
  if (action === 'delete') {
    const result = await db.prepare(`DELETE FROM chat_messages WHERE id=? AND chat=? AND sender=? AND ${memberSql}`).bind(msg, id, me, id, me).run()
    return result.meta.changes ? ok() : fail('Only your own messages can be deleted.', 403)
  }
  if (action === 'report') {
    const reason = shortText(body['reason'], 240)
    if (!reason) return fail('Choose a report reason.')
    const result = await db.prepare(`INSERT INTO chat_reports(actor,message,chat,target,reason,created) SELECT ?,id,chat,sender,?,? FROM chat_messages
      WHERE chat=? AND id=? AND sender IS NOT ? AND ${memberSql} ON CONFLICT(actor,message) DO UPDATE SET reason=excluded.reason`)
      .bind(me, reason, Date.now(), id, msg, me, id, me).run()
    return result.meta.changes ? ok() : gone()
  }
  return gone()
}
