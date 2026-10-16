// @parity test/self-regression
// Regression check against this configuration's own baseline, at the same-configuration bar.
//
// The parity suites ask whether the web edition still agrees with Swift, and must allow
// 1 dB / 1 Hz to do it — the editions genuinely differ. That looseness is not a bar this
// edition can be held to against itself: a change of 0.003 dB is invisible under it, and a
// drift of exactly that size sat in the Swift goldens undetected until the oracle was re-minted.
//
// So this compares what the web edition computes now against what it computed when this
// configuration's baseline was minted, and allows only the oracle's `selfTolerances` (1e-12): the
// last-bit differences between CPUs of one configuration (GitHub's runners, different people's
// machines), a million times below any real change. Any larger movement is either a deliberate
// algorithm change — re-mint, review the diff, commit it — or a regression.
//
// Minting is never automatic (tooling/mint-baseline.sh). A suite that wrote its own
// expectations could not fail: delete the file, run the tests, and today's output becomes the
// answer it is checked against.

import { describe, it, expect, beforeAll } from 'vitest'
import { computeAll, selfTolerance } from './parityRunner'
import { configKey, flatten, load } from './selfBaseline'

const baseline = load()

let computed: Record<string, number> = {}
let expectedValues: Record<string, number> = {}

// An unminted configuration is exactly the state that must not become permanent, so its skip says so,
// in the skipped list at the end of the run.
const NO_BASELINE =
  `NO SELF-BASELINE for ${configKey()} — this configuration has never been minted, so its regression bar is ` +
  'not in force. It is still covered at the 1 dB / 1 Hz parity bar by the other suites. To close the gap: ' +
  './tooling/mint-baseline.sh'

describe(
  `self-regression — ${configKey()}`,
  () => {
    beforeAll(async () => {
      if (baseline === null) return
      computed = flatten(await computeAll())
      expectedValues = flatten(baseline!.values)
    }, 600_000)

    it('the baseline covers every computed value, and no more', (ctx) => {
      if (baseline === null) return ctx.skip(NO_BASELINE)
      const missing = Object.keys(expectedValues).filter((k) => !(k in computed)).sort()
      const extra = Object.keys(computed).filter((k) => !(k in expectedValues)).sort()
      expect(missing, `${missing.length} baseline value(s) are no longer computed`).toEqual([])
      expect(extra, `${extra.length} newly computed value(s) are absent from the baseline (re-mint to adopt them)`).toEqual([])
    })

    it('every value is unchanged', (ctx) => {
      if (baseline === null) return ctx.skip(NO_BASELINE)
      const drifted = Object.keys(expectedValues)
        .sort()
        .filter(
          (k) =>
            k in computed &&
            computed[k] !== expectedValues[k] &&
            !(Math.abs(computed[k]! - expectedValues[k]!) <= selfTolerance(k)),
        )
      if (drifted.length > 0) {
        const lines = drifted
          .slice(0, 20)
          .map((k) => `  ${k}: baseline ${expectedValues[k]} -> now ${computed[k]}  (delta ${computed[k]! - expectedValues[k]!})`)
          .join('\n')
        const more = drifted.length > 20 ? `\n  ... and ${drifted.length - 20} more` : ''
        throw new Error(
          `${drifted.length} of ${Object.keys(expectedValues).length} values moved since ` +
            `${baseline!.provenance.mintedAt} on ${configKey()}:\n${lines}${more}\n\n` +
            'Nothing legitimately moves these. Either a change altered the numbers — re-mint with ' +
            'tooling/mint-baseline.sh, review the diff, and commit it — or this is a regression.',
        )
      }
    })
  },
)
