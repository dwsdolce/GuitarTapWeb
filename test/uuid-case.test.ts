// @parity test/uuid-case
//
// Minted UUIDs are UPPERCASE, and nothing mints outside the one helper.
//
// Swift's `UUID().uuidString` is uppercase, so every id that can travel between editions has to
// be uppercase to compare equal as a string. This edition already uppercased measurement ids, but
// minted calibration ids as raw `crypto.randomUUID()` — lowercase — which went unnoticed until
// Python moved to uppercase (SLUG-SWEEP.md F22) and left web the only edition disagreeing.
//
// The second test is the one that prevents a regression. Checking that `newId()` is uppercase
// proves the helper works; it does nothing about a `crypto.randomUUID()` added elsewhere next
// month, which would pass every other test here while quietly reintroducing the divergence. A rule
// with no test is a rule that drifts, so this scans the source rather than trusting it.
//
// Mirrors Python tests/test_uuid_case.py. Swift needs no counterpart: `UUID().uuidString` is
// uppercase by definition, so there is nothing there to get wrong.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { newId } from '../src/measurement/newId'

const SRC = join(__dirname, '..', 'src')
const HELPER = join(SRC, 'measurement', 'newId.ts')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

describe('uuid-case', () => {
  it('newId() mints uppercase, well-formed, distinct ids', () => {
    // Many draws: a lowercase hex digit only appears when the random bytes call for one.
    const minted = Array.from({ length: 2000 }, () => newId())
    expect(minted.every((u) => u === u.toUpperCase())).toBe(true)
    const pattern = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/
    expect(minted.every((u) => pattern.test(u))).toBe(true)
    expect(new Set(minted).size).toBe(minted.length)
  })

  it('no module mints outside the helper', () => {
    // `crypto.randomUUID()` appears in exactly one file: newId.ts. Everything else calls newId().
    // This is what fails when someone reintroduces a direct mint — the case test above would not.
    const offenders: string[] = []
    for (const path of sourceFiles(SRC)) {
      if (path === HELPER) continue
      readFileSync(path, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes('crypto.randomUUID')) {
            offenders.push(`${relative(SRC, path)}:${i + 1}: ${line.trim()}`)
          }
        })
    }
    expect(offenders, `these mint a UUID directly instead of calling newId():\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})
