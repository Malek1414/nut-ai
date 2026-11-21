/**
 * The browser's own speech recognition (SpeechRecognition, in Chrome and Safari
 * still webkitSpeechRecognition), listening while a voice message is recorded.
 * Free and with no upload, so it comes first wherever it can share the
 * microphone with the recording (see `sttPlan`).
 */

interface RecognitionResult { isFinal: boolean; 0?: { transcript: string } }
interface RecognitionEvent { results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const canRecognise = (): boolean => recognitionCtor() !== null

export interface Listening {
  /** Stop listening and return everything that was heard ("" when nothing was). */
  finish(): Promise<string>
  abort(): void
}

/** Start listening in `locale` ("de-DE"). Null when this browser cannot, or will not start. */
export function listen(locale: string): Listening | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null
  let rec: Recognition
  try {
    rec = new Ctor()
  } catch {
    return null
  }
  rec.lang = locale
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 1

  let finals = ''
  let interim = ''
  let ended = false
  let onEnd: (() => void) | null = null
  // The whole result list is read each time: some phones repeat earlier results in later events.
  rec.onresult = (e) => {
    let f = ''
    let t = ''
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i]!
      const words = r[0]?.transcript ?? ''
      if (r.isFinal) f += `${words} `
      else t += words
    }
    finals = f
    interim = t
  }
  rec.onerror = () => { /* onend follows; whatever was heard until now still counts */ }
  rec.onend = () => { ended = true; onEnd?.() }
  try {
    rec.start()
  } catch {
    return null
  }
  const heard = () => `${finals} ${interim}`.replace(/\s+/g, ' ').trim()

  return {
    finish: () =>
      new Promise<string>((resolve) => {
        if (ended) { resolve(heard()); return }
        let done = false
        const finish = () => { if (!done) { done = true; resolve(heard()) } }
        onEnd = finish
        // The last words arrive a moment after stop(); do not wait for them forever.
        window.setTimeout(finish, 1400)
        try { rec.stop() } catch { finish() }
      }),
    abort: () => {
      onEnd = null
      try { rec.abort() } catch { /* not running */ }
    },
  }
}
