/**
 * Community: Reddit-style posts, one level of replies, votes, saves and reports.
 * No accounts: a random device id (sent by the app) plus a nickname. No DMs, no personal data.
 */
import { checkNickname, checkText, COMMUNITIES, COMMUNITY_IDS, hotScore, initials, parseVote, RATE_LIMITS, shouldHide, voteDelta, type VoteValue } from './community.js'
import type { D1Like } from './d1-adapter.js'
import type { CommentView, PostView } from './types.js'

export const COMMUNITY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, ts INTEGER NOT NULL, device TEXT, nickname TEXT NOT NULL, team INTEGER NOT NULL DEFAULT 0, seed INTEGER NOT NULL DEFAULT 0,
    community TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    place_id TEXT, place_name TEXT, place_lat REAL, place_lng REAL,
    dish_name TEXT, kcal_low REAL, kcal_high REAL, protein REAL, price TEXT, goal TEXT, photo TEXT,
    ups INTEGER NOT NULL DEFAULT 0, downs INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0, hot REAL NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_hot ON posts(hidden, hot DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_place ON posts(place_id)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, post_id TEXT NOT NULL, parent_id TEXT, ts INTEGER NOT NULL, device TEXT, nickname TEXT NOT NULL,
    team INTEGER NOT NULL DEFAULT 0, seed INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL,
    ups INTEGER NOT NULL DEFAULT 0, downs INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0,
    reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id)`,
  `CREATE TABLE IF NOT EXISTS votes (kind TEXT NOT NULL, target TEXT NOT NULL, device TEXT NOT NULL, value INTEGER NOT NULL, ts INTEGER NOT NULL, team INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (kind, target, device))`,
  `CREATE TABLE IF NOT EXISTS saves (device TEXT NOT NULL, post_id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (device, post_id))`,
  `CREATE TABLE IF NOT EXISTS reports (kind TEXT NOT NULL, target TEXT NOT NULL, device TEXT NOT NULL, ts INTEGER NOT NULL, reason TEXT, PRIMARY KEY (kind, target, device))`,
]

export interface Viewer { device: string | null; team: boolean }

export type Out<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string }
const bad = (status: number, code: string, message: string): Out<never> => ({ ok: false, status, code, message })

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

interface PostRow {
  id: string; ts: number; device: string | null; nickname: string; seed: number; community: string; kind: string; title: string; body: string
  place_id: string | null; place_name: string | null; place_lat: number | null; place_lng: number | null
  dish_name: string | null; kcal_low: number | null; kcal_high: number | null; protein: number | null; price: string | null; goal: string | null
  has_photo: number; score: number; comments: number; hidden: number; my_vote?: number | null; saved?: number | null
}

const POST_COLS = `p.id, p.ts, p.device, p.nickname, p.seed, p.community, p.kind, p.title, p.body, p.place_id, p.place_name, p.place_lat, p.place_lng,
  p.dish_name, p.kcal_low, p.kcal_high, p.protein, p.price, p.goal, (p.photo IS NOT NULL) AS has_photo, p.score, p.comments, p.hidden`

function postView(r: PostRow, v: Viewer): PostView {
  return {
    id: r.id, ts: r.ts, nickname: r.nickname, initials: initials(r.nickname), community: r.community, kind: r.kind === 'order' ? 'order' : 'text',
    title: r.title, body: r.body,
    place: r.place_id && r.place_name && r.place_lat !== null && r.place_lng !== null ? { id: r.place_id, name: r.place_name, lat: r.place_lat, lng: r.place_lng } : null,
    dish: r.dish_name ? { name: r.dish_name, kcalLow: r.kcal_low ?? 0, kcalHigh: r.kcal_high ?? 0, protein: r.protein ?? 0, price: r.price } : null,
    goal: r.goal, hasPhoto: Boolean(r.has_photo), score: r.score, comments: r.comments,
    myVote: (r.my_vote ?? 0) as VoteValue, saved: Boolean(r.saved), mine: Boolean(v.device && r.device === v.device), example: r.seed === 1,
  }
}

async function limited(db: D1Like, table: 'posts' | 'comments' | 'votes' | 'reports', kind: keyof typeof RATE_LIMITS, device: string): Promise<boolean> {
  const { max, windowMs } = RATE_LIMITS[kind]
  const r = await db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE device = ? AND ts > ?`).bind(device, Date.now() - windowMs).first<{ c: number }>()
  return (r?.c ?? 0) >= max
}

