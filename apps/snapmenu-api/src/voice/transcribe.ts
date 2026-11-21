/**
 * A recorded voice message as words, for phones whose browser cannot listen
 * and record at once. Runs on Workers AI Whisper (the `AI` binding) inside its
 * free daily allocation: the budget in ./limits.ts is booked before every call,
 * and a Worker on the free plan cannot be charged past the allocation anyway
 * (the call then fails and the app asks the person to type).
 */
import { languageCode } from './speech.js'

/** The Workers AI binding, as far as this file uses it. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>
}

export const STT_MODEL = '@cf/openai/whisper-large-v3-turbo'

/** Recordings the browsers make: Chrome and Android write WebM/Opus, Safari MP4/AAC, Firefox Ogg/Opus. */
const AUDIO_TYPE = /^audio\/(webm|mp4|ogg|mpeg|wav|x-wav|aac|x-m4a|m4a|3gpp)\b/i
export const isAudioType = (type: string | null): boolean => AUDIO_TYPE.test(type ?? '')

/** Bytes as base64, in slices: a spread of the whole recording would overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * How many seconds a recording is billed as: what the app says, but never less
 * than its size allows (a client cannot book one second for a minute of audio).
 * 12 kB a second is more than any phone writes for speech.
 */
export function billedSeconds(claimed: unknown, bytes: number, maxSeconds: number): number {
  const said = typeof claimed === 'number' && Number.isFinite(claimed) && claimed > 0 ? claimed : 0
  return Math.min(maxSeconds, Math.max(1, Math.ceil(Math.max(said, bytes / 12_000))))
}

/**
 * What Whisper writes for silence or noise: a line it learnt from video
 * subtitles. Such a "transcript" is not something the person said.
 */
const PHANTOMS = [
  /^(thanks?( you)?( so much| very much)?( for watching| for listening)?[.! ]*)+$/i,
  /^(untertitel|untertitelung)\b.*/i,
  /^sous-titres?\b.*/i,
  /^subt[ií]tulos?\b.*/i,
  /^sottotitoli\b.*/i,
  /^(legendas?|ondertitel(s|ing)?|napisy|altyaz[ıi])\b.*/i,
  /amara\.org/i,
  /^[\s.…♪*-]*$/,
  /^\[[^\]]*\]$|^\([^)]*\)$/,
]

/** The words of a transcript as a person said them; empty when the model only heard silence. */
export function cleanTranscript(raw: unknown, max = 500): string {
  if (typeof raw !== 'string') return ''
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t || PHANTOMS.some((p) => p.test(t))) return ''
  return t.slice(0, max)
}

/** Transcribe one recording. `language` is the user's ("German"); the model is told its code. Throws when the service fails. */
export async function transcribe(ai: AiBinding, audio: Uint8Array, language: unknown): Promise<{ text: string; seconds: number | null }> {
  const out = (await ai.run(STT_MODEL, {
    audio: toBase64(audio),
    task: 'transcribe',
    language: languageCode(language),
    // Drops the silent stretches first: a short voice note is mostly speech, and silence is where the model makes things up.
    vad_filter: true,
  })) as { text?: unknown; transcription_info?: { duration?: unknown } } | null
  const duration = out?.transcription_info?.duration
  return { text: cleanTranscript(out?.text), seconds: typeof duration === 'number' && Number.isFinite(duration) ? duration : null }
}
