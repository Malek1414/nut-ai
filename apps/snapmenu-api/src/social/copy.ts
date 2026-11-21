/**
 * The fixed sentences of sharing, link imports and the Premium list, in the
 * ten languages the app talks in. They follow the same rules as voice/copy.ts
 * (VOICE_RULES: short, everyday words, warm and direct, no exclamation marks,
 * no em dashes, no number typed in) and live here only so this feature stays
 * in its own folder. English is the master: a language that misses a line does
 * not compile.
 */
import { DEFAULT_LANGUAGE, toLang, type Lang } from '../voice/index.js'

const en = {
  'bad_link': 'That does not look like a link. Paste the link to a post or a page.',
  'blocked': '{site} does not let apps read this post. Tell us what the meal is and we will work it out.',
  'unreachable': 'That page did not open. Check the link, or tell us what the meal is.',
  'not_food': 'No meal found in this link. Tell us what it is and we will work it out.',
  'needs_dish': 'Found the place, not the dish. Which dish did you see?',
  'slow': 'That was a lot of links at once. Try again in a few minutes.',
  'failed': 'That did not work. Try again in a moment.',
  'share_failed': 'The link could not be made. Try again.',
  'bad_email': 'Check the email address.',
}

export type SocialKey = keyof typeof en
type Table = Record<SocialKey, string>

const de: Table = {
  'bad_link': 'Das sieht nicht nach einem Link aus. Füg den Link zu einem Post oder einer Seite ein.',
  'blocked': '{site} lässt Apps diesen Post nicht lesen. Sag uns, was für ein Gericht es ist, dann rechnen wir es aus.',
  'unreachable': 'Die Seite ging nicht auf. Prüf den Link oder sag uns, was für ein Gericht es ist.',
  'not_food': 'In diesem Link war kein Gericht zu finden. Sag uns, was es ist, dann rechnen wir es aus.',
  'needs_dish': 'Den Laden haben wir, das Gericht nicht. Welches Gericht hast du gesehen?',
  'slow': 'Das waren viele Links auf einmal. Versuch es in ein paar Minuten noch mal.',
  'failed': 'Das hat nicht geklappt. Versuch es gleich noch mal.',
  'share_failed': 'Der Link ließ sich nicht erstellen. Versuch es noch mal.',
  'bad_email': 'Schau noch mal auf die E-Mail-Adresse.',
}

const es: Table = {
  'bad_link': 'Eso no parece un enlace. Pega el enlace de una publicación o de una página.',
  'blocked': '{site} no deja que las apps lean esta publicación. Dinos qué plato es y lo calculamos.',
  'unreachable': 'La página no se abrió. Revisa el enlace o dinos qué plato es.',
  'not_food': 'No encontramos ningún plato en este enlace. Dinos qué es y lo calculamos.',
  'needs_dish': 'Tenemos el sitio, pero no el plato. ¿Qué plato viste?',
  'slow': 'Fueron muchos enlaces de golpe. Vuelve a intentarlo en unos minutos.',
  'failed': 'No ha funcionado. Vuelve a intentarlo en un momento.',
  'share_failed': 'No se pudo crear el enlace. Vuelve a intentarlo.',
  'bad_email': 'Revisa la dirección de correo.',
}

const fr: Table = {
  'bad_link': "Ça ne ressemble pas à un lien. Colle le lien d'un post ou d'une page.",
  'blocked': "{site} ne laisse pas les applis lire ce post. Dis-nous quel plat c'est et on fait le calcul.",
  'unreachable': "La page ne s'est pas ouverte. Vérifie le lien ou dis-nous quel plat c'est.",
  'not_food': "Pas de plat trouvé dans ce lien. Dis-nous ce que c'est et on fait le calcul.",
  'needs_dish': 'On a le resto, pas le plat. Quel plat as-tu vu ?',
  'slow': "Ça fait beaucoup de liens d'un coup. Réessaie dans quelques minutes.",
  'failed': "Ça n'a pas marché. Réessaie dans un instant.",
  'share_failed': "Le lien n'a pas pu être créé. Réessaie.",
  'bad_email': "Vérifie l'adresse e-mail.",
}

const it: Table = {
  'bad_link': 'Non sembra un link. Incolla il link di un post o di una pagina.',
  'blocked': '{site} non lascia leggere questo post alle app. Dicci che piatto è e facciamo noi il conto.',
  'unreachable': 'La pagina non si è aperta. Controlla il link o dicci che piatto è.',
  'not_food': "Nessun piatto trovato in questo link. Dicci cos'è e facciamo noi il conto.",
  'needs_dish': 'Abbiamo il locale, non il piatto. Che piatto hai visto?',
  'slow': 'Erano tanti link tutti insieme. Riprova tra qualche minuto.',
  'failed': 'Non ha funzionato. Riprova tra un attimo.',
  'share_failed': 'Non siamo riusciti a creare il link. Riprova.',
  'bad_email': "Controlla l'indirizzo email.",
}

