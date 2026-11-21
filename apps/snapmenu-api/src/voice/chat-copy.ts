/**
 * The fixed sentences of the menu chat and of voice messages, in the ten
 * languages the app talks in. They follow the same rules as ./copy.ts (short,
 * everyday words, warm and direct, no number typed in: a number arrives only
 * through a {placeholder}, and only the engine fills it). They live in their
 * own file so the chat can be merged without touching the big copy table.
 * English is the master: a language that misses a line does not compile.
 */
import { DEFAULT_LANGUAGE, toLang, type Lang } from './index.js'

const en = {
  // The first bubble of the chat, and the questions a tap can ask.
  'chat.hello': 'Ask me anything about this menu.',
  'chat.ask.light': 'What is light here?',
  'chat.ask.protein': 'Which dish has the most protein?',
  'chat.ask.change': 'How do I make my pick lighter?',
  // When an answer does not come.
  'chat.slow': 'That was a lot of questions. Take a short break and try again in a few minutes.',
  'chat.busy': 'Busy right now. Try again in a moment.',
  'chat.off': 'The menu chat is not switched on yet.',
  'chat.failed': 'That did not work. Try again.',
  'chat.offline': 'You are offline. Check your connection, then try again.',
  'chat.empty': 'Say or type a question first.',
  'chat.no_menu': 'Scan a menu first, then ask about it.',
  // The answer had to be left out (it carried a number of its own): the dishes speak for themselves.
  'chat.look': 'Have a look at these.',
  // Read aloud after an answer: the engine's numbers for a dish it names.
  'chat.numbers': '{dish}: {low} to {high} calories, about {protein} grams of protein.',
  // Voice messages.
  'voice.unheard': 'Could not catch that. Try again, or type it.',
  'voice.off': 'Voice is taking a break. Type it instead.',
  'voice.slow': 'That was a lot of voice messages. Type it, or try again in a few minutes.',
  'voice.too_long': 'That one was too long. Keep it under a minute.',
  'voice.denied': 'The microphone is blocked. Allow it in your browser, or type instead.',
  // The interview, answered by voice.
  'interview.say': 'Or just say it: your goal and your allergies.',
  'interview.unheard': 'Did not catch a goal. Say it again, or tap one.',
} as const

export type ChatKey = keyof typeof en
type Copy = Record<ChatKey, string>

const de: Copy = {
  'chat.hello': 'Frag mich alles zu dieser Karte.',
  'chat.ask.light': 'Was ist hier leicht?',
  'chat.ask.protein': 'Welches Gericht hat am meisten Eiweiß?',
  'chat.ask.change': 'Wie wird meine Wahl leichter?',
  'chat.slow': 'Das waren viele Fragen. Mach kurz Pause und versuch es in ein paar Minuten noch mal.',
  'chat.busy': 'Gerade ist viel los. Versuch es gleich noch mal.',
  'chat.off': 'Der Karten-Chat ist noch nicht eingeschaltet.',
  'chat.failed': 'Das hat nicht geklappt. Versuch es noch mal.',
  'chat.offline': 'Du bist offline. Prüf deine Verbindung und versuch es noch mal.',
  'chat.empty': 'Sag oder schreib erst eine Frage.',
  'chat.no_menu': 'Scann erst eine Karte, dann frag dazu.',
  'chat.look': 'Schau dir die hier an.',
  'chat.numbers': '{dish}: {low} bis {high} Kalorien, etwa {protein} Gramm Eiweiß.',
  'voice.unheard': 'Das habe ich nicht verstanden. Versuch es noch mal oder schreib es.',
  'voice.off': 'Sprache macht gerade Pause. Schreib es einfach.',
  'voice.slow': 'Das waren viele Sprachnachrichten. Schreib es oder versuch es in ein paar Minuten noch mal.',
  'voice.too_long': 'Die war zu lang. Bleib unter einer Minute.',
  'voice.denied': 'Das Mikrofon ist gesperrt. Erlaub es im Browser oder schreib einfach.',
  'interview.say': 'Oder sag es einfach: dein Ziel und deine Allergien.',
  'interview.unheard': 'Kein Ziel verstanden. Sag es noch mal oder tipp eins an.',
}

