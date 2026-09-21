// Vitest config for the baseline minter alone.
//
// The minter needs vitest because it has to execute TypeScript — parityRunner and selfBaseline —
// and vitest is this project's TS execution environment. But it is a TOOL, not a test: it writes
// a file, and the suite must never run it.
//
// The main config includes `test/**/*.test.ts`. The minter lives in tooling/, outside that glob,
// so a normal `vitest run` cannot load it. This config exists to point vitest at it deliberately,
// and is used only by tooling/mint-baseline.sh.
//
// Vitest 2.x has no `--include` CLI flag and `--dir` does not override the glob, so a second
// config is the way to run a file outside the suite. See SLUG-SWEEP.md F2.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tooling/mint-baseline.test.ts'],
    environment: 'node',
    // Minting runs every oracle case through the real DSP; the default 5s is not enough.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
