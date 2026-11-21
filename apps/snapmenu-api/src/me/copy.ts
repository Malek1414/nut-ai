/**
 * The sentences the "Me" features say at run time, in the ten languages of the
 * app's voice (../voice/index.ts). They follow VOICE_RULES: short, everyday
 * words, warm and direct, never preachy, no exclamation marks, no em dashes.
 *
 * Same two rules as ../voice/copy.ts:
 *   - no number is typed in here. A number reaches a sentence only through a
 *     {placeholder}, and only arithmetic over the engine's numbers fills it;
 *   - a {placeholder} stands where a plain noun fits without an article.
 *
 * English is the master: a language that misses a line does not compile.
 */
import { DEFAULT_LANGUAGE, toLang, type Lang } from '../voice/index.js'

const en = {
  // What a dish means for the rest of the day. Shown only after something was logged today.
  'day.fits': 'Fits the {kcal} calories you have left today.',
  'day.protein': 'Covers a good part of the protein you still need today.',
  'day.tight': 'Takes a big part of what you have left today.',
  'day.over': 'More than the {kcal} calories you have left today.',
  'day.reached': 'You have already reached your calories for today.',
  // Taste: {thing} is a food the person picked or typed themselves.
  'taste.like': 'Has {thing}, which you like.',
  'taste.dislike': 'Has {thing}, which you would rather skip.',
  'taste.cuisine': 'A cuisine you like.',
}

export type MeKey = keyof typeof en
type Table = Record<MeKey, string>

const de: Table = {
  'day.fits': 'Passt in die {kcal} Kalorien, die du heute noch übrig hast.',
  'day.protein': 'Bringt einen guten Teil vom Eiweiß, das dir heute noch fehlt.',
  'day.tight': 'Nimmt einen großen Teil von dem, was du heute noch übrig hast.',
  'day.over': 'Mehr als die {kcal} Kalorien, die du heute noch übrig hast.',
  'day.reached': 'Deine Kalorien für heute hast du schon erreicht.',
  'taste.like': 'Mit {thing}, das magst du.',
  'taste.dislike': 'Mit {thing}, das lässt du lieber weg.',
  'taste.cuisine': 'Eine Küche, die du magst.',
}

const es: Table = {
  'day.fits': 'Entra en las {kcal} calorías que te quedan hoy.',
  'day.protein': 'Cubre buena parte de la proteína que te falta hoy.',
  'day.tight': 'Se lleva buena parte de lo que te queda hoy.',
  'day.over': 'Más que las {kcal} calorías que te quedan hoy.',
  'day.reached': 'Ya has llegado a tus calorías de hoy.',
  'taste.like': 'Lleva {thing}, que te gusta.',
  'taste.dislike': 'Lleva {thing}, que prefieres evitar.',
  'taste.cuisine': 'Una cocina que te gusta.',
}

const fr: Table = {
  'day.fits': "Rentre dans les {kcal} calories qu'il te reste aujourd'hui.",
  'day.protein': "Couvre une bonne partie des protéines qu'il te manque aujourd'hui.",
  'day.tight': "Prend une bonne partie de ce qu'il te reste aujourd'hui.",
  'day.over': "Plus que les {kcal} calories qu'il te reste aujourd'hui.",
  'day.reached': "Tu as déjà atteint tes calories pour aujourd'hui.",
  'taste.like': 'Avec {thing}, que tu aimes.',
  'taste.dislike': 'Avec {thing}, que tu préfères éviter.',
  'taste.cuisine': 'Une cuisine que tu aimes.',
}

const it: Table = {
  'day.fits': 'Sta nelle {kcal} calorie che ti restano oggi.',
  'day.protein': 'Copre una buona parte delle proteine che ti mancano oggi.',
  'day.tight': 'Si prende una bella fetta di quello che ti resta oggi.',
  'day.over': 'Più delle {kcal} calorie che ti restano oggi.',
  'day.reached': 'Hai già raggiunto le tue calorie di oggi.',
  'taste.like': 'Con {thing}, che ti piace.',
  'taste.dislike': 'Con {thing}, che preferisci evitare.',
  'taste.cuisine': 'Una cucina che ti piace.',
}

