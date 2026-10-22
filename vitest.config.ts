import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@': resolve(import.meta.dirname, 'src/renderer/src'),
      '@main': resolve(import.meta.dirname, 'src/main')
    }
  },
  test: { include: ['tests/**/*.test.ts'] }
})
