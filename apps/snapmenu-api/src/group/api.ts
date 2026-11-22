import { aiSettings, type AiEnv } from '../ai-config.js'
/**
 * Eating together: the routes and their storage (D1).
 *
 *   POST /api/group         open a group (friends plan a meal out) or a table (one scanned menu)
 *   GET  /api/group?id=     the group: its people, and what fits them (`since=` answers "unchanged" for polling)
 *   POST /api/group/join    add a person, or change one this phone added
 *   POST /api/group/leave   remove a person this phone added
 *   POST /api/group/vote    one vote per person for a restaurant
 *   POST /api/group/menu    put a scanned menu on the group (table mode), or take it off again
 *   POST /api/group/needs   plain text (a typed note, a voice transcript) -> needs
 *
 * No accounts: a group is whoever has its link. A person is a first name and
 * their needs, added from a phone (its random device id decides who may change it).
 * Groups are deleted 30 days after they were opened.
 */
import { setAiBaseUrl } from '../anthropic.js'
import { checkText, distanceM } from '../community.js'
import type { D1Like } from '../d1-adapter.js'
import { allergensFromWords, dishAllergens, DISH_ROWS, OSM_ATTRIBUTION, parsePriceEur, readDishHints } from '../places.js'
import { say, userLanguage, type Lang } from '../voice/index.js'
import { askNeeds } from './ai.js'
import { matchPlaces, newMemo, pickFor, type Candidate, type Member, type PlaceInput } from './match.js'
import { cleanName, cleanNeeds, MAX_NEEDS_TEXT, mergeModelNeeds, parseNeedsText, worthAsking } from './needs.js'
import type { GroupKind, GroupView, ParsedNeeds } from './types.js'

export interface GroupEnv extends AiEnv {
  DB: D1Like
  ANTHROPIC_API_KEY?: string
  MODEL_READ?: string
  MODEL_VOICE?: string
  ANTHROPIC_BASE_URL?: string
}

