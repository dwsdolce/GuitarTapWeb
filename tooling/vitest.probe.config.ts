// Vitest config for the capture-probe tool alone.
//
// Like the baseline minter, the probe needs vitest to execute TypeScript, but it is a TOOL, not a
// test: it writes a file, and the suite must never run it. It lives in tooling/, outside the main
// config's `test/**/*.test.ts` glob; this config points vitest at it deliberately, and is used
// only by tooling/capture-probe.sh.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __APP_BUILD__: JSON.stringify('0'),
  },
  test: {
    include: ['tooling/capture-probe.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
