/**
 * Example data so the map and the community are not empty on day one.
 * Every row is marked seed = 1: the app labels it "Example" and /numbers never counts it.
 * Places are real OpenStreetMap restaurants around the Berlin Mitte fallback position;
 * the dishes and numbers are illustrative examples, not scans of their menus.
 */

import { hotScore } from './community.js'

const T0 = Date.UTC(2026, 10, 20, 11, 0, 0)
const q = (s: string | null) => (s === null ? 'NULL' : `'${s.replace(/'/g, "''")}'`)

// place id, name, lat, lng, kind, cuisine
type P = [string, string, number, number, string, string]
// dish, translated, kcal low, mid, high, protein, carbs, fat, fiber, price, vegetarian, vegan
type D = [string, string | null, number, number, number, number, number, number, number, string | null, 0 | 1, 0 | 1]

export const SEED_PLACES: Array<{ place: P; dishes: D[] }> = [
  { place: ['n975312181', "Mustafa's Can Gemüse Kebap", 52.5226768, 13.4011539, 'fast_food', 'Kebab'], dishes: [
    ['Hähnchen Gemüse Döner', 'Chicken veggie döner', 620, 720, 830, 38, 72, 26, 6, '7,50 €', 0, 0],
    ['Hähnchen Döner Teller mit Salat', 'Chicken döner plate with salad', 520, 610, 720, 44, 34, 30, 7, '11,00 €', 0, 0],
  ] },
  { place: ['n1860405863', 'dean&david', 52.5235038, 13.398912, 'fast_food', 'Salad, Sandwich'], dishes: [
    ['Chicken Caesar Salad', null, 450, 530, 610, 38, 18, 31, 5, '10,90 €', 0, 0],
    ['Green Goddess Bowl', null, 480, 560, 650, 17, 62, 24, 11, '11,50 €', 1, 1],
  ] },
  { place: ['n1860427541', 'Quy Nguyen Vegan Living', 52.5237141, 13.4004769, 'restaurant', 'Vietnamese'], dishes: [
    ['Phở Chay mit Tofu', 'Tofu pho', 420, 490, 560, 22, 66, 10, 5, '12,50 €', 1, 1],
  ] },
  { place: ['n959287072', 'Kebab Kitchen', 52.5244815, 13.4031679, 'fast_food', 'Kebab'], dishes: [
    ['Falafel Teller', 'Falafel plate', 720, 830, 950, 24, 92, 38, 14, '9,00 €', 1, 1],
    ['Hähnchen Dürüm', 'Chicken wrap', 640, 740, 860, 40, 78, 27, 5, '7,50 €', 0, 0],
  ] },
  { place: ['n1860423254', 'Saveur de Bánh Mì', 52.5235794, 13.399975, 'fast_food', 'Vietnamese'], dishes: [
    ['Bánh Mì Gà', 'Chicken bánh mì', 480, 550, 620, 31, 62, 14, 4, '8,90 €', 0, 0],
  ] },
  { place: ['n5037669578', 'Got Rice', 52.5237292, 13.4092181, 'fast_food', 'Korean'], dishes: [
    ['Bibimbap mit Rind', 'Beef bibimbap', 620, 710, 800, 35, 86, 19, 7, '12,90 €', 0, 0],
  ] },
  { place: ['n3895254315', "MOM's vegan cooking", 52.5233173, 13.4081119, 'restaurant', 'Vietnamese'], dishes: [
    ['Bún Chay', 'Vegan rice noodle bowl', 500, 580, 650, 20, 80, 15, 8, '11,90 €', 1, 1],
  ] },
]

export const SEED_SQL: string[] = SEED_PLACES.flatMap(({ place: [id, name, lat, lng, kind, cuisine], dishes }, i) =>
  dishes.map((d, j) => {
    const [dish, tr, lo, mid, hi, p, c, f, fib, price, veg, vegan] = d
    return `INSERT OR IGNORE INTO place_dishes (place_id, place_name, lat, lng, kind, cuisine, scan_id, device, team, seed, ts, name, translated, kcal_low, kcal_mid, kcal_high, protein, carbs, fat, fiber, price, vegetarian, vegan)
      VALUES (${q(id)}, ${q(name)}, ${lat}, ${lng}, ${q(kind)}, ${q(cuisine)}, 'seed-scan-${i + 1}', NULL, 0, 1, ${T0 - (i * 3 + j) * 3_600_000}, ${q(dish)}, ${q(tr)}, ${lo}, ${mid}, ${hi}, ${p}, ${c}, ${f}, ${fib}, ${q(price)}, ${veg}, ${vegan})`
  }),
)

