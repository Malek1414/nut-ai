# Open data and open source scout for Snapmenu

Checked on 21 Nov 2026. Scope: things Snapmenu may legally reuse for free inside an AGPL app.
Effort: **S** under 2 hours, **M** half a day, **L** days.
"Verified" means the licence page, licence file or the API field was opened that day. Everything else is marked **unverified**: check it before use.

## The short version

1. **Built: CIQUAL 2025 as a bundled table with a lookup** (`apps/snapmenu-api/src/sources/ciqual`). 3,286 European foods and dishes, French and English names, real per-100 g rows, CC BY 4.0. Not wired in yet; the steps are below.
2. **Next data win: BLS 4.0** (Germany, CC BY 4.0, 7,140 foods). It has what CIQUAL lacks for Berlin menus: Bratwurst, Currywurst, Spätzle, Knödel, Leberkäse. M.
3. **Cheap multilingual names:** the Open Food Facts category taxonomy links 2,883 categories to CIQUAL codes, with names in many languages. It can generate aliases we now write by hand. M.
4. **Quick product wins:** read more OpenStreetMap tags (opening hours, cuisine, `website:menu`), and copy single allergen icons from Lucide or Tabler. S each.
5. **Do not use:** NEVO, BEDCA, TheMealDB, RecipeNLG, Recipe1M+, Food-101, Surya weights, Remix Icon, Google Places, Yelp.

## What was built: CIQUAL 2025

Source: Anses. 2025. Ciqual French food composition table. https://doi.org/10.5281/zenodo.17550133
Licence: CC BY 4.0 (verified on the Zenodo record, published 2025-11-19). The older 2020 table is on data.gouv.fr under Licence Ouverte (verified, licence id `fr-lo`).
The official site ciqual.anses.fr was down for maintenance on the day, so the build reads the Zenodo copy, which also publishes md5 checksums.

| File | What |
|---|---|
| `build.mjs` | Downloads the four official XML files (71 MB, kept out of git in `data/sources/ciqual/raw`), checks their md5, writes the table. No dependencies. Same input, same output. |
| `table.generated.ts` | 3,286 rows: kcal, protein, carbohydrate, fat, fibre, sugars, sodium, alcohol per 100 g, CIQUAL's own reliability letter (A best, D weakest: 1,508 A, 487 B, 341 C, 950 D), search keys. 673 KB, 175 KB gzipped in the bundle. |
| `aliases.ts` | 89 hand-checked rows with 438 spellings in German, French, Italian, Spanish, Turkish and English ("Laugenbrezel", "Schafskäse", "patatas fritas", "cacık"). Each is pinned to a piece of the row's French name; a test fails if a new release moves a code. |
| `index.ts` | `lookupCiqual(name)`, `ciqualDishReference(dishName)`, `searchCiqual`, `ciqualByCode`, `warmCiqual`, `CIQUAL_ATTRIBUTION`. |
| `ciqual.test.ts` | 23 tests. |
| `NOTICE.md` | Source, licence and the list of changes made to the data (format only). |

```bash
node apps/snapmenu-api/src/sources/ciqual/build.mjs                        # rebuild the table (4 s once the XML is cached)
npx vitest run apps/snapmenu-api/src/sources                               # 23 tests (also part of the root `npx vitest run`)
```

What it gives Snapmenu:

- **European foods under their own names.** Tzatziki, hummus, falafel from take-away, merguez, raclette, crème fraîche, Bretzel, tarte flambée, wine and beer by type. Whether USDA has an equally good row was not compared food by food.
- **402 composite dishes as a second opinion.** `ciqualDishReference('Döner Kebab im Brot')` returns "Sandwich, pita bread, kebab and raw vegetables", 232 kcal per 100 g, reliability A. The same for moussaka, lasagne, carbonara, pizza margherita, quiche lorraine, paella, cassoulet, tiramisu, baklava.
- **Menus in French read directly**, other languages through the alias list.

Measured against today's dish table (`src/dishes.ts`):

