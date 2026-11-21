/**
 * Allergy hints. NEVER a guarantee: every flag says "likely contains" with the
 * reason, and the UI always adds "confirm with the restaurant".
 *
 * Two sources are merged:
 *   1. Deterministic keyword rules over the dish name, description and every
 *      component (EU's 14 declarable allergens, Regulation 1169/2011 Annex II).
 *   2. The model's own hints from reading the menu (e.g. allergen footnote
 *      letters printed on German menus), passed through with their reason.
 */

export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const
export type Allergen = (typeof ALLERGENS)[number]

export const ALLERGEN_LABEL: Record<Allergen, string> = {
  gluten: 'gluten (wheat)',
  crustaceans: 'crustaceans (shrimp, crab)',
  eggs: 'egg',
  fish: 'fish',
  peanuts: 'peanuts',
  soy: 'soy',
  milk: 'milk / lactose',
  tree_nuts: 'tree nuts',
  celery: 'celery',
  mustard: 'mustard',
  sesame: 'sesame',
  sulphites: 'sulphites',
  lupin: 'lupin',
  molluscs: 'molluscs (mussels, squid)',
}

/** Word rules. Each pattern is matched against lowercase, accent-folded text. */
const RULES: Array<{ allergen: Allergen; rx: RegExp; except?: RegExp }> = [
  {
    allergen: 'gluten',
    rx: /\b(bread|brot|brotchen|bun|roll|pita|fladenbrot|flatbread|wrap|tortilla|yufka|durum|dough|pizza|pasta|spaghetti|penne|tagliatelle|lasagn\w*|noodle\w*|nudel\w*|ramen|udon|spatzle|spaetzle|flour|mehl|breaded|paniert|schnitzel|crouton\w*|couscous|bulgur|seitan|beer|bier|croissant|cake|kuchen|ladyfinger\w*|biscuit|cookie|wheat|weizen|barley|gerste|rye|roggen|soy sauce|shoyu|naan|baguette|ciabatta|focaccia|gnocchi|lahmacun|pide|borek|burek|dumpling|gyoza|tempura|panko|batter)\b/,
    except: /\b(rice noodle\w*|reisnudel\w*|glass noodle\w*|gluten.?free|glutenfrei|senza glutine)\b/,
  },
  { allergen: 'crustaceans', rx: /\b(shrimp\w*|prawn\w*|garnele\w*|gamba\w*|scampi|crab\w*|krabbe\w*|lobster|hummer|langoustin\w*|crayfish|krebs)\b/ },
  {
    allergen: 'eggs',
    rx: /\b(egg|eggs|ei|eier|eigelb|yolk|mayonnaise|mayo|aioli|carbonara|hollandaise|bearnaise|spatzle|spaetzle|egg noodle\w*|meringue|tiramisu|omelet\w*|frittata|tamago|scrambled|ladyfinger\w*)\b/,
  },
  { allergen: 'fish', rx: /\b(fish|fisch|salmon|lachs|tuna|thunfisch|tonno|cod|kabeljau|anchov\w*|sardell\w*|acciugh\w*|sardine\w*|trout|forelle|herring|hering|matjes|mackerel|makrele|sea bass|dorade|branzino|fish sauce|nuoc mam|bonito|dashi|caesar dressing|worcestershire|sushi|sashimi|nigiri)\b/ },
  { allergen: 'peanuts', rx: /\b(peanut\w*|erdnuss\w*|arachid\w*|satay|sate)\b/ },
  { allergen: 'soy', rx: /\b(soy|soja|soya|tofu|edamame|miso|tempeh|shoyu|teriyaki)\b/ },
  {
    allergen: 'milk',
    rx: /\b(milk|milch|cheese|kase|kaese|formaggio|fromage|mozzarella|parmesan|parmigiano|pecorino|cheddar|emmental\w*|gouda|feta|halloumi|hellim|mascarpone|ricotta|burrata|gorgonzola|cream|sahne|panna|creme|butter|yogurt|yoghurt|joghurt|ayran|tzatziki|cacik|bechamel|alfredo|quark|raita|paneer|ghee|kefir|latte|cappuccino|doner sauce|yogurt.?garlic|knoblauchsosse|krautersosse|swiss)\b/,
    except: /\b(peanut butter|sesame butter|nut butter|almond butter|apple butter|coconut milk|kokosmilch|oat milk|hafermilch|soy milk|sojamilch|vegan cheese|cocoa butter|butternut)\b/,
  },
  { allergen: 'tree_nuts', rx: /\b(almond\w*|mandel\w*|walnut\w*|walnuss\w*|hazelnut\w*|haselnuss\w*|cashew\w*|pistach\w*|pecan\w*|macadamia|pine nut\w*|pinienkern\w*|pinoli|pesto|nutella|praline|marzipan|amaretto|frangipane)\b/ },
  { allergen: 'celery', rx: /\b(celery|sellerie|celeriac|knollensellerie|sedano|bouillon|bruhe|broth|soup stock)\b/ },
  { allergen: 'mustard', rx: /\b(mustard|senf|moutarde|senape|dijon|honey mustard|currywurst sauce|remoulade)\b/ },
  { allergen: 'sesame', rx: /\b(sesame|sesam|tahini|tahin|hummus|humus|halva|helva|simit|furikake|falafel)\b/ },
  { allergen: 'sulphites', rx: /\b(wine|wein|vino|vinegar|essig|aceto|balsamic\w*|dried fruit|trockenobst|prosecco|sekt|beer|bier)\b/ },
  { allergen: 'lupin', rx: /\b(lupin\w*|lupine)\b/ },
  { allergen: 'molluscs', rx: /\b(mussel\w*|muschel\w*|cozze|clam\w*|vongole|oyster\w*|auster\w*|squid|calamar\w*|tintenfisch|octopus|oktopus|polpo|scallop\w*|jakobsmuschel\w*|oyster sauce)\b/ },
]

