#!/usr/bin/env node
/**
 * Redraws the pictures that carry the brand, from the ONE brand constant
 * (apps/snapmenu-api/src/brand.ts): the home screen icons and the link preview
 * picture of the start page. Run it after changing the name, the tagline or
 * the colours:
 *
 *   npm run brand:assets -w @snapmenu/web
 *
 * It draws with a headless Chromium through Playwright, which is not a
 * dependency of this repo. Point it at any install:
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs
 *   PLAYWRIGHT_CHROMIUM=/path/to/chrome-headless-shell   (optional)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(HERE, '../public')

// The brand constant is TypeScript with no imports: its object literal is read straight from the file.
const src = readFileSync(join(HERE, '../../snapmenu-api/src/brand.ts'), 'utf8')
const pick = (key) => new RegExp(`${key}:\\s*'([^']*)'`).exec(src)?.[1] ?? ''
const wordmark = /wordmark:\s*\['([^']*)',\s*'([^']*)'\]/.exec(src)
const BRAND = { name: pick('name'), tagline: pick('tagline'), accent: pick('accent'), background: pick('background'), wordmark: [wordmark?.[1] ?? '', wordmark?.[2] ?? ''] }
if (!BRAND.name || !BRAND.tagline) throw new Error('Could not read the brand constant.')

const mod = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
const { chromium } = await import(mod).then((m) => m.default ?? m)

/** The logo mark without its rounded square: a menu page, a scan line and the corner brackets. */
const GLYPH = `<g transform="scale(10.6666667)">
  <path d="M15 12h18v24H15V12Z" fill="white"/>
  <path d="M20 19h8m-8 5h8m-8 5h5" stroke="${BRAND.accent}" stroke-width="2" stroke-linecap="round"/>
  <path d="M10 17v-5a2 2 0 0 1 2-2h5m14 0h5a2 2 0 0 1 2 2v5M10 31v5a2 2 0 0 0 2 2h5m14 0h5a2 2 0 0 0 2-2v-5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/>
</g>`
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">${inner}</svg>`
/** Rounded square on a clear background: the icon as browsers and Android show it. */
const rounded = svg(`<rect width="512" height="512" rx="116" fill="${BRAND.accent}"/>${GLYPH}`)
/** Full bleed, mark at 72%: safe inside any mask a launcher cuts (and for iOS, which rounds the corners itself). */
const bleed = (scale) => svg(`<rect width="512" height="512" fill="${BRAND.accent}"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${GLYPH}</g>`)

const fonts = ''
const page = (body, w, h, clear = false) => `<!doctype html><html><head><meta charset="utf-8">
<style>${fonts}*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${clear ? 'transparent' : BRAND.accent}}</style></head><body>${body}</body></html>`

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const [first, ...rest] = BRAND.tagline.match(/[^.!?]+[.!?]+|[^.!?]+$/g).map((s) => s.trim())
const og = `<div style="width:1200px;height:630px;background:#fff;color:#18212f;font-family:system-ui,sans-serif;display:flex;padding:64px;gap:64px;align-items:center">
  <div style="width:600px">
    <div style="display:flex;align-items:center;gap:16px;font-size:40px;font-weight:700;letter-spacing:-2px"><span style="width:56px;height:56px">${rounded}</span>${esc(BRAND.wordmark.join(''))}</div>
    <h1 style="font-size:58px;line-height:1.12;letter-spacing:-2px;margin:56px 0 24px">${esc(first)}</h1>
    <p style="font-size:30px;line-height:1.4;color:#536174">${esc(rest.join(' '))}</p>
    <p style="font-size:22px;line-height:1.5;color:#697586;margin-top:40px">Calories and protein as honest ranges,<br>in your language.</p>
  </div>
  <img src="data:image/jpeg;base64,${readFileSync(join(PUBLIC, 'photos/salad.jpg')).toString('base64')}" style="width:420px;height:460px;object-fit:cover;border-radius:20px" alt="">
</div>`

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {})
const shot = async (file, html, w, h, clear = false) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  await p.setContent(page(html, w, h, clear), { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  const out = join(PUBLIC, file)
  mkdirSync(dirname(out), { recursive: true })
  await p.screenshot({ path: out, omitBackground: clear, type: 'png' })
  await ctx.close()
  console.log('wrote', file)
}
await shot('icons/icon-192.png', rounded, 192, 192, true)
await shot('icons/icon-512.png', rounded, 512, 512, true)
await shot('icons/icon-maskable-512.png', bleed(0.72), 512, 512)
await shot('icons/apple-touch-icon.png', bleed(0.84), 180, 180)
await shot('og.png', og, 1200, 630)
await browser.close()
writeFileSync(join(PUBLIC, 'icon.svg'), `${rounded.replace(' width="100%" height="100%"', '').replace(/\n\s*/g, '')}\n`)
console.log('wrote icon.svg')