- 48 of its 71 component keys have a CIQUAL row (by key or by display name).
- 11 of its 33 dishes have a whole-dish reference.
- Of the four components estimated by hand today, CIQUAL has a strong row for one (mascarpone, A), a weak one for yogurt sauce (98.5 kcal, reliability D, against our 230 kcal estimate and CIQUAL's own "kebab sauce" at 433 kcal), and nothing for ayran or halloumi. So it does not remove the hand estimates; it adds rows where the model names European foods freely.

It prefers no answer to a wrong one. It returns null for "white wine butter sauce", "Adana Kebab Teller", "Wiener Schnitzel mit Pommes" (a combination plate), "chicken" (rows run from 107 to 247 kcal), and for "Pommes", "Chips" and "Tortilla", which mean different foods in different languages.

Limits to know:

- CIQUAL is French. Most dish rows are prepacked or take-away versions, not a restaurant's recipe. Treat a dish row as a second opinion.
- Name search (`via: 'search'`) is weaker than an alias (`via: 'alias'`). One example found: "Pizza dough base" matches "Base for pizza (dough + cream sauce), raw" at score 0.85.
- Not in CIQUAL: Bratwurst, Currywurst, Spätzle, Knödel, Leberkäse, halloumi, ayran.
- Speed was measured on a laptop under heavy load from the other agents, so the numbers are upper bounds: module import 39 to 270 ms, first alias lookup about 3.5 ms, first name search about 6 ms, later name searches 0.1 to 0.6 ms, repeated queries are cached. Workers Free allows 10 ms CPU per request and 1 second at start-up (verified on Cloudflare's limits page), so call `warmCiqual()` at module scope and prefer `aliasOnly: true` inside a request. Not measured on a real Worker.

### Wiring CIQUAL

Nothing imports the module yet. To turn it on (S, about 1 to 2 hours with tests):

1. `src/types.ts`: add to `NumberSource`
   `| { kind: 'ciqual'; code: string; name: string; url: string; attribution: string }`
2. `src/menu-engine.ts`, in `resolveComponent`, after the USDA branch and before the `c.per100` estimate:
   ```ts
   const cq = lookupCiqual(c.key, { aliasOnly: true }) ?? lookupCiqual(item.name, { aliasOnly: true })
   if (cq && cq.food.confidence !== 'D') return { per100: cq.per100, source: cq.source, food: null, isEstimate: false }
   ```
   Skipping reliability D keeps the hand-written sauce estimate. Further down, map `kind === 'ciqual'` to origin `'db_search'`.
3. `apps/snapmenu-web/src/screens/DishDetail.tsx`, in `sourceLine`:
   ``if (s.kind === 'ciqual') return `CIQUAL 2025 (Anses): “${s.name}”, ${n0(r.per100.kcal)} kcal / 100 g` ``
4. Show `CIQUAL_ATTRIBUTION` once on the sources or about screen, and add a credit line to the README. The licence requires the credit.
5. Optional second opinion in `estimateDish`: `ciqualDishReference(dish.name_original)`. If the component sum per 100 g is far from it, add a reason to `bandReasons` or widen the band.
6. Done at the swarm merge: the root `vitest.config.ts` includes `'apps/snapmenu-api/src/**/*.test.ts'`, so the module's tests run with the root suite.
7. Worker entry: `warmCiqual()` at module scope.

## European nutrition tables

| Source | Licence | What it gives | Effort |
|---|---|---|---|
| [CIQUAL 2025](https://doi.org/10.5281/zenodo.17550133) (Anses, France) | CC BY 4.0, verified | 3,484 foods, 74 components, French and English names, min, max and a reliability letter per value. Done, see above. | Done |
| [CIQUAL average foods 2025](https://doi.org/10.5281/zenodo.17592207) | CC BY 4.0 per the Zenodo record | The "average" rows and the foods and weights they are made of. Could back ranges with real spread. Content not opened. | M |
| [BLS 4.0](https://www.blsdb.de/download) (Max Rubner-Institut, Germany) | CC BY 4.0, verified. Credit: "Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0" plus DOI 10.25826/Data20251217-134202-0 | 7,140 foods, 138 nutrients, prepared dishes. German names; English names unverified. XLSX, so the build needs a zip reader. | M |
| [Swiss Food Composition Database 7.1](https://naehrwertdaten.ch/en/downloads/) (FSVO) | No named licence. The site says the data "may also be used for commercial purposes (e.g. ... nutrition diary app) ... subject to acknowledgment of the source" (verified) | One XLSX, a site in DE, FR, IT, EN. 1,096 foods in version 6.0; the count for 7.1 is not stated. | M |
| [UK CoFID 2021](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid) | Open Government Licence v3.0, verified | British foods and dishes, English only. | M |
| [Frida 5.5](https://doi.org/10.11583/DTU.29500682) (DTU, Denmark) | CC BY 4.0, verified | Nordic foods. | M |
| [EFSA FoodEx2](https://zenodo.org/records/18429596) | CC BY 4.0 per the Zenodo record | Food classification with codes many tables share. A join key, not nutrition. | L |
| Fineli (Finland), CREA (Italy), Nubel (Belgium), OeNWT (Austria), EFSA composition database | **Unverified** | Do not bundle until the licence is read. OeNWT shows BLS data, so use BLS. | |
| [NEVO](https://www.rivm.nl/sites/default/files/2025-11/Conditions-of-use-NEVO-online-2025-dataset_0.pdf) (Netherlands) | Own terms: use "only allowed unchanged", no charging users | **Avoid.** Conflicts with AGPL and with a paid app. | |
| BEDCA (Spain) | "All rights reserved" | **Avoid.** | |
| [Open Food Facts](https://world.openfoodfacts.org/data) | Database ODbL, contents DbCL, images CC BY-SA (verified) | Already used live. Limits: 15 product reads and 10 searches per minute per IP. A bundled subset must itself be offered under ODbL, so keep it in its own file. | In use |
| [OFF category taxonomy](https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/food/categories.txt) | Repository AGPL-3.0; a separate data licence is unverified | 2,883 categories carry a `ciqual_food_code`, 4,240 a Wikidata ID (counts from the scout, not rechecked). Names in many languages: generates CIQUAL aliases for Dutch, Polish, Portuguese and more. | M |

## Dishes, recipes and vocabularies

| Source | Licence | What it gives | Effort |
|---|---|---|---|
| [Wikidata](https://www.wikidata.org/wiki/Wikidata:Licensing) | CC0 | About 1,585 dishes with a European country of origin and labels in several languages (query below). Coverage is patchy; many have one language. | M |
| [OFF allergens taxonomy](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/taxonomies/allergens.txt) | Repository AGPL-3.0 | 27 allergens with synonyms in 38 languages. Fits `allergens.ts`. | M |
| FoodOn (OBO Foundry) | CC BY 4.0 | Food ontology. Heavy for our need. | L |
| [Nutrition5k](https://github.com/google-research-datasets/Nutrition5k) | CC BY 4.0 | 5,006 plates with grams per ingredient, weighed. US cafeteria food. Useful for testing the gram engine, not for Europe. | M |
| [Wikibooks Cookbook](https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents) | CC BY-SA | Recipes as free text. Share-alike. | L |
| TheMealDB, RecipeNLG, Recipe1M+, Food-101 | App-store use needs a paid plan; research only; non-commercial; image rights unclear | **Avoid.** | |
| Open dataset of European restaurant portions or of standard recipes with grams | None found | Our own dish table stays the source for grams. | |

```sparql
SELECT ?dish ?en ?de ?fr ?it ?es ?countryLabel WHERE {
  ?dish wdt:P31/wdt:P279* wd:Q746549 ; wdt:P495 ?country .
  ?country wdt:P30 wd:Q46 .
  OPTIONAL { ?dish rdfs:label ?en FILTER(LANG(?en)="en") }
  OPTIONAL { ?dish rdfs:label ?de FILTER(LANG(?de)="de") }
  OPTIONAL { ?dish rdfs:label ?fr FILTER(LANG(?fr)="fr") }
  OPTIONAL { ?dish rdfs:label ?it FILTER(LANG(?it)="it") }
  OPTIONAL { ?dish rdfs:label ?es FILTER(LANG(?es)="es") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

## Menu and receipt reading

No open-source menu parser is worth adopting (the best GitHub hit has 18 stars and no licence). The hosted model stays the reader; these are fallbacks.

| Tool | Licence | What it gives | Effort |
|---|---|---|---|
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Free allocation of 10,000 neurons a day; on the free plan it stops with an error after that | A second menu reader on the platform we already use, with vision models such as `@cf/meta/llama-3.2-11b-vision-instruct`. Roughly 100 scans a day (scout's estimate). Some models need a billing method: skip those. Read the Llama licence for EU terms first (unverified). | S to M |
| [tesseract.js](https://github.com/naptha/tesseract.js) | Apache-2.0 | Text from a photo in the browser, offline. Likely weak on angled photos (not tested). | M |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) and browser ports ([ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr), MIT) | Apache-2.0 | Better text detection. The browser ports are small projects. | M to L |
| docTR, EasyOCR | Apache-2.0 | Need a Python server. Not for a Worker. | L |
| [currency.js](https://github.com/scurker/currency.js) | MIT | Price maths and formatting. | S |
| Surya | Code Apache-2.0, weights limited to small companies | **Avoid.** | |

## UI: icons, components, fonts

The web app has its own small icon component and hand-written CSS. Copying single SVG paths adds no weight.

| Item | Licence | What it gives | Effort |
|---|---|---|---|
| [Lucide](https://github.com/lucide-icons/lucide) | ISC | Food and allergen glyphs: utensils, soup, salad, vegan, wheat-off, milk-off, egg-off, fish-off, nut-off. | S |
| [Tabler Icons](https://github.com/tabler/tabler-icons) | MIT | Same allergen set plus meat-off. | S |
| [sonner](https://github.com/emilkowalski/sonner) | MIT | Toasts, 9 kB, React 19. | S |
| [Radix Primitives](https://github.com/radix-ui/primitives) | MIT | Accessible dialog and sheet behaviour, 13 kB for Dialog. | S to M |
| [vaul](https://github.com/emilkowalski/vaul) | MIT | Bottom sheet, 18 kB. Its README says it is unmaintained. | S |
| [Inter](https://github.com/rsms/inter), [Geist](https://github.com/vercel/geist-font) | OFL-1.1 | Fonts. | S |
| [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) | MIT | Food illustrations. Twemoji needs attribution (CC BY 4.0); OpenMoji is share-alike. | S |
| Konsta UI | MIT | Needs Tailwind. Skip. | L |
| Remix Icon | Own licence since Jan 2026 | **Avoid.** | |

## Restaurants and maps

| Source | Licence and limits | What it gives | Effort |
|---|---|---|---|
| OpenStreetMap via Overpass (in use) | ODbL. About 10,000 requests a day on the main server. The usage policy discourages apps that use the public servers as their backend; we already cache each area in D1 for a day | More from the same query: `opening_hours` (3.1 M uses in Europe), `cuisine` (622 k), `diet:vegan` (48.8 k), `website:menu` (23 k, links only). Fallback mirror: overpass.private.coffee. | S |
| [OpenFreeMap](https://openfreemap.org/) tiles (in use) | MIT code, no key, no limits stated | Already the map style. Nothing to do. | Done |
| [Overture Maps Places](https://docs.overturemaps.org/attribution/) | Mostly CDLA-Permissive-2.0 | Websites, phones, brands, categories for a city extract. No opening hours, no cuisine field. | M |
| [All The Places](https://github.com/alltheplaces/alltheplaces) | Data CC0 | Chain locations. | M |
| [Geoapify](https://www.geoapify.com/pricing/) | 3,000 credits a day, no card, attribution link | Geocoding and place search if Overpass is not enough. | S |
| Foursquare Open Source Places | Apache-2.0, needs a free account and token | Similar to Overture. | M |
| Nominatim | 1 request a second, no autocomplete | Not for search-as-you-type. | |
| Google Places, Yelp | Billing or paid | **Excluded** by the free-only rule. | |
| Open dataset of European menus or dish prices | None found | The community scans stay our source. | |

## How this was checked

- CIQUAL (Zenodo and data.gouv.fr records, files, checksums) and the Cloudflare limits were fetched directly while building.
- The other rows come from two research passes that opened the licence pages or files on the same day. Rows marked unverified, and the counts for the OFF taxonomy and Wikidata, were not rechecked.
- Star counts and "last commit" dates were left out on purpose: they change, and they were read once.
