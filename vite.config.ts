import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed under dolcesfogato.com/guitar_tap/guitar_tap_web/ — production assets
// (and the AudioWorklet, loaded via import.meta.env.BASE_URL) must be served from
// that subpath. Dev server stays at root.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/guitar_tap/guitar_tap_web/' : '/',
  plugins: [
    react(),
    // PWA: installable + offline. The app is already fully client-side (DSP in the
    // browser, library in IndexedDB), so precaching the bundle makes it work offline.
    // `autoUpdate` swaps in a new service worker on the next visit after a deploy.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-64.png', 'icons/apple-touch-icon-180.png'],
      manifest: {
        name: 'Guitar Tap',
        short_name: 'Guitar Tap',
        description: 'Tap-tone spectrum analysis for luthiers — guitar, plate, and brace measurements.',
        theme_color: '#0b0e13',
        background_color: '#0b0e13',
        display: 'standalone',
        orientation: 'any',
        // Relative src resolves against the manifest URL, so it follows `base` automatically.
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the bundle, styles, html, icons AND the AudioWorklet (spectrum-processor.js).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
}))