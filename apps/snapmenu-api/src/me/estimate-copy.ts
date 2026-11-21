/**
 * What "type what you ate" says when it cannot answer, in the ten languages of
 * ../voice/index.ts. Written to VOICE_RULES by hand, like ../voice/copy.ts:
 * short, everyday words, the informal "you", no number typed in here.
 *
 * English is the master: a language that misses a line does not compile.
 */
import { DEFAULT_LANGUAGE, toLang, type Lang } from '../voice/index.js'

const en = {
  // Nothing usable was typed (empty, a single letter, or far too long).
  bad_text: 'Type what you ate, in a few words.',
  // The text is not about food or drink.
  not_food: 'That does not look like food. Type what you ate, like a dish or a drink.',
  // The food database has nothing for it, so there is no number to show.
  no_match: 'We could not work that one out. Try naming the dish more plainly.',
  // This phone asked for a lot of typed dishes today.
  slow_down: 'That was a lot of typing for today. Tap a dish you scanned, or try again later.',
  // The AI service is busy.
  busy: 'Lots going on right now. Try again in a moment.',
  // No AI key on the server.
  setup: 'Typing a dish is not switched on yet. Nothing was made up.',
  connection: 'That did not get through. Check your connection and try again.',
  failed: 'Something went wrong with that one. Try again.',
}

export type EstimateCopyKey = keyof typeof en
type Copy = Record<EstimateCopyKey, string>

const de: Copy = {
  bad_text: 'Schreib in ein paar Worten, was du gegessen hast.',
  not_food: 'Das sieht nicht nach Essen aus. Schreib, was du gegessen hast, zum Beispiel ein Gericht oder ein Getränk.',
  no_match: 'Das konnten wir nicht einschätzen. Nenn das Gericht etwas einfacher.',
  slow_down: 'Das war viel Tippen für heute. Tipp ein gescanntes Gericht an oder versuch es später noch mal.',
  busy: 'Gerade ist viel los. Versuch es gleich noch mal.',
  setup: 'Gerichte eintippen ist noch nicht eingeschaltet. Es wurde nichts erfunden.',
  connection: 'Das ist nicht angekommen. Prüf deine Verbindung und versuch es noch mal.',
  failed: 'Dabei ist etwas schiefgegangen. Versuch es noch mal.',
}

const es: Copy = {
  bad_text: 'Escribe en pocas palabras lo que comiste.',
  not_food: 'Eso no parece comida. Escribe lo que comiste, como un plato o una bebida.',
  no_match: 'No pudimos calcular ese. Prueba a nombrar el plato de forma más sencilla.',
  slow_down: 'Has escrito mucho por hoy. Toca un plato que hayas escaneado o vuelve a intentarlo más tarde.',
  busy: 'Hay mucho movimiento ahora mismo. Vuelve a intentarlo en un momento.',
  setup: 'Escribir un plato aún no está activado. No se ha inventado nada.',
  connection: 'Eso no llegó. Revisa tu conexión y vuelve a intentarlo.',
  failed: 'Algo salió mal con ese. Vuelve a intentarlo.',
}

const fr: Copy = {
  bad_text: 'Écris en quelques mots ce que tu as mangé.',
  not_food: "Ça ne ressemble pas à de la nourriture. Écris ce que tu as mangé, un plat ou une boisson par exemple.",
  no_match: "On n'a pas réussi à estimer celui-là. Essaie de nommer le plat plus simplement.",
  slow_down: "Ça fait beaucoup de saisies pour aujourd'hui. Touche un plat que tu as scanné ou réessaie plus tard.",
  busy: 'Il y a beaucoup de monde en ce moment. Réessaie dans un instant.',
  setup: "La saisie d'un plat n'est pas encore activée. Rien n'a été inventé.",
  connection: "Ce n'est pas passé. Vérifie ta connexion et réessaie.",
  failed: "Un souci est survenu avec celui-là. Réessaie.",
}

const it: Copy = {
  bad_text: 'Scrivi in poche parole cosa hai mangiato.',
  not_food: 'Non sembra cibo. Scrivi cosa hai mangiato, per esempio un piatto o una bevanda.',
  no_match: 'Non siamo riusciti a stimarlo. Prova a chiamare il piatto in modo più semplice.',
  slow_down: 'Hai scritto tanto per oggi. Tocca un piatto che hai scansionato o riprova più tardi.',
  busy: "C'è molto movimento in questo momento. Riprova tra un attimo.",
  setup: 'Scrivere un piatto non è ancora attivo. Non è stato inventato nulla.',
  connection: 'Non è arrivato. Controlla la connessione e riprova.',
  failed: 'Qualcosa è andato storto con questo. Riprova.',
}

