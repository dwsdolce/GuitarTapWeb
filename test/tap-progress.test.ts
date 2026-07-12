// @parity test/tap-progress
// Pins `totalPlateTaps` + `tapProgress` + the CUMULATIVE material `currentTapCount` — the values the
// status-bar tap/phase progress bar renders (Swift `ProgressView(value: tap.tapProgress)`).
//
// Why this suite exists: the web's material `currentTapCount` used to RESET at every phase advance,
// while Swift/Python count CUMULATIVELY across L→C→FLC. The status text agreed by coincidence (the web
// printed its per-phase count directly; Swift subtracts the completed phases from its cumulative one),
// so nothing caught it — until the progress bar was added, where the web's bar would have refilled 0→100%
// on EVERY phase instead of filling once across the whole sequence. These tests pin the canonical model:
//   totalPlateTaps = numberOfTaps × (brace ? 1 : measureFlc ? 3 : 2)      [Swift TapDetection:360]
//   tapProgress    = min(1, currentTapCount / (guitar ? numberOfTaps : totalPlateTaps))
//   currentTapCount (material) is CUMULATIVE, and rebases to the prior phases' taps on Accept/Redo
//                                                                        [Swift Control:465-487]
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import type { Spectrum } from '../src/dsp/guitarFFT'

/** Flat -80 dB over 0–200 Hz with a single-bin resonance at `peakHz` (null → no detectable peak). */
function spectrum(peakHz: number | null): Spectrum {
  const frequencies = Array.from({ length: 201 }, (_, i) => i)
  const magnitudesDb = frequencies.map(() => -80)
  if (peakHz != null) {
    magnitudesDb[peakHz] = -40
    magnitudesDb[peakHz - 1] = -55
    magnitudesDb[peakHz + 1] = -55
  }
  return { magnitudesDb, frequencies }
}

function fakeDevice(playingFile = false): RealtimeFFTAnalyzer {
  return {
    playingFile,
    activeCalibration: null,
    armMaterial() {},
    checkpointSession() {},
    redoSession() {},
    startSessionRecording() {},
    finishSessionRecording() {},
    cancelSessionRecording() {},
  } as unknown as RealtimeFFTAnalyzer
}

/** An armed plate/brace analyzer with `taps` taps per phase. */
function material(type: 'plate' | 'brace', taps: number, flc = false): TapToneAnalyzer {
  const a = new TapToneAnalyzer()
  a.measurementType = type
  a.measureFlc = flc
  a.setNumberOfTaps(taps)
  a.setDevice(fakeDevice())
  a.startMaterial(false)
  return a
}

// Phase peaks that land inside each search band (plate L 20–100, C 40–220, FLC 15–100; brace 100–1200).
const L_TAP = () => spectrum(60)
const C_TAP = () => spectrum(150)
const FLC_TAP = () => spectrum(60)
const BRACE_TAP = () => spectrum(150)

describe('totalPlateTaps — taps expected across ALL phases (Swift TapDetection:360)', () => {
  it('brace = numberOfTaps (longitudinal only)', () => {
    expect(material('brace', 3).totalPlateTaps).toBe(3)
  })

  it('plate without FLC = numberOfTaps × 2 (L + C)', () => {
    expect(material('plate', 3, false).totalPlateTaps).toBe(6)
  })

  it('plate with FLC = numberOfTaps × 3 (L + C + FLC)', () => {
    expect(material('plate', 3, true).totalPlateTaps).toBe(9)
  })
})

describe('tapProgress — guitar divides by numberOfTaps', () => {
  it('advances 0 → 1/4 → 2/4 as taps are captured, clamped at 1', () => {
    const a = new TapToneAnalyzer()
    a.setNumberOfTaps(4)
    a.startTapSequence()
    a.beginGuitarAccumulation()
    expect(a.tapProgress).toBe(0)

    a.recordGuitarTap(spectrum(100))
    expect(a.currentTapCount).toBe(1)
    expect(a.tapProgress).toBeCloseTo(0.25, 6)

    a.recordGuitarTap(spectrum(100))
    expect(a.tapProgress).toBeCloseTo(0.5, 6)
  })
})

