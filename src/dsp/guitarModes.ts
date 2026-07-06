/**
 * Guitar resonance mode bands per guitar type, mirroring Swift `GuitarType.modeRanges`
 * (`GuitarType.swift`) — see `Development/INVENTORY.md` "Mode Classification". Inclusive Hz
 * ranges. Bands overlap by design (Top vs Back especially); the context-aware claimer in
 * `findPeaks` / `classifyAll` resolves the overlaps.
 */
// @parity dsp/guitar-modes

/** Guitar type selecting a set of mode bands. Mirrors Swift `GuitarType`. */
export type GuitarTypeName = 'generic' | 'classical' | 'flamenco' | 'acoustic'

/** The resonance mode names, low→high, shared by every guitar type. */
export const MODE_NAMES = ['air', 'top', 'back', 'dipole', 'ring', 'upper'] as const
/** One of the {@link MODE_NAMES}. */
export type ModeName = (typeof MODE_NAMES)[number]

/** A named, inclusive `[lo, hi]` Hz band for one resonance mode. */
export interface ModeBand {
  name: ModeName
  /** Low edge, inclusive, in Hz. */
  lo: number
  /** High edge, inclusive, in Hz. */
  hi: number
}

const RANGES: Record<GuitarTypeName, ModeBand[]> = {
  classical: [
    { name: 'air', lo: 80, hi: 110 },
    { name: 'top', lo: 170, hi: 230 },
    { name: 'back', lo: 190, hi: 280 },
    { name: 'dipole', lo: 330, hi: 430 },
    { name: 'ring', lo: 580, hi: 820 },
    { name: 'upper', lo: 820, hi: 20000 },
  ],
  flamenco: [
    { name: 'air', lo: 85, hi: 115 },
    { name: 'top', lo: 190, hi: 250 },
    { name: 'back', lo: 180, hi: 240 },
    { name: 'dipole', lo: 350, hi: 450 },
    { name: 'ring', lo: 600, hi: 850 },
    { name: 'upper', lo: 850, hi: 20000 },
  ],
  acoustic: [
    { name: 'air', lo: 90, hi: 120 },
    { name: 'top', lo: 150, hi: 210 },
    { name: 'back', lo: 210, hi: 290 },
    { name: 'dipole', lo: 360, hi: 460 },
    { name: 'ring', lo: 620, hi: 880 },
    { name: 'upper', lo: 880, hi: 20000 },
  ],
  generic: [
    { name: 'air', lo: 70, hi: 135 },
    { name: 'top', lo: 140, hi: 260 },
    { name: 'back', lo: 180, hi: 300 },
    { name: 'dipole', lo: 310, hi: 460 },
    { name: 'ring', lo: 580, hi: 880 },
    { name: 'upper', lo: 880, hi: 20000 },
  ],
}

/** Mode bands for a guitar type (copy; safe to sort). */
export function modeBands(type: GuitarTypeName): ModeBand[] {
  return RANGES[type].map((b) => ({ ...b }))
}
