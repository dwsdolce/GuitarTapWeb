// @parity test/tap-progress
// Pins `totalPlateTaps` + `tapProgress` + the CUMULATIVE material `currentTapCount` — the values the
// status-bar tap/phase progress bar renders (Swift `ProgressView(value: tap.tapProgress)`).
//
// Why this suite exists: the web's material `currentTapCount` used to RESET at every phase advance,
// while Swift/Python count CUMULATIVELY across L→C→FLC. The status text agreed by coincidence (the web
// printed its per-phase count directly; Swift subtracts the completed phases from its cumulative one),
// so nothing caught it — until the progress bar was added, where the web's bar would have refilled 0→100%
// on EVERY phase instead of filling once across the whole sequence. These tests pin the canonical model:
//   totalPlateTaps = numberOfTaps × (brace ? 1 : measureFlc ? 3 : 2)      [Swift `totalPlateTaps`]
//   tapProgress    = min(1, currentTapCount / (guitar ? numberOfTaps : totalPlateTaps))
//   currentTapCount (material) is CUMULATIVE, and rebases to the prior phases' taps on Redo
//                                                                        [Swift `redoCurrentPhase`]
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { TapToneMeasurementModel } from '../src/measurement/types'
import { advanceAudio } from './audioClockFeed'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'

/** A decaying tone — a tap's ring-out — at 48 kHz. */
function decayingTone(hz: number, count: number): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = 0.5 * Math.exp((-i / 48000) * 6) * Math.sin((2 * Math.PI * hz * i) / 48000)
  return out
}

/** An armed plate/brace analyzer with `taps` taps per phase, armed as the app arms it. No device: the
 *  analyzer's gated transform then runs on an uncalibrated engine, which is the bare transform. (A fake
 *  device used to stand here, faking eight engine methods that no longer exist — #17 F51.) */
function material(type: 'plate' | 'brace', taps: number, flc = false): TapToneAnalyzer {
  const a = new TapToneAnalyzer()
  a.measurementType = type
  a.measureFlc = flc
  a.setNumberOfTaps(taps)
  a.startTapSequence()
  return a
}

// Real taps through the capture finish, at frequencies inside each search band (plate L 20–100, C 40–220,
// FLC 15–100; brace 100–1200). Each case reaches its state through them, never by setting it (#17 F51).
const MATERIAL_TAP = 24_000 // a 0.5 s capture at 48 kHz
const tapL = (a: TapToneAnalyzer) => a.finishGatedFFTCapture(decayingTone(60, MATERIAL_TAP), 48000, 'capturingL')
const tapC = (a: TapToneAnalyzer) => a.finishGatedFFTCapture(decayingTone(150, MATERIAL_TAP), 48000, 'capturingC')
const tapFlc = (a: TapToneAnalyzer) => a.finishGatedFFTCapture(decayingTone(60, MATERIAL_TAP), 48000, 'capturingFlc')
const tapBrace = (a: TapToneAnalyzer) => a.finishGatedFFTCapture(decayingTone(150, MATERIAL_TAP), 48000, 'capturingL')

