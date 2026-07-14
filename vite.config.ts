import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Version (marketing) + build number, mirroring Swift/Python: the short version is
// package.json `version`, and the build number is the git commit count
// (`git rev-list --count HEAD`) — the same source Swift's build-phase script and
// Python's gen_version_build.sh use. Falls back to "0" outside a git checkout.
const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const appBuild: string = (() => {
  try {
    return execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return '0'
  }
})()

// Production uses a RELATIVE base, so the build runs from whatever directory it is uploaded
// to — the live site (dolcesfogato.com/guitar_tap/guitar_tap_web/) or a test directory beside
// it — with no rebuild. An absolute base bakes the deploy path into every asset URL, so a copy
// dropped anywhere else asks for its JS at the production path, gets a 404, and renders a blank
// page. Everything that resolves against the base follows automatically: the bundle, the
// manifest, the service worker, and the AudioWorklet (loaded via import.meta.env.BASE_URL).
//
// Caveat: relative URLs resolve against the DOCUMENT url, so the app must be served with a
// trailing slash (…/guitar_tap_web/, not …/guitar_tap_web). Servers normally redirect to add it.
// The User Manual link is an absolute external URL and is unaffected. Dev server stays at root.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(appBuild),
  },
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