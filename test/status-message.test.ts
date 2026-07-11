// @parity test/status-message
// Pins the analyzer's imperative `statusMessage` field (Swift @Published TapToneAnalyzer.statusMessage /
// Python tap_tone_analyzer.status_message) to the canonical strings by DRIVING TRANSITIONS on a real
// TapToneAnalyzer and asserting the field — the way Swift/Python test it (6-TEST 3c-C4 D3). Covers the
// clipping override/restore, the device-change transient, the guitar detection-loop strings, every
// material phase string, and the EG-1 no-resonance re-tap. Also guards that the old web-only inventions
// ("Requesting microphone…", "Playing…", "Comparing…", "Microphone unavailable") are never produced.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import type { Spectrum } from '../src/dsp/guitarFFT'
import type { MaterialPeak } from '../src/dsp/gatedCapture'

const CLIP = '⚠ Input clipping — reduce mic gain'

// A synthetic gated spectrum: flat -80 dB over 0–200 Hz, with an optional single-bin bump (a resonance)
// at `peakHz`. No bump → findDominantPeak finds no candidate (the EG-1 "no resonance" case).
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
const mp = (f: number): MaterialPeak => ({ frequency: f, magnitude: -40, quality: 8, bandwidth: 2 })

/** A minimal device stand-in — the analyzer only needs playingFile + activeCalibration + no-op session/arm
 *  hooks (armMaterial etc. re-arm the real device; here they do nothing). */
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

describe('statusMessage — initial + clipping override/restore', () => {
  it('starts at the canonical initial message (NOT "Requesting microphone…")', () => {
    expect(new TapToneAnalyzer().statusMessage).toBe('Tap the guitar to begin')
  })

  it('clipping overrides the display and restores the latest real status when it clears', () => {
    const a = new TapToneAnalyzer()
    a.setEngineState('listening') // → "Tap the guitar..."
    expect(a.statusMessage).toBe('Tap the guitar...')
    a.setClipping(true)
    expect(a.statusMessage).toBe(CLIP)
    // A real write while clipping stays PINNED to the warning, but is stashed for restore.
    a.setNumberOfTaps(3)
    a.setEngineState('listening') // real write "Tap the guitar 3 times..."
    expect(a.statusMessage).toBe(CLIP)
    a.setClipping(false)
    expect(a.statusMessage).toBe('Tap the guitar 3 times...')
  })
})

describe('statusMessage — device change (route change transient)', () => {
  it('shows reinitializing, then restores the resting prompt', () => {
    const a = new TapToneAnalyzer()
    a.setEngineState('listening')
    a.handleDeviceChange(true)
    expect(a.statusMessage).toBe('Audio device changed - reinitializing...')
    a.handleDeviceChange(false)
    expect(a.statusMessage).toBe('Tap the guitar...')
  })
})

describe('statusMessage — guitar detection-loop strings', () => {
  it('single- and multi-tap resting prompt', () => {
    const a = new TapToneAnalyzer()
    a.setEngineState('listening')
    expect(a.statusMessage).toBe('Tap the guitar...')
    a.setNumberOfTaps(3) // armed + waiting → prompt refreshes to the count
    expect(a.statusMessage).toBe('Tap the guitar 3 times...')
  })

  it('capturing (provisional) and between-taps strings', () => {
    const a = new TapToneAnalyzer()
    a.setNumberOfTaps(3)
    a.setCurrentTapCount(0)
    a.setEngineState('capturing')
    expect(a.statusMessage).toBe('Tap 1/3 capturing...')
    a.setCurrentTapCount(1)
    a.setEngineState('listening')
    expect(a.statusMessage).toBe('Tap 1/3 captured. Tap again...')
    a.setCurrentTapCount(2)
    a.setEngineState('capturing') // last tap → provisional says processing
    expect(a.statusMessage).toBe('All taps captured. Processing...')
  })

  it('paused, then resume restores the resting prompt', () => {
    const a = new TapToneAnalyzer()
    a.setEngineState('listening')
    a.setEngineState('paused')
    expect(a.statusMessage).toBe('Detection paused – tap freely, then resume')
    a.setEngineState('listening') // resume
    expect(a.statusMessage).toBe('Tap the guitar...')
  })

  it('completion string is set once at completion, FROZEN across Peak-Min recalcs (Swift/Python)', () => {
    const a = new TapToneAnalyzer()
    a.capturedTaps = [
      { magnitudes: [], frequencies: [], captureTime: 0 },
      { magnitudes: [], frequencies: [], captureTime: 0 },
    ]
    a.frozenMagnitudes = spectrum(60).magnitudesDb // a peak at 60 Hz (-40 dB)
    a.frozenFrequencies = spectrum(60).frequencies
    a.isMeasurementComplete = true
    const recalc = (peakMin: number) =>
      a.recalculatePeaks({ material: false, loadedPeaks: null, liveSpectrum: null, guitarType: 'generic', minHz: 0, maxHz: 20000, peakMin })
    recalc(-100)
    const announced = a.statusMessage
    expect(announced).toMatch(/^Analysis complete! \d+ peaks identified \(from 2 averaged taps\)\.$/)
    // A Peak-Min slider move recomputes peaks but must NOT re-announce (canonical freezes N at completion).
    recalc(-30)
    expect(a.statusMessage).toBe(announced)
  })

  it('a loaded measurement shows the frozen-loaded prompt (even after a prior fresh capture)', () => {
    const a = new TapToneAnalyzer()
    // Simulate a prior completed fresh capture leaving capturedTaps populated + announced.
    a.capturedTaps = [{ magnitudes: [], frequencies: [], captureTime: 0 }]
    a.isMeasurementComplete = true
    a.loadMeasurement({ magnitudes: [1, 2], frequencies: [1, 2] })
    expect(a.statusMessage).toBe('Loaded measurement (frozen). Press ‘New Tap’ to start a new measurement.')
    // A recalc on the loaded measurement must NOT flip it to "Analysis complete" (capturedTaps cleared).
    a.recalculatePeaks({ material: false, loadedPeaks: [], liveSpectrum: null, guitarType: 'generic', minHz: 0, maxHz: 20000, peakMin: -100 })
    expect(a.statusMessage).toBe('Loaded measurement (frozen). Press ‘New Tap’ to start a new measurement.')
  })
})