describe('totalPlateTaps — taps expected across ALL phases', () => {
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

describe('tapProgress — the fraction the bar renders', () => {
  // A guitar measurement's bar advances by numberOfTaps, through the real capture finish — the place
  // progress is decided. (This used to record spectra one level below it; the material denominator is
  // asserted by the cumulative case below, and the clamp is unreachable in production — #17 F51.)
  // Mirrors Swift guitarProgressAdvancesByNumberOfTaps and Python test_guitar_progress_advances_by_number_of_taps.
  it('guitar progress advances by numberOfTaps as taps are captured', () => {
    const a = new TapToneAnalyzer()
    a.setNumberOfTaps(4)
    a.startTapSequence()
    expect(a.tapProgress).toBe(0)

    const tap = decayingTone(100, GUITAR_FFT_SIZE)
    a.finishGuitarGatedCapture(tap, 48000)
    expect(a.tapProgress).toBeCloseTo(0.25, 6)
    a.finishGuitarGatedCapture(tap, 48000)
    expect(a.tapProgress).toBeCloseTo(0.5, 6)
    a.finishGuitarGatedCapture(tap, 48000)
    expect(a.tapProgress).toBeCloseTo(0.75, 6)
  })

  // A new sequence starts its bar at 0 — a finished measurement's full bar does not carry into it.
  // Mirrors Swift newSequenceResetsTheBar.
  it('a new sequence resets the bar', () => {
    const a = new TapToneAnalyzer()
    a.setNumberOfTaps(1)
    a.startTapSequence()
    a.finishGuitarGatedCapture(decayingTone(100, GUITAR_FFT_SIZE), 48000)
    advanceAudio(a, a.captureWindow) // complete
    expect(a.isMeasurementComplete).toBe(true)
    expect(a.tapProgress).toBe(1)

    a.startTapSequence() // New Tap

    expect(a.tapProgress).toBe(0)
  })
})

describe('material currentTapCount is CUMULATIVE across phases (Swift), not per-phase', () => {
  it('plate + FLC, 2 taps/phase: the count accrues 0→6 across L→C→FLC and the bar fills ONCE', () => {
    const a = material('plate', 2, true) // totalPlateTaps = 6
    expect(a.totalPlateTaps).toBe(6)
    expect(a.currentTapCount).toBe(0)
    expect(a.tapProgress).toBe(0)

    // ── L phase ──────────────────────────────────────────────────────────────
    tapL(a)
    expect(a.currentTapCount).toBe(1)
    expect(a.tapProgress).toBeCloseTo(1 / 6, 6)

    tapL(a) // 2/2 → L complete → review
    expect(a.materialTapPhase).toBe('reviewingL')
    expect(a.currentTapCount).toBe(2) // NOT reset — L's taps stay counted
    expect(a.tapProgress).toBeCloseTo(2 / 6, 6)

    // ── Accept → C phase: the count rebases to L's total, it does NOT drop to 0 ──
    a.acceptMaterial()
    expect(a.materialTapPhase).toBe('capturingC')
    expect(a.currentTapCount).toBe(2)
    expect(a.tapProgress).toBeCloseTo(2 / 6, 6)

    tapC(a)
    expect(a.currentTapCount).toBe(3) // 2 (L) + 1 (C)
    expect(a.tapProgress).toBeCloseTo(3 / 6, 6)

    tapC(a) // 2/2 → C complete
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
    tapBrace(a)
    expect(a.currentTapCount).toBe(1)
    expect(a.tapProgress).toBeCloseTo(0.5, 6)

    tapBrace(a) // completes the brace measurement
    expect(a.currentTapCount).toBe(2)
    expect(a.tapProgress).toBe(1)
    expect(a.isMeasurementComplete).toBe(true)
  })
})

describe('Redo rebases the count to the PRIOR phases', () => {
  it('redo C keeps L’s taps counted (currentTapCount = numberOfTaps, not 0)', () => {
    const a = material('plate', 2, true)
    tapL(a)
    tapL(a) // L done → reviewingL
    a.acceptMaterial() // → capturingC
    tapC(a)
    tapC(a) // C done → reviewingC
    expect(a.currentTapCount).toBe(4)

    a.redoMaterial() // re-tap C
    expect(a.materialTapPhase).toBe('capturingC')
    expect(a.currentTapCount).toBe(2) // Swift: `currentTapCount = lCount`
    expect(a.tapProgress).toBeCloseTo(2 / 6, 6)
  })

  it('redo FLC keeps L+C counted (currentTapCount = numberOfTaps × 2)', () => {
    const a = material('plate', 2, true)
    tapL(a)
    tapL(a)
    a.acceptMaterial()
    tapC(a)
    tapC(a)
    a.acceptMaterial() // → waitingForFlcTap
    advanceAudio(a, a.tapCooldown) // the hold, in audio → capturingFlc
    expect(a.materialTapPhase).toBe('capturingFlc')
    tapFlc(a)
    tapFlc(a) // FLC done → reviewingFlc
    expect(a.currentTapCount).toBe(6)
    expect(a.tapProgress).toBe(1)

    a.redoMaterial() // re-tap FLC
    expect(a.materialTapPhase).toBe('capturingFlc')
    expect(a.currentTapCount).toBe(4) // Swift: `currentTapCount = lcCount`
    expect(a.tapProgress).toBeCloseTo(4 / 6, 6)
  })

  it('redo L resets to 0 (nothing precedes it)', () => {
    const a = material('plate', 2, true)
    tapL(a)
    tapL(a) // → reviewingL
    expect(a.currentTapCount).toBe(2)

    a.redoMaterial()
    expect(a.materialTapPhase).toBe('capturingL')
    expect(a.currentTapCount).toBe(0)
    expect(a.tapProgress).toBe(0)
  })
})

// Loading a measurement while a capture is unfinished tears it down, so the status-bar progress bar
// (shown while currentTapCount > 0) and the Analyzing indicator (isDetecting) do not linger over the
// loaded measurement. The sequence is driven for real; the load is the real loadMeasurement (these used to
// call restoreSnapshot, one step below it, and set detection to listening by hand — #17 F51). Paired with
// Swift LoadTearsDownInterruptedCaptureTests and Python TestLoadTearsDownInterruptedCapture.
describe('loadMeasurement tears down an interrupted capture', () => {
  /** A saved classical measurement to load. */
  const savedMeasurement = (): TapToneMeasurementModel => {
    const frequencies = Array.from({ length: 64 }, (_, i) => i * 31.25)
    const magnitudes = frequencies.map((_, i) => (i === 16 ? -30 : -80))
    return {
      id: 'saved',
      timestamp: '2026-09-25T00:00:00Z',
      peaks: [],
      numberOfTaps: 1,
      spectrumSnapshot: {
        frequencies, magnitudes, minFreq: 0, maxFreq: 2000, minDB: -90, maxDB: -20, isLogarithmic: false,
        measurementType: 'Classical Guitar',
      },
    }
  }

  it('a plate sequence abandoned after L+C (FLC pending) resets on load', () => {
    const a = material('plate', 2, true)
    tapL(a)
    tapL(a) // L done → reviewingL
    a.acceptMaterial() // → capturingC
    tapC(a)
    tapC(a) // C done → reviewingC
    a.acceptMaterial() // → waitingForFlcTap (FLC never captured)
    expect(a.currentTapCount).toBe(4)
    expect(a.materialTapPhase).toBe('waitingForFlcTap')

    a.loadMeasurement(savedMeasurement())

    expect(a.currentTapCount).toBe(0)
    expect(a.tapProgress).toBe(0)
    expect(a.materialTapPhase).toBe('complete')
    expect(a.isDetecting).toBe(false)
    expect(a.isMeasurementComplete).toBe(true)
  })

  it('a load while detecting stops detection', () => {
    const a = material('plate', 2, true)
    tapL(a)
    advanceAudio(a, a.tapCooldown) // the rest ends: listening for tap 2
    expect(a.isDetecting).toBe(true)
    expect(a.currentTapCount).toBe(1)

    a.loadMeasurement(savedMeasurement())

    expect(a.isDetecting).toBe(false)
    expect(a.currentTapCount).toBe(0)
    expect(a.materialTapPhase).toBe('complete')
  })
})

// ── FLC cooldown cancellation ───────────────────────────────────────────────
// Accepting fC schedules a hold, after which detection re-arms for the FLC tap. If the user
// restarts (Cancel / New Tap) before it elapses, it must not drag the fresh sequence into the FLC
// phase. Swift shipped without any protection until #17, so the re-arm fired into whatever was
// running 0.5 s later. Pinned in all three now. The hold runs on the AUDIO clock and, as in Swift and
// Python, cannot be cancelled: the phase guard in the callback is the protection (#19 — the web used
// to cancel a wall-clock timer as well).
describe('the FLC cooldown does not re-arm a restarted sequence', () => {
  it('a restart during the cooldown leaves the fresh sequence alone', () => {
    const a = material('plate', 1, true)
    tapL(a)
    a.acceptMaterial() // reviewingL -> capturingC
    tapC(a)
    expect(a.materialTapPhase).toBe('reviewingC')

    a.acceptMaterial() // -> waitingForFlcTap, schedules the re-arm
    expect(a.materialTapPhase).toBe('waitingForFlcTap')

    a.cancelTapSequence() // the user cancels before the cooldown elapses
    const phaseAfterRestart = a.materialTapPhase
    expect(phaseAfterRestart).not.toBe('waitingForFlcTap')

    advanceAudio(a, 0.8) // the hold ends, in AUDIO (#19), against the restarted sequence

    expect(a.materialTapPhase).toBe(phaseAfterRestart)
    expect(a.materialTapPhase).not.toBe('capturingFlc')
  })
})

// F34: a completed measurement's progress bar records what was MEASURED. Raising the tap count
// afterwards configures the NEXT measurement and must not rewrite the finished one — tapProgress is
// stored at each count change, as Swift and Python store it, not derived at render time.
describe('TapProgress — a later count change does not rewrite a finished measurement', () => {
  // The measurement is completed for real: one tap through the finish, then the capture window's audio.
  // (This set the count by hand and never completed — #17 F51.) Mirrors Swift
  // completeMeasurement_keepsFullBar_whenTapCountRaised.
  it('a complete 1-tap measurement keeps a full bar when Taps is raised to 3', () => {
    const a = new TapToneAnalyzer()
    a.setNumberOfTaps(1)
    a.startTapSequence()
    a.finishGuitarGatedCapture(decayingTone(100, GUITAR_FFT_SIZE), 48000)
    advanceAudio(a, a.captureWindow) // "All taps captured. Processing..." → complete
    expect(a.isMeasurementComplete).toBe(true)
    expect(a.tapProgress).toBe(1)

    a.setNumberOfTaps(3) // configures the next measurement

    expect(a.tapProgress).toBe(1)
  })
})