export interface AllergenFlag {
  allergen: Allergen
  /** Human reason: which word/component triggered it. */
  reason: string
  source: 'menu_text' | 'component' | 'model'
}

export const foldText = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')

function firstHit(text: string, rule: (typeof RULES)[number]): string | null {
  const folded = foldText(text)
  const cleaned = rule.except ? folded.replace(new RegExp(rule.except.source, 'g'), ' ') : folded
  const m = rule.rx.exec(cleaned)
  return m ? m[0] : null
}

export interface AllergenInput {
  dishName: string
  description?: string | null
  components: Array<{ name: string; dbName?: string | null }>
  modelHints?: Array<{ allergen: string; reason: string }>
}

export function detectAllergens(input: AllergenInput): AllergenFlag[] {
  const out = new Map<Allergen, AllergenFlag & { reasons: string[] }>()
  const add = (a: Allergen, reason: string, source: AllergenFlag['source']) => {
    const cur = out.get(a)
    if (!cur) out.set(a, { allergen: a, reason, source, reasons: [reason] })
    else if (cur.reasons.length < 2 && !cur.reasons.includes(reason)) cur.reasons.push(reason)
  }
  const short = (a: Allergen) => ALLERGEN_LABEL[a].split(' (')[0]!
  const menuText = `${input.dishName} ${input.description ?? ''}`

  // The model's reading of the menu's own allergen codes is the strongest evidence; it goes first.
  for (const h of input.modelHints ?? []) {
    const a = normalizeAllergen(h.allergen)
    if (a) add(a, h.reason, 'model')
  }
  for (const rule of RULES) {
    const hit = firstHit(menuText, rule)
    if (hit) {
      add(rule.allergen, hit.toLowerCase().startsWith(short(rule.allergen).toLowerCase().slice(0, 4)) ? `menu mentions ${hit}` : `${hit} usually contains ${short(rule.allergen)}`, 'menu_text')
      continue
    }
    for (const c of input.components) {
      if (firstHit(`${c.name} ${c.dbName ?? ''}`, rule)) {
        add(rule.allergen, `${c.name} usually contains ${short(rule.allergen)}`, 'component')
        break
      }
    }
  }

  return ALLERGENS.filter((a) => out.has(a)).map((a) => {
    const f = out.get(a)!
    return { allergen: f.allergen, reason: f.reasons.join('; '), source: f.source }
  })
}

