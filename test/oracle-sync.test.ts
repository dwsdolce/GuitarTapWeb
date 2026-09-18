// @parity test/oracle-sync
// The vendored oracle still matches canonical — when canonical can be reached.
//
// Each repo commits its own copy of parity-oracle.json so the suite runs offline. That
// convenience is also the failure mode: a copy can sit here for months, quietly stale, while
// the canonical file in the hub has moved on. Nothing notices, because every test passes
// against the stale copy — they are measuring agreement with yesterday.
//
// tooling/sync-oracle.sh --check is the existing answer, and it has always had to be run by
// hand. This puts it in the suite, where it runs without being remembered.
//
// It cannot always run. While the hub is private the published URL 404s, so canonical is only
// reachable through ORACLE_SRC pointing at a local hub checkout — which most machines do not
// have. Rather than fail everywhere for a condition nobody can fix locally, an unreachable
// canonical SKIPS LOUDLY. Once the hub is public (issue #11) the URL resolves on its own and
// this starts checking everywhere with no change here.
//
//   exit 0 → in sync            exit 1 → drift, and the diff is the message
//   exit 2 → could not reach canonical → skip, or a misconfigured script → fail

import { describe, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../tooling/sync-oracle.sh', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// Phrases fetch_canonical emits when it cannot reach canonical, as opposed to the other things
// that also exit 2 (no oracle-dest.txt, bad usage) — those are real misconfiguration and must
// fail rather than skip.
const UNREACHABLE = ['could not fetch canonical oracle', 'ORACLE_SRC given but no oracle']

describe('the vendored oracle matches canonical', () => {
  it('is in sync, or says why it could not be checked', (ctx) => {
    if (!existsSync(script)) {
      console.warn(`⚠️  no sync-oracle.sh at ${script} — oracle staleness NOT checked`)
      return ctx.skip()
    }

    const run = spawnSync('bash', [script, '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (run.error) {
      console.warn(`⚠️  could not run bash (${run.error.message}) — oracle staleness NOT checked`)
      return ctx.skip()
    }

    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim()
    if (run.status === 0) return

    if (run.status === 2 && UNREACHABLE.some((p) => output.includes(p))) {
      console.warn(
        '⚠️  CANONICAL ORACLE UNREACHABLE — the vendored copy is NOT being checked for\n' +
          '   staleness. While the hub is private this needs ORACLE_SRC=<hub checkout>.\n' +
          `   Script said: ${output.split('\n')[0] || '(no output)'}`,
      )
      return ctx.skip()
    }

    throw new Error(`sync-oracle.sh --check failed (exit ${run.status}):\n${output}`)
  })
})
