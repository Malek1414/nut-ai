import { levelFromRms } from '../../../snapmenu-api/src/voice/speech'

/**
 * The microphone for one voice message: a live loudness reading for the
 * waveform (Web Audio AnalyserNode) and, where the browser can, the recording
 * itself (MediaRecorder). The stream is released the moment the message ends.
 */

/** One loudness value every this many milliseconds: a bar of the live waveform. */
export const TICK_MS = 55

let shared: AudioContext | null = null

/**
 * The page's AudioContext, woken up. Call this inside the tap that starts a
 * recording: iOS only lets a user gesture start audio, and an await before the
 * call (the permission prompt) would already be too late.
 */
export function wakeAudio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    shared ??= new Ctor()
    if (shared.state === 'suspended') void shared.resume().catch(() => {})
    return shared
  } catch {
    return null
  }
}

export const canCapture = (): boolean => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
export const canRecord = (): boolean => canCapture() && typeof MediaRecorder !== 'undefined'

/** What each browser writes: Chrome and Android WebM/Opus, Safari MP4/AAC, Firefox Ogg/Opus. */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export interface Capture {
  readonly startedAt: number
  /** Whether loudness is really measured (false when the browser has no Web Audio). */
  readonly metered: boolean
  /** Loudness history, 0..1, one value per TICK_MS. */
  readonly levels: number[]
  /** Loudness right now, 0..1. */
  level(): number
  /** End the message and hand over the recording; null when this browser cannot record. */
  stop(): Promise<Blob | null>
  /** End the message and throw the recording away. */
  cancel(): void
}

/** Ask for the microphone and start. Rejects when the person says no or there is no microphone. */
export async function startCapture(ctx: AudioContext | null): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })

  let analyser: AnalyserNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  try {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.5
      // Not connected to the speakers: the microphone is only measured, never played back.
      source.connect(analyser)
    }
  } catch {
    analyser = null
  }

  const wave = analyser ? new Uint8Array(analyser.fftSize) : null
  const levels: number[] = []
  let now = 0
  const read = () => {
    if (!analyser || !wave) return 0
    analyser.getByteTimeDomainData(wave)
    let sum = 0
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i]! - 128) / 128
      sum += v * v
    }
    return levelFromRms(Math.sqrt(sum / wave.length))
  }
  const timer = window.setInterval(() => {
    now = read()
    // A minute of history at most; the bubble's bars are made from it.
    if (levels.length < 1400) levels.push(now)
  }, TICK_MS)

  let recorder: MediaRecorder | null = null
  const chunks: Blob[] = []
  const type = typeof MediaRecorder !== 'undefined' ? TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } }) : undefined
  try {
    if (typeof MediaRecorder !== 'undefined') {
      // Speech needs little: a small upload on a phone connection, and well inside the transcription limit.
      recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 })
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
      recorder.start()
    }
  } catch {
    recorder = null
  }

  let released = false
  const release = () => {
    if (released) return
    released = true
    window.clearInterval(timer)
    try { source?.disconnect() } catch { /* already gone */ }
    for (const t of stream.getTracks()) t.stop()
  }

  return {
    startedAt: Date.now(),
    metered: analyser !== null,
    levels,
    level: () => now,
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        const rec = recorder
        if (!rec || rec.state === 'inactive') { release(); resolve(null); return }
        let done = false
        const finish = () => {
          if (done) return
          done = true
          release()
          resolve(chunks.length > 0 ? new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }) : null)
        }
        rec.onstop = finish
        // A recorder that never reports back must not hang the message.
        window.setTimeout(finish, 1500)
        try { rec.stop() } catch { finish() }
      }),
    cancel: () => {
      try { if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop() } } catch { /* nothing to stop */ }
      release()
    },
  }
}
