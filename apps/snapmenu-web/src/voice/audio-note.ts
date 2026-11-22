// Private chat voice notes use the device microphone. Dictation elsewhere keeps its existing speech-only path.
export interface RecordedNote {
  audio: Blob
  durationMs: number
}

interface AudioCapture {
  finish(): Promise<{ text: string; error?: string; note?: RecordedNote }>
  abort(): void
}

export const NOTE_SECONDS = 30
const MAX_BYTES = 256 * 1024

export function recordNote(onReady: () => void, onError: (message: string) => void): AudioCapture | null {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null
  let cancelled = false
  let recorder: MediaRecorder | undefined
  let stream: MediaStream | undefined
  let start = 0
  let finishTime = 0
  let settle!: (value: { text: string; error?: string; note?: RecordedNote }) => void
  const result = new Promise<Awaited<ReturnType<AudioCapture['finish']>>>((resolve) => { settle = resolve })
  const release = () => stream?.getTracks().forEach((track) => track.stop())
  const fail = (message: string) => {
    release()
    settle({ text: '', error: message })
    if (!cancelled) onError(message)
  }
  const ready = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false }).then((s) => {
    stream = s
    if (cancelled) { release(); return }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((mime) => MediaRecorder.isTypeSupported(mime))
    if (!mimeType) { fail('This browser can’t record a supported audio format.'); return }
    recorder = new MediaRecorder(s, { mimeType, audioBitsPerSecond: 24000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => fail('Recording stopped. Please try again.')
    recorder.onstop = () => {
      release()
      if (cancelled) { settle({ text: '' }); return }
      const audio = new Blob(chunks, { type: mimeType.split(';')[0] })
      if (!audio.size || audio.size > MAX_BYTES) { fail('Please try a shorter voice message.'); return }
      settle({ text: '', note: { audio, durationMs: Math.max(1, Math.min(NOTE_SECONDS * 1000, (finishTime || Date.now()) - start)) } })
    }
    recorder.start()
    start = Date.now()
    onReady()
  }).catch((e: Error) => fail(e.name === 'NotAllowedError' ? 'Allow microphone access to record a voice message.' : 'Your microphone isn’t available.'))
  return {
    async finish() {
      await ready
      if (recorder?.state === 'recording') { finishTime = Date.now(); recorder.stop() }
      return result
    },
    abort() {
      cancelled = true
      if (recorder?.state === 'recording') recorder.stop()
      release()
      settle({ text: '' })
    },
  }
}
