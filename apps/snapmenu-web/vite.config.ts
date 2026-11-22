import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { brandPlugin } from './brand-plugin'

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  plugins: [react(), brandPlugin()],
  resolve: {
    alias: {
      // The Nut AI engine runs in the browser too: corrections recompute locally.
      '@nutai/totals': pkg('totals'),
      '@nutai/core-schema': pkg('core-schema'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5199,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/api': { target: 'http://127.0.0.1:8799', changeOrigin: true } },
  },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8799', changeOrigin: true } } },
})