const pt: Table = {
  'day.fits': 'Cabe nas {kcal} calorias que te restam hoje.',
  'day.protein': 'Cobre uma boa parte da proteína que ainda te falta hoje.',
  'day.tight': 'Leva uma boa parte do que te resta hoje.',
  'day.over': 'Mais do que as {kcal} calorias que te restam hoje.',
  'day.reached': 'Já chegaste às tuas calorias de hoje.',
  'taste.like': 'Tem {thing}, que é do teu gosto.',
  'taste.dislike': 'Tem {thing}, que preferes evitar.',
  'taste.cuisine': 'Uma cozinha de que gostas.',
}

const tr: Table = {
  'day.fits': 'Bugün kalan {kcal} kaloriye sığar.',
  'day.protein': 'Bugün hâlâ gereken proteinin iyi bir kısmını karşılar.',
  'day.tight': 'Bugün kalanının büyük bir kısmını alır.',
  'day.over': 'Bugün kalan {kcal} kaloriden fazla.',
  'day.reached': 'Bugünkü kalorine zaten ulaştın.',
  'taste.like': 'İçinde {thing} var, sen bunu seversin.',
  'taste.dislike': 'İçinde {thing} var, bunu pek istemiyorsun.',
  'taste.cuisine': 'Sevdiğin bir mutfak.',
}

const pl: Table = {
  'day.fits': 'Mieści się w {kcal} kaloriach, które zostały ci na dziś.',
  'day.protein': 'Pokrywa sporą część białka, którego ci dziś jeszcze brakuje.',
  'day.tight': 'Zabiera sporą część tego, co zostało ci na dziś.',
  'day.over': 'Więcej niż {kcal} kalorii, które zostały ci na dziś.',
  'day.reached': 'Masz już swoje kalorie na dziś.',
  'taste.like': 'Jest w tym {thing}, a to lubisz.',
  'taste.dislike': 'Jest w tym {thing}, a tego wolisz unikać.',
  'taste.cuisine': 'Kuchnia, którą lubisz.',
}

const nl: Table = {
  'day.fits': 'Past in de {kcal} calorieën die je vandaag nog over hebt.',
  'day.protein': 'Dekt een flink deel van het eiwit dat je vandaag nog nodig hebt.',
  'day.tight': 'Neemt een groot deel van wat je vandaag nog over hebt.',
  'day.over': 'Meer dan de {kcal} calorieën die je vandaag nog over hebt.',
  'day.reached': 'Je zit vandaag al aan je calorieën.',
  'taste.like': 'Met {thing}, dat vind je lekker.',
  'taste.dislike': 'Met {thing}, dat laat je liever staan.',
  'taste.cuisine': 'Een keuken die je lekker vindt.',
}

const ar: Table = {
  'day.fits': 'يناسب {kcal} سعرة باقية لك اليوم.',
  'day.protein': 'يغطي جزءًا جيدًا من البروتين الذي ما زلت تحتاجه اليوم.',
  'day.tight': 'يأخذ جزءًا كبيرًا مما بقي لك اليوم.',
  'day.over': 'أكثر من {kcal} سعرة باقية لك اليوم.',
  'day.reached': 'وصلت إلى سعراتك لهذا اليوم.',
  'taste.like': 'فيه {thing} وأنت تحبه.',
  'taste.dislike': 'فيه {thing} وأنت تفضّل تجنّبه.',
  'taste.cuisine': 'مطبخ تحبه.',
}

export const ME_COPY: Record<Lang, Table> = {
  English: en, German: de, Spanish: es, French: fr, Italian: it, Portuguese: pt, Turkish: tr, Polish: pl, Dutch: nl, Arabic: ar,
}

// The same grouping the screen uses for its own numbers.
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A fixed "Me" sentence in the person's language (English when we do not talk theirs). */
export function sayMe(lang: unknown, key: MeKey, vars: Record<string, string | number> = {}): string {
  const table = ME_COPY[toLang(lang) ?? DEFAULT_LANGUAGE]
  return table[key].replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name]
    return typeof v === 'number' ? NUMBER.format(v) : v ?? ''
  })
}
