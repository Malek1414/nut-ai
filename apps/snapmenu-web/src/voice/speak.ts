/**
 * Reading an answer aloud with the phone's own voices (speechSynthesis), in the
 * user's language. Free, offline on most phones, and always started by a tap:
 * a browser does not let a page talk on its own.
 */

export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

const fold = (l: string) => l.replace('_', '-').toLowerCase()

/** The best voice the phone has for `locale` ("de-AT"): that region first, then the language. */
export function voiceFor(locale: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const want = fold(locale)
  const lang = want.split('-')[0]!
  const same = voices.filter((v) => fold(v.lang) === want)
  const kin = voices.filter((v) => fold(v.lang).split('-')[0] === lang)
  return same.find((v) => v.localService) ?? same[0] ?? kin.find((v) => v.default) ?? kin.find((v) => v.localService) ?? kin[0] ?? null
}

/** Voices load late in some browsers: asking once early means they are there at the first tap. */
export function primeVoices(): void {
  try { if (canSpeak()) window.speechSynthesis.getVoices() } catch { /* no voices here */ }
}

/**
 * Read `text` aloud in `locale`. Returns a function that stops it. `onDone`
 * runs once, when the reading ends, fails or is stopped.
 */
export function speak(text: string, locale: string, onDone: () => void): () => void {
  let done = false
  const finish = () => { if (!done) { done = true; onDone() } }
  if (!canSpeak()) { finish(); return () => {} }
  try {
    const synth = window.speechSynthesis
    const u = new SpeechSynthesisUtterance(text)
    u.lang = locale
    const voice = voiceFor(locale, synth.getVoices())
    if (voice) u.voice = voice
    u.rate = 1
    u.onend = finish
    u.onerror = finish
    synth.cancel()
    synth.speak(u)
    return () => { try { synth.cancel() } catch { /* nothing playing */ } finish() }
  } catch {
    finish()
    return () => {}
  }
}
