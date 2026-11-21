/**
 * Drinks in a scanned menu, and which of them are alcoholic.
 *
 * Pure and shared by the Worker and the web app. The rule it serves: a drink shows
 * with the engine's numbers like any dish; an alcoholic drink shows only to a person
 * who confirmed they are 18 or older, and it is never recommended.
 *
 * `isAlcoholic` reads words only: the printed name, its translation, the description
 * and the names of the components, in the nine menu languages the app talks plus
 * English. It errs towards "yes": a wrong yes hides a drink, a wrong no would show
 * alcohol to someone who should not see it.
 */
import type { MenuResult } from '../types.js'

export interface DrinkLike {
  name: string
  translated?: string | null
  description?: string | null
  course?: string
  rows?: Array<{ name: string }>
}

export const isDrink = (d: DrinkLike): boolean => d.course === 'drink'

// ---------- Reading the words ----------

const SPECIAL: Record<string, string> = { 'ß': 'ss', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd' }

/** Lowercase without accents: "Glühwein" -> "gluhwein", "Rakı" -> "raki", "Bière" -> "biere". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ßıłøæœđ]/g, (c) => SPECIAL[c] ?? c)

/** The folded text as plain words with one space around each. "/" and "|" read as "or": "Weizen / alkoholfrei" offers two drinks. */
const words = (s: string) => ` ${fold(s).replace(/[/|]/g, ' or ').replace(/[^a-z0-9]+/g, ' ').trim()} `

const list = (s: string) => s.trim().split(/\s+/)
/** Whole words (or whole phrases) only: no lookbehind, so it also runs on older phones. */
const wordRx = (parts: readonly string[], flags = '') => new RegExp(` (?:${parts.join('|')})(?= )`, flags)

/** "This one has no alcohol", as menus say it. */
const FREE_PARTS = [
  'alkohol ?frei[a-z]*', 'ohne alkohol', 'entalkoholisiert[a-z]*',
  'alcohol ?free', 'non ?alcoholic', '(?:no|zero|without) alcohol', '0 (?:alcohol|alkohol|alcool|alcol)',
  'sans alcool', 'desalcoolise[a-z]*',
  'sin alcohol', 'desalcoholizad[a-z]*',
  'senza alcol[a-z]*', 'analcolic[a-z]+', 'analcoolic[a-z]+',
  'sem alcool',
  'alkolsuz',
  'bezalkoholow[a-z]*', 'bez alkoholu',
  'alcoholvrij[a-z]*', 'alcohol vrij', 'zonder alcohol',
  'alkoholfri[a-z]*',
  'virgin', 'mocktails?', 'jever fun',
]
const FREE = wordRx(FREE_PARTS)
const FREE_ALL = wordRx(FREE_PARTS, 'g')
/** "Heineken 0.0", "Bitburger 0,0%": never "0,04 l" or "10,0". */
const ZERO = /(?:^|[^0-9])0[.,]0(?![0-9])/

/** "Also available alcohol-free", "Pils oder alkoholfrei": the alcohol-free one is only an option, the drink itself is not. */
const HEDGE = wordRx(list('also auch or oder wahlweise optional optionally option available erhaltlich moglich wunsch request aussi ou tambien anche oppure ook rowniez lub albo veya disponible disponibile disponivel possible'))

/** Phrases that carry a beer, wine or spirit word and are not alcohol. Taken out before the words are checked. */
const NEUTRAL = wordRx([
  // soft drinks
  'ginger (?:beer|ale)s?', 'root beers?', 'malt beers?', 'birch beers?', 'butter ?beers?', 'malzbier[a-z]*', 'ingwerbier[a-z]*', 'kombuchas?', 'bitter lemon',
  // vinegar, grapes, acids, grains
  '[a-z]*essig[a-z]*', '(?:apple )?cider vinegar', '(?:red |white )?wine vinegar', 'sherry vinegar', 'vinaigre de (?:vin|cidre)', 'aceto di vino', 'vinagre de (?:vino|sidra|jerez)',
  '[a-z]*weintraube[a-z]*', 'weins(?:a|ae)ure[a-z]*', 'weinstein[a-z]*', 'weinbergpfirsich[a-z]*', '[a-z]*schwein[a-z]*', 'bierteig[a-z]*', 'buchweizen[a-z]*',
  // juice mixes and starters called cocktail
  '(?:frucht|fruchte|obst|saft|milch|krabben|garnelen)cocktails?', '(?:fruit|juice|shrimp|prawn|seafood) cocktails?',
  // a shot that is not a spirit
  '(?:ginger|ingwer|kurkuma|turmeric|vitamin|immun[a-z]*|wellness|energy|matcha|wheatgrass|weizengras|espresso|detox|sanddorn|acerola|juice|saft|smoothie|protein|power) ?shots?',
  '(?:extra|double|doppelter|doppelt|single|triple|additional|zusatzlicher) (?:espresso )?shots?', 'shots? (?:of )?(?:espresso|ginger|ingwer|syrup|sirup|vanilla|caramel|milk)',
  // rose, the flower
  'rosen? (?:lemonade|limonade|limo|tea|tee|latte|water|wasser|syrup|sirup|lassi|milk|milch|chai|matcha|soda|cordial|petals?|kombucha)',
], 'g')

/** Words that mean alcohol wherever they stand: in the name, the description or a component. */
const STRONG = wordRx([
  // beer
  ...list('beer beers birra birre cerveza cervezas cerveja cervejas piwo piwa pils pilsner pilsener kolsch koelsch radler shandy hefeweizen kristallweizen doppelbock alsterwasser ipa chopp guinness kilkenny heineken desperados peroni moretti tyskie zywiec efes asahi kirin sapporo tsingtao singha staropramen budweiser carlsberg tuborg augustiner tegernseer schultheiss jever flensburger'),
  '[a-z]*bier[a-z]*', 'berliner (?:kindl|weisse)', 'weisse mit schuss', 'beck ?s',
  // wine
  ...list('wine wines vino vinos vini vin vins vinho vinhos sarap wino wina prosecco champagne champagner sampanya spumante lambrusco franciacorta cremant sangria sherry vermouth vermut wermut riesling chardonnay merlot pinot sauvignon cabernet shiraz syrah malbec tempranillo rioja chianti primitivo montepulciano grauburgunder spatburgunder spaetburgunder weissburgunder silvaner gewurztraminer muskateller dornfelder trollinger lugana soave bardolino valpolicella barolo zweigelt veltliner bordeaux beaujolais sancerre chablis federweisser'),
  '[a-z]*wein[a-z]*', '[a-z]*wijn[a-z]*', '[a-z]*sekt', 'tinto de verano',
  // cocktails
  ...list('spritz sprizz aperol negroni mojito caipirinha caipiroska caipi margarita daiquiri tschunk pisco lillet kokteyl carajillo lumumba calimocho kalimotxo rebujito'),
  '[a-z]*cocktails?', 'long ?drinks?', 'pina colada', 'mai tai', 'long island', 'cuba libre', 'bloody mary', 'sex on the beach', 'old fashioned', '(?:white|black) russian', 'irish coffee', 'caffe corretto', 'mit schuss', 'hard seltzer',
  // spirits and liqueurs
  ...list('gin rum rhum tequila mezcal bourbon scotch raki ouzo arak grappa obstler obstbrand doppelkorn liqueur liqueurs liquore liquori liquor licor licores likier likeur limoncello jagermeister jaegermeister baileys kahlua amaretto sambuca campari cynar fernet averna ramazzotti cognac brandy armagnac calvados soju pastis pernod ricard absinth absinthe cider ciders cidre sidra cachaca aguardente aguardiente ginebra ginjinha chupito chupitos jenever aquavit akvavit nalewka grzaniec pfeffi feigling asbach bacardi smirnoff jameson hennessy tanqueray orujo pacharan nocino spirituosen spiritueux superalcolici digestif digestivo aperitif aperitivo apero schnapps viski votka whiskies'),
  '[a-z]*schnaps[a-z]*', '[a-z]*liko(?:e)?r[a-z]*', '[a-z]*whiske?ys?', '[a-z]*[vw]odka[a-z]*', 'berliner luft', 'eau de vie', 'miod pitny',
  // the word itself
  'alcohol[a-z]*', 'alkohol[a-z]*', 'alcool[a-z]*', 'alcol[a-z]*', 'alkol[a-z]*',
])

/**
 * Words that mean alcohol as a drink's name or component, but are everyday words in running
 * text somewhere ("ale" is Polish for "but", "amaro" Italian for "bitter", "Weizen" German for
 * wheat, a "shot" of espresso). Checked in the name and the components, not in the description.
 */
const WEAK = wordRx([
  ...list('ale ales lager lagers stout stouts porter weizen helles bock bira corona astra port rose rosato rosado cava jerez hugo mule mules martini cosmopolitan manhattan mimosa bellini kir malibu korn amaro amari sake shot shots ron punsch bowle grog mexikaner panache bollicine'),
  '[a-z]+weizen',
])

interface Part { free: boolean; text: string; weak: boolean }

function read(raw: string, weak: boolean): Part {
  const w = words(raw)
  const marked = FREE.test(w) || ZERO.test(fold(raw))
  return { free: marked && !HEDGE.test(w), text: w.replace(NEUTRAL, '').replace(FREE_ALL, ''), weak }
}

/**
 * An alcoholic drink. Reads the printed name, its translation, the description and the
 * component names. Errs towards true: a wrong "yes" only hides a drink.
 * Always false for a dish that is not a drink ("Coq au vin" is a main).
 */
export function isAlcoholic(d: DrinkLike): boolean {
  if (!isDrink(d)) return false
  const title = read(`${d.name} ${d.translated ?? ''}`, true)
  const description = read(d.description ?? '', false)
  // The menu says this one has no alcohol.
  if (title.free || description.free) return false
  const parts = [title, description, ...(d.rows ?? []).map((r) => read(r.name, true))]
  // A component that is itself alcohol-free ("Non-alcoholic beer") does not count.
  return parts.some((p) => !p.free && (STRONG.test(p.text) || (p.weak && WEAK.test(p.text))))
}

/**
 * The drinks a viewer may see: non-alcoholic first (menu order kept), then the alcoholic
 * ones, only when `adult`. `alcoholic` holds the alcoholic drinks among `drinks` (empty
 * for a viewer who is not `adult`); `hiddenAlcohol` counts the ones left out.
 */
export function visibleDrinks<T extends DrinkLike>(dishes: readonly T[], adult: boolean): { drinks: T[]; alcoholic: Set<T>; hiddenAlcohol: number } {
  const soft: T[] = []
  const hard: T[] = []
  for (const d of dishes) {
    if (!isDrink(d)) continue
    if (isAlcoholic(d)) hard.push(d)
    else soft.push(d)
  }
  return adult
    ? { drinks: [...soft, ...hard], alcoholic: new Set(hard), hiddenAlcohol: 0 }
    : { drinks: soft, alcoholic: new Set<T>(), hiddenAlcohol: hard.length }
}

const foodCache = new WeakMap<MenuResult, MenuResult>()

/**
 * The scan result without its drinks: the food lists (picks, skip, whole menu) never carry
 * a drink. `top`, `avoid` and `tips` entries of removed dishes are dropped too. Returns the
 * same object when there are no drinks, and the same answer for the same result.
 */
export function foodOnly(result: MenuResult): MenuResult {
  const cached = foodCache.get(result)
  if (cached) return cached
  const dishes = result.dishes.filter((d) => !isDrink(d))
  let out = result
  if (dishes.length !== result.dishes.length) {
    const keep = new Set(dishes.map((d) => d.id))
    out = {
      ...result,
      dishes,
      top: result.top.filter((id) => keep.has(id)),
      avoid: result.avoid.filter((a) => keep.has(a.dishId)),
      tips: result.tips.filter((t) => keep.has(t.dishId)),
    }
  }
  foodCache.set(result, out)
  return out
}
