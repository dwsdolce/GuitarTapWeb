// @parity tooling/capture-probe
// Write this edition's capture-window fingerprints for the REG-G2 per-tap case.
//
// NOT part of the suite: it lives in tooling/, outside the `test/**/*.test.ts` glob. Drive it
// through tooling/capture-probe.sh, which points vitest at tooling/vitest.probe.config.ts.
//
// Companion to Swift's CaptureProbeTests and Python's Tooling/capture-probe.py. Compare the files
// with the hub's tooling/compare-capture-probes.py — see src/state/captureProbe.ts for what the
// three outcomes mean.

import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'
import { captureProbe } from '../src/state/captureProbe'
import { oracle, playGuitar } from '../test/parityRunner'
import { archName, osName } from '../test/selfBaseline'

const CASE_NAME = 'REG-G2'

describe('capture probe', () => {
  it(`writes the capture-window fingerprints for ${CASE_NAME}`, async () => {
    const out = env.CAPTURE_PROBE_OUT || fileURLToPath(new URL('../capture-probe-web.json', import.meta.url))

    captureProbe.reset()
    captureProbe.enabled = true
    try {
      await playGuitar(oracle.filePlayback[CASE_NAME]) // the same setup REG-G2's regression test uses
    } finally {
      captureProbe.enabled = false
    }

    writeFileSync(out, captureProbe.encoded({ os: osName(), arch: archName() }, CASE_NAME, captureProbe.records), 'utf8')
    console.log(`CAPTURE_PROBE_WROTE ${out}`)
    captureProbe.records.forEach((record, index) => {
      console.log(`  tap ${index + 1}: buffer ${record.bufferCount} ${record.bufferHash}  window ${record.windowCount} ${record.windowHash}`)
    })
  })
})