/** The same statements as migrations/0100_group.sql; run on first use so a fresh local D1 works without a migration step. */
export const GROUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS grp_groups (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, lat REAL, lng REAL, device TEXT, team INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL, updated INTEGER NOT NULL, restaurant TEXT, scan_id TEXT, menu TEXT)`,
  `CREATE TABLE IF NOT EXISTS grp_members (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, device TEXT, needs TEXT NOT NULL, lat REAL, lng REAL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_grp_members_group ON grp_members(group_id)`,
  `CREATE TABLE IF NOT EXISTS grp_votes (group_id TEXT NOT NULL, member_id TEXT NOT NULL, place_id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (group_id, member_id))`,
]

export const GROUP_LIMITS = {
  members: 12,
  menuDishes: 40,
  /** Groups one phone may open per hour. */
  opens: { max: 30, windowMs: 60 * 60_000 },
  /** Model readings of a note per hour: for one phone, and for everyone together (it is the only paid step here). */
  ai: { perDevice: 12, total: 300, windowMs: 60 * 60_000 },
  keepMs: 30 * 24 * 60 * 60_000,
} as const

let schemaReady: Promise<void> | null = null
function ensureGroupSchema(db: D1Like): Promise<void> {
  schemaReady ??= (async () => { for (const sql of GROUP_SCHEMA) await db.prepare(sql).run() })().catch((e) => { schemaReady = null; throw e })
  return schemaReady
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-device, x-team, x-lang',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status)

interface Viewer { device: string | null; team: boolean; lang: Lang }

function viewerOf(req: Request): Viewer {
  const d = req.headers.get('x-device')
  return {
    device: d && /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null,
    team: req.headers.get('x-team') === '1',
    lang: userLanguage({ locale: req.headers.get('x-lang'), acceptLanguage: req.headers.get('accept-language') }),
  }
}

/** Link codes: 8 characters without look-alikes (no 0/O, 1/I/L), easy to read out and to type. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newCode(length = 8): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}
export const cleanCode = (raw: unknown): string | null => {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return /^[A-HJKMNP-Z2-9]{8}$/.test(code) ? code : null
}

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const COURSES = new Set(['main', 'starter', 'side', 'dessert', 'drink'])

/**
 * A scanned menu as the app sent it, checked like a scan filed on the map: every
 * number in range, the calorie range in order. A dish keeps the allergy hints of
 * its scan, plus what its own words point to.
 */
export function cleanMenu(raw: unknown): { scanId: string | null; restaurant: string | null; dishes: Candidate[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const list = Array.isArray(r['dishes']) ? (r['dishes'] as unknown[]).slice(0, GROUP_LIMITS.menuDishes) : []
  const dishes: Candidate[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const d = item as Record<string, unknown>
    const name = str(d['name'], 80)
    const k = d['kcal'] as Record<string, unknown> | undefined
    const low = num(k?.['low'], 0, 4000), mid = num(k?.['mid'], 0, 4000), high = num(k?.['high'], 0, 4000)
    const protein = num(d['protein'], 0, 300), carbs = num(d['carbs'], 0, 500), fat = num(d['fat'], 0, 300)
    if (!name || low === null || mid === null || high === null || protein === null || carbs === null || fat === null || !(low <= mid && mid <= high)) continue
    if (dishes.some((x) => x.name === name)) continue
    const translated = str(d['translated'], 120)
    const price = str(d['price'], 24)
    const fromScan = dishAllergens(d['allergens'])
    dishes.push({
      name, translated: translated === name ? null : translated, price, priceEur: parsePriceEur(price),
      kcal: { low: Math.round(low), mid: Math.round(mid), high: Math.round(high) },
      protein: +protein.toFixed(1), carbs: +carbs.toFixed(1), fat: +fat.toFixed(1), fiber: num(d['fiber'], 0, 100) ?? 0,
      vegetarian: d['vegetarian'] === true || d['vegan'] === true, vegan: d['vegan'] === true,
      allergens: [...new Set([...fromScan, ...allergensFromWords(name, translated)])],
      course: typeof d['course'] === 'string' && COURSES.has(d['course']) ? (d['course'] as Candidate['course']) : 'main',
      example: false,
    })
  }
  return dishes.length ? { scanId: str(r['scanId'], 64), restaurant: str(r['restaurant'], 80), dishes } : null
}

interface GroupRow { id: string; kind: GroupKind; name: string; lat: number | null; lng: number | null; device: string | null; ts: number; updated: number; restaurant: string | null; menu: string | null }
interface MemberRow { id: string; name: string; device: string | null; needs: string; lat: number | null; lng: number | null }
interface DishRow {
  place_id: string; place_name: string; lat: number; lng: number; kind: string | null; cuisine: string | null; seed: number; ts: number
  name: string; translated: string | null; kcal_low: number; kcal_mid: number; kcal_high: number; protein: number; carbs: number; fat: number; fiber: number
  price: string | null; vegetarian: number; vegan: number; course: Candidate['course']; allergens: string | null
}

const parse = (text: string | null): unknown => { try { return text ? JSON.parse(text) : null } catch { return null } }

const loadGroup = (db: D1Like, id: string) =>
  db.prepare('SELECT id, kind, name, lat, lng, device, ts, updated, restaurant, menu FROM grp_groups WHERE id = ?').bind(id).first<GroupRow>()

/** In the order they were added. */
const loadMembers = async (db: D1Like, id: string) =>
  (await db.prepare('SELECT id, name, device, needs, lat, lng FROM grp_members WHERE group_id = ? ORDER BY rowid').bind(id).all<MemberRow>()).results

/** Every change moves `updated` forward, so a phone that polls sees it. */
const touch = (db: D1Like, g: GroupRow) => db.prepare('UPDATE grp_groups SET updated = ? WHERE id = ?').bind(Math.max(Date.now(), g.updated + 1), g.id).run()

/** Where "near the group" is: between the people who shared their position, else where the group was opened. */
export function centerOf(g: { lat: number | null; lng: number | null }, members: Array<{ lat: number | null; lng: number | null }>): { lat: number; lng: number } | null {
  const shared = members.filter((m): m is { lat: number; lng: number } => m.lat !== null && m.lng !== null)
  if (shared.length) return { lat: shared.reduce((s, m) => s + m.lat, 0) / shared.length, lng: shared.reduce((s, m) => s + m.lng, 0) / shared.length }
  return g.lat !== null && g.lng !== null ? { lat: g.lat, lng: g.lng } : null
}

/** The app's fallback position (apps/snapmenu-web/src/lib/position.ts BERLIN_MITTE): used until someone in the group shares theirs. */
export const DEFAULT_CENTER = { lat: 52.5235, lng: 13.404 } as const

/** Search boxes around the group, in degrees: about 2 km, then about 10 km when nothing was scanned close by. */
const BOXES = [{ lat: 0.02, lng: 0.03, wide: false }, { lat: 0.09, lng: 0.14, wide: true }] as const

/** How much one look around may take in: the newest scanned dishes in the box, then the nearest places with their newest dishes. */
const NEAR = { rows: 300, places: 10, dishesPerPlace: 12 } as const

/** Restaurants around a point with the dishes the community scanned there (the map's own table), nearest first. */
export async function placesNear(db: D1Like, c: { lat: number; lng: number }, withAllergens = true, menus: 'all' | 'verified' = 'all'): Promise<{ places: PlaceInput[]; wide: boolean }> {
  // A chat plan needs several real options. Search the full area once and omit examples
  // before the row and place limits so they cannot crowd out verified menu observations.
  const boxes = menus === 'verified' ? BOXES.slice(-1) : BOXES
  const source = menus === 'verified' ? 'AND d.seed = 0 AND d.osm_verified = 1' : ''
  for (const box of boxes) {
    const rows = (await db.prepare(`${DISH_ROWS} WHERE d.lat BETWEEN ? AND ? AND d.lng BETWEEN ? AND ? ${source} ORDER BY d.seed ASC, d.ts DESC, d.id DESC LIMIT ${NEAR.rows}`)
      .bind(c.lat - box.lat, c.lat + box.lat, c.lng - box.lng, c.lng + box.lng).all<DishRow>()).results
    if (rows.length === 0) continue
    const byPlace = new Map<string, { first: DishRow; dishes: Map<string, Candidate> }>()
    for (const row of rows) {
      let p = byPlace.get(row.place_id)
      if (!p) { p = { first: row, dishes: new Map() }; byPlace.set(row.place_id, p) }
      const key = row.name.toLowerCase()
      // Rows come newest first: the latest scan of a dish wins, and a place counts with its newest dishes.
      if (row.seed !== p.first.seed || p.dishes.has(key) || p.dishes.size >= NEAR.dishesPerPlace) continue
      p.dishes.set(key, {
        name: row.name, translated: row.translated, price: row.price, priceEur: parsePriceEur(row.price),
        kcal: { low: row.kcal_low, mid: row.kcal_mid, high: row.kcal_high }, protein: row.protein, carbs: row.carbs, fat: row.fat, fiber: row.fiber,
        // Reading a dish's words for allergens is the costly step here: skipped when nobody in the group has an allergy.
        vegetarian: Boolean(row.vegetarian), vegan: Boolean(row.vegan), allergens: withAllergens ? readDishHints(row) : [], course: row.course, example: row.seed === 1,
      })
    }
    const places = [...byPlace.entries()]
      .map(([id, p]): PlaceInput => ({
        place: { id, name: p.first.place_name, lat: p.first.lat, lng: p.first.lng, kind: p.first.kind ?? 'restaurant', cuisine: p.first.cuisine, address: null },
        distanceM: distanceM(c.lat, c.lng, p.first.lat, p.first.lng),
        dishes: [...p.dishes.values()],
      }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, NEAR.places)
    return { places, wide: box.wide }
  }
  return { places: [], wide: false }
}

/** The whole group as one phone sees it. */
export async function viewGroup(db: D1Like, g: GroupRow, v: Viewer): Promise<GroupView> {
  const rows = await loadMembers(db, g.id)
  const members: Member[] = rows.map((r) => ({ id: r.id, name: r.name, needs: cleanNeeds(parse(r.needs)) }))
  const view: GroupView = {
    id: g.id, kind: g.kind, name: g.name, updated: g.updated,
    members: rows.map((r, i) => ({ ...members[i]!, mine: Boolean(v.device) && r.device === v.device })),
    matches: [], conflicts: [], noPlaceForAll: false, wide: false, located: true, table: null, attribution: OSM_ATTRIBUTION,
  }
  const menu = (parse(g.menu) as { dishes?: Candidate[] } | null)?.dishes
  if (Array.isArray(menu) && menu.length) {
    const memo = newMemo()
    view.table = { restaurant: g.restaurant, dishes: menu.length, results: members.map((m) => pickFor(m, menu, v.lang, 'menu', memo)) }
    return view
  }
  if (g.kind !== 'group') return view
  const shared = centerOf(g, rows)
  view.located = shared !== null
  if (members.length === 0) return view
  const near = await placesNear(db, shared ?? DEFAULT_CENTER, members.some((m) => m.needs.allergies.length > 0))
  const out = matchPlaces(members, near.places, v.lang)
  const votes = (await db.prepare('SELECT member_id, place_id FROM grp_votes WHERE group_id = ?').bind(g.id).all<{ member_id: string; place_id: string }>()).results
  const alive = new Set(members.map((m) => m.id))
  for (const m of out.matches) m.voters = votes.filter((x) => x.place_id === m.place.id && alive.has(x.member_id)).map((x) => x.member_id)
  return { ...view, matches: out.matches, conflicts: out.conflicts, noPlaceForAll: out.noPlaceForAll, wide: near.wide }
}

async function logEvent(db: D1Like, type: string, v: Viewer, props: Record<string, unknown>): Promise<void> {
  try {
    await db.prepare('INSERT INTO events (ts, type, device, team, props) VALUES (?, ?, ?, ?, ?)').bind(Date.now(), type, v.device?.slice(0, 64) ?? null, v.team ? 1 : 0, JSON.stringify(props).slice(0, 2000)).run()
  } catch { /* analytics never break a request */ }
}

/** The model is asked only within the hourly limits. Without the events table there is nothing to count with, so it is not asked. */
async function aiAllowed(db: D1Like, v: Viewer): Promise<boolean> {
  if (!v.device) return false
  try {
    const r = await db.prepare("SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN device = ? THEN 1 ELSE 0 END), 0) mine FROM events WHERE type = 'group_needs_ai' AND ts > ?")
      .bind(v.device, Date.now() - GROUP_LIMITS.ai.windowMs).first<{ total: number; mine: number }>()
    return (r?.total ?? 0) < GROUP_LIMITS.ai.total && (r?.mine ?? 0) < GROUP_LIMITS.ai.perDevice
  } catch {
    return false
  }
}

/** Plain text to needs: the word rules always, the model on top when it is there and the note is worth it. */
export async function readNeeds(env: GroupEnv, v: Viewer, text: string, ask: typeof askNeeds = askNeeds): Promise<ParsedNeeds> {
  const rules = parseNeedsText(text)
  if (!aiSettings(env).apiKey || !worthAsking(text, rules) || !(await aiAllowed(env.DB, v))) return rules
  setAiBaseUrl(env.ANTHROPIC_BASE_URL)
  await logEvent(env.DB, 'group_needs_ai', v, {})
  try {
    const slow = new Promise<never>((_ok, no) => setTimeout(() => no(new Error('slow')), 9000))
    const model = await Promise.race([ask({ ...aiSettings(env) }, text), slow])
    return mergeModelNeeds(rules, model, text)
  } catch {
    // The service is slow or down: the word rules stand.
    return rules
  }
}

const position = (b: Record<string, unknown>) => {
  const lat = num(b['lat'], -85, 85), lng = num(b['lng'], -180, 180)
  return lat === null || lng === null ? { lat: null, lng: null } : { lat: +lat.toFixed(5), lng: +lng.toFixed(5) }
}

async function open(db: D1Like, b: Record<string, unknown>, v: Viewer): Promise<Response> {
  if (!v.device) return fail(400, 'no_device', 'Missing device id.')
  const { max, windowMs } = GROUP_LIMITS.opens
  const recent = await db.prepare('SELECT COUNT(*) c FROM grp_groups WHERE device = ? AND ts > ?').bind(v.device, Date.now() - windowMs).first<{ c: number }>()
  if ((recent?.c ?? 0) >= max) return fail(429, 'rate_limited', say(v.lang, 'community.slow_posts'))
  const kind: GroupKind = b['kind'] === 'table' ? 'table' : 'group'
  const menu = b['menu'] == null ? null : cleanMenu(b['menu'])
  if (b['menu'] != null && !menu) return fail(400, 'bad_menu', say(v.lang, 'community.failed'))
  if (kind === 'table' && !menu) return fail(400, 'no_menu', say(v.lang, 'community.failed'))
  let name = ''
  if (typeof b['name'] === 'string' && b['name'].trim()) {
    const checked = checkText(b['name'], 'name', 1, 40, v.lang)
    if (!checked.ok) return fail(400, checked.code, checked.message)
    name = checked.text
  }
  const { lat, lng } = position(b)
  const now = Date.now()
  const id = newCode()
  await db.prepare('INSERT INTO grp_groups (id, kind, name, lat, lng, device, team, ts, updated, restaurant, scan_id, menu) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, kind, name, lat, lng, v.device, v.team ? 1 : 0, now, now, menu?.restaurant ?? null, menu?.scanId ?? null, menu ? JSON.stringify({ dishes: menu.dishes }) : null).run()
  // Old groups go when a new one is opened: a first name and needs are not kept for longer than they are useful.
  const old = now - GROUP_LIMITS.keepMs
  await db.batch([
    db.prepare('DELETE FROM grp_votes WHERE group_id IN (SELECT id FROM grp_groups WHERE ts < ?)').bind(old),
    db.prepare('DELETE FROM grp_members WHERE group_id IN (SELECT id FROM grp_groups WHERE ts < ?)').bind(old),
    db.prepare('DELETE FROM grp_groups WHERE ts < ?').bind(old),
  ])
  await logEvent(db, 'group_open', v, { kind, dishes: menu?.dishes.length ?? 0 })
  const g = (await loadGroup(db, id))!
  return json({ id, group: await viewGroup(db, g, v) })
}

async function join(db: D1Like, g: GroupRow, b: Record<string, unknown>, v: Viewer): Promise<Response> {
  if (!v.device) return fail(400, 'no_device', 'Missing device id.')
  const name = cleanName(b['name'])
  const checked = name ? checkText(name, 'name', 1, 24, v.lang) : null
  if (!name || !checked) return fail(400, 'bad_name', say(v.lang, 'community.empty'))
  if (!checked.ok) return fail(400, checked.code, checked.message)
  const needs = JSON.stringify(cleanNeeds(b['needs']))
  const { lat, lng } = position(b)
  let memberId = typeof b['memberId'] === 'string' ? b['memberId'] : null
  if (memberId) {
    const own = await db.prepare('SELECT id FROM grp_members WHERE id = ? AND group_id = ? AND device = ?').bind(memberId, g.id, v.device).first<{ id: string }>()
    if (!own) return fail(403, 'not_yours', say(v.lang, 'community.gone'))
    await db.prepare('UPDATE grp_members SET name = ?, needs = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng) WHERE id = ?').bind(name, needs, lat, lng, memberId).run()
  } else {
    const n = await db.prepare('SELECT COUNT(*) c FROM grp_members WHERE group_id = ?').bind(g.id).first<{ c: number }>()
    if ((n?.c ?? 0) >= GROUP_LIMITS.members) return fail(409, 'full', say(v.lang, 'community.failed'))
    memberId = crypto.randomUUID()
    await db.prepare('INSERT INTO grp_members (id, group_id, name, device, needs, lat, lng, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(memberId, g.id, name, v.device, needs, lat, lng, Date.now()).run()
    await logEvent(db, 'group_join', v, { kind: g.kind })
  }
  await touch(db, g)
  return json({ memberId, group: await viewGroup(db, (await loadGroup(db, g.id))!, v) })
}

async function leave(db: D1Like, g: GroupRow, b: Record<string, unknown>, v: Viewer): Promise<Response> {
  const memberId = typeof b['memberId'] === 'string' ? b['memberId'] : ''
  const row = await db.prepare('SELECT device FROM grp_members WHERE id = ? AND group_id = ?').bind(memberId, g.id).first<{ device: string | null }>()
  // The phone that added a person may remove them, and so may the phone that opened the group.
  if (!row || !v.device || (row.device !== v.device && g.device !== v.device)) return fail(403, 'not_yours', say(v.lang, 'community.gone'))
  await db.batch([
    db.prepare('DELETE FROM grp_votes WHERE group_id = ? AND member_id = ?').bind(g.id, memberId),
    db.prepare('DELETE FROM grp_members WHERE id = ? AND group_id = ?').bind(memberId, g.id),
  ])
  await touch(db, g)
  return json({ group: await viewGroup(db, (await loadGroup(db, g.id))!, v) })
}

async function vote(db: D1Like, g: GroupRow, b: Record<string, unknown>, v: Viewer): Promise<Response> {
  const memberId = typeof b['memberId'] === 'string' ? b['memberId'] : ''
  const own = v.device ? await db.prepare('SELECT id FROM grp_members WHERE id = ? AND group_id = ? AND device = ?').bind(memberId, g.id, v.device).first<{ id: string }>() : null
  if (!own) return fail(403, 'not_yours', say(v.lang, 'community.gone'))
  const placeId = b['placeId']
  if (placeId === null) await db.prepare('DELETE FROM grp_votes WHERE group_id = ? AND member_id = ?').bind(g.id, memberId).run()
  else if (typeof placeId === 'string' && /^[nwr]\d{1,15}$/.test(placeId)) {
    await db.prepare('INSERT OR REPLACE INTO grp_votes (group_id, member_id, place_id, ts) VALUES (?, ?, ?, ?)').bind(g.id, memberId, placeId, Date.now()).run()
    await logEvent(db, 'group_vote', v, {})
  } else return fail(400, 'bad_vote', 'Invalid vote.')
  await touch(db, g)
  return json({ group: await viewGroup(db, (await loadGroup(db, g.id))!, v) })
}

async function setMenu(db: D1Like, g: GroupRow, b: Record<string, unknown>, v: Viewer): Promise<Response> {
  const inGroup = v.device ? g.device === v.device || Boolean(await db.prepare('SELECT id FROM grp_members WHERE group_id = ? AND device = ? LIMIT 1').bind(g.id, v.device).first<{ id: string }>()) : false
  if (!inGroup) return fail(403, 'not_yours', say(v.lang, 'community.gone'))
  const menu = b['menu'] == null ? null : cleanMenu(b['menu'])
  if (b['menu'] != null && !menu) return fail(400, 'bad_menu', say(v.lang, 'community.failed'))
  // A table is its menu: only a group that was planning a meal out can go back to the restaurant list.
  if (!menu && g.kind === 'table') return fail(400, 'no_menu', say(v.lang, 'community.failed'))
  await db.prepare('UPDATE grp_groups SET menu = ?, restaurant = ?, scan_id = ? WHERE id = ?').bind(menu ? JSON.stringify({ dishes: menu.dishes }) : null, menu?.restaurant ?? null, menu?.scanId ?? null, g.id).run()
  await touch(db, g)
  if (menu) await logEvent(db, 'group_menu', v, { dishes: menu.dishes.length })
  return json({ group: await viewGroup(db, (await loadGroup(db, g.id))!, v) })
}

/** The group routes. Returns null for any other path, so the Worker's router moves on. */
export async function handleGroup(req: Request, env: GroupEnv, url: URL): Promise<Response | null> {
  const p = url.pathname
  if (p !== '/api/group' && !p.startsWith('/api/group/')) return null
  await ensureGroupSchema(env.DB)
  const v = viewerOf(req)
  const db = env.DB
  const gone = () => fail(404, 'not_found', say(v.lang, 'community.gone'))

  if (req.method === 'GET') {
    if (p !== '/api/group') return null
    const id = cleanCode(url.searchParams.get('id'))
    const g = id ? await loadGroup(db, id) : null
    if (!g) return gone()
    // Polling costs one row read while nothing changed.
    if (url.searchParams.get('since') === String(g.updated)) return json({ unchanged: true, updated: g.updated })
    return json({ group: await viewGroup(db, g, v) })
  }
  if (req.method !== 'POST') return null
  let b: Record<string, unknown>
  try { b = (await req.json()) as Record<string, unknown> } catch { return fail(400, 'bad_json', 'Request body must be JSON.') }
  if (!b || typeof b !== 'object') return fail(400, 'bad_json', 'Request body must be JSON.')

  if (p === '/api/group') return open(db, b, v)
  if (p === '/api/group/needs') {
    const text = typeof b['text'] === 'string' ? b['text'].slice(0, MAX_NEEDS_TEXT).trim() : ''
    if (text.length < 2) return fail(400, 'empty', say(v.lang, 'community.empty'))
    return json(await readNeeds(env, v, text))
  }
  const routes: Record<string, (db: D1Like, g: GroupRow, b: Record<string, unknown>, v: Viewer) => Promise<Response>> = {
    '/api/group/join': join, '/api/group/leave': leave, '/api/group/vote': vote, '/api/group/menu': setMenu,
  }
  const fn = routes[p]
  if (!fn) return null
  const id = cleanCode(b['id'])
  const g = id ? await loadGroup(db, id) : null
  return g ? fn(db, g, b, v) : gone()
}
