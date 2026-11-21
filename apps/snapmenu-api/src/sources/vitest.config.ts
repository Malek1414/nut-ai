import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * The root vitest.config.ts only includes apps/snapmenu-api/test. Until the
 * sources are wired in (then add 'apps/snapmenu-api/src/**\/*.test.ts' there),
 * run these with:
 *
 *   npx vitest run --config apps/snapmenu-api/src/sources/vitest.config.ts
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    environment: 'node',
  },
})
