/**
 * The browser's own speech recognition (SpeechRecognition, in Chrome and Safari
 * still webkitSpeechRecognition). The browser may use its own speech service;
 * PlatePal does not record audio or send it to its server.
 */

interface RecognitionResult { isFinal: boolean; 0?: { transcript: string } }
interface RecognitionEvent { results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  onsoundstart: (() => void) | null
  onsoundend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface Listening {
  /** Stop listening and return everything that was heard ("" when nothing was). */
  finish(): Promise<{ text: string; error: string | undefined }>
  abort(): void
}

/** Start listening in `locale` ("de-DE"). Null when this browser cannot, or will not start. */
export function listen(locale: string, onError?: (error: string) => void, onWords?: (text: string) => void, onSound?: (active: boolean) => void): Listening | null {
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
  let error: string | undefined
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
    onWords?.(`${f} ${t}`.trim())
  }
  rec.onsoundstart = () => onSound?.(true)
  rec.onsoundend = () => onSound?.(false)
  rec.onerror = (e) => {
    error = e.error
    if (error && error !== 'aborted' && !finals && !interim) queueMicrotask(() => onError?.(error!))
  }
  rec.onend = () => { ended = true; onSound?.(false); onEnd?.() }
  try {
    rec.start()
  } catch {
    return null
  }
  const heard = () => ({ text: `${finals} ${interim}`.replace(/\s+/g, ' ').trim(), error })

  return {
    finish: () =>
      new Promise((resolve) => {
        if (ended) { resolve(heard()); return }
        let done = false
        const finish = () => {
          if (done) return
          done = true
          window.clearTimeout(timeout)
          onEnd = null
          resolve(heard())
        }
        const timeout = window.setTimeout(() => { finish(); try { rec.abort() } catch { /* already ended */ } }, 1400)
        onEnd = finish
        try { rec.stop() } catch { finish() }
      }),
    abort: () => {
      onEnd = null
      try { rec.abort() } catch { /* not running */ }
    },
  }
}
