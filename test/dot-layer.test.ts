// @parity view/dot-layer
//
// Web side of the dot-layer parity group (Swift DotLayerTests.swift DL1–DL7, Python
// test_dot_layer.py). Pins the CHART DOT LIST rule — `peaksInDisplayRange`, the rule behind
// Swift `SpectrumView.allPeaksInRange` and the Python scatter update.
//
// Why this suite exists: the dot list and the annotation list are DIFFERENT sets, and
// conflating them is a bug that shipped HERE — with annotation mode = selected the web dotted
// only the chosen peaks, where Swift/Python dot every peak in range. Swift and Python were
// correct but nothing pinned the rule, so the drift was invisible.
//
//   dot list        = every peak in the visible frequency range   (annotation-independent)
//   annotation list = narrowed by all/selected/none               (badges + report summary)
//
// DL7 additionally pins the distinction that this port got wrong a second way: the dot list is
// POSITIONAL (`isKnown` — frequency falls in a band), not the assigned-mode filter the Results
// panel uses. Before the fix the web filtered dots by assigned mode and DL7 would fail.

import { describe, it, expect } from 'vitest'
import { peaksInDisplayRange, isKnown } from '../src/dsp/guitarModes'
import { buildGuitarMarkers } from '../src/presentation/measurementImage'
import type { Peak } from '../src/dsp/peaks'
import type { ResolvedMode } from '../src/dsp/classify'

// ---------------------------------------------------------------------------
// Fixture — generic guitar bands (guitarModes RANGES.generic):
// air 70–135, top 140–260, back 180–300, dipole 310–460, ring 580–880, upper 880+.
// A display range of 75–350 Hz therefore gives us, deliberately:
//
//    60 Hz — BELOW the range                       → excluded by range
//    75 Hz — exactly the low edge, in air          → included (boundary)
//   100 Hz — in air                                → known, included
//   200 Hz — in top/back                           → known, included
//   305 Hz — IN range but in NO band (300<305<310) → the "unknown frequency" case
//   350 Hz — exactly the high edge, in dipole      → included (boundary)
//   400 Hz — in dipole but ABOVE the range         → excluded (range beats known)
// ---------------------------------------------------------------------------

const MIN_HZ = 75
const MAX_HZ = 350

let nextId = 1
const peak = (frequency: number, magnitude = -30): Peak => ({
  id: nextId++,
  frequency,
  magnitude,
  quality: 10,
  bandwidth: frequency / 10,
})

const dots = (peaks: Peak[], isGuitar = true, showUnknown = false): number[] =>
  peaksInDisplayRange(peaks, MIN_HZ, MAX_HZ, isGuitar, showUnknown, 'generic').map((p) => p.frequency)

// ---------------------------------------------------------------------------

describe('dot layer — range filtering (DL1–DL2)', () => {
  it('DL1 — excludes out-of-range peaks, even ones inside a named band', () => {
    // 400 Hz IS in the dipole band; range still wins.
    expect(dots([peak(60), peak(100), peak(200), peak(400)])).toEqual([100, 200])
  })

  it('DL2 — range bounds are inclusive on both edges', () => {
    expect(dots([peak(MIN_HZ), peak(200), peak(MAX_HZ)])).toEqual([75, 200, 350])
  })
})

describe('dot layer — unknown-mode filtering (DL3–DL5)', () => {
  it('DL3 — hides an in-range peak that falls in no band when unknown modes are off', () => {
    expect(dots([peak(100), peak(305), peak(200)], true, false)).toEqual([100, 200])
  })

  it('DL4 — keeps it when the user asks to see unknown modes', () => {
    expect(dots([peak(100), peak(305), peak(200)], true, true)).toEqual([100, 305, 200])
  })

  it('DL5 — material has no mode bands, so the unknown filter never applies', () => {
    expect(dots([peak(100), peak(305)], false, false)).toEqual([100, 305])
  })
})

describe('dot layer — the dot list is NOT the annotation list (DL6–DL7)', () => {
  it('DL6 — the dot list is identical under every annotation mode and selection', () => {
    const p1 = peak(100), p2 = peak(200), p3 = peak(250)
    const peaks = [p1, p2, p3]
    const modes = new Map<number, ResolvedMode>([[p1.id, 'air'], [p2.id, 'top'], [p3.id, 'back']])
    const selected = new Set<number>([p2.id]) // only ONE peak selected
    const expected = [100, 200, 250]

    for (const mode of ['all', 'selected', 'none'] as const) {
      // The dot rule takes no annotation input at all — that IS the invariant.
      expect(dots(peaks), `dot list must not change with annotation mode ${mode}`).toEqual(expected)
    }

    // …while the annotation set genuinely does vary. If this half ever stops varying, the
    // assertions above have become vacuous.
    const annotatedCount = (mode: 'all' | 'selected' | 'none') =>
      buildGuitarMarkers(peaks, modes, selected, new Map(), mode, undefined).filter((m) => m.annotated).length

    expect(annotatedCount('all')).toBe(3)
    expect(annotatedCount('selected')).toBe(1)
    expect(annotatedCount('none')).toBe(0)
  })

  it('DL7 — the dot list is positional (isKnown), not the assigned mode', () => {
    // A peak at 200 Hz sits squarely in top/back, but carries a freeform mode override, so its
    // ASSIGNED mode resolves to 'unknown'. Swift/Python still dot it; the web used to drop it
    // because it filtered dots by assigned mode.
    const p = peak(200)
    const assignedModes = new Map<number, ResolvedMode>([[p.id, 'unknown']])

    // The assigned-mode filter (what the Results panel uses) would drop it…
    const byAssignedMode = [p].filter((q) => (assignedModes.get(q.id) ?? 'unknown') !== 'unknown')
    expect(byAssignedMode).toEqual([])

    // …but the positional rule keeps it, because 200 Hz is in a band.
    expect(isKnown(200, 'generic')).toBe(true)
    expect(dots([p])).toEqual([200])
  })
})