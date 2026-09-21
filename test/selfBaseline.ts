// @parity tooling/self-baseline
// This configuration's committed self-baseline: what it computed, last time it was minted.
//
// Two different bars guard the numbers, and conflating them is what let a real drift hide:
//   * The PARITY bar (parity-oracle.json `tolerances`, 1 dB / 1 Hz) asks whether the editions
//     agree. It is necessarily loose — the web DSP and Swift's are different implementations
//     on different runtimes, and they genuinely differ.
//   * The REGRESSION bar, here, asks whether THIS edition on THIS machine still computes what
//     it computed before. Nothing legitimately moves it, so it is ZERO.
//
// The web edition cannot use the oracle for the second question: the oracle holds Swift's
// numbers, and the distance to them is the very thing the parity bar measures. So each
// configuration — edition x OS x arch — mints its own absolute baseline and is checked against
// itself.
//
// The key deliberately excludes the Node and V8 versions. A runtime upgrade that moves the
// numbers is precisely the event this exists to catch; keying on the version would let the
// baseline follow the upgrade and report nothing.
//
// Scope, stated honestly: the suite runs under Node, so this baseline characterises the web
// DSP on V8 for this OS and arch. It says nothing about Safari, which is a separate question
// the browser harness would have to answer.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { arch, platform } from 'node:process'

export const EDITION = 'web'

export function osName(): string {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return platform
}

export function archName(): string {
  if (arch === 'arm64') return 'arm64'
  if (arch === 'x64') return 'x86_64'
  return arch
}

export function configuration(): { edition: string; os: string; arch: string } {
  return { edition: EDITION, os: osName(), arch: archName() }
}

export function configKey(): string {
  return `${EDITION}-${osName()}-${archName()}`
}

/** Beside the tests, so the suite reads it with no hub checkout and no network. */
export function baselinePath(): string {
  return fileURLToPath(
    new URL(`./fixtures/self-baseline-${osName()}-${archName()}.json`, import.meta.url),
  )
}

export interface Baseline {
  configuration: { edition: string; os: string; arch: string }
  provenance: Record<string, string>
  values: Record<string, unknown>
}

/** The committed baseline for this configuration, or null if none has been minted. */
export function load(): Baseline | null {
  const path = baselinePath()
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline
}

/** Nested case values → one flat {path: number} map, for value-by-value comparison.
 *  Every edition produces the same paths, so the hub can subtract one configuration's file
 *  from another's without knowing anything about either. */
export function flatten(values: Record<string, unknown>): Record<string, number> {
  const flat: Record<string, number> = {}

  const label = (item: unknown): string | null => {
    if (typeof item !== 'object' || item === null) return null
    const it = item as Record<string, unknown>
    if ('role' in it) return String(it.role)
    if ('tap' in it) return `tap${it.tap}`
    if ('hz' in it) return `${it.hz}Hz`
    return null
  }

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}/${label(item) ?? index}`))
    } else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'role' || key === 'tap' || key === 'hz' || key.startsWith('_')) continue
        walk(value, `${path}/${key}`)
      }
    } else if (typeof node === 'number') {
      flat[path] = node
    }
  }

  for (const block of ['filePlayback', 'gatedFft']) {
    const body = (values as Record<string, unknown>)[block]
    if (!body) continue
    for (const [name, caseBody] of Object.entries(body as Record<string, unknown>)) {
      walk(caseBody, name)
    }
  }
  return flat
}