const es: Copy = {
  'chat.hello': 'Pregúntame lo que quieras sobre esta carta.',
  'chat.ask.light': '¿Qué hay ligero aquí?',
  'chat.ask.protein': '¿Qué plato tiene más proteína?',
  'chat.ask.change': '¿Cómo hago más ligera mi elección?',
  'chat.slow': 'Han sido muchas preguntas. Descansa un poco y prueba otra vez en unos minutos.',
  'chat.busy': 'Hay mucho lío ahora mismo. Prueba otra vez en un momento.',
  'chat.off': 'El chat de la carta aún no está activado.',
  'chat.failed': 'No ha funcionado. Prueba otra vez.',
  'chat.offline': 'Estás sin conexión. Revísala y prueba otra vez.',
  'chat.empty': 'Di o escribe primero una pregunta.',
  'chat.no_menu': 'Escanea primero una carta y luego pregunta.',
  'chat.look': 'Échales un vistazo a estos.',
  'chat.numbers': '{dish}: de {low} a {high} calorías, unos {protein} gramos de proteína.',
  'voice.unheard': 'No lo he pillado. Prueba otra vez o escríbelo.',
  'voice.off': 'La voz está descansando. Mejor escríbelo.',
  'voice.slow': 'Han sido muchos mensajes de voz. Escríbelo o prueba otra vez en unos minutos.',
  'voice.too_long': 'Ese era demasiado largo. Que dure menos de un minuto.',
  'voice.denied': 'El micrófono está bloqueado. Permítelo en el navegador o escribe.',
  'interview.say': 'O dilo sin más: tu objetivo y tus alergias.',
  'interview.unheard': 'No he pillado ningún objetivo. Dilo otra vez o toca uno.',
}

const fr: Copy = {
  'chat.hello': 'Demande-moi ce que tu veux sur cette carte.',
  'chat.ask.light': 'Qu’est-ce qui est léger ici ?',
  'chat.ask.protein': 'Quel plat a le plus de protéines ?',
  'chat.ask.change': 'Comment alléger mon choix ?',
  'chat.slow': 'Ça fait beaucoup de questions. Fais une petite pause et réessaie dans quelques minutes.',
  'chat.busy': 'C’est chargé en ce moment. Réessaie dans un instant.',
  'chat.off': 'Le chat de la carte n’est pas encore activé.',
  'chat.failed': 'Ça n’a pas marché. Réessaie.',
  'chat.offline': 'Tu es hors ligne. Vérifie ta connexion, puis réessaie.',
  'chat.empty': 'Dis ou écris d’abord une question.',
  'chat.no_menu': 'Scanne d’abord une carte, puis pose ta question.',
  'chat.look': 'Jette un œil à ceux-ci.',
  'chat.numbers': '{dish} : de {low} à {high} calories, environ {protein} grammes de protéines.',
  'voice.unheard': 'Je n’ai pas compris. Réessaie ou écris-le.',
  'voice.off': 'La voix fait une pause. Écris-le plutôt.',
  'voice.slow': 'Ça fait beaucoup de messages vocaux. Écris-le ou réessaie dans quelques minutes.',
  'voice.too_long': 'Celui-là était trop long. Reste sous une minute.',
  'voice.denied': 'Le micro est bloqué. Autorise-le dans ton navigateur ou écris.',
  'interview.say': 'Ou dis-le simplement : ton objectif et tes allergies.',
  'interview.unheard': 'Pas d’objectif compris. Redis-le ou touches-en un.',
}

const it: Copy = {
  'chat.hello': 'Chiedimi quello che vuoi su questo menu.',
  'chat.ask.light': 'Cosa c’è di leggero qui?',
  'chat.ask.protein': 'Quale piatto ha più proteine?',
  'chat.ask.change': 'Come rendo più leggera la mia scelta?',
  'chat.slow': 'Sono state tante domande. Fai una pausa e riprova tra qualche minuto.',
  'chat.busy': 'C’è tanto da fare adesso. Riprova tra un attimo.',
  'chat.off': 'La chat del menu non è ancora attiva.',
  'chat.failed': 'Non ha funzionato. Riprova.',
  'chat.offline': 'Sei offline. Controlla la connessione e riprova.',
  'chat.empty': 'Prima di’ o scrivi una domanda.',
  'chat.no_menu': 'Prima scansiona un menu, poi chiedi.',
  'chat.look': 'Dai un’occhiata a questi.',
  'chat.numbers': '{dish}: da {low} a {high} calorie, circa {protein} grammi di proteine.',
  'voice.unheard': 'Non ho capito. Riprova o scrivilo.',
  'voice.off': 'La voce è in pausa. Scrivilo.',
  'voice.slow': 'Sono stati tanti messaggi vocali. Scrivilo o riprova tra qualche minuto.',
  'voice.too_long': 'Era troppo lungo. Resta sotto un minuto.',
  'voice.denied': 'Il microfono è bloccato. Consentilo nel browser o scrivi.',
  'interview.say': 'Oppure dillo e basta: il tuo obiettivo e le tue allergie.',
  'interview.unheard': 'Non ho capito l’obiettivo. Dillo di nuovo o toccane uno.',
}

