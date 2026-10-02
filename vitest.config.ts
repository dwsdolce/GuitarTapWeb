import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The build-time constants the app reads (vite.config.ts defines them for the app build).
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __APP_BUILD__: JSON.stringify('0'),
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