/** Map user/model spellings onto the closed list. */
export function normalizeAllergen(s: string): Allergen | null {
  const k = foldText(s).replace(/[^a-z]/g, '')
  const map: Record<string, Allergen> = {
    gluten: 'gluten', wheat: 'gluten', cereals: 'gluten',
    crustaceans: 'crustaceans', shellfish: 'crustaceans', shrimp: 'crustaceans',
    eggs: 'eggs', egg: 'eggs',
    fish: 'fish',
    peanuts: 'peanuts', peanut: 'peanuts',
    soy: 'soy', soya: 'soy', soybeans: 'soy',
    milk: 'milk', lactose: 'milk', dairy: 'milk',
    treenuts: 'tree_nuts', nuts: 'tree_nuts',
    celery: 'celery', mustard: 'mustard', sesame: 'sesame',
    sulphites: 'sulphites', sulfites: 'sulphites', sulphurdioxide: 'sulphites',
    lupin: 'lupin', molluscs: 'molluscs', mollusks: 'molluscs',
  }
  return map[k] ?? null
}

/** The user's "shellfish" covers both crustaceans and molluscs. */
export function expandUserAllergies(list: readonly string[]): Set<Allergen> {
  const s = new Set<Allergen>()
  for (const raw of list) {
    if (foldText(raw).replace(/[^a-z]/g, '') === 'shellfish') {
      s.add('crustaceans')
      s.add('molluscs')
      continue
    }
    const a = normalizeAllergen(raw)
    if (a) s.add(a)
  }
  return s
}

const MEAT_RX = /\b(beef|rind|pork|schwein\w*|lamb|lamm|veal|kalb|chicken|hahnchen|huhn|poulet|pollo|turkey|pute\w*|duck|ente|bacon|speck|ham|schinken|prosciutto|salami|sausage|wurst|bratwurst|currywurst|frankfurter|doner|kebab|kebap|gyros|guanciale|pancetta|chorizo|meat|fleisch|hackfleisch|mince\w*|minced|bolognese|ragu|schnitzel|steak|burger|patty|chashu|lard|schmalz|gelatin\w*|broth|bruhe|bouillon|pho bo|anchov\w*)\b/
const VEG_FISH_RX = /\b(fish|fisch|salmon|lachs|tuna|thunfisch|cod|shrimp|prawn|garnele|squid|calamari|mussel|sushi|sashimi|anchov\w*|fish sauce|bonito|dashi|caesar dressing)\b/
const ANIMAL_RX = /\b(egg|eggs|ei|eier|cheese|kase|mozzarella|parmesan|pecorino|feta|halloumi|hellim|cheddar|swiss|mascarpone|cream|sahne|butter|yogurt|joghurt|milk|milch|honey|honig|mayonnaise|mayo|aioli|tzatziki|bechamel|ghee|quark|doner sauce|yogurt.?garlic|ladyfinger\w*)\b/

export interface DietInfo {
  vegetarian: boolean
  vegan: boolean
  reason: string | null
}

/**
 * Vegetarian / vegan check. Menu words that EXPLICITLY say vegan/vegetarian win
 * unless a component plainly contradicts them.
 */
export function detectDiet(dishName: string, description: string | null | undefined, components: Array<{ name: string; dbName?: string | null }>, model?: { meat?: boolean; fish?: boolean; dairy_or_egg?: boolean }): DietInfo {
  const text = foldText(`${dishName} ${description ?? ''} ${components.map((c) => `${c.name} ${c.dbName ?? ''}`).join(' ')}`)
  const explicitVegan = /\b(vegan|vegane?r?s?)\b/.test(foldText(`${dishName} ${description ?? ''}`))
  const meat = MEAT_RX.exec(text)?.[0] ?? (model?.meat ? 'meat (from the menu)' : null)
  const fish = VEG_FISH_RX.exec(text)?.[0] ?? (model?.fish ? 'fish (from the menu)' : null)
  if (meat || fish) return { vegetarian: false, vegan: false, reason: `contains ${meat ?? fish}` }
  if (explicitVegan) return { vegetarian: true, vegan: true, reason: null }
  const animal = ANIMAL_RX.exec(text)?.[0] ?? (model?.dairy_or_egg ? 'dairy or egg' : null)
  if (animal) return { vegetarian: true, vegan: false, reason: `contains ${animal}` }
  return { vegetarian: true, vegan: true, reason: null }
}