const pt: Copy = {
  'chat.hello': 'Pergunta-me o que quiseres sobre este menu.',
  'chat.ask.light': 'O que há de leve aqui?',
  'chat.ask.protein': 'Qual é o prato com mais proteína?',
  'chat.ask.change': 'Como torno a minha escolha mais leve?',
  'chat.slow': 'Foram muitas perguntas. Faz uma pausa e tenta outra vez daqui a uns minutos.',
  'chat.busy': 'Há muito movimento agora. Tenta outra vez daqui a um momento.',
  'chat.off': 'O chat do menu ainda não está ligado.',
  'chat.failed': 'Não funcionou. Tenta outra vez.',
  'chat.offline': 'Estás offline. Verifica a ligação e tenta outra vez.',
  'chat.empty': 'Diz ou escreve primeiro uma pergunta.',
  'chat.no_menu': 'Digitaliza primeiro um menu e depois pergunta.',
  'chat.look': 'Dá uma olhada nestes.',
  'chat.numbers': '{dish}: de {low} a {high} calorias, cerca de {protein} gramas de proteína.',
  'voice.unheard': 'Não percebi. Tenta outra vez ou escreve.',
  'voice.off': 'A voz está a fazer uma pausa. Escreve antes.',
  'voice.slow': 'Foram muitas mensagens de voz. Escreve ou tenta outra vez daqui a uns minutos.',
  'voice.too_long': 'Essa foi longa demais. Fica abaixo de um minuto.',
  'voice.denied': 'O microfone está bloqueado. Permite-o no navegador ou escreve.',
  'interview.say': 'Ou diz simplesmente: o teu objetivo e as tuas alergias.',
  'interview.unheard': 'Não percebi o objetivo. Diz outra vez ou toca num.',
}

const tr: Copy = {
  'chat.hello': 'Bu menü hakkında ne istersen sor.',
  'chat.ask.light': 'Burada hafif ne var?',
  'chat.ask.protein': 'En çok protein hangi yemekte?',
  'chat.ask.change': 'Seçimimi nasıl hafifletirim?',
  'chat.slow': 'Çok soru oldu. Biraz ara ver, birkaç dakika sonra tekrar dene.',
  'chat.busy': 'Şu an çok yoğun. Birazdan tekrar dene.',
  'chat.off': 'Menü sohbeti henüz açık değil.',
  'chat.failed': 'Olmadı. Tekrar dene.',
  'chat.offline': 'Çevrimdışısın. Bağlantını kontrol et, sonra tekrar dene.',
  'chat.empty': 'Önce bir soru söyle ya da yaz.',
  'chat.no_menu': 'Önce bir menü tara, sonra sor.',
  'chat.look': 'Şunlara bir bak.',
  'chat.numbers': '{dish}: {low} ile {high} kalori arası, yaklaşık {protein} gram protein.',
  'voice.unheard': 'Bunu anlayamadım. Tekrar dene ya da yaz.',
  'voice.off': 'Ses şu an mola veriyor. Yazarak sor.',
  'voice.slow': 'Çok sesli mesaj oldu. Yaz ya da birkaç dakika sonra tekrar dene.',
  'voice.too_long': 'Bu çok uzundu. Bir dakikanın altında tut.',
  'voice.denied': 'Mikrofon engelli. Tarayıcıdan izin ver ya da yaz.',
  'interview.say': 'Ya da sadece söyle: hedefin ve alerjilerin.',
  'interview.unheard': 'Bir hedef anlayamadım. Tekrar söyle ya da birine dokun.',
}

const pl: Copy = {
  'chat.hello': 'Pytaj o wszystko w tym menu.',
  'chat.ask.light': 'Co tu jest lekkie?',
  'chat.ask.protein': 'Które danie ma najwięcej białka?',
  'chat.ask.change': 'Jak odchudzić mój wybór?',
  'chat.slow': 'To było dużo pytań. Zrób krótką przerwę i spróbuj za kilka minut.',
  'chat.busy': 'Teraz jest duży ruch. Spróbuj za chwilę.',
  'chat.off': 'Czat o menu nie jest jeszcze włączony.',
  'chat.failed': 'Nie udało się. Spróbuj jeszcze raz.',
  'chat.offline': 'Jesteś offline. Sprawdź połączenie i spróbuj jeszcze raz.',
  'chat.empty': 'Najpierw powiedz albo napisz pytanie.',
  'chat.no_menu': 'Najpierw zeskanuj menu, potem pytaj.',
  'chat.look': 'Zerknij na te.',
  'chat.numbers': '{dish}: od {low} do {high} kalorii, około {protein} gramów białka.',
  'voice.unheard': 'Nie zrozumiałem. Spróbuj jeszcze raz albo napisz.',
  'voice.off': 'Głos ma teraz przerwę. Napisz to.',
  'voice.slow': 'To było dużo wiadomości głosowych. Napisz albo spróbuj za kilka minut.',
  'voice.too_long': 'Ta była za długa. Zmieść się w minucie.',
  'voice.denied': 'Mikrofon jest zablokowany. Zezwól na niego w przeglądarce albo napisz.',
  'interview.say': 'Albo po prostu powiedz: swój cel i alergie.',
  'interview.unheard': 'Nie wyłapałem celu. Powiedz jeszcze raz albo wybierz jeden.',
}

