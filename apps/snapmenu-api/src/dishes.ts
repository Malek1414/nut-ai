/**
 * Snapmenu's hand-written table of common European restaurant dishes.
 *
 * EVERY ROW HERE IS AN ESTIMATE written by the Snapmenu team: a typical
 * restaurant portion broken into components with gram weights. The grams are
 * ours (standard-recipe portions); the nutrition per 100 g still comes from a
 * real database row (USDA FoodData Central, pinned by its exact description),
 * so the engine does the arithmetic and the UI can say where each number came
 * from. Where USDA has no fitting row (a Döner sauce, say), `per100` carries a
 * labelled estimate and the UI marks it as such.
 *
 * Components are pinned with `usda` = an exact USDA description (or a prefix
 * ending in '%'), so a dish never silently drifts to a different row.
 */

export interface RecipeComponent {
  /** Shown to the user. */
  name: string
  /** Exact USDA FoodData Central description, or a LIKE prefix ending in '%'. */
  usda?: string
  /** Fallback search key for the resolver / Open Food Facts when `usda` is absent. */
  key: string
  grams: number
  form?: 'discrete' | 'flat' | 'piled' | 'liquid' | 'wrapped' | 'spread'
  /** Per-100 g estimate for components no database row fits. Shown as "Snapmenu estimate". */
  per100?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g?: number }
  /** Hidden fat / sauce: widens the band. */
  hiddenFat?: boolean
}

export interface DishRecipe {
  key: string
  label: string
  /** Lowercase spellings seen on menus, used for matching. */
  aliases: string[]
  cuisine: string
  components: RecipeComponent[]
}

const OIL = 'Oil, olive, salad or cooking'
const VEG_OIL = 'Oil, vegetable, soybean, refined'