// ---------- Read ----------

export async function listPosts(db: D1Like, url: URL, v: Viewer): Promise<PostView[]> {
  const sort = url.searchParams.get('sort')
  const community = url.searchParams.get('c')
  const place = url.searchParams.get('place')
  const where: string[] = ['p.hidden = 0']
  const args: unknown[] = [v.device ?? '', v.device ?? '']
  if (community && COMMUNITY_IDS.has(community)) { where.push('p.community = ?'); args.push(community) }
  if (place && /^[nwr]\d{1,15}$/.test(place)) { where.push('p.place_id = ?'); args.push(place) }
  if (url.searchParams.get('saved') === '1') where.push('s.post_id IS NOT NULL')
  if (url.searchParams.get('mine') === '1') { where.push('p.device = ?'); args.push(v.device ?? '-') }
  // Your own reports hide a post for you straight away.
  where.push('NOT EXISTS (SELECT 1 FROM reports r WHERE r.kind = \'post\' AND r.target = p.id AND r.device = ?)')
  args.push(v.device ?? '')
  const order = sort === 'new' ? 'p.ts DESC' : sort === 'top' ? 'p.score DESC, p.ts DESC' : 'p.hot DESC, p.ts DESC'
  const rows = (await db.prepare(`SELECT ${POST_COLS}, vt.value AS my_vote, (s.post_id IS NOT NULL) AS saved FROM posts p
      LEFT JOIN votes vt ON vt.kind = 'post' AND vt.target = p.id AND vt.device = ?
      LEFT JOIN saves s ON s.post_id = p.id AND s.device = ?
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 60`).bind(...args).all<PostRow>()).results
  return rows.map((r) => postView(r, v))
}

export async function getPost(db: D1Like, id: string, v: Viewer): Promise<Out<{ post: PostView; comments: CommentView[] }>> {
  const row = await db.prepare(`SELECT ${POST_COLS}, vt.value AS my_vote, (s.post_id IS NOT NULL) AS saved FROM posts p
      LEFT JOIN votes vt ON vt.kind = 'post' AND vt.target = p.id AND vt.device = ?
      LEFT JOIN saves s ON s.post_id = p.id AND s.device = ?
      WHERE p.id = ?`).bind(v.device ?? '', v.device ?? '', id).first<PostRow>()
  if (!row || row.hidden) return bad(404, 'not_found', 'This post was removed or does not exist.')
  const crow = (await db.prepare(`SELECT c.id, c.post_id, c.parent_id, c.ts, c.device, c.nickname, c.seed, c.body, c.score, vt.value AS my_vote FROM comments c
      LEFT JOIN votes vt ON vt.kind = 'comment' AND vt.target = c.id AND vt.device = ?
      WHERE c.post_id = ? AND c.hidden = 0
        AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.kind = 'comment' AND r.target = c.id AND r.device = ?)
      ORDER BY c.score DESC, c.ts ASC`).bind(v.device ?? '', id, v.device ?? '').all<{
    id: string; post_id: string; parent_id: string | null; ts: number; device: string | null; nickname: string; seed: number; body: string; score: number; my_vote: number | null
  }>()).results
  const view = (c: (typeof crow)[number]): CommentView => ({
    id: c.id, postId: c.post_id, parentId: c.parent_id, ts: c.ts, nickname: c.nickname, initials: initials(c.nickname), body: c.body, score: c.score,
    myVote: (c.my_vote ?? 0) as VoteValue, mine: Boolean(v.device && c.device === v.device), example: c.seed === 1, replies: [],
  })
  const top = crow.filter((c) => !c.parent_id).map(view)
  const byId = new Map(top.map((c) => [c.id, c]))
  for (const c of crow) {
    if (!c.parent_id) continue
    const parent = byId.get(c.parent_id)
    if (parent) parent.replies.push(view(c))
  }
  // Replies read as a conversation: oldest first.
  for (const c of top) c.replies.sort((a, b) => a.ts - b.ts)
  return { ok: true, data: { post: postView(row, v), comments: top } }
}

