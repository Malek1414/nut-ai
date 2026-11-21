import { BRAND } from '../brand.js'

/**
 * The web app manifest, built from the brand constant: what makes the app
 * installable ("Add to Home Screen") and how it looks once it is.
 *
 * `share_target` puts the installed app into the phone's share sheet (Android):
 * sharing a post from Instagram, TikTok or a browser opens /import with the
 * link, where it is read like a pasted one. iOS has no share target; there the
 * link is pasted.
 */
export function brandManifest(): Record<string, unknown> {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    id: '/',
    // Opened from the home screen: counted as its own source in /numbers.
    start_url: '/?utm_source=homescreen',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: BRAND.background,
    theme_color: BRAND.theme,
    lang: 'en',
    categories: ['food', 'health', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: {
      action: '/import',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
    shortcuts: [
      { name: 'Scan a menu', url: '/?utm_source=homescreen', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Save from a link', url: '/import', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  }
}

/**
 * The tags of the page head that carry the brand: title, description, link
 * preview, home screen. One list, used by the Vite plugin. `siteUrl` is the
 * public address ("https://example.org"): with it the preview picture and the
 * page address are absolute, which most messengers need.
 */
export function brandHead(siteUrl = ''): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const site = /^https?:\/\/[^\s"'<>]+$/.test(siteUrl) ? siteUrl.replace(/\/+$/, '') : ''
  const name = esc(BRAND.name)
  const title = esc(`${BRAND.name}: ${BRAND.tagline}`)
  const description = esc(BRAND.description)
  return [
    `<title>${name}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="application-name" content="${name}" />`,
    `<meta name="apple-mobile-web-app-title" content="${name}" />`,
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    `<meta name="theme-color" content="${BRAND.theme}" />`,
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="icon" type="image/svg+xml" href="/icon.svg" />',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${name}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    ...(site ? [`<meta property="og:url" content="${esc(site)}/" />`, `<link rel="canonical" href="${esc(site)}/" />`] : []),
    `<meta property="og:image" content="${esc(site)}/og.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${esc(site)}/og.png" />`,
  ].join('\n    ')
}
