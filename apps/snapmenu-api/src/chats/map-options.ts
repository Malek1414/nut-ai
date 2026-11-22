import { distanceM } from '../community.js'
import type { D1Like } from '../d1-adapter.js'
import { orderUrl, PROVIDERS } from '../delivery.js'
import type { Diet } from '../group/types.js'
import type { Place } from '../types.js'
import type { Lang } from '../voice/index.js'
import type { PlanOption } from './types.js'

const notes: Record<Lang, [menu: string, allergy: string, vegan: string, vegetarian: string]> = {
  English: ['No scanned menu yet. Check the dishes for your goals.', 'Ask the kitchen about ingredients and cross-contact.', 'Vegan options', 'Vegetarian options'],
  German: ['Noch keine gescannte Karte. Schaut, welche Gerichte zu euren Zielen passen.', 'Fragt in der Küche nach Zutaten und möglichen Allergenspuren.', 'Vegane Optionen', 'Vegetarische Optionen'],
  French: ['Pas encore de menu scanné. Vérifiez quels plats vous conviennent.', 'Demandez en cuisine quels ingrédients sont utilisés et s’il y a un risque de contact croisé.', 'Options véganes', 'Options végétariennes'],
  Spanish: ['Aún no hay una carta escaneada. Mirad qué platos encajan con vuestros objetivos.', 'Preguntad en cocina por los ingredientes y el contacto cruzado.', 'Opciones veganas', 'Opciones vegetarianas'],
  Italian: ['Il menu non è ancora stato scansionato. Controllate quali piatti fanno al caso vostro.', 'Chiedete in cucina degli ingredienti e del rischio di contaminazione crociata.', 'Opzioni vegane', 'Opzioni vegetariane'],
  Portuguese: ['Ainda não há um menu digitalizado. Vejam quais pratos combinam com os seus objetivos.', 'Perguntem na cozinha sobre os ingredientes e o contacto cruzado.', 'Opções veganas', 'Opções vegetarianas'],
  Turkish: ['Henüz taranmış menü yok. Hedeflerinize uygun yemekleri menüden kontrol edin.', 'Malzemeleri ve çapraz temas riskini mutfağa sorun.', 'Vegan seçenekler', 'Vejetaryen seçenekler'],
  Polish: ['Nie ma jeszcze zeskanowanego menu. Sprawdźcie, które dania pasują do waszych celów.', 'Zapytajcie w kuchni o składniki i możliwość kontaktu z alergenami.', 'Opcje wegańskie', 'Opcje wegetariańskie'],
  Dutch: ['Nog geen gescande menukaart. Kijk welke gerechten bij jullie doelen passen.', 'Vraag de keuken naar ingrediënten en kruiscontact.', 'Vegan opties', 'Vegetarische opties'],
  Arabic: ['لم تُمسح قائمة الطعام بعد. تحققوا من الأطباق التي تناسب أهدافكم.', 'اسألوا المطبخ عن المكونات واحتمال ملامسة مسببات الحساسية.', 'خيارات نباتية صرفة', 'خيارات نباتية'],
}

export async function mapOptions(db: D1Like, center: { lat: number; lng: number }, diet: Diet, allergies: boolean, lang: Lang, limit: number): Promise<PlanOption[]> {
  const longitudeScale = Math.max(0.01, Math.cos(center.lat * Math.PI / 180))
  // Each map cell contains at most 600 server-parsed OSM records. Use the newest
  // copy of each place within the three closest cells, then apply the diet filter.
  const rows = await db.prepare(`WITH origin AS (SELECT ? y, ? x, ? dx, ? scale, ? since, ? diet), cells AS (
    SELECT ts,body FROM origin CROSS JOIN overpass_cache
    WHERE lat BETWEEN origin.y - 0.065 AND origin.y + 0.065 AND lng BETWEEN origin.x - origin.dx AND origin.x + origin.dx AND ts >= origin.since
    ORDER BY (lat-origin.y)*(lat-origin.y) + (lng-origin.x)*(lng-origin.x)*origin.scale LIMIT 3
  ), places AS (
    SELECT j.value AS place, MAX(c.ts) AS latest FROM cells c, json_each(c.body) j
    GROUP BY json_extract(j.value,'$.id')
  )
  SELECT place FROM places, origin
  WHERE (origin.diet='any' OR json_extract(place,'$.vegan') IN ('yes','only') OR
     (origin.diet='vegetarian' AND json_extract(place,'$.vegetarian') IN ('yes','only')))
  AND NOT EXISTS (SELECT 1 FROM place_dishes d WHERE d.place_id=json_extract(place,'$.id') AND d.seed=0 AND d.osm_verified=1)
  ORDER BY (json_extract(place,'$.lat')-origin.y)*(json_extract(place,'$.lat')-origin.y) +
           (json_extract(place,'$.lng')-origin.x)*(json_extract(place,'$.lng')-origin.x)*origin.scale LIMIT 12`)
    .bind(center.lat, center.lng, 0.065 / longitudeScale, longitudeScale ** 2, Date.now() - 60 * 86_400_000, diet)
    .all<{ place: string }>()
  const [menu, allergy, veganOptions, vegetarianOptions] = notes[lang]
  const found: PlanOption[] = []
  for (const row of rows.results) {
    const p = JSON.parse(row.place) as Place
    if (!/^[nwr]\d{1,15}$/.test(p.id) || !p.name || !['restaurant', 'fast_food', 'cafe'].includes(p.kind)) continue
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || distanceM(center.lat, center.lng, p.lat, p.lng) > 5000) continue
    const tag = p.vegan === 'only' || p.vegan === 'yes' ? veganOptions
      : p.vegetarian === 'only' || p.vegetarian === 'yes' ? vegetarianOptions : ''
    const source = tag ? `OpenStreetMap · ${tag}.` : 'OpenStreetMap.'
    found.push({
      id: p.id, name: p.name, lat: p.lat, lng: p.lng, picks: [], menuNote: [source, menu, ...(allergies ? [allergy] : [])].join(' '),
      delivery: PROVIDERS.map(({ id, label }) => ({ label, url: orderUrl(id, p) })),
    })
    if (found.length === limit) break
  }
  return found
}