export async function communityCounts(db: D1Like) {
  const rows = (await db.prepare('SELECT community, COUNT(*) n FROM posts WHERE hidden = 0 GROUP BY community').all<{ community: string; n: number }>()).results
  const counts = new Map(rows.map((r) => [r.community, r.n]))
  return COMMUNITIES.map((c) => ({ ...c, posts: counts.get(c.id) ?? 0 }))
}

export async function getPhoto(db: D1Like, id: string): Promise<{ type: string; bytes: Uint8Array } | null> {
  const row = await db.prepare('SELECT photo FROM posts WHERE id = ? AND hidden = 0').bind(id).first<{ photo: string | null }>()
  const m = row?.photo ? /^data:(image\/(?:jpeg|webp|png));base64,(.+)$/.exec(row.photo) : null
  if (!m) return null
  const bin = atob(m[2]!)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { type: m[1]!, bytes }
}

// ---------- Write ----------

const num = (x: unknown, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null)

export async function createPost(db: D1Like, body: Record<string, unknown>, v: Viewer): Promise<Out<PostView>> {
  if (!v.device) return bad(400, 'no_device', 'Missing device id.')
  const nick = checkNickname(body['nickname'])
  if (!nick.ok) return bad(400, nick.code, nick.message)
  const community = typeof body['community'] === 'string' && COMMUNITY_IDS.has(body['community']) ? body['community'] : null
  if (!community) return bad(400, 'bad_community', 'Pick a community.')
  const kind = body['kind'] === 'order' ? 'order' : 'text'
  const title = checkText(body['title'], 'title', 6, 140)
  if (!title.ok) return bad(400, title.code, title.message)
  const text = typeof body['body'] === 'string' && body['body'].trim() ? checkText(body['body'], 'text', 1, 2000) : ({ ok: true, text: '' } as const)
  if (!text.ok) return bad(400, text.code, text.message)

  let place: { id: string; name: string; lat: number; lng: number } | null = null
  const p = body['place'] as Record<string, unknown> | undefined
  if (p && typeof p['id'] === 'string' && /^[nwr]\d{1,15}$/.test(p['id']) && typeof p['name'] === 'string' && num(p['lat'], -85, 85) !== null && num(p['lng'], -180, 180) !== null) {
    place = { id: p['id'], name: p['name'].slice(0, 80), lat: p['lat'] as number, lng: p['lng'] as number }
  }
  let dish: { name: string; kcalLow: number; kcalHigh: number; protein: number; price: string | null } | null = null
  const d = body['dish'] as Record<string, unknown> | undefined
  if (kind === 'order') {
    const low = num(d?.['kcalLow'], 0, 4000), high = num(d?.['kcalHigh'], 0, 4000), protein = num(d?.['protein'], 0, 300)
    if (!d || typeof d['name'] !== 'string' || !d['name'].trim() || low === null || high === null || protein === null || low > high) return bad(400, 'bad_dish', 'A best-order post needs the dish and its numbers.')
    dish = { name: d['name'].trim().slice(0, 100), kcalLow: Math.round(low), kcalHigh: Math.round(high), protein: Math.round(protein), price: typeof d['price'] === 'string' ? d['price'].slice(0, 24) : null }
  }
  let photo: string | null = null
  if (typeof body['photo'] === 'string' && body['photo']) {
    if (!/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(body['photo'])) return bad(400, 'bad_photo', 'That photo could not be read.')
    if (body['photo'].length > 450_000) return bad(413, 'too_big', 'The photo is too large.')
    photo = body['photo']
  }
  if (await limited(db, 'posts', 'post', v.device)) return bad(429, 'rate_limited', 'You posted a lot just now. Take a break and try again in a few minutes.')

  const id = newId()
  const ts = Date.now()
  const goal = typeof body['goal'] === 'string' ? body['goal'].slice(0, 20) : null
  await db.batch([
    db.prepare(`INSERT INTO posts (id, ts, device, nickname, team, seed, community, kind, title, body, place_id, place_name, place_lat, place_lng, dish_name, kcal_low, kcal_high, protein, price, goal, photo, ups, downs, score, hot)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?)`).bind(
      id, ts, v.device, nick.text, v.team ? 1 : 0, community, kind, title.text, text.text, place?.id ?? null, place?.name ?? null, place?.lat ?? null, place?.lng ?? null,
      dish?.name ?? null, dish?.kcalLow ?? null, dish?.kcalHigh ?? null, dish?.protein ?? null, dish?.price ?? null, goal, photo, hotScore(1, 0, ts)),
    // Like Reddit, your own post starts with your upvote.
    db.prepare(`INSERT INTO votes (kind, target, device, value, ts, team) VALUES ('post', ?, ?, 1, ?, ?)`).bind(id, v.device, ts, v.team ? 1 : 0),
  ])
  const out = await getPost(db, id, v)
  return out.ok ? { ok: true, data: out.data.post } : out
}

