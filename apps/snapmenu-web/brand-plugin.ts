import type { Plugin } from 'vite'
import { brandHead, brandManifest } from '../snapmenu-api/src/social/manifest'

declare const process: { env: Record<string, string | undefined> }

/**
 * Writes everything in the page shell that carries the brand from the ONE brand
 * constant (apps/snapmenu-api/src/brand.ts), in dev and in the build:
 *
 *   - index.html: `<!--brand-head-->` becomes the title, description, link
 *     preview (OpenGraph), manifest link and icons;
 *   - /manifest.webmanifest: the home screen manifest.
 *
 * Link previews need absolute picture links. Build with SITE_URL set to the
 * public address (SITE_URL=https://example.org npm run build -w @snapmenu/web)
 * and the page's og:image and og:url carry it; without it they stay relative.
 */
export function brandPlugin(): Plugin {
  const manifest = () => `${JSON.stringify(brandManifest(), null, 2)}\n`
  const serve = (_req: unknown, res: { setHeader(k: string, v: string): void; end(body: string): void }) => {
    res.setHeader('content-type', 'application/manifest+json; charset=utf-8')
    res.end(manifest())
  }
  return {
    name: 'brand',
    transformIndexHtml: (html) => html.replace('<!--brand-head-->', brandHead(process.env['SITE_URL'] ?? '')),
    configureServer(server) { server.middlewares.use('/manifest.webmanifest', serve) },
    configurePreviewServer(server) { server.middlewares.use('/manifest.webmanifest', serve) },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() }) },
  }
}
