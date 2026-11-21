/**
 * Hand-checked spellings (German, French, Italian, Spanish, Turkish, English)
 * for European menu components and dishes, pinned to one CIQUAL 2025 row each.
 *
 * `pin` is a piece of the row's French name. The test fails if a new CIQUAL
 * release moves a code to a different food, so a mapping never drifts silently.
 * CIQUAL names are French and English only; every other language reaches the
 * table through this list.
 */
export interface CiqualAlias {
  code: number
  pin: string
  keys: string[]
  /** A complete menu item outside CIQUAL's own "dishes" group (desserts, pastries). */
  dish?: true
}

export const CIQUAL_ALIASES: CiqualAlias[] = [
  // Sauces and dips
  { code: 11203, pin: 'sauce kebab', keys: ['kebab sauce', 'sauce kebab', 'kebabsauce', 'kebab sosu'] },
  { code: 11166, pin: 'sauce au yaourt', keys: ['yogurt sauce', 'yoghurt sauce', 'yogurt garlic sauce', 'joghurtsauce', 'joghurtsosse', 'joghurt sauce', 'joghurt knoblauch sauce', 'sauce au yaourt', 'salsa allo yogurt', 'salsa de yogur'] },
  { code: 19863, pin: 'tzatziki', keys: ['tzatziki', 'tsatsiki', 'zaziki', 'cacik'] },
  { code: 25621, pin: 'houmous', keys: ['hummus', 'houmous', 'humus', 'hommos', 'hoummous'] },
  { code: 11101, pin: 'sauce bechamel', keys: ['bechamel', 'bechamel sauce', 'sauce bechamel', 'bechamelsauce', 'besciamella', 'salsa bechamel'] },
  { code: 11114, pin: 'sauce bolognaise', keys: ['bolognese sauce', 'sauce bolognaise', 'bolognesesauce', 'ragu alla bolognese', 'ragu', 'salsa bolonesa'] },
  { code: 11128, pin: 'sauce carbonara', keys: ['carbonara sauce', 'sauce carbonara', 'carbonarasauce'] },
  { code: 11179, pin: 'sauce pesto', keys: ['pesto', 'pesto sauce', 'pesto genovese', 'basil pesto', 'pesto alla genovese'] },
  { code: 11054, pin: 'mayonnaise', keys: ['mayonnaise', 'mayo', 'majonase', 'maionese', 'mayonesa'] },
  { code: 11168, pin: 'aioli', keys: ['aioli', 'allioli', 'alioli', 'sauce aioli'] },
  { code: 11105, pin: 'sauce hollandaise', keys: ['hollandaise', 'sauce hollandaise', 'hollandaise sauce', 'salsa olandese', 'salsa holandesa'] },
  { code: 11051, pin: 'sauce tartare', keys: ['tartare sauce', 'tartar sauce', 'sauce tartare', 'salsa tartara'] },
  { code: 11110, pin: 'sauce vinaigrette', keys: ['vinaigrette', 'salad dressing', 'sauce vinaigrette', 'essig ol dressing', 'vinagreta'] },
  { code: 11132, pin: 'sauce au curry', keys: ['curry sauce', 'sauce au curry', 'sauce curry', 'currysauce', 'salsa al curry'] },
  { code: 19410, pin: 'creme 30% mg', keys: ['creme fraiche', 'creme epaisse', 'creme fraiche epaisse', 'thick cream'] },

  { code: 11013, pin: 'moutarde', keys: ['mustard', 'moutarde', 'senf', 'senape', 'mostaza', 'hardal'] },
  { code: 11008, pin: 'ketchup, preemballe', keys: ['ketchup', 'catsup', 'tomato ketchup', 'tomatenketchup'] },

  // Dairy and cheese
  { code: 19600, pin: 'yaourt ou lait fermenté, nature, sans précision', keys: ['yogurt', 'yoghurt', 'plain yogurt', 'natural yogurt', 'yaourt', 'yaourt nature', 'joghurt', 'naturjoghurt', 'yogurt bianco', 'yogur natural', 'yogur'] },
  { code: 12115, pin: 'emmental ou emmenthal', keys: ['emmental', 'emmenthal', 'emmentaler', 'emmental cheese', 'swiss cheese'] },
  { code: 19584, pin: 'mascarpone', keys: ['mascarpone', 'mascarpone cream'] },
  { code: 12066, pin: 'feta', keys: ['feta', 'feta cheese', 'schafskase', 'fetakase', 'queso feta', 'beyaz peynir'] },
  { code: 19590, pin: 'mozzarella', keys: ['mozzarella', 'mozzarella cheese', 'mozarella', 'fior di latte'] },
  { code: 12072, pin: 'burrata', keys: ['burrata'] },
  { code: 12120, pin: 'parmesan', keys: ['parmesan', 'parmesan cheese', 'parmigiano', 'parmigiano reggiano', 'parmesano'] },
  { code: 12749, pin: 'raclette', keys: ['raclette', 'raclette cheese', 'raclettekase', 'fromage a raclette'] },

  // Bread and starch
  { code: 7180, pin: 'pain pita', keys: ['pita', 'pitta', 'pita bread', 'pain pita', 'pitabrot', 'pan de pita'] },
  { code: 7001, pin: 'pain blanc', keys: ['baguette', 'french bread', 'white bread', 'pain blanc', 'weissbrot', 'pane bianco'] },
  { code: 7263, pin: 'bretzel', keys: ['bretzel', 'brezel', 'breze', 'brezn', 'laugenbrezel', 'pretzel', 'soft pretzel'] },
  { code: 7815, pin: 'tortilla souple', keys: ['wheat tortilla', 'flour tortilla', 'tortilla wrap', 'wrap bread', 'weizentortilla', 'tortilla de trigo'] },
  { code: 9811, pin: 'pâtes sèches, standard, cuites', keys: ['pasta', 'cooked pasta', 'pâtes', 'pâtes cuites', 'nudeln', 'spaghetti', 'penne', 'tagliatelle', 'fusilli', 'rigatoni', 'linguine'] },
  { code: 9104, pin: 'riz blanc, cuit', keys: ['rice', 'white rice', 'cooked rice', 'steamed rice', 'riz', 'riz blanc', 'reis', 'riso', 'arroz', 'pilav'] },
  { code: 9683, pin: 'couscous, cuite', keys: ['couscous', 'cooked couscous', 'semoule', 'kuskus', 'cuscus'] },
  { code: 9691, pin: 'boulgour', keys: ['bulgur', 'bulgur wheat', 'boulgour', 'burghul', 'bulgur pilavi'] },
  { code: 25510, pin: 'gnocchi', keys: ['gnocchi', 'potato gnocchi', 'gnocchi di patate'] },
  { code: 4032, pin: 'frites de pommes de terre', keys: ['fries', 'french fries', 'pommes frites', 'frites', 'fritten', 'pommes rot weiss', 'patatine fritte', 'patatas fritas', 'patates kizartmasi'] },
  { code: 4039, pin: 'rostis', keys: ['rosti', 'roesti', 'rostis', 'kartoffelrosti', 'galette de pomme de terre', 'reibekuchen', 'kartoffelpuffer'] },
  { code: 4018, pin: 'puree de pomme de terre', keys: ['mashed potatoes', 'mashed potato', 'puree de pommes de terre', 'kartoffelpuree', 'kartoffelbrei', 'pure di patate', 'pure de patatas'] },

  // Meat and fish
  { code: 30134, pin: 'saucisse de francfort', keys: ['frankfurter', 'frankfurter sausage', 'frankfurter wurstchen', 'wiener wurstchen', 'wienerle', 'saucisse de francfort', 'wurstel', 'salchicha de frankfurt'] },
  { code: 30155, pin: 'merguez', keys: ['merguez', 'merguez sausage'] },
  { code: 30315, pin: 'chorizo', keys: ['chorizo'] },
  { code: 36205, pin: 'magret', keys: ['duck breast', 'magret', 'magret de canard', 'entenbrust', 'petto d anatra', 'magret de pato'] },
  { code: 6253, pin: 'steak hache 10%', keys: ['beef patty', 'minced steak', 'steak hache', 'hacksteak', 'burger patty', 'rinderhacksteak', 'hamburguesa de ternera'] },
  { code: 25173, pin: 'escalope panee', keys: ['wiener schnitzel', 'schnitzel', 'breaded veal escalope', 'escalope viennoise', 'escalope milanaise', 'escalope panee', 'cotoletta alla milanese', 'cotoletta', 'escalope milanesa'] },
  { code: 25089, pin: 'cordon bleu', keys: ['cordon bleu', 'chicken cordon bleu', 'hahnchen cordon bleu'] },
  { code: 11033, pin: 'basilic, frais', keys: ['basil', 'fresh basil', 'basilic', 'basilikum', 'basilico', 'albahaca'] },
  { code: 25571, pin: 'falafel', keys: ['falafel', 'falafel balls', 'falafels', 'felafel'] },
  { code: 10082, pin: 'moules marinieres', keys: ['moules marinieres', 'mussels mariniere', 'miesmuscheln in weisswein', 'cozze alla marinara', 'mejillones a la marinera'] },

  // Whole dishes: a second opinion per 100 g next to the component sum
  { code: 25428, pin: 'kebab, pita', keys: ['doner kebab', 'doner', 'doner kebap', 'sandwich grec', 'doner im brot', 'kebab sandwich', 'doner sandwich'] },
  { code: 25404, pin: 'pizza margherita', keys: ['pizza margherita', 'margherita', 'pizza margarita', 'pizza au fromage'] },
  { code: 25462, pin: 'pizza au chorizo ou salami', keys: ['pizza salami', 'pizza salame', 'pizza diavola', 'pizza chorizo', 'pizza pepperoni', 'salamipizza'] },
  { code: 25405, pin: 'quiche lorraine', keys: ['quiche lorraine'] },
  { code: 25547, pin: 'croque-monsieur', keys: ['croque monsieur', 'croque', 'toasted ham and cheese sandwich'] },
  { code: 25081, pin: 'lasagnes', keys: ['lasagne', 'lasagna', 'lasagnes', 'lasagne bolognese', 'lasagne alla bolognese', 'lasagne al forno', 'lasana'] },
  { code: 25135, pin: 'carbonara', keys: ['spaghetti carbonara', 'carbonara', 'spaghetti alla carbonara', 'pasta carbonara', 'pâtes à la carbonara', 'pâtes carbonara'] },
  { code: 25123, pin: 'moussaka', keys: ['moussaka', 'musaka', 'mousaka', 'musakka'] },
  { code: 25031, pin: 'paella', keys: ['paella', 'paella mixta', 'paella valenciana'] },
  { code: 25002, pin: 'cassoulet', keys: ['cassoulet'] },
  { code: 25018, pin: 'ratatouille', keys: ['ratatouille', 'ratatouille nicoise'] },
  { code: 25056, pin: 'gratin dauphinois', keys: ['gratin dauphinois', 'kartoffelgratin', 'potato gratin', 'gratin de pommes de terre', 'patatas gratinadas'] },
  { code: 25001, pin: 'blanquette de veau', keys: ['blanquette de veau', 'blanquette', 'kalbsfrikassee'] },
  { code: 25003, pin: 'choucroute garnie', keys: ['choucroute garnie', 'choucroute royale'] },
  { code: 25137, pin: 'tartiflette', keys: ['tartiflette'] },
  { code: 25550, pin: 'tarte flambee', keys: ['flammkuchen', 'flammekueche', 'flammenkueche', 'tarte flambee', 'flammkuchen elsasser art'] },
  { code: 25187, pin: 'risotto, aux legumes', keys: ['risotto', 'vegetable risotto', 'gemuserisotto', 'risotto aux legumes', 'risotto alle verdure'] },
  { code: 25456, pin: 'sushi ou maki', keys: ['sushi', 'maki', 'sushi set', 'maki sushi', 'nigiri'] },
  { code: 25583, pin: 'nem ou pâté impérial, au porc', keys: ['nem', 'nems', 'fried spring roll', 'fruhlingsrolle', 'involtini primavera', 'rollito de primavera', 'cha gio'] },
  { code: 25413, pin: 'hamburger', keys: ['hamburger', 'burger'] },
  { code: 25414, pin: 'cheeseburger', keys: ['cheeseburger', 'cheese burger'] },
  { code: 25403, pin: 'hot-dog', keys: ['hot dog', 'hotdog'] },
  { code: 25628, pin: 'salade cesar', keys: ['caesar salad', 'caesar salad with chicken', 'salade cesar', 'caesar salat', 'insalata caesar', 'ensalada cesar', 'chicken caesar salad'] },
  { code: 25910, pin: "soupe a l'oignon", keys: ['onion soup', 'french onion soup', 'soupe a l oignon', 'zwiebelsuppe', 'zuppa di cipolle', 'sopa de cebolla'] },
  { code: 25967, pin: 'gaspacho', keys: ['gazpacho', 'gaspacho', 'gazpacho andaluz'] },
  { code: 25916, pin: 'minestrone', keys: ['minestrone', 'minestrone soup', 'soupe minestrone'] },
  { code: 22510, pin: 'tortilla espagnole', keys: ['tortilla espanola', 'tortilla de patatas', 'spanish omelette', 'spanish tortilla', 'tortilla espagnole'] },

  // Bakery and desserts
  { code: 7615, pin: 'croissant ordinaire, artisanal', keys: ['croissant', 'butter croissant', 'cornetto'], dish: true },
  { code: 19698, pin: 'tiramisu', keys: ['tiramisu', 'tiramisu classico'], dish: true },
  { code: 39213, pin: 'creme brulee', keys: ['creme brulee'], dish: true },
  { code: 39210, pin: 'mousse au chocolat traditionnelle', keys: ['mousse au chocolat', 'chocolate mousse', 'schokoladenmousse', 'mousse al cioccolato', 'mousse de chocolate'], dish: true },
  { code: 19685, pin: 'panna cotta', keys: ['panna cotta', 'pannacotta'], dish: true },
  { code: 23496, pin: 'tarte tatin', keys: ['tarte tatin', 'tatin'], dish: true },
  { code: 23850, pin: 'gaufre', keys: ['waffle', 'waffel', 'gaufre', 'belgian waffle', 'gaufre de liege', 'gofre'], dish: true },
  { code: 23300, pin: 'baklava', keys: ['baklava', 'baklawa'], dish: true },

  // Drinks
  { code: 5001, pin: 'biere "coeur de marche"', keys: ['beer', 'lager', 'pils', 'pilsner', 'helles', 'bier', 'biere', 'biere blonde', 'birra', 'cerveza', 'bira', 'draft beer', 'draught beer', 'bier vom fass', 'fassbier', 'biere pression', 'birra alla spina', 'cerveza de barril'] },
  { code: 5004, pin: 'panache', keys: ['shandy', 'radler', 'alsterwasser', 'panache', 'clara'] },
  { code: 5214, pin: 'vin rouge', keys: ['red wine', 'vin rouge', 'rotwein', 'vino rosso', 'vino tinto', 'kirmizi sarap'] },
  { code: 5215, pin: 'vin blanc sec', keys: ['white wine', 'dry white wine', 'vin blanc', 'vin blanc sec', 'weisswein', 'vino bianco', 'vino blanco', 'beyaz sarap'] },
  { code: 18071, pin: 'cafe expresso', keys: ['espresso', 'expresso', 'cafe expresso', 'caffe', 'cafe solo'] },
  { code: 18010, pin: 'limonade, sucree', keys: ['lemonade', 'limonade', 'zitronenlimonade', 'limonata'] },
  { code: 2070, pin: "jus d'orange", keys: ['orange juice', 'jus d orange', 'orangensaft', 'succo d arancia', 'zumo de naranja', 'portakal suyu'] },
]
