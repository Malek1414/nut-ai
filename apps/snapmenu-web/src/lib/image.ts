/**
 * Downscale and compress a phone photo before upload: a 12 MP menu photo is
 * 4-6 MB; 1600 px JPEG at q0.82 keeps menu text legible at ~250-450 KB, which
 * uploads in a few seconds on 4G.
 */
const MAX_EDGE = 1600

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; close?: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
    } catch {
      /* fall through to <img> (older Safari, HEIC) */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { src: img, w: img.naturalWidth, h: img.naturalHeight }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export async function compressImage(file: Blob): Promise<{ dataUrl: string; bytes: number; width: number; height: number }> {
  const img = await decode(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.w, img.h))
  const w = Math.round(img.w * scale)
  const h = Math.round(img.h * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(img.src, 0, 0, w, h)
  img.close?.()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
  return { dataUrl, bytes: Math.round((dataUrl.length * 3) / 4), width: w, height: h }
}
