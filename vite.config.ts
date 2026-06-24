import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Deployed under dolcesfogato.com/guitar_tap/guitar_tap_web/ — production assets
// (and the AudioWorklet, loaded via import.meta.env.BASE_URL) must be served from
// that subpath. Dev server stays at root.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/guitar_tap/guitar_tap_web/' : '/',
  plugins: [react()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
}))
