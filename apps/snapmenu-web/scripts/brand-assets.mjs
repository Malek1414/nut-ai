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
const GLYPH = `
  <rect x="146" y="112" width="220" height="288" rx="26" fill="#F3F5EF"/>
  <rect x="178" y="158" width="120" height="16" rx="8" fill="#1E6B4E" opacity=".35"/>
  <rect x="178" y="196" width="156" height="16" rx="8" fill="#1E6B4E" opacity=".35"/>
  <rect x="178" y="234" width="104" height="16" rx="8" fill="#1E6B4E" opacity=".35"/>
  <rect x="178" y="310" width="140" height="16" rx="8" fill="#1E6B4E" opacity=".35"/>
  <rect x="118" y="262" width="276" height="22" rx="11" fill="#F2B33D"/>
  <path d="M118 150v-38a26 26 0 0 1 26-26h38M394 150v-38a26 26 0 0 0-26-26h-38M118 362v38a26 26 0 0 0 26 26h38M394 362v38a26 26 0 0 1-26 26h-38" fill="none" stroke="#F2B33D" stroke-width="18" stroke-linecap="round"/>`
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">${inner}</svg>`
/** Rounded square on a clear background: the icon as browsers and Android show it. */
const rounded = svg(`<rect width="512" height="512" rx="116" fill="${BRAND.accent}"/>${GLYPH}`)
/** Full bleed, mark at 72%: safe inside any mask a launcher cuts (and for iOS, which rounds the corners itself). */
const bleed = (scale) => svg(`<rect width="512" height="512" fill="${BRAND.accent}"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${GLYPH}</g>`)

const page = (body, w, h, clear = false) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Manrope:wght@500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${clear ? 'transparent' : BRAND.accent}}</style></head><body>${body}</body></html>`

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const [first, ...rest] = BRAND.tagline.match(/[^.!?]+[.!?]+|[^.!?]+$/g).map((s) => s.trim())
const og = `
<div style="position:relative;width:1200px;height:630px;background:#123F2E;color:#fff;font-family:'Manrope',system-ui,sans-serif;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(760px 760px at 86% 5%,rgba(242,179,61,.24),rgba(242,179,61,0))"></div>
  <div style="position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:16px;font:800 40px 'Bricolage Grotesque',sans-serif;letter-spacing:-.04em">
    <span style="display:block;width:56px;height:56px">${rounded.replace(BRAND.accent, '#F2B33D').replace(/#F2B33D"\/>\s*<path/, '#1E6B4E"/><path')}</span>
    <span>${esc(BRAND.wordmark[0])}<span style="color:#F2B33D">${esc(BRAND.wordmark[1])}</span></span>
  </div>
  <div style="position:absolute;left:64px;top:206px;width:640px;font:800 76px/1.02 'Bricolage Grotesque',sans-serif;letter-spacing:-.035em;text-wrap:balance">
    ${esc(first)}${rest.length ? `<br><span style="color:#F2B33D">${esc(rest.join(' '))}</span>` : ''}
  </div>
  <div style="position:absolute;left:64px;bottom:52px;font:600 26px 'Manrope',sans-serif;color:rgba(243,245,239,.68)">Calories and protein as honest ranges, in your language.</div>
  <div style="position:absolute;right:64px;top:150px;width:396px;padding:32px 34px 34px;border-radius:40px;background:#F3F5EF;color:#14221B;box-shadow:0 30px 60px -30px rgba(0,0,0,.5)">
    <div style="display:flex;align-items:center;gap:12px">
      <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:#F2B33D;color:#3A2604;font:800 18px 'Bricolage Grotesque',sans-serif">1</span>
      <span style="font:700 24px 'Bricolage Grotesque',sans-serif;letter-spacing:-.02em">Hähnchenbrust Salat</span>
    </div>
    <div style="margin-top:22px;font:800 68px/1 'Bricolage Grotesque',sans-serif;letter-spacing:-.04em;white-space:nowrap">290–520<span style="font:700 24px 'Manrope',sans-serif;color:#6B776F;letter-spacing:0;margin-left:8px">kcal</span></div>
    <div style="position:relative;margin-top:22px;height:16px;border-radius:8px;background:#E1E6DB">
      <div style="position:absolute;left:19%;width:16%;top:0;bottom:0;border-radius:8px;background:#6553CF"></div>
      <div style="position:absolute;left:27%;top:-7px;width:6px;height:30px;border-radius:3px;background:#14221B"></div>
    </div>
    <div style="display:inline-block;margin-top:26px;padding:12px 20px;border-radius:999px;background:#E5EBFB;color:#22408F;font:800 24px 'Manrope',sans-serif">43 g protein</div>
  </div>
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