export const DISH_TABLE: DishRecipe[] = [
  {
    key: 'doner_kebab',
    label: 'Döner Kebab (bread)',
    aliases: ['döner', 'doner', 'döner kebab', 'doner kebab', 'döner im brot', 'dönerkebab', 'kalb döner'],
    cuisine: 'turkish',
    components: [
      { name: 'Flatbread (Fladenbrot)', usda: 'Bread, pita, white, enriched', key: 'bread, pita, white', grams: 110, form: 'discrete' },
      { name: 'Döner meat (veal/beef mix)', usda: 'Lamb, ground, cooked, broiled', key: 'lamb, ground, cooked', grams: 120, form: 'piled', hiddenFat: true },
      { name: 'Salad (lettuce, cabbage, tomato, onion)', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 70, form: 'piled' },
      { name: 'Yogurt-garlic sauce', key: 'doner sauce yogurt garlic', grams: 40, form: 'spread', hiddenFat: true,
        per100: { kcal: 230, protein_g: 2.5, carbs_g: 5, fat_g: 22 } },
    ],
  },
  {
    key: 'chicken_doner',
    label: 'Chicken Döner (bread)',
    aliases: ['hähnchen döner', 'hahnchen doner', 'hähnchendöner', 'chicken döner', 'chicken doner', 'tavuk döner', 'geflügel döner', 'chicken kebab'],
    cuisine: 'turkish',
    components: [
      { name: 'Flatbread (Fladenbrot)', usda: 'Bread, pita, white, enriched', key: 'bread, pita, white', grams: 110, form: 'discrete' },
      { name: 'Chicken döner meat', usda: 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted', key: 'chicken thigh, roasted', grams: 120, form: 'piled' },
      { name: 'Salad (lettuce, cabbage, tomato, onion)', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 70, form: 'piled' },
      { name: 'Yogurt-garlic sauce', key: 'doner sauce yogurt garlic', grams: 40, form: 'spread', hiddenFat: true,
        per100: { kcal: 230, protein_g: 2.5, carbs_g: 5, fat_g: 22 } },
    ],
  },
  {
    key: 'doner_box',
    label: 'Döner Box (meat and fries)',
    aliases: ['döner box', 'doner box', 'dönerbox', 'döner box pommes', 'kebab box'],
    cuisine: 'turkish',
    components: [
      { name: 'Döner meat', usda: 'Lamb, ground, cooked, broiled', key: 'lamb, ground, cooked', grams: 120, form: 'piled', hiddenFat: true },
      { name: 'Fries', usda: 'Fast foods, potato, french fried in vegetable oil', key: 'potato, french fried', grams: 150, form: 'piled' },
      { name: 'Yogurt-garlic sauce', key: 'doner sauce yogurt garlic', grams: 40, form: 'spread', hiddenFat: true,
        per100: { kcal: 230, protein_g: 2.5, carbs_g: 5, fat_g: 22 } },
      { name: 'Salad', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 30, form: 'piled' },
    ],
  },
  {
    key: 'ayran',
    label: 'Ayran (yogurt drink, 0.3 l)',
    aliases: ['ayran', 'ayran 0 3 l', 'ayran 0 25 l'],
    cuisine: 'turkish',
    components: [
      { name: 'Ayran (yogurt, water, salt)', key: 'ayran', grams: 300, form: 'liquid',
        per100: { kcal: 37, protein_g: 1.7, carbs_g: 2.6, fat_g: 2 } },
    ],
  },
  {
    key: 'durum',
    label: 'Dürüm (wrap)',
    aliases: ['dürüm', 'durum', 'dürüm döner', 'durum doner', 'yufka', 'dürüm kebab'],
    cuisine: 'turkish',
    components: [
      { name: 'Wheat wrap (yufka)', usda: 'Tortillas, ready-to-bake or -fry, flour, refrigerated', key: 'tortilla, flour', grams: 90, form: 'wrapped' },
      { name: 'Döner meat', usda: 'Lamb, ground, cooked, broiled', key: 'lamb, ground, cooked', grams: 130, form: 'piled', hiddenFat: true },
      { name: 'Salad', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 70, form: 'piled' },
      { name: 'Yogurt-garlic sauce', key: 'doner sauce yogurt garlic', grams: 40, form: 'spread', hiddenFat: true,
        per100: { kcal: 230, protein_g: 2.5, carbs_g: 5, fat_g: 22 } },
    ],
  },
  {
    key: 'doner_teller',
    label: 'Döner plate with fries or rice',
    aliases: ['döner teller', 'doner teller', 'dönerteller', 'iskender', 'döner teller mit pommes', 'döner mit pommes'],
    cuisine: 'turkish',
    components: [
      { name: 'Döner meat', usda: 'Lamb, ground, cooked, broiled', key: 'lamb, ground, cooked', grams: 180, form: 'piled', hiddenFat: true },
      { name: 'Fries', usda: 'Fast foods, potato, french fried in vegetable oil', key: 'potato, french fried', grams: 150, form: 'piled' },
      { name: 'Salad', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 80, form: 'piled' },
      { name: 'Yogurt-garlic sauce', key: 'doner sauce yogurt garlic', grams: 50, form: 'spread', hiddenFat: true,
        per100: { kcal: 230, protein_g: 2.5, carbs_g: 5, fat_g: 22 } },
    ],
  },
  {
    key: 'lahmacun',
    label: 'Lahmacun',
    aliases: ['lahmacun', 'lahmajun', 'türkische pizza', 'turkish pizza'],
    cuisine: 'turkish',
    components: [
      { name: 'Thin dough base', usda: 'Bread, pita, white, enriched', key: 'bread, pita, white', grams: 100, form: 'flat' },
      { name: 'Spiced minced meat', usda: 'Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned', key: 'beef, ground, cooked', grams: 50, form: 'spread' },
      { name: 'Salad and lemon', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 50, form: 'piled' },
    ],
  },
  {
    key: 'currywurst',
    label: 'Currywurst',
    aliases: ['currywurst', 'curry wurst', 'currywurst ohne darm', 'currywurst mit darm'],
    cuisine: 'german',
    components: [
      { name: 'Pork sausage (Bratwurst)', usda: 'Bratwurst, pork, cooked', key: 'bratwurst, pork, cooked', grams: 130, form: 'discrete' },
      { name: 'Curry ketchup', usda: 'Catsup', key: 'catsup', grams: 60, form: 'spread' },
      { name: 'Curry powder', usda: 'Spices, curry powder', key: 'curry powder', grams: 2, form: 'spread' },
    ],
  },
  {
    key: 'currywurst_pommes',
    label: 'Currywurst with fries',
    aliases: ['currywurst pommes', 'currywurst mit pommes', 'currywurst & pommes', 'currywurst und pommes'],
    cuisine: 'german',
    components: [
      { name: 'Pork sausage (Bratwurst)', usda: 'Bratwurst, pork, cooked', key: 'bratwurst, pork, cooked', grams: 130, form: 'discrete' },
      { name: 'Curry ketchup', usda: 'Catsup', key: 'catsup', grams: 60, form: 'spread' },
      { name: 'Fries', usda: 'Fast foods, potato, french fried in vegetable oil', key: 'potato, french fried', grams: 150, form: 'piled' },
      { name: 'Mayonnaise', usda: 'Salad dressing, mayonnaise, regular', key: 'mayonnaise', grams: 20, form: 'spread', hiddenFat: true },
    ],
  },
  {
    key: 'pommes',
    label: 'Fries',
    aliases: ['pommes', 'pommes frites', 'fries', 'french fries', 'frites', 'patatas fritas'],
    cuisine: 'german',
    components: [
      { name: 'Fries', usda: 'Fast foods, potato, french fried in vegetable oil', key: 'potato, french fried', grams: 160, form: 'piled' },
    ],
  },
  {
    key: 'schnitzel',
    label: 'Schnitzel Wiener Art with fries',
    aliases: ['schnitzel', 'wiener schnitzel', 'schnitzel wiener art', 'schweineschnitzel', 'jägerschnitzel', 'jaegerschnitzel', 'zigeunerschnitzel', 'paprikaschnitzel', 'schnitzel mit pommes'],
    cuisine: 'german',
    components: [
      { name: 'Breaded pork/veal cutlet, pan-fried', usda: 'Veal, leg (top round), separable lean and fat, cooked, pan-fried, breaded', key: 'veal, breaded, pan-fried', grams: 180, form: 'flat', hiddenFat: true },
      { name: 'Fries', usda: 'Fast foods, potato, french fried in vegetable oil', key: 'potato, french fried', grams: 150, form: 'piled' },
      { name: 'Frying fat absorbed', usda: VEG_OIL, key: 'oil, vegetable', grams: 10, form: 'spread', hiddenFat: true },
      { name: 'Lemon and side salad', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 40, form: 'piled' },
    ],
  },
  {
    key: 'kaesespaetzle',
    label: 'Käsespätzle',
    aliases: ['käsespätzle', 'kasespatzle', 'käsespätzle mit röstzwiebeln', 'spätzle', 'spaetzle'],
    cuisine: 'german',
    components: [
      { name: 'Egg noodles (Spätzle), cooked', usda: 'Noodles, egg, enriched, cooked', key: 'noodles, egg, cooked', grams: 280, form: 'piled' },
      { name: 'Emmental cheese', usda: 'Cheese, swiss', key: 'cheese, swiss', grams: 80, form: 'spread' },
      { name: 'Fried onions and butter', usda: 'Butter, salted', key: 'butter, salted', grams: 15, form: 'spread', hiddenFat: true },
    ],
  },
  {
    key: 'bratwurst_brot',
    label: 'Bratwurst in a roll',
    aliases: ['bratwurst', 'rostbratwurst', 'thüringer', 'bratwurst im brötchen', 'wurst im brötchen'],
    cuisine: 'german',
    components: [
      { name: 'Bratwurst', usda: 'Bratwurst, pork, cooked', key: 'bratwurst, pork, cooked', grams: 110, form: 'discrete' },
      { name: 'Bread roll', usda: 'Rolls, hard (includes kaiser)', key: 'rolls, hard', grams: 60, form: 'discrete' },
      { name: 'Mustard', usda: 'Mustard, prepared, yellow', key: 'mustard, prepared', grams: 10, form: 'spread' },
    ],
  },
  {
    key: 'pho_bo',
    label: 'Phở bò (beef noodle soup)',
    aliases: ['pho', 'phở', 'pho bo', 'phở bò', 'pho ga', 'phở gà', 'pho tai', 'pho noodle soup'],
    cuisine: 'vietnamese',
    components: [
      { name: 'Rice noodles, cooked', usda: 'Rice noodles, cooked', key: 'rice noodles, cooked', grams: 250, form: 'piled' },
      { name: 'Beef slices', usda: 'Beef, round, eye of round roast, boneless, separable lean only, trimmed to 0" fat, all grades, cooked, roasted', key: 'beef, round, cooked', grams: 90, form: 'flat' },
      { name: 'Beef broth', usda: 'Soup, beef broth or bouillon canned, ready-to-serve', key: 'beef broth', grams: 450, form: 'liquid' },
      { name: 'Bean sprouts and herbs', usda: 'Mung beans, mature seeds, sprouted, raw', key: 'mung beans, sprouted, raw', grams: 50, form: 'piled' },
    ],
  },
  {
    key: 'ramen',
    label: 'Ramen (pork broth)',
    aliases: ['ramen', 'tonkotsu ramen', 'shoyu ramen', 'miso ramen', 'ramen noodle soup'],
    cuisine: 'japanese',
    components: [
      { name: 'Wheat noodles, cooked', usda: 'Noodles, egg, enriched, cooked', key: 'noodles, cooked', grams: 220, form: 'piled' },
      { name: 'Pork belly (chashu)', usda: 'Pork, fresh, belly, raw', key: 'pork belly', grams: 60, form: 'flat', hiddenFat: true },
      { name: 'Rich broth', usda: 'Soup, chicken broth, ready-to-serve', key: 'chicken broth', grams: 450, form: 'liquid', hiddenFat: true },
      { name: 'Soft-boiled egg', usda: 'Egg, whole, cooked, hard-boiled', key: 'egg, hard-boiled', grams: 50, form: 'discrete' },
      { name: 'Broth fat / tare', usda: 'Lard', key: 'lard', grams: 10, form: 'liquid', hiddenFat: true },
    ],
  },
  {
    key: 'margherita',
    label: 'Pizza Margherita',
    aliases: ['margherita', 'pizza margherita', 'pizza margarita', 'margarita pizza'],
    cuisine: 'italian',
    components: [
      { name: 'Pizza dough base', usda: 'Bread, white, commercially prepared (includes soft bread crumbs)', key: 'bread, white', grams: 230, form: 'flat' },
      { name: 'Tomato sauce', usda: 'Tomato products, canned, sauce', key: 'tomato sauce', grams: 80, form: 'spread' },
      { name: 'Mozzarella', usda: 'Cheese, mozzarella, whole milk', key: 'cheese, mozzarella, whole milk', grams: 110, form: 'spread' },
      { name: 'Olive oil', usda: OIL, key: 'oil, olive', grams: 8, form: 'spread', hiddenFat: true },
      { name: 'Basil', usda: 'Basil, fresh', key: 'basil, fresh', grams: 2, form: 'spread' },
    ],
  },
  {
    key: 'pizza_salami',
    label: 'Pizza Salami / Diavola',
    aliases: ['pizza salami', 'salami pizza', 'diavola', 'pizza diavola', 'pepperoni pizza', 'pizza pepperoni'],
    cuisine: 'italian',
    components: [
      { name: 'Pizza dough base', usda: 'Bread, white, commercially prepared (includes soft bread crumbs)', key: 'bread, white', grams: 230, form: 'flat' },
      { name: 'Tomato sauce', usda: 'Tomato products, canned, sauce', key: 'tomato sauce', grams: 80, form: 'spread' },
      { name: 'Mozzarella', usda: 'Cheese, mozzarella, whole milk', key: 'cheese, mozzarella, whole milk', grams: 100, form: 'spread' },
      { name: 'Salami', usda: 'Salami, Italian, pork', key: 'salami, italian, pork', grams: 50, form: 'flat' },
    ],
  },
  {
    key: 'carbonara',
    label: 'Spaghetti Carbonara',
    aliases: ['carbonara', 'spaghetti carbonara', 'pasta carbonara', 'spaghetti alla carbonara'],
    cuisine: 'italian',
    components: [
      { name: 'Spaghetti, cooked', usda: 'Pasta, cooked, enriched, without added salt', key: 'pasta, cooked', grams: 250, form: 'piled' },
      { name: 'Guanciale / bacon', usda: 'Pork, cured, bacon, cooked, restaurant', key: 'bacon, cooked', grams: 40, form: 'piled', hiddenFat: true },
      { name: 'Egg yolk', usda: 'Egg, yolk, raw, fresh', key: 'egg yolk, raw', grams: 35, form: 'spread' },
      { name: 'Pecorino / Parmesan', usda: 'Cheese, parmesan, grated', key: 'cheese, parmesan, grated', grams: 25, form: 'spread' },
    ],
  },
  {
    key: 'bolognese',
    label: 'Spaghetti Bolognese',
    aliases: ['bolognese', 'spaghetti bolognese', 'spaghetti bolognaise', 'tagliatelle al ragù', 'ragù', 'pasta bolognese'],
    cuisine: 'italian',
    components: [
      { name: 'Spaghetti, cooked', usda: 'Pasta, cooked, enriched, without added salt', key: 'pasta, cooked', grams: 250, form: 'piled' },
      { name: 'Minced beef', usda: 'Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned', key: 'beef, ground, cooked', grams: 90, form: 'piled', hiddenFat: true },
      { name: 'Tomato sauce', usda: 'Sauce, pasta, spaghetti/marinara, ready-to-serve', key: 'marinara sauce', grams: 120, form: 'spread' },
      { name: 'Parmesan', usda: 'Cheese, parmesan, grated', key: 'cheese, parmesan, grated', grams: 10, form: 'spread' },
    ],
  },
  {
    key: 'penne_arrabbiata',
    label: 'Penne all’arrabbiata',
    aliases: ['arrabbiata', 'penne arrabbiata', "penne all'arrabbiata", 'pasta arrabbiata', 'pasta pomodoro', 'spaghetti pomodoro'],
    cuisine: 'italian',
    components: [
      { name: 'Penne, cooked', usda: 'Pasta, cooked, enriched, without added salt', key: 'pasta, cooked', grams: 260, form: 'piled' },
      { name: 'Tomato-chili sauce', usda: 'Sauce, pasta, spaghetti/marinara, ready-to-serve', key: 'marinara sauce', grams: 150, form: 'spread' },
      { name: 'Olive oil', usda: OIL, key: 'oil, olive', grams: 10, form: 'spread', hiddenFat: true },
    ],
  },
  {
    key: 'lasagne',
    label: 'Lasagne',
    aliases: ['lasagne', 'lasagna', 'lasagne al forno', 'lasagne bolognese'],
    cuisine: 'italian',
    components: [
      { name: 'Pasta sheets, cooked', usda: 'Pasta, cooked, enriched, without added salt', key: 'pasta, cooked', grams: 150, form: 'flat' },
      { name: 'Minced beef ragù', usda: 'Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned', key: 'beef, ground, cooked', grams: 100, form: 'piled', hiddenFat: true },
      { name: 'Tomato sauce', usda: 'Sauce, pasta, spaghetti/marinara, ready-to-serve', key: 'marinara sauce', grams: 100, form: 'spread' },
      { name: 'Béchamel (milk, butter, flour)', usda: 'Milk, whole, 3.25% milkfat, with added vitamin D', key: 'milk, whole', grams: 100, form: 'spread' },
      { name: 'Butter in béchamel', usda: 'Butter, salted', key: 'butter, salted', grams: 12, form: 'spread', hiddenFat: true },
      { name: 'Mozzarella / Parmesan', usda: 'Cheese, mozzarella, whole milk', key: 'cheese, mozzarella', grams: 50, form: 'spread' },
    ],
  },
  {
    key: 'risotto',
    label: 'Risotto (mushroom)',
    aliases: ['risotto', 'risotto ai funghi', 'mushroom risotto', 'pilzrisotto', 'risotto milanese'],
    cuisine: 'italian',
    components: [
      { name: 'Arborio rice, cooked', usda: 'Rice, white, medium-grain, enriched, cooked', key: 'rice, white, medium-grain, cooked', grams: 280, form: 'piled' },
      { name: 'Mushrooms', usda: 'Mushrooms, white, cooked, boiled, drained, without salt', key: 'mushrooms, white, cooked', grams: 80, form: 'piled' },
      { name: 'Butter', usda: 'Butter, salted', key: 'butter, salted', grams: 20, form: 'spread', hiddenFat: true },
      { name: 'Parmesan', usda: 'Cheese, parmesan, grated', key: 'cheese, parmesan, grated', grams: 20, form: 'spread' },
    ],
  },
  {
    key: 'caesar_salad',
    label: 'Caesar salad with chicken',
    aliases: ['caesar salad', 'caesar salat', 'insalata caesar', 'chicken caesar', 'caesar salad mit hähnchen'],
    cuisine: 'international',
    components: [
      { name: 'Romaine lettuce', usda: 'Lettuce, cos or romaine, raw', key: 'lettuce, romaine, raw', grams: 150, form: 'piled' },
      { name: 'Grilled chicken breast', usda: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', key: 'chicken breast, roasted', grams: 120, form: 'flat' },
      { name: 'Caesar dressing', usda: 'Salad dressing, caesar dressing, regular', key: 'caesar dressing', grams: 45, form: 'spread', hiddenFat: true },
      { name: 'Croutons', usda: 'Croutons, seasoned', key: 'croutons', grams: 20, form: 'piled' },
      { name: 'Parmesan', usda: 'Cheese, parmesan, grated', key: 'cheese, parmesan, grated', grams: 15, form: 'spread' },
    ],
  },
  {
    key: 'falafel_teller',
    label: 'Falafel plate',
    aliases: ['falafel teller', 'falafelteller', 'falafel plate', 'falafel platte', 'falafel'],
    cuisine: 'middle_eastern',
    components: [
      { name: 'Falafel (6 pieces)', usda: 'Falafel, home-prepared', key: 'falafel', grams: 120, form: 'discrete' },
      { name: 'Hummus', usda: 'Hummus, commercial', key: 'hummus', grams: 80, form: 'spread' },
      { name: 'Salad', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 100, form: 'piled' },
      { name: 'Tahini sauce', usda: 'Seeds, sesame butter, tahini, from roasted and toasted kernels (most common type)', key: 'tahini', grams: 25, form: 'spread', hiddenFat: true },
      { name: 'Pita bread', usda: 'Bread, pita, white, enriched', key: 'bread, pita, white', grams: 60, form: 'discrete' },
    ],
  },
  {
    key: 'falafel_wrap',
    label: 'Falafel wrap',
    aliases: ['falafel wrap', 'falafel dürüm', 'falafel durum', 'falafel im brot', 'falafel sandwich'],
    cuisine: 'middle_eastern',
    components: [
      { name: 'Wheat wrap', usda: 'Tortillas, ready-to-bake or -fry, flour, refrigerated', key: 'tortilla, flour', grams: 80, form: 'wrapped' },
      { name: 'Falafel (4 pieces)', usda: 'Falafel, home-prepared', key: 'falafel', grams: 80, form: 'discrete' },
      { name: 'Salad', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 60, form: 'piled' },
      { name: 'Tahini sauce', usda: 'Seeds, sesame butter, tahini, from roasted and toasted kernels (most common type)', key: 'tahini', grams: 20, form: 'spread', hiddenFat: true },
    ],
  },
  {
    key: 'halloumi_wrap',
    label: 'Halloumi wrap',
    aliases: ['halloumi', 'halloumi wrap', 'halloumi dürüm', 'hellim', 'halloumi im brot', 'halloumi sandwich'],
    cuisine: 'middle_eastern',
    components: [
      { name: 'Wheat wrap / bread', usda: 'Tortillas, ready-to-bake or -fry, flour, refrigerated', key: 'tortilla, flour', grams: 90, form: 'wrapped' },
      { name: 'Grilled halloumi', key: 'halloumi cheese', grams: 90, form: 'flat',
        per100: { kcal: 321, protein_g: 21, carbs_g: 2, fat_g: 25 } },
      { name: 'Salad', usda: 'Lettuce, iceberg (includes crisphead types), raw', key: 'lettuce, iceberg, raw', grams: 60, form: 'piled' },
      { name: 'Yogurt sauce', key: 'yogurt garlic sauce', grams: 30, form: 'spread', hiddenFat: true,
        per100: { kcal: 230, protein_g: 2.5, carbs_g: 5, fat_g: 22 } },
    ],
  },
  {
    key: 'buddha_bowl',
    label: 'Bowl (grain, veg, protein)',
    aliases: ['buddha bowl', 'poke', 'poke bowl', 'poké bowl', 'power bowl', 'protein bowl', 'grain bowl', 'salad bowl'],
    cuisine: 'international',
    components: [
      { name: 'Rice / quinoa base', usda: 'Rice, white, medium-grain, enriched, cooked', key: 'rice, white, cooked', grams: 180, form: 'piled' },
      { name: 'Protein (chicken, tofu or salmon)', usda: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', key: 'chicken breast, roasted', grams: 100, form: 'flat' },
      { name: 'Vegetables (edamame, cucumber, carrot, cabbage)', usda: 'Edamame, frozen, prepared', key: 'edamame', grams: 120, form: 'piled' },
      { name: 'Avocado', usda: 'Avocados, raw, all commercial varieties', key: 'avocado, raw', grams: 50, form: 'piled' },
      { name: 'Dressing / sauce', usda: 'Salad dressing, sesame seed dressing, regular', key: 'sesame dressing', grams: 30, form: 'spread', hiddenFat: true },
    ],
  },
  {
    key: 'burger',
    label: 'Cheeseburger with fries',
    aliases: ['burger', 'cheeseburger', 'hamburger', 'classic burger', 'beef burger', 'burger mit pommes'],
    cuisine: 'international',
    components: [
      { name: 'Brioche bun', usda: 'Rolls, hamburger or hotdog, plain', key: 'rolls, hamburger', grams: 80, form: 'discrete' },
      { name: 'Beef patty (180 g raw)', usda: 'Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled', key: 'beef, ground, patty, cooked', grams: 140, form: 'discrete', hiddenFat: true },
      { name: 'Cheddar slice', usda: 'Cheese, cheddar', key: 'cheese, cheddar', grams: 20, form: 'flat' },
      { name: 'Burger sauce', usda: 'Salad dressing, mayonnaise, regular', key: 'mayonnaise', grams: 20, form: 'spread', hiddenFat: true },
      { name: 'Fries', usda: 'Fast foods, potato, french fried in vegetable oil', key: 'potato, french fried', grams: 150, form: 'piled' },
    ],
  },
  {
    key: 'pad_thai',
    label: 'Pad Thai with chicken',
    aliases: ['pad thai', 'phat thai', 'pad thai gai', 'pad thai mit hähnchen'],
    cuisine: 'thai',
    components: [
      { name: 'Rice noodles, cooked', usda: 'Rice noodles, cooked', key: 'rice noodles, cooked', grams: 250, form: 'piled' },
      { name: 'Chicken', usda: 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted', key: 'chicken thigh, roasted', grams: 90, form: 'piled' },
      { name: 'Egg', usda: 'Egg, whole, cooked, scrambled', key: 'egg, scrambled', grams: 50, form: 'piled' },
      { name: 'Peanuts', usda: 'Peanuts, all types, dry-roasted, without salt', key: 'peanuts, dry-roasted', grams: 15, form: 'piled' },
      { name: 'Wok oil and tamarind sauce', usda: VEG_OIL, key: 'oil, vegetable', grams: 15, form: 'liquid', hiddenFat: true },
    ],
  },
  {
    key: 'green_curry',
    label: 'Thai curry with rice',
    aliases: ['green curry', 'red curry', 'thai curry', 'gaeng keow wan', 'panang', 'grünes curry', 'rotes curry', 'curry mit reis'],
    cuisine: 'thai',
    components: [
      { name: 'Jasmine rice, cooked', usda: 'Rice, white, long-grain, regular, enriched, cooked', key: 'rice, white, long-grain, cooked', grams: 200, form: 'piled' },
      { name: 'Chicken', usda: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', key: 'chicken breast, roasted', grams: 100, form: 'piled' },
      { name: 'Coconut milk', usda: 'Nuts, coconut milk, canned (liquid expressed from grated meat and water)', key: 'coconut milk, canned', grams: 150, form: 'liquid', hiddenFat: true },
      { name: 'Vegetables', usda: 'Peppers, sweet, green, raw', key: 'peppers, sweet, raw', grams: 80, form: 'piled' },
    ],
  },
  {
    key: 'sushi_mix',
    label: 'Sushi set (8 maki + 4 nigiri)',
    aliases: ['sushi', 'sushi set', 'maki', 'nigiri', 'sushi mix', 'california roll'],
    cuisine: 'japanese',
    components: [
      { name: 'Sushi rice', usda: 'Rice, white, short-grain, enriched, cooked', key: 'rice, white, short-grain, cooked', grams: 220, form: 'discrete' },
      { name: 'Salmon / tuna', usda: 'Fish, salmon, Atlantic, farmed, raw', key: 'salmon, raw', grams: 70, form: 'discrete' },
      { name: 'Nori, cucumber, avocado', usda: 'Avocados, raw, all commercial varieties', key: 'avocado, raw', grams: 30, form: 'discrete' },
      { name: 'Soy sauce', usda: 'Soy sauce made from soy and wheat (shoyu)', key: 'soy sauce', grams: 15, form: 'liquid' },
    ],
  },
  {
    key: 'grilled_chicken_salad',
    label: 'Grilled chicken salad',
    aliases: ['chicken salad', 'hähnchensalat', 'salat mit hähnchen', 'grilled chicken salad', 'insalata di pollo', 'salat mit putenstreifen'],
    cuisine: 'international',
    components: [
      { name: 'Mixed leaves and vegetables', usda: 'Lettuce, cos or romaine, raw', key: 'lettuce, romaine, raw', grams: 200, form: 'piled' },
      { name: 'Grilled chicken breast', usda: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', key: 'chicken breast, roasted', grams: 130, form: 'flat' },
      { name: 'Vinaigrette', usda: 'Salad dressing, italian dressing, commercial, regular', key: 'italian dressing', grams: 30, form: 'spread', hiddenFat: true },
    ],
  },
  {
    key: 'tiramisu',
    label: 'Tiramisu',
    aliases: ['tiramisu', 'tiramisù'],
    cuisine: 'italian',
    components: [
      { name: 'Mascarpone cream', key: 'mascarpone cream', grams: 80, form: 'spread',
        per100: { kcal: 350, protein_g: 5, carbs_g: 18, fat_g: 29 } },
      { name: 'Ladyfingers soaked in coffee', usda: 'Cookies, ladyfingers, with lemon juice and rind', key: 'ladyfingers', grams: 40, form: 'flat' },
    ],
  },
]

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const BY_KEY = new Map(DISH_TABLE.map((d) => [d.key, d]))
/** Aliases normalised once per isolate, in table order (was ~200 normalisations per lookup). */
let ALIASES: Array<{ d: DishRecipe; padded: string; len: number }> | null = null
function aliases(): NonNullable<typeof ALIASES> {
  ALIASES ??= DISH_TABLE.flatMap((d) => d.aliases.map((a) => ({ d, na: norm(a) })).filter((x) => x.na).map((x) => ({ d: x.d, padded: ` ${x.na} `, len: x.na.length })))
  return ALIASES
}

/** Find a table recipe by explicit key or by menu name. Longest alias wins. */
export function matchDish(name: string, keyHint?: string | null): DishRecipe | null {
  if (keyHint) {
    const byKey = BY_KEY.get(keyHint)
    if (byKey) return byKey
  }
  const n = ` ${norm(name)} `
  let best: { d: DishRecipe; len: number } | null = null
  for (const a of aliases()) {
    if (a.len > (best?.len ?? 0) && n.includes(a.padded)) best = a
  }
  return best?.d ?? null
}
