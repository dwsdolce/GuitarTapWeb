// @parity tooling/mint-baseline
// Mint this configuration's self-baseline — the zero-tolerance regression reference.
//
// Gated: it does nothing unless MINT_BASELINE=1, so a normal `vitest run` never writes.
// Drive it through tooling/mint-baseline.sh rather than by hand.
//
// Minting is deliberately separate from checking. A suite that minted its own expectations
// could never fail — delete the file, run the tests, and whatever the machine produces today
// becomes the answer it is checked against. So this is an explicit act, and the file it writes
// is committed and reviewed like any other change.
//
// Two situations, two behaviours:
//   * NO BASELINE YET. There is no prior to compare against, so the first run is trusted — with
//     the one check actually available: the values must pass the parity gate against the oracle.
//     Within 1 dB / 1 Hz of canonical Swift they are plausible and worth freezing. Outside it
//     there is no baseline to commit, there is a finding; committing it would freeze a bug into
//     the thing meant to catch bugs.
//   * A BASELINE EXISTS. Re-minting means the numbers moved deliberately, so the diff is printed
//     and must be confirmed (MINT_BASELINE_YES=1, which the wrapper sets after prompting).
//     That diff is the review artifact for the change.

import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { arch, env, platform, versions } from 'node:process'
import { cpus } from 'node:os'
import { computeAll, oracle } from './parityRunner'
import { baselinePath, configuration, configKey, flatten, load } from './selfBaseline'

const enabled = env.MINT_BASELINE === '1'

// Which tolerance governs a value, by the leaf its path ends in.
const TOLERANCE_KEYS: Record<string, string> = {
  frequency: 'freqHz',
  magnitude: 'magDb',
  q: 'q',
  ringOutSec: 'ringOutSec',
  db: 'gatedFftDb',
  deltaDb: 'gatedFftDb',
}

// The FIRST-MINT bar, not the parity bar. A new configuration has no prior to check against,
// so the only available question is whether its numbers are plausible at all. Parity is now
// tight enough (0.02 Hz / 0.01 dB) that a port still being built could fail it — and failing
// it here would leave that port with no zero-tolerance regression check at exactly the moment
// it most needs one. Falls back to the parity numbers for an older oracle predating the split.
const BOOTSTRAP: Record<string, number> = oracle.bootstrapTolerances ?? oracle.tolerances

/** The first-mint bar for a value. Per-case overrides are a parity concept and do not apply
 *  here: this asks whether the numbers are garbage, which is not case-specific. */
function toleranceFor(path: string): number | null {
  const key = TOLERANCE_KEYS[path.split('/').pop()!]
  return key ? Number(BOOTSTRAP[key]) : null
}

/** Paths where this configuration falls outside the first-mint bar. Empty is a pass. */
function checkAgainstOracle(computed: Record<string, number>): string[] {
  const oracleFlat = flatten(oracle)
  const failures: string[] = []
  for (const path of Object.keys(computed).sort()) {
    const value = computed[path]!
    if (path.endsWith('/maxDb')) {
      const ceiling = Number(oracle.gatedFft[path.split('/')[0]!].maxDbBelow)
      if (!(value < ceiling)) failures.push(`  ${path}: ${value} is not below the ${ceiling} dB ceiling`)
      continue
    }
    const want = oracleFlat[path]
    const tolerance = toleranceFor(path)
    if (want === undefined || tolerance === null) continue
    const delta = Math.abs(value - want)
    if (delta >= tolerance) {
      failures.push(`  ${path}: oracle ${want}, computed ${value}, delta ${delta} >= ${tolerance} tolerance`)
    }
  }
  return failures
}

function diffAgainst(previous: Record<string, number>, computed: Record<string, number>): string[] {
  const lines: string[] = []
  for (const path of [...new Set([...Object.keys(previous), ...Object.keys(computed)])].sort()) {
    const before = previous[path]
    const after = computed[path]
    if (before === undefined) lines.push(`  + ${path} = ${after}`)
    else if (after === undefined) lines.push(`  - ${path} (was ${before})`)
    else if (before !== after) lines.push(`  ~ ${path}: ${before} -> ${after}  (delta ${after - before})`)
  }
  return lines
}

/** What the machine was, so a future drift can be explained rather than guessed at. None of it
 *  is part of the configuration key: a V8 upgrade that moves the numbers must fail the
 *  regression check, not silently redefine the baseline. */
function provenance(): Record<string, string> {
  return {
    mintedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    oracleVersion: String(oracle.oracleVersion ?? 'unknown'),
    node: versions.node,
    v8: versions.v8,
    platform: `${platform}-${arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
  }
}

describe.skipIf(!enabled)('mint the self-baseline', () => {
  it('computes every oracle case and writes this configuration\'s baseline', async () => {
    const path = baselinePath()
    console.log(`Configuration: ${configKey()}`)
    console.log(`Baseline:      ${path}`)
    console.log('Running every oracle case ...')

    const values = await computeAll()
    const computed = flatten(values)
    console.log(`Computed ${Object.keys(computed).length} values.`)

    const previous = load()
    if (previous === null) {
      console.log('\nNo baseline exists for this configuration — bootstrapping.')
      console.log('Checking the values against the oracle at the first-mint bar, since there')
      console.log('is no prior to compare them to.')
      const failures = checkAgainstOracle(computed)
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} value(s) fall outside the first-mint bar:\n${failures.slice(0, 20).join('\n')}\n\n` +
            'No baseline written. These numbers are too far from the canonical edition to be\n' +
            'plausible, so freezing them would freeze the defect into the detector.',
        )
      }
      console.log('✅ Every value is within the first-mint bar.')
    } else {
      const lines = diffAgainst(flatten(previous.values), computed)
      if (lines.length === 0) {
        console.log('\n✅ Identical to the committed baseline — nothing to do.')
        return
      }
      console.log(`\n${lines.length} value(s) differ from the committed baseline:`)
      console.log(lines.slice(0, 40).join('\n'))
      if (lines.length > 40) console.log(`  ... and ${lines.length - 40} more`)
      if (env.MINT_BASELINE_YES !== '1') {
        throw new Error(
          'Baseline NOT overwritten. This diff is the review artifact: adopt it only if a\n' +
            'deliberate change explains every line, otherwise it is a regression and re-minting\n' +
            'hides it. Re-run with tooling/mint-baseline.sh --yes to adopt.',
        )
      }
    }

    const document = {
      _generator:
        'GuitarTapWeb test/mint-baseline.test.ts — this configuration\'s zero-tolerance regression ' +
        'reference. Not the oracle: the oracle is the cross-edition contract minted by canonical Swift.',
      configuration: configuration(),
      provenance: provenance(),
      values,
    }
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    console.log(`\n✅ Wrote ${path}`)
    console.log('   Review it, commit it, and publish it to the hub so the parity')
    console.log('   arithmetic can see this configuration.')
  }, 600_000)
})