export async function createComment(db: D1Like, body: Record<string, unknown>, v: Viewer): Promise<Out<CommentView>> {
  if (!v.device) return bad(400, 'no_device', 'Missing device id.')
  const nick = checkNickname(body['nickname'])
  if (!nick.ok) return bad(400, nick.code, nick.message)
  const text = checkText(body['body'], 'comment', 1, 1000)
  if (!text.ok) return bad(400, text.code, text.message)
  const postId = typeof body['postId'] === 'string' ? body['postId'] : ''
  const post = await db.prepare('SELECT id, hidden FROM posts WHERE id = ?').bind(postId).first<{ id: string; hidden: number }>()
  if (!post || post.hidden) return bad(404, 'not_found', 'This post was removed.')
  // One level of replies: a reply to a reply joins its parent's thread.
  let parentId: string | null = null
  if (typeof body['parentId'] === 'string' && body['parentId']) {
    const parent = await db.prepare('SELECT id, parent_id FROM comments WHERE id = ? AND post_id = ?').bind(body['parentId'], postId).first<{ id: string; parent_id: string | null }>()
    if (!parent) return bad(404, 'not_found', 'That comment was removed.')
    parentId = parent.parent_id ?? parent.id
  }
  if (await limited(db, 'comments', 'comment', v.device)) return bad(429, 'rate_limited', 'You commented a lot just now. Try again in a few minutes.')
  const id = newId()
  const ts = Date.now()
  await db.batch([
    db.prepare('INSERT INTO comments (id, post_id, parent_id, ts, device, nickname, team, seed, body, ups, downs, score) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1, 0, 1)')
      .bind(id, postId, parentId, ts, v.device, nick.text, v.team ? 1 : 0, text.text),
    db.prepare(`INSERT INTO votes (kind, target, device, value, ts, team) VALUES ('comment', ?, ?, 1, ?, ?)`).bind(id, v.device, ts, v.team ? 1 : 0),
    db.prepare('UPDATE posts SET comments = comments + 1 WHERE id = ?').bind(postId),
  ])
  return { ok: true, data: { id, postId, parentId, ts, nickname: nick.text, initials: initials(nick.text), body: text.text, score: 1, myVote: 1, mine: true, example: false, replies: [] } }
}