// ---------- Example community posts ----------


interface SeedPost {
  id: string; ago: number; nick: string; c: string; kind: 'order' | 'text'; title: string; body: string; ups: number
  place?: [string, string, number, number]; dish?: [string, number, number, number, string | null]; goal?: string; via?: 'wolt' | 'lieferando' | 'ubereats'
  comments?: Array<{ id: string; ago: number; nick: string; body: string; ups: number; replies?: Array<{ id: string; ago: number; nick: string; body: string; ups: number }> }>
}

const H = 3_600_000
const SEED_POSTS: SeedPost[] = [
  {
    id: 'ex-post-1', ago: 3 * H, nick: 'lena.lifts', c: 'HighProtein', kind: 'order', ups: 24, goal: 'build_muscle',
    title: 'Döner plate with salad instead of fries: 44 g protein for about 610 kcal',
    body: 'Ask for the plate with extra salad and the sauce on the side. Way more protein per euro than the wrap.',
    place: ['n975312181', "Mustafa's Can Gemüse Kebap", 52.5226768, 13.4011539], dish: ['Hähnchen Döner Teller mit Salat', 520, 720, 44, '11,00 €'],
    comments: [
      { id: 'ex-c-1', ago: 2.5 * H, nick: 'jonas_b', body: 'The queue is long at lunch, go before 12.', ups: 9, replies: [{ id: 'ex-c-2', ago: 2 * H, nick: 'lena.lifts', body: 'True, 11:40 was fine for me.', ups: 4 }] },
      { id: 'ex-c-3', ago: 1.5 * H, nick: 'mehmet.k', body: 'Does the range include the garlic sauce?', ups: 3 },
    ],
  },
  {
    id: 'ex-post-2', ago: 6 * H, nick: 'kiezkatze', c: 'Kreuzberg', kind: 'text', ups: 17,
    title: 'Best high-protein lunch in Kreuzberg under 12 EUR?',
    body: 'Working near Kotti this week. Looking for 35 g+ protein and not a 1,200 kcal plate. Go.',
    comments: [
      { id: 'ex-c-4', ago: 5 * H, nick: 'ana.eats', body: 'Chicken shawarma plate, skip the fries, double salad. Scan the menu, it ranks it right at the top.', ups: 11 },
      { id: 'ex-c-5', ago: 4 * H, nick: 'tomwalks', body: 'Lentil soup + grilled halloumi works for veggie protein too.', ups: 5 },
    ],
  },
  {
    id: 'ex-post-3', ago: 9 * H, nick: 'mila.plants', c: 'Vegan', kind: 'order', ups: 15, goal: 'plant_based',
    title: 'Tofu pho that actually fills you up, 420-560 kcal',
    body: 'Fully vegan place. Ask for extra tofu, it pushes the protein past 25 g.',
    place: ['n1860427541', 'Quy Nguyen Vegan Living', 52.5237141, 13.4004769], dish: ['Phở Chay mit Tofu', 420, 560, 22, '12,50 €'],
    comments: [{ id: 'ex-c-6', ago: 8 * H, nick: 'veganbär', body: 'Their summer rolls are a good side if you are still hungry.', ups: 6 }],
  },
  {
    id: 'ex-post-4', ago: 14 * H, nick: 'sam.cuts', c: 'LoseFat', kind: 'order', ups: 12, goal: 'lose_fat',
    title: 'Caesar salad is the move at dean&david, 38 g protein',
    body: 'Dressing on the side drops it closer to the low end of the range.',
    place: ['n1860405863', 'dean&david', 52.5235038, 13.398912], dish: ['Chicken Caesar Salad', 450, 610, 38, '10,90 €'],
  },
  {
    id: 'ex-post-7', ago: 2 * H, nick: 'deskdinner', c: 'Delivery', kind: 'order', ups: 19, goal: 'build_muscle', via: 'wolt',
    title: 'Delivered Caesar salad, 38 g protein for 450-610 kcal. Beats the burger by a mile',
    body: 'Ordered to the office. Dressing on the side, it survived the 20 minute ride fine.',
    place: ['n1860405863', 'dean&david', 52.5235038, 13.398912], dish: ['Chicken Caesar Salad', 450, 610, 38, '10,90 €'],
    comments: [{ id: 'ex-c-7', ago: 1.5 * H, nick: 'lena.lifts', body: 'Same order here. Add the extra chicken if you train later.', ups: 5 }],
  },
  {
    id: 'ex-post-8', ago: 5 * H, nick: 'kotti.kai', c: 'Delivery', kind: 'text', ups: 11,
    title: 'Late-night delivery that does not wreck the day: what do you order?',
    body: 'After 22:00 it is pizza or döner around me. Looking for 30 g+ protein under 800 kcal.',
    comments: [{ id: 'ex-c-8', ago: 4 * H, nick: 'mehmet.k', body: 'Döner plate with salad instead of fries. Ask for the sauce on the side.', ups: 7 }],
  },
  {
    id: 'ex-post-9', ago: 11 * H, nick: 'bowl.bea', c: 'HighProtein', kind: 'order', ups: 9, goal: 'build_muscle', via: 'lieferando',
    title: 'Beef bibimbap delivered: 35 g protein, 620-800 kcal',
    body: 'Comes with the egg on top. Skip the extra sauce to stay at the low end.',
    place: ['n5037669578', 'Got Rice', 52.5237292, 13.4092181], dish: ['Bibimbap mit Rind', 620, 800, 35, '12,90 €'],
  },
  {
    id: 'ex-post-5', ago: 20 * H, nick: 'nico.mitte', c: 'Mitte', kind: 'text', ups: 8,
    title: 'Anyone scanned the menus around Rosenthaler Platz yet?',
    body: 'The map shows lots of grey dots there. Will scan a few tomorrow and post the best orders.',
  },
  {
    id: 'ex-post-6', ago: 30 * H, nick: 'fhain.runner', c: 'Friedrichshain', kind: 'text', ups: 6,
    title: 'Post-run dinner near Boxhagener Platz, what do you order?',
    body: 'Need carbs and protein after a long run but not a calorie bomb.',
  },
]