const nl: Copy = {
  'chat.hello': 'Vraag me alles over deze kaart.',
  'chat.ask.light': 'Wat is hier licht?',
  'chat.ask.protein': 'Welk gerecht heeft de meeste eiwitten?',
  'chat.ask.change': 'Hoe maak ik mijn keuze lichter?',
  'chat.slow': 'Dat waren veel vragen. Neem even pauze en probeer het over een paar minuten opnieuw.',
  'chat.busy': 'Het is nu druk. Probeer het zo nog eens.',
  'chat.off': 'De kaartchat staat nog niet aan.',
  'chat.failed': 'Dat lukte niet. Probeer het opnieuw.',
  'chat.offline': 'Je bent offline. Check je verbinding en probeer het opnieuw.',
  'chat.empty': 'Zeg of typ eerst een vraag.',
  'chat.no_menu': 'Scan eerst een kaart en vraag er dan iets over.',
  'chat.look': 'Kijk eens naar deze.',
  'chat.numbers': '{dish}: {low} tot {high} calorieën, ongeveer {protein} gram eiwit.',
  'voice.unheard': 'Dat heb ik niet verstaan. Probeer het opnieuw of typ het.',
  'voice.off': 'Spraak neemt even pauze. Typ het maar.',
  'voice.slow': 'Dat waren veel spraakberichten. Typ het of probeer het over een paar minuten opnieuw.',
  'voice.too_long': 'Die was te lang. Blijf onder een minuut.',
  'voice.denied': 'De microfoon is geblokkeerd. Sta hem toe in je browser of typ.',
  'interview.say': 'Of zeg het gewoon: je doel en je allergieën.',
  'interview.unheard': 'Geen doel verstaan. Zeg het nog eens of tik er een aan.',
}

const ar: Copy = {
  'chat.hello': 'اسألني أي شيء عن هذه القائمة.',
  'chat.ask.light': 'ما الخفيف هنا؟',
  'chat.ask.protein': 'أي طبق فيه أكثر بروتين؟',
  'chat.ask.change': 'كيف أجعل اختياري أخف؟',
  'chat.slow': 'كانت أسئلة كثيرة. خذ استراحة قصيرة وجرّب بعد بضع دقائق.',
  'chat.busy': 'الضغط كبير الآن. جرّب بعد لحظة.',
  'chat.off': 'محادثة القائمة لم تُشغَّل بعد.',
  'chat.failed': 'لم ينجح ذلك. جرّب مرة أخرى.',
  'chat.offline': 'أنت غير متصل. تحقق من الاتصال ثم جرّب مرة أخرى.',
  'chat.empty': 'قل أو اكتب سؤالا أولا.',
  'chat.no_menu': 'صوّر قائمة أولا ثم اسأل عنها.',
  'chat.look': 'ألقِ نظرة على هذه.',
  'chat.numbers': '{dish}: من {low} إلى {high} سعرة حرارية، ونحو {protein} غرام بروتين.',
  'voice.unheard': 'لم أفهم ذلك. جرّب مرة أخرى أو اكتبه.',
  'voice.off': 'الصوت في استراحة الآن. اكتبه بدلا من ذلك.',
  'voice.slow': 'كانت رسائل صوتية كثيرة. اكتبه أو جرّب بعد بضع دقائق.',
  'voice.too_long': 'كانت طويلة جدا. اجعلها أقل من دقيقة.',
  'voice.denied': 'الميكروفون محظور. اسمح به في المتصفح أو اكتب.',
  'interview.say': 'أو قلها فقط: هدفك وما لديك من حساسية.',
  'interview.unheard': 'لم أفهم الهدف. قله مرة أخرى أو اختر واحدا.',
}

export const CHAT_COPY: Record<Lang, Copy> = {
  English: en, German: de, Spanish: es, French: fr, Italian: it, Portuguese: pt, Turkish: tr, Polish: pl, Dutch: nl, Arabic: ar,
}

/**
 * A fixed chat sentence in the person's language (English when we do not talk
 * theirs). A number in `vars` is the engine's; it is written plainly ("1200"),
 * because these lines are also read aloud and a grouped number is read wrong.
 */
export function sayChat(lang: unknown, key: ChatKey, vars: Record<string, string | number> = {}): string {
  const table = CHAT_COPY[toLang(lang) ?? DEFAULT_LANGUAGE]
  return table[key].replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name]
    return typeof v === 'number' ? String(Math.round(v)) : v ?? ''
  })
}