const pt: Copy = {
  bad_text: 'Escreve em poucas palavras o que comeste.',
  not_food: 'Isso não parece comida. Escreve o que comeste, como um prato ou uma bebida.',
  no_match: 'Não conseguimos calcular esse. Tenta dizer o nome do prato de forma mais simples.',
  slow_down: 'Escreveste muito por hoje. Toca num prato que já leste num menu ou tenta outra vez mais tarde.',
  busy: 'Há muito movimento neste momento. Tenta outra vez daqui a pouco.',
  setup: 'Escrever um prato ainda não está ligado. Nada foi inventado.',
  connection: 'Isso não chegou. Verifica a internet e tenta outra vez.',
  failed: 'Algo correu mal com esse. Tenta outra vez.',
}

const tr: Copy = {
  bad_text: 'Ne yediğini birkaç kelimeyle yaz.',
  not_food: 'Bu yiyeceğe benzemiyor. Ne yediğini yaz, bir yemek ya da içecek gibi.',
  no_match: 'Bunu hesaplayamadık. Yemeğin adını daha sade yazmayı dene.',
  slow_down: 'Bugünlük çok yazdın. Taradığın bir yemeğe dokun ya da daha sonra tekrar dene.',
  busy: 'Şu anda çok yoğun. Birazdan tekrar dene.',
  setup: 'Yemek yazma henüz açık değil. Hiçbir şey uydurulmadı.',
  connection: 'Bu ulaşmadı. Bağlantını kontrol et ve tekrar dene.',
  failed: 'Bunda bir şeyler ters gitti. Tekrar dene.',
}

const pl: Copy = {
  // No gendered past tense here ("zjadłeś" / "zjadłaś"): the app does not know who is typing.
  bad_text: 'Wpisz w kilku słowach, co było na talerzu.',
  not_food: 'To nie wygląda na jedzenie. Wpisz danie albo napój.',
  no_match: 'Tego nie udało się policzyć. Spróbuj nazwać danie prościej.',
  slow_down: 'Sporo tego pisania na dziś. Dotknij zeskanowanego dania albo spróbuj ponownie później.',
  busy: 'Teraz dużo się dzieje. Spróbuj za chwilę.',
  setup: 'Wpisywanie dań nie jest jeszcze włączone. Nic nie zostało zmyślone.',
  connection: 'To nie doszło. Sprawdź połączenie i spróbuj ponownie.',
  failed: 'Coś poszło nie tak. Spróbuj ponownie.',
}

const nl: Copy = {
  bad_text: 'Typ in een paar woorden wat je hebt gegeten.',
  not_food: 'Dat lijkt niet op eten. Typ wat je hebt gegeten, zoals een gerecht of een drankje.',
  no_match: 'Dat konden we niet uitrekenen. Probeer het gerecht simpeler te noemen.',
  slow_down: 'Dat was veel typen voor vandaag. Tik op een gerecht dat je hebt gescand of probeer het later opnieuw.',
  busy: 'Het is nu erg druk. Probeer het zo nog eens.',
  setup: 'Een gerecht typen staat nog niet aan. Er is niets verzonnen.',
  connection: 'Dat kwam niet aan. Check je verbinding en probeer het opnieuw.',
  failed: 'Er ging iets mis. Probeer het opnieuw.',
}

const ar: Copy = {
  bad_text: 'اكتب ما أكلته في كلمات قليلة.',
  not_food: 'هذا لا يبدو طعامًا. اكتب ما أكلته، مثل طبق أو مشروب.',
  no_match: 'لم نستطع حساب هذا. جرّب أن تكتب اسم الطبق بشكل أبسط.',
  slow_down: 'كتبت كثيرًا اليوم. اضغط على طبق مسحته أو حاول لاحقًا.',
  busy: 'الضغط كبير الآن. حاول بعد قليل.',
  setup: 'كتابة الأطباق غير مفعّلة بعد. لم يُختلق أي شيء.',
  connection: 'لم يصل هذا. تحقق من اتصالك وحاول مرة أخرى.',
  failed: 'حدث خطأ في هذا. حاول مرة أخرى.',
}

/** Keyed by the language names in ../voice/index.ts LANGUAGES. */
export const ESTIMATE_COPY: Record<Lang, Copy> = { English: en, German: de, Spanish: es, French: fr, Italian: it, Portuguese: pt, Turkish: tr, Polish: pl, Dutch: nl, Arabic: ar }

/** A fixed sentence in the person's language (English when we do not talk theirs). */
export function sayEstimate(lang: unknown, key: EstimateCopyKey): string {
  return ESTIMATE_COPY[toLang(lang) ?? DEFAULT_LANGUAGE][key]
}

/** Which sentence a failed estimate gets, by its error code. An unknown code gets the general one. */
const BY_CODE: Record<string, EstimateCopyKey> = {
  bad_text: 'bad_text',
  not_food: 'not_food',
  refusal: 'not_food',
  no_match: 'no_match',
  slow_down: 'slow_down',
  rate_limited: 'busy',
  no_key: 'setup',
  auth: 'setup',
  connection: 'connection',
}

export function estimateErrorText(lang: unknown, code: string): string {
  return sayEstimate(lang, BY_CODE[code] ?? 'failed')
}
