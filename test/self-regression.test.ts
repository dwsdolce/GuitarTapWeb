// @parity test/self-regression
// Zero-tolerance regression check against this configuration's own baseline.
//
// The parity suites ask whether the web edition still agrees with Swift, and must allow
// 1 dB / 1 Hz to do it — the editions genuinely differ. That looseness is not a bar this
// edition can be held to against itself: a change of 0.003 dB is invisible under it, and a
// drift of exactly that size sat in the Swift goldens undetected until the oracle was re-minted.
//
// So this compares what the web edition computes now against what it computed when this
// machine's baseline was minted, and allows NOTHING. Any movement is either a deliberate
// algorithm change — re-mint, review the diff, commit it — or a regression.
//
// Minting is never automatic (tooling/mint-baseline.sh). A suite that wrote its own
// expectations could not fail: delete the file, run the tests, and today's output becomes the
// answer it is checked against.

import { describe, it, expect, beforeAll } from 'vitest'
import { computeAll } from './parityRunner'
import { configKey, flatten, load } from './selfBaseline'

const baseline = load()

let computed: Record<string, number> = {}
let expectedValues: Record<string, number> = {}

describe.skipIf(baseline === null)(
  `zero-tolerance regression — ${configKey()}`,
  () => {
    beforeAll(async () => {
      computed = flatten(await computeAll())
      expectedValues = flatten(baseline!.values)
    }, 600_000)

    it('the baseline covers every computed value, and no more', () => {
      const missing = Object.keys(expectedValues).filter((k) => !(k in computed)).sort()
      const extra = Object.keys(computed).filter((k) => !(k in expectedValues)).sort()
      expect(missing, `${missing.length} baseline value(s) are no longer computed`).toEqual([])
      expect(extra, `${extra.length} newly computed value(s) are absent from the baseline (re-mint to adopt them)`).toEqual([])
    })

    it('every value is unchanged', () => {
      const drifted = Object.keys(expectedValues)
        .sort()
        .filter((k) => k in computed && computed[k] !== expectedValues[k])
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

// A skipped suite scrolls past unnoticed, and an unminted configuration is exactly the state
// that must not become permanent. Say so loudly, once, at collection time.
if (baseline === null) {
  console.warn(
    `\n⚠️  NO SELF-BASELINE for ${configKey()} — this configuration has never been minted, so its\n` +
      '   regression bar is not in force. It is still covered at the 1 dB / 1 Hz parity bar by the\n' +
      '   other suites. To close the gap: ./tooling/mint-baseline.sh\n',
  )
}