export async function vote(db: D1Like, body: Record<string, unknown>, v: Viewer): Promise<Out<{ score: number; myVote: VoteValue }>> {
  if (!v.device) return bad(400, 'no_device', 'Missing device id.')
  const kind = body['kind'] === 'comment' ? 'comment' : body['kind'] === 'post' ? 'post' : null
  const next = parseVote(body['value'])
  const id = typeof body['id'] === 'string' ? body['id'] : ''
  if (!kind || next === null || !id) return bad(400, 'bad_vote', 'Invalid vote.')
  const table = kind === 'post' ? 'posts' : 'comments'
  const target = await db.prepare(`SELECT ts, ups, downs, hidden FROM ${table} WHERE id = ?`).bind(id).first<{ ts: number; ups: number; downs: number; hidden: number }>()
  if (!target || target.hidden) return bad(404, 'not_found', 'This was removed.')
  if (await limited(db, 'votes', 'vote', v.device)) return bad(429, 'rate_limited', 'Slow down a little with the votes.')
  const prevRow = await db.prepare('SELECT value FROM votes WHERE kind = ? AND target = ? AND device = ?').bind(kind, id, v.device).first<{ value: number }>()
  const prev = (prevRow?.value ?? 0) as VoteValue
  if (prev === next) return { ok: true, data: { score: target.ups - target.downs, myVote: next } }
  const dlt = voteDelta(prev, next)
  const ups = target.ups + dlt.ups
  const downs = target.downs + dlt.downs
  const stmts = [
    next === 0
      ? db.prepare('DELETE FROM votes WHERE kind = ? AND target = ? AND device = ?').bind(kind, id, v.device)
      : db.prepare('INSERT OR REPLACE INTO votes (kind, target, device, value, ts, team) VALUES (?, ?, ?, ?, ?, ?)').bind(kind, id, v.device, next, Date.now(), v.team ? 1 : 0),
    kind === 'post'
      ? db.prepare('UPDATE posts SET ups = ups + ?, downs = downs + ?, score = score + ?, hot = ? WHERE id = ?').bind(dlt.ups, dlt.downs, dlt.ups - dlt.downs, hotScore(ups, downs, target.ts), id)
      : db.prepare('UPDATE comments SET ups = ups + ?, downs = downs + ?, score = score + ? WHERE id = ?').bind(dlt.ups, dlt.downs, dlt.ups - dlt.downs, id),
  ]
  await db.batch(stmts)
  return { ok: true, data: { score: ups - downs, myVote: next } }
}

export async function save(db: D1Like, body: Record<string, unknown>, v: Viewer): Promise<Out<{ saved: boolean }>> {
  if (!v.device) return bad(400, 'no_device', 'Missing device id.')
  const id = typeof body['postId'] === 'string' ? body['postId'] : ''
  const on = body['on'] !== false
  const exists = await db.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first()
  if (!exists) return bad(404, 'not_found', 'This post does not exist.')
  if (on) await db.prepare('INSERT OR IGNORE INTO saves (device, post_id, ts) VALUES (?, ?, ?)').bind(v.device, id, Date.now()).run()
  else await db.prepare('DELETE FROM saves WHERE device = ? AND post_id = ?').bind(v.device, id).run()
  return { ok: true, data: { saved: on } }
}

