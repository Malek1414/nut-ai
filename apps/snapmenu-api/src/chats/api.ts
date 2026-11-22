import { allowed, sessionIdentity } from '../account.js'
import type { AiEnv } from '../ai-config.js'
import type { D1Like } from '../d1-adapter.js'
import { createChat, fail, friends, gone, invite, limited, membership, readChatBody, removeFriend } from './access.js'
import { createPlan, listChats, modifyMessage, postMessage, readChat, readVoice } from './messages.js'

export async function handleChats(req: Request, env: AiEnv & { DB: D1Like; AUTH_ORIGIN?: string }, url: URL, ensurePlaces: () => Promise<void>) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const origin = env.AUTH_ORIGIN ? new URL(env.AUTH_ORIGIN).origin : local ? url.origin : null
  if (origin !== url.origin || req.headers.get('sec-fetch-site') === 'cross-site') return fail('Open PlatePal directly in your browser.', 403)
  if (req.method !== 'GET' && (req.method !== 'POST' || req.headers.get('origin') !== origin || !req.headers.get('content-type')?.startsWith('application/json')))
    return fail('Open PlatePal directly in your browser.', 403)
  try {
    const db = env.DB, session = await sessionIdentity(req, db)
    if (!session) return fail('Sign in to use chats.', 401)
    const me = { id: session.id, username: session.username }
    const path = url.pathname.slice('/api/chats'.length).replace(/^\//, '')
    const [id, ...parts] = path.split('/'), action = parts.join('/')
    if (req.method === 'GET') {
      if (!path) return await listChats(db, me.id)
      if (path === 'friends') return await friends(db, me.id)
      if (!id) return gone()
      if (!action) return await readChat(db, me, id, url)
      if (/^voice\/\d{1,15}$/.test(action)) return await readVoice(db, id, me.id, Number(parts[1]))
      return gone()
    }
    if (action !== 'read' && !await allowed(db, 'chat-write:' + me.id, 60, 60_000)) return limited()
    const body = await readChatBody(req, action === 'messages' ? 352_000 : 8_192)
    if (body instanceof Response) return body
    if (!path) return await createChat(db, me.id, body)
    if (id === 'invite') return await invite(db, me.id, path, body)
    if (path === 'friends/remove' || path === 'block') return await removeFriend(db, me.id, body['memberId'], path === 'block')
    if (!id || !await db.prepare('SELECT 1 FROM chat_members WHERE chat=? AND account=?').bind(id, me.id).first()) return gone()
    if (action === 'messages') return await postMessage(env, me.id, id, body)
    if (action === 'plan') {
      await ensurePlaces()
      return await createPlan(db, me.id, id, body)
    }
    if (action.startsWith('members/') || action === 'leave') return await membership(db, me.id, id, action, body)
    return await modifyMessage(db, me.id, id, action, body)
  } catch {
    // D1 or a provider can include parameters in exception messages. Keep chat data out of logs.
    return fail('Chats are temporarily unavailable. Please try again.', 503)
  }
}
