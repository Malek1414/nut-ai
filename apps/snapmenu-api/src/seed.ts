/**
 * Example data so the map and the community are not empty on day one.
 * Every row is marked seed = 1: the app labels it "Example" and /numbers never counts it.
 * Places are real OpenStreetMap restaurants around the Berlin Mitte fallback position;
 * the dishes and numbers are illustrative examples, not scans of their menus.
 */

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