describe('material currentTapCount is CUMULATIVE across phases (Swift), not per-phase', () => {
  it('plate + FLC, 2 taps/phase: the count accrues 0→6 across L→C→FLC and the bar fills ONCE', () => {
    const a = material('plate', 2, true) // totalPlateTaps = 6
    expect(a.totalPlateTaps).toBe(6)
    expect(a.currentTapCount).toBe(0)
    expect(a.tapProgress).toBe(0)

    // ── L phase ──────────────────────────────────────────────────────────────
    a.recordMaterialTap(L_TAP())
    expect(a.currentTapCount).toBe(1)
    expect(a.tapProgress).toBeCloseTo(1 / 6, 6)

    a.recordMaterialTap(L_TAP()) // 2/2 → L complete → review
    expect(a.materialTapPhase).toBe('reviewingL')
    expect(a.currentTapCount).toBe(2) // NOT reset — L's taps stay counted
    expect(a.tapProgress).toBeCloseTo(2 / 6, 6)

    // ── Accept → C phase: the count rebases to L's total, it does NOT drop to 0 ──
    a.acceptMaterial()
    expect(a.materialTapPhase).toBe('capturingC')
    expect(a.currentTapCount).toBe(2)
    expect(a.tapProgress).toBeCloseTo(2 / 6, 6)

    a.recordMaterialTap(C_TAP())
    expect(a.currentTapCount).toBe(3) // 2 (L) + 1 (C)
    expect(a.tapProgress).toBeCloseTo(3 / 6, 6)

    a.recordMaterialTap(C_TAP()) // 2/2 → C complete
    expect(a.materialTapPhase).toBe('reviewingC')
    expect(a.currentTapCount).toBe(4)
    expect(a.tapProgress).toBeCloseTo(4 / 6, 6)

    // ── Accept → FLC (via the disarmed waitingForFlcTap cooldown) ────────────
    a.acceptMaterial()
    expect(a.materialTapPhase).toBe('waitingForFlcTap')
    expect(a.currentTapCount).toBe(4) // L+C stay counted through the cooldown
    expect(a.tapProgress).toBeCloseTo(4 / 6, 6)
  })

  it('brace (single phase): cumulative == within-phase, bar fills 0→1 over its taps', () => {
    const a = material('brace', 2) // totalPlateTaps = 2
    a.recordMaterialTap(BRACE_TAP())
    expect(a.currentTapCount).toBe(1)
    expect(a.tapProgress).toBeCloseTo(0.5, 6)

    a.recordMaterialTap(BRACE_TAP()) // completes the brace measurement
    expect(a.currentTapCount).toBe(2)
    expect(a.tapProgress).toBe(1)
    expect(a.isMeasurementComplete).toBe(true)
  })

  it('tapProgress never exceeds 1', () => {
    const a = material('brace', 1)
    a.recordMaterialTap(BRACE_TAP())
    a.setNumberOfTaps(1)
    expect(a.tapProgress).toBeLessThanOrEqual(1)
  })
})

describe('Redo rebases the count to the PRIOR phases (Swift Control:465-487)', () => {
  it('redo C keeps L’s taps counted (currentTapCount = numberOfTaps, not 0)', () => {
    const a = material('plate', 2, true)
    a.recordMaterialTap(L_TAP())
    a.recordMaterialTap(L_TAP()) // L done → reviewingL
    a.acceptMaterial() // → capturingC
    a.recordMaterialTap(C_TAP())
    a.recordMaterialTap(C_TAP()) // C done → reviewingC
    expect(a.currentTapCount).toBe(4)

    a.redoMaterial() // re-tap C
    expect(a.materialTapPhase).toBe('capturingC')
    expect(a.currentTapCount).toBe(2) // Swift: `currentTapCount = lCount`
    expect(a.tapProgress).toBeCloseTo(2 / 6, 6)
  })

  it('redo FLC keeps L+C counted (currentTapCount = numberOfTaps × 2)', () => {
    const a = material('plate', 2, true)
    a.recordMaterialTap(L_TAP())
    a.recordMaterialTap(L_TAP())
    a.acceptMaterial()
    a.recordMaterialTap(C_TAP())
    a.recordMaterialTap(C_TAP())
    a.acceptMaterial() // → waitingForFlcTap
    a.materialTapPhase = 'capturingFlc' // skip the cooldown timer
    a.recordMaterialTap(FLC_TAP())
    a.recordMaterialTap(FLC_TAP()) // FLC done → reviewingFlc
    expect(a.currentTapCount).toBe(6)
    expect(a.tapProgress).toBe(1)

    a.redoMaterial() // re-tap FLC
    expect(a.materialTapPhase).toBe('capturingFlc')
    expect(a.currentTapCount).toBe(4) // Swift: `currentTapCount = lcCount`
    expect(a.tapProgress).toBeCloseTo(4 / 6, 6)
  })

  it('redo L resets to 0 (nothing precedes it)', () => {
    const a = material('plate', 2, true)
    a.recordMaterialTap(L_TAP())
    a.recordMaterialTap(L_TAP()) // → reviewingL
    expect(a.currentTapCount).toBe(2)

    a.redoMaterial()
    expect(a.materialTapPhase).toBe('capturingL')
    expect(a.currentTapCount).toBe(0)
    expect(a.tapProgress).toBe(0)
  })
})