const pt: Table = {
  'bad_link': 'Isto não parece um link. Cola o link de uma publicação ou de uma página.',
  'blocked': '{site} não deixa as apps lerem esta publicação. Diz-nos que prato é e nós fazemos as contas.',
  'unreachable': 'A página não abriu. Verifica o link ou diz-nos que prato é.',
  'not_food': 'Não encontrámos nenhum prato neste link. Diz-nos o que é e nós fazemos as contas.',
  'needs_dish': 'Temos o sítio, mas não o prato. Que prato viste?',
  'slow': 'Foram muitos links de uma vez. Tenta outra vez daqui a uns minutos.',
  'failed': 'Não resultou. Tenta outra vez daqui a pouco.',
  'share_failed': 'Não foi possível criar o link. Tenta outra vez.',
  'bad_email': 'Verifica o endereço de email.',
}

const tr: Table = {
  'bad_link': 'Bu bir bağlantıya benzemiyor. Bir gönderinin ya da sayfanın bağlantısını yapıştır.',
  'blocked': '{site} uygulamaların bu gönderiyi okumasına izin vermiyor. Yemeğin ne olduğunu yaz, biz hesaplayalım.',
  'unreachable': 'Sayfa açılmadı. Bağlantıya bir bak ya da yemeğin ne olduğunu yaz.',
  'not_food': 'Bu bağlantıda bir yemek bulamadık. Ne olduğunu yaz, biz hesaplayalım.',
  'needs_dish': 'Mekânı bulduk, yemeği bulamadık. Hangi yemeği gördün?',
  'slow': 'Bir anda çok bağlantı oldu. Birkaç dakika sonra tekrar dene.',
  'failed': 'Olmadı. Birazdan tekrar dene.',
  'share_failed': 'Bağlantı oluşturulamadı. Tekrar dene.',
  'bad_email': 'E-posta adresine bir daha bak.',
}

const pl: Table = {
  'bad_link': 'To nie wygląda na link. Wklej link do posta albo strony.',
  'blocked': '{site} nie pozwala aplikacjom czytać tego posta. Napisz, co to za danie, a my to policzymy.',
  'unreachable': 'Strona się nie otworzyła. Sprawdź link albo napisz, co to za danie.',
  'not_food': 'W tym linku nie znaleźliśmy dania. Napisz, co to jest, a my to policzymy.',
  'needs_dish': 'Mamy miejsce, ale nie danie. O jakie danie chodzi?',
  'slow': 'To było dużo linków naraz. Spróbuj ponownie za kilka minut.',
  'failed': 'Nie udało się. Spróbuj ponownie za chwilę.',
  'share_failed': 'Nie udało się utworzyć linku. Spróbuj ponownie.',
  'bad_email': 'Sprawdź adres e-mail.',
}

const nl: Table = {
  'bad_link': 'Dat lijkt geen link. Plak de link naar een post of een pagina.',
  'blocked': '{site} laat apps deze post niet lezen. Zeg ons welk gerecht het is, dan rekenen wij het uit.',
  'unreachable': 'De pagina ging niet open. Check de link of zeg ons welk gerecht het is.',
  'not_food': 'Geen gerecht gevonden in deze link. Zeg ons wat het is, dan rekenen wij het uit.',
  'needs_dish': 'De plek hebben we, het gerecht niet. Welk gerecht zag je?',
  'slow': 'Dat waren veel links tegelijk. Probeer het over een paar minuten opnieuw.',
  'failed': 'Dat lukte niet. Probeer het zo nog eens.',
  'share_failed': 'De link kon niet worden gemaakt. Probeer het opnieuw.',
  'bad_email': 'Check het e-mailadres.',
}

const ar: Table = {
  'bad_link': 'هذا لا يبدو رابطًا. الصق رابط منشور أو صفحة.',
  'blocked': '{site} لا يسمح للتطبيقات بقراءة هذا المنشور. اكتب لنا ما هو الطبق ونحسبه لك.',
  'unreachable': 'الصفحة لم تفتح. تحقق من الرابط أو اكتب لنا ما هو الطبق.',
  'not_food': 'لم نجد طبقًا في هذا الرابط. اكتب لنا ما هو ونحسبه لك.',
  'needs_dish': 'وجدنا المكان ولم نجد الطبق. أي طبق رأيت؟',
  'slow': 'كانت روابط كثيرة دفعة واحدة. حاول مرة أخرى بعد دقائق.',
  'failed': 'لم ينجح ذلك. حاول بعد قليل.',
  'share_failed': 'تعذّر إنشاء الرابط. حاول مرة أخرى.',
  'bad_email': 'تحقق من عنوان البريد الإلكتروني.',
}

export const SOCIAL_COPY: Record<Lang, Table> = {
  English: en, German: de, Spanish: es, French: fr, Italian: it, Portuguese: pt, Turkish: tr, Polish: pl, Dutch: nl, Arabic: ar,
}

/** A fixed sentence of this feature in the person's language (English when we do not talk theirs). */
export function saySocial(lang: unknown, key: SocialKey, vars: Record<string, string> = {}): string {
  return SOCIAL_COPY[toLang(lang) ?? DEFAULT_LANGUAGE][key].replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? '')
}