/** Report a post or comment. Each device counts once; at 3 different devices it hides for everyone. */
export async function report(db: D1Like, body: Record<string, unknown>, v: Viewer): Promise<Out<{ hidden: boolean; reports: number }>> {
  if (!v.device) return bad(400, 'no_device', 'Missing device id.')
  const kind = body['kind'] === 'comment' ? 'comment' : body['kind'] === 'post' ? 'post' : null
  const id = typeof body['id'] === 'string' ? body['id'] : ''
  if (!kind || !id) return bad(400, 'bad_report', 'Invalid report.')
  const table = kind === 'post' ? 'posts' : 'comments'
  const target = await db.prepare(`SELECT device FROM ${table} WHERE id = ?`).bind(id).first<{ device: string | null }>()
  if (!target) return bad(404, 'not_found', 'This was already removed.')
  if (target.device && target.device === v.device) return bad(400, 'own', 'You cannot report your own post. Delete it instead.')
  if (await limited(db, 'reports', 'report', v.device)) return bad(429, 'rate_limited', 'You sent many reports. Thanks, we have them.')
  const reason = typeof body['reason'] === 'string' ? body['reason'].slice(0, 60) : null
  await db.prepare('INSERT OR IGNORE INTO reports (kind, target, device, ts, reason) VALUES (?, ?, ?, ?, ?)').bind(kind, id, v.device, Date.now(), reason).run()
  const n = (await db.prepare('SELECT COUNT(DISTINCT device) c FROM reports WHERE kind = ? AND target = ?').bind(kind, id).first<{ c: number }>())?.c ?? 0
  const hidden = shouldHide(n)
  await db.prepare(`UPDATE ${table} SET reports = ?, hidden = CASE WHEN ? THEN 1 ELSE hidden END WHERE id = ?`).bind(n, hidden ? 1 : 0, id).run()
  if (hidden && kind === 'comment') {
    const c = await db.prepare('SELECT post_id FROM comments WHERE id = ?').bind(id).first<{ post_id: string }>()
    if (c) await db.prepare('UPDATE posts SET comments = (SELECT COUNT(*) FROM comments WHERE post_id = ? AND hidden = 0) WHERE id = ?').bind(c.post_id, c.post_id).run()
  }
  return { ok: true, data: { hidden, reports: n } }
}

/** Authors can delete their own posts and comments. */
export async function remove(db: D1Like, body: Record<string, unknown>, v: Viewer): Promise<Out<{ removed: boolean }>> {
  const kind = body['kind'] === 'comment' ? 'comment' : body['kind'] === 'post' ? 'post' : null
  const id = typeof body['id'] === 'string' ? body['id'] : ''
  if (!kind || !id || !v.device) return bad(400, 'bad_request', 'Invalid request.')
  const table = kind === 'post' ? 'posts' : 'comments'
  const r = await db.prepare(`UPDATE ${table} SET hidden = 1 WHERE id = ? AND device = ?`).bind(id, v.device).run()
  if (kind === 'comment') {
    await db.prepare('UPDATE posts SET comments = (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND hidden = 0) WHERE id = (SELECT post_id FROM comments WHERE id = ?)').bind(id).run()
  }
  return { ok: true, data: { removed: Boolean((r.meta as { changes?: number }).changes) } }
}

export async function communityNumbers(db: D1Like) {
  const q = async (sql: string) => (await db.prepare(sql).first<{ c: number }>())?.c ?? 0
  return {
    posts: await q('SELECT COUNT(*) c FROM posts WHERE seed = 0 AND team = 0'),
    comments: await q('SELECT COUNT(*) c FROM comments WHERE seed = 0 AND team = 0'),
    votes: await q(`SELECT COUNT(*) c FROM votes v WHERE v.team = 0 AND NOT EXISTS (
      SELECT 1 FROM posts p WHERE v.kind = 'post' AND p.id = v.target AND p.device = v.device) AND NOT EXISTS (
      SELECT 1 FROM comments c WHERE v.kind = 'comment' AND c.id = v.target AND c.device = v.device)`),
    activePosters: await q(`SELECT COUNT(DISTINCT device) c FROM (SELECT device FROM posts WHERE seed = 0 AND team = 0 UNION SELECT device FROM comments WHERE seed = 0 AND team = 0)`),
    scansOnMap: await q('SELECT COUNT(DISTINCT scan_id) c FROM place_dishes WHERE seed = 0 AND team = 0'),
  }
}