describe('statusMessage — material phase strings', () => {
  it('capturingL rests at the tap prompt (NOT "Ready for L tap")', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.startMaterial(false)
    expect(a.statusMessage).toBe('Tap the guitar...')
  })

  it('Accept L → "Rotate 90° and tap for C"; Accept C (FLC) → "Set up for FLC tap, then tap"', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.measureFlc = true
    a.setDevice(fakeDevice())
    a.materialTapPhase = 'reviewingL'
    a.acceptMaterial()
    expect(a.materialTapPhase).toBe('capturingC')
    expect(a.statusMessage).toBe('Rotate 90° and tap for C')
    a.materialTapPhase = 'reviewingC'
    a.acceptMaterial()
    expect(a.materialTapPhase).toBe('waitingForFlcTap')
    expect(a.statusMessage).toBe('Set up for FLC tap, then tap')
  })

  it('Redo re-arms the phase with the "— tap again" prompt', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setDevice(fakeDevice())
    a.materialTapPhase = 'reviewingC'
    a.redoMaterial()
    expect(a.materialTapPhase).toBe('capturingC')
    expect(a.statusMessage).toBe('Ready for C tap — tap again')
  })

  it('plate (L,C only) complete lists fL/fC; plate+FLC completes generically', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setDevice(fakeDevice())
    a.matPeaks = { longitudinal: mp(100), cross: mp(200), flc: null }
    a.materialTapPhase = 'reviewingC'
    a.acceptMaterial() // no FLC → complete
    expect(a.statusMessage).toBe('Complete — fL: 100.0 Hz, fC: 200.0 Hz')

    const b = new TapToneAnalyzer()
    b.measurementType = 'plate'
    b.measureFlc = true
    b.setDevice(fakeDevice())
    b.materialTapPhase = 'reviewingFlc'
    b.acceptMaterial()
    expect(b.statusMessage).toBe('Complete - check Results')
  })
})

describe('statusMessage — material per-tap flow (recordMaterialTap, Option C)', () => {
  it('multi-tap progress then review (valid resonances)', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setNumberOfTaps(3)
    a.setDevice(fakeDevice())
    a.startMaterial(false)
    a.recordMaterialTap(spectrum(60)) // fL bump in 20–100 Hz
    expect(a.statusMessage).toBe('L tap 1/3 captured. Tap again...')
    a.recordMaterialTap(spectrum(60))
    expect(a.statusMessage).toBe('L tap 2/3 captured. Tap again...')
    a.recordMaterialTap(spectrum(60)) // 3/3 → phase complete → review
    expect(a.materialTapPhase).toBe('reviewingL')
    expect(a.statusMessage).toMatch(/^fL: \d+\.\d Hz — Accept to continue or Redo to re-tap$/)
  })

  it('EG-1: a tap with no in-band resonance re-arms the same phase without counting', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setNumberOfTaps(1)
    a.setDevice(fakeDevice())
    a.startMaterial(false)
    a.recordMaterialTap(spectrum(null)) // flat → no dominant peak
    expect(a.statusMessage).toBe('No resonance detected — tap again')
    expect(a.materialTapPhase).toBe('capturingL') // did NOT advance
    expect(a.currentTapCount).toBe(0) // did NOT count
  })

  it('file playback auto-advances L→C with the "File:" transition string', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setNumberOfTaps(1)
    a.setDevice(fakeDevice(true)) // playingFile = true
    a.startMaterial(false)
    a.recordMaterialTap(spectrum(60)) // 1/1 → phase complete → auto-advance (playing)
    expect(a.materialTapPhase).toBe('capturingC')
    expect(a.statusMessage).toBe('File: L complete, capturing C...')
  })
})

describe('statusMessage — removed web-only inventions are never produced', () => {
  it('none of the sweep states yield a removed string', () => {
    const seen: string[] = []
    const a = new TapToneAnalyzer()
    a.setEngineState('listening')
    seen.push(a.statusMessage)
    a.loadMeasurement({ magnitudes: [1, 2], frequencies: [1, 2] })
    seen.push(a.statusMessage)
    const b = new TapToneAnalyzer()
    b.measurementType = 'brace'
    b.setDevice(fakeDevice())
    b.setNumberOfTaps(1)
    b.startMaterial(false)
    seen.push(b.statusMessage)
    b.recordMaterialTap(spectrum(150)) // brace L range 100–1200 → complete
    seen.push(b.statusMessage)
    for (const out of seen) {
      expect(out).not.toMatch(/Requesting microphone|Comparing|Tap comparison|Microphone unavailable|Playing|Cancelled/)
    }
    expect(seen[3]).toBe('Complete - check Results') // brace completes generically
  })
})