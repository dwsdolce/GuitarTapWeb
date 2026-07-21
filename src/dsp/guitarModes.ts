/**
 * Guitar resonance mode bands per guitar type, mirroring Swift `GuitarType.modeRanges`
 * (`GuitarType.swift`). Inclusive Hz ranges. Bands overlap by design (Top vs Back
 * especially); the context-aware claimer in
 * `findPeaks` / `classifyAll` resolves the overlaps.
 */
// @parity dsp/guitar-modes

/** Guitar type selecting a set of mode bands. Mirrors Swift `GuitarType`. */
export type GuitarTypeName = 'generic' | 'classical' | 'flamenco' | 'acoustic'

/** The resonance mode names, low→high, shared by every guitar type. */
export const MODE_NAMES = ['air', 'top', 'back', 'dipole', 'ring', 'upper'] as const
/** One of the {@link MODE_NAMES}. */
export type ModeName = (typeof MODE_NAMES)[number]

/**
 * A named, inclusive `[lo, hi]` Hz band for one resonance mode.
 *
 * **Bands overlap, by design.** Top and Back overlap on every guitar type — 40 Hz on
 * classical, 50 on flamenco, 80 on generic — because a real instrument's top and back
 * resonances are not separable by frequency alone. A single frequency can therefore fall
 * in more than one band, and no code may assume otherwise.
 *
 * Resolving that ambiguity is `classifyAll`'s job: it claims the strongest peak per mode
 * in ascending range order and constrains Back to sit above the claimed Top. Detection
 * must not consult these bands at all — a detector that iterates them visits overlap bins
 * more than once, which is what produced the duplicate-peak defect
 * (Development/PEAK-FINDING-DUPLICATE-PEAKS.md).
 *
 * The values are approximations; `generic` deliberately spans them all and is the more
 * useful setting in practice.
 */
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
    // Modern flamenco tops are built closer to classical, so the top band reaches 220 and
    // overlaps the back band on 200–220. The back still sits above the top, as on every type.
    { name: 'top', lo: 180, hi: 220 },
    { name: 'back', lo: 200, hi: 250 },
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

/**
 * True when `freq` falls within any named mode band for `guitarType`.
 *
 * Use this to filter peaks by visibility (the "hide unknown modes" setting) instead of
 * classifying and comparing against `'unknown'`. It avoids any ambiguity around the overlap
 * zone: a frequency in the Top/Back overlap is always "known" regardless of which mode
 * `classifyAll` ultimately assigns it to.
 *
 * Mirrors Swift `GuitarMode.isKnown(frequency:guitarType:)` and Python `GuitarMode.is_known`.
 */
export function isKnown(freq: number, guitarType: GuitarTypeName): boolean {
  return RANGES[guitarType].some((b) => freq >= b.lo && freq <= b.hi)
}

/**
 * The peaks the chart draws a **dot** for: every peak inside the visible frequency range,
 * **independent of annotation-visibility mode and of peak selection**.
 *
 * This is the "dot list" (the always-visible layer), deliberately NOT the annotation list:
 * the annotation set narrows by all/selected/none and drives the badges, while every peak in
 * range keeps its dot regardless. Gating dots on the annotation mode is a bug — it shipped
 * here once, with dots following the selection — which is why this rule now carries a paired
 * 3-platform test (`@parity view/dot-layer`).
 *
 * The unknown-mode filter uses {@link isKnown} (*frequency falls in a band*) rather than the
 * mode assigned by `classifyAll`. The two agree for auto-classified peaks — `classifyAll`
 * gives every in-band peak a band mode — and differ only under a user override; the
 * positional test is the one that belongs on a chart layer.
 *
 * Callers pass the **display/viewport** range, which follows pan and zoom — not the analysis
 * range used by peak detection.
 *
 * Mirrors Swift `GuitarMode.peaksInDisplayRange(...)` / Python `GuitarMode.peaks_in_display_range(...)`.
 */
export function peaksInDisplayRange<T extends { frequency: number }>(
  peaks: readonly T[],
  minFreq: number,
  maxFreq: number,
  isGuitar: boolean,
  showUnknownModes: boolean,
  guitarType: GuitarTypeName,
): T[] {
  const inRange = peaks.filter((p) => p.frequency >= minFreq && p.frequency <= maxFreq)
  if (!isGuitar || showUnknownModes) return inRange
  return inRange.filter((p) => isKnown(p.frequency, guitarType))
}
