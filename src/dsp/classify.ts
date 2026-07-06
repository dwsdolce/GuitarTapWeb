// @parity model/guitar-mode-classify tests=test/classify
import { modeBands, type GuitarTypeName, type ModeName } from './guitarModes'
import type { Peak } from './peaks'

// Mode classification, ported from GuitarMode.classify / classifyAll.
// classifyAll is the context-aware claimer used by the Results panel's
// getPeak(for:) — it disambiguates the Top/Back overlap that a naive per-peak
// lookup cannot. See Development/INVENTORY.md "Mode Classification".

export type ResolvedMode = ModeName | 'unknown'

/** Single-frequency lookup: bands tested in fixed case order (air→upper); first match wins. */
export function classifySingle(freq: number, guitarType: GuitarTypeName): ResolvedMode {
  for (const b of modeBands(guitarType)) {
    if (b.lo <= freq && freq <= b.hi) return b.name
  }
  return 'unknown'
}

/**
 * Context-aware mode classifier — mirrors Swift `GuitarMode.classifyAll` / Python
 * `classify_all`. Unlike `classifySingle` (per-frequency), it processes all peaks
 * together so overlapping ranges (especially Top/Back) resolve correctly:
 * 1. Sort the modes by ascending range lower-bound.
 * 2. Claim the highest-magnitude unclaimed peak in each mode's range. Back is
 *    constrained to lie strictly above the claimed Top frequency (the back plate
 *    resonance is always higher than the top plate's).
 * 3. Remaining peaks fall back to `classifySingle` — except a peak above the claimed
 *    Top and within the Back range resolves to `back`, preserving Top-below-Back.
 * @returns Map of peak `id` -> resolved mode (`'unknown'` if outside all ranges).
 */
export function classifyAll(peaks: Peak[], guitarType: GuitarTypeName): Map<number, ResolvedMode> {
  const ordered = modeBands(guitarType).sort((a, b) => a.lo - b.lo)
  const result = new Map<number, ResolvedMode>()
  const claimed = new Set<number>()
  let claimedTopFreq: number | null = null

  for (const m of ordered) {
    const effLo =
      m.name === 'back' && claimedTopFreq !== null ? Math.max(m.lo, claimedTopFreq + 1) : m.lo
    let best: Peak | null = null
    for (const p of peaks) {
      if (claimed.has(p.id)) continue
      if (p.frequency >= effLo && p.frequency <= m.hi && (!best || p.magnitude > best.magnitude)) {
        best = p
      }
    }
    if (!best) continue
    result.set(best.id, m.name)
    claimed.add(best.id)
    if (m.name === 'top') claimedTopFreq = best.frequency
  }

  const back = modeBands(guitarType).find((b) => b.name === 'back')!
  for (const p of peaks) {
    if (result.has(p.id)) continue
    if (claimedTopFreq !== null && p.frequency > claimedTopFreq && back.lo <= p.frequency && p.frequency <= back.hi) {
      result.set(p.id, 'back')
    } else {
      result.set(p.id, classifySingle(p.frequency, guitarType))
    }
  }
  return result
}

/** Strongest peak per identified mode (the Results-panel resolution). */
export function resolvedModePeaks(peaks: Peak[], guitarType: GuitarTypeName): Map<ModeName, Peak> {
  const modeMap = classifyAll(peaks, guitarType)
  const best = new Map<ModeName, Peak>()
  for (const p of peaks) {
    const m = modeMap.get(p.id)
    if (m === undefined || m === 'unknown') continue
    const existing = best.get(m)
    if (!existing || p.magnitude > existing.magnitude) best.set(m, p)
  }
  return best
}

/** The peak resolved for a given mode (mirrors TapToneAnalyzer.getPeak(for:)). */
export function getPeak(
  peaks: Peak[],
  mode: ModeName,
  guitarType: GuitarTypeName,
): Peak | undefined {
  return resolvedModePeaks(peaks, guitarType).get(mode)
}