export function seedCommunitySql(now: number): string[] {
  const out: string[] = []
  for (const p of SEED_POSTS) {
    const ts = Math.round(now - p.ago)
    const nComments = (p.comments ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0)
    const [pid, pname, plat, plng] = p.place ?? [null, null, null, null]
    const [dn, lo, hi, prot, price] = p.dish ?? [null, null, null, null, null]
    out.push(`INSERT OR IGNORE INTO posts (id, ts, device, nickname, team, seed, community, kind, title, body, place_id, place_name, place_lat, place_lng, dish_name, kcal_low, kcal_high, protein, price, goal, photo, ups, downs, score, hot, comments, via)
      VALUES (${q(p.id)}, ${ts}, NULL, ${q(p.nick)}, 0, 1, ${q(p.c)}, ${q(p.kind)}, ${q(p.title)}, ${q(p.body)}, ${q(pid)}, ${q(pname)}, ${plat ?? 'NULL'}, ${plng ?? 'NULL'},
      ${q(dn)}, ${lo ?? 'NULL'}, ${hi ?? 'NULL'}, ${prot ?? 'NULL'}, ${q(price)}, ${q(p.goal ?? null)}, NULL, ${p.ups}, 0, ${p.ups}, ${hotScore(p.ups, 0, ts)}, ${nComments}, ${q(p.via ?? null)})`)
    for (const c of p.comments ?? []) {
      out.push(`INSERT OR IGNORE INTO comments (id, post_id, parent_id, ts, device, nickname, team, seed, body, ups, downs, score)
        VALUES (${q(c.id)}, ${q(p.id)}, NULL, ${Math.round(now - c.ago)}, NULL, ${q(c.nick)}, 0, 1, ${q(c.body)}, ${c.ups}, 0, ${c.ups})`)
      for (const r of c.replies ?? []) {
        out.push(`INSERT OR IGNORE INTO comments (id, post_id, parent_id, ts, device, nickname, team, seed, body, ups, downs, score)
          VALUES (${q(r.id)}, ${q(p.id)}, ${q(c.id)}, ${Math.round(now - r.ago)}, NULL, ${q(r.nick)}, 0, 1, ${q(r.body)}, ${r.ups}, 0, ${r.ups})`)
      }
    }
  }
  return out
}
