import { useEffect, useRef, useState } from 'react'
import { friendToken } from './link'

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
type DetectorClass = { new(options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> }

export function Scanner({ onFound }: { onFound: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const found = useRef(onFound)
  found.current = onFound
  const [status, setStatus] = useState('Point the camera at a PlatePal friend code.')
  const [paste, setPaste] = useState('')
  useEffect(() => {
    let active = true
    let stream: MediaStream | null = null
    let timer: number | undefined
    const element = video.current!
    const stop = () => stream?.getTracks().forEach(track => track.stop())
    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (!active) { stop(); return }
      element.srcObject = stream
      await element.play()
      const Native = (window as Window & { BarcodeDetector?: DetectorClass }).BarcodeDetector
      let detector: Detector | null = null
      if (Native) {
        try { if ((await Native.getSupportedFormats()).includes('qr_code')) detector = new Native({ formats: ['qr_code'] }) } catch { /* Use the bundled decoder. */ }
      }
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      async function frame() {
        if (!active) return
        let value: string | undefined
        if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          if (detector) {
            try { value = (await detector.detect(element))[0]?.rawValue } catch { detector = null }
          }
          if (!detector && context && element.videoWidth) {
            const width = Math.min(element.videoWidth, 640)
            canvas.width = width
            canvas.height = Math.max(1, Math.round(width * element.videoHeight / element.videoWidth))
            const { default: decode } = await import('jsqr')
            if (!active) return
            context.drawImage(element, 0, 0, width, canvas.height)
            const pixels = context.getImageData(0, 0, width, canvas.height)
            value = decode(pixels.data, width, canvas.height, { inversionAttempts: 'dontInvert' })?.data
          }
        }
        if (!active) return
        if (value) {
          const token = friendToken(value, location.origin)
          if (token) { stop(); found.current(token); return }
          setStatus('That code is for something else. Scan a PlatePal friend code.')
        }
        timer = window.setTimeout(() => { void frame().catch(unavailable) }, 200)
      }
      await frame()
    }
    function unavailable() {
      stop()
      if (active) setStatus('Camera unavailable. Allow camera access or paste your friend’s link.')
    }
    void start().catch(unavailable)
    return () => { active = false; clearTimeout(timer); stop(); element.srcObject = null }
  }, [])
  return <>
    <video ref={video} className="friend-camera" playsInline muted autoPlay aria-label="Friend code scanner" />
    <p className="small" role="status">{status}</p>
    <form onSubmit={e => {
      e.preventDefault()
      const token = friendToken(paste.trim(), location.origin)
      if (token) onFound(token)
      else setStatus('Paste the full link from your friend’s PlatePal QR.')
    }}>
      <label>Friend link<input className="input" type="url" required value={paste} onChange={e => setPaste(e.target.value)} placeholder="Paste a PlatePal link" /></label>
      <button className="btn btn-secondary" disabled={!paste.trim()}>Open friend link</button>
    </form>
  </>
}
