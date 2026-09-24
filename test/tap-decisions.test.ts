// @parity test/tap-decisions
import { describe, it, expect } from 'vitest'
import { alignCaptureToOnset } from '../src/dsp/gatedCapture'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { DEFAULT_SETTINGS } from '../src/settings'

// The four cases that used to open this file drove `findLevelCrossing` / `findAllLevelCrossings`
// — offline scanners with no production caller since 2026-07-11, deleted with them (#17 F43). They
// asserted, among other things, that the brace fixture yields 1 tap and the plate 3; REG-B1 and
// REG-P1 in file-playback.test.ts assert exactly that on exactly those fixtures, through the engine
// rather than one level under it. What is left here runs against code the app calls.
describe('G5 — tap-detection decisions', () => {
  it('onset alignment positions the transient at pre-onset (+backup)', () => {
    const buf = new Float32Array(10000)
    buf[5000] = 0.5 // a single transient after silence
    const windowSize = 4096
    const preOnset = 1000
    const out = alignCaptureToOnset(buf, windowSize, preOnset)
    let argmax = 0
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i]!) > Math.abs(out[argmax]!)) argmax = i
    expect(argmax).toBe(preOnset + 32) // onset backed up by ONSET_BACKUP_SAMPLES (32)
    expect(out[argmax]).toBeCloseTo(0.5, 6)
  })
})

const WIRING_CHUNK = 1024

/** A guitar analyzer, armed and listening, with the threshold set the way the APP sets it. */
function armedAt(thresholdDb: number): TapToneAnalyzer {
  const a = new TapToneAnalyzer()
  a.measurementType = 'classical'
  // The application's path: the slider writes settings, App mirrors settings onto the analyzer.
  a.setSettings({ ...DEFAULT_SETTINGS, tapDetectionThreshold: thresholdDb })
  a.startTapSequence({ arm: false })
  a.detectionState = 'listening'
  return a
}

/** Silence, then a tap. Feeding the quiet frames is what makes this a tap rather than a level: the
 *  hysteresis latch refuses to count while it is up, so a burst with no fall before it is ignored. */
function tap(a: TapToneAnalyzer, levelDb: number): void {
  let t = 10
  for (let i = 0; i < 2; i++) a.processAudioFrame(new Float32Array(WIRING_CHUNK), -70, (t += 0.02))
  for (let i = 0; i < 3; i++) a.processAudioFrame(new Float32Array(WIRING_CHUNK), levelDb, (t += 0.02))
}

describe('the detector uses the threshold the application configured', () => {
  it('a level BELOW the configured threshold does not start a capture', () => {
    const a = armedAt(-30)
    tap(a, -35) // below -30, but ABOVE the -40 default the analyzer ships with
    expect(a.gatedCaptureActive).toBe(false)
  })

  it('a level ABOVE the configured threshold does start a capture', () => {
    const a = armedAt(-30)
    tap(a, -25)
    expect(a.gatedCaptureActive).toBe(true)
  })

  it('raising the threshold makes a previously-detected level too quiet', () => {
    const loud = armedAt(-50)
    tap(loud, -45)
    expect(loud.gatedCaptureActive).toBe(true) // -45 clears a -50 threshold

    const strict = armedAt(-35)
    tap(strict, -45)
    expect(strict.gatedCaptureActive).toBe(false) // the same tap, now too quiet
  })
})

// The re-arm rule: what it takes for the detector to accept ANOTHER tap after one has fired.
//
// Between taps in a multi-tap sequence the detector sits LATCHED ABOVE with no capture running —
// the tap fired, its capture completed, and the level has not yet settled. Hysteresis says the
// ring-out must fall below `falling` (threshold − margin) before anything counts as a new strike;
// a decay that dips past `rising` but stays above `falling` is the SAME tap still sounding.
//
// Swift and Python enforce that with one flag: `is_above_threshold` is both the latch and the gate,
// and while it is up no counting happens at all. Web splits them — the latch is `isAboveThreshold`,
// but firing is gated by `prevAbove`, which clears as soon as the level drops below `rising`. So on
// web a ring-out that never reaches `falling` re-arms the detector, and the next rise is taken as a
// new tap. Paired with Swift T1f and Python test_T1f.
describe('the re-arm rule — a ring-out above the falling threshold is not a new tap', () => {
  it('a dip between falling and rising does not re-arm the detector', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'classical'
    a.setSettings({ ...DEFAULT_SETTINGS, tapDetectionThreshold: -40 }) // rising -40, falling -43
    a.startTapSequence({ arm: false })
    a.detectionState = 'listening'

    // The state between taps: a tap has fired and its capture has finished, so the detector is
    // latched above with nothing in flight. Reached in the app after every tap of a multi-tap run.
    const s = a as unknown as { isAboveThreshold: boolean; prevAbove: boolean; consecutive: number }
    s.isAboveThreshold = true
    s.prevAbove = true
    s.consecutive = 0

    let t = 10
    const feed = (lvl: number, n: number) => {
      for (let i = 0; i < n; i++) a.processAudioFrame(new Float32Array(WIRING_CHUNK), lvl, (t += 0.02))
    }

    feed(-42, 3) // ring-out: below rising (-40) but ABOVE falling (-43) — still the same tap
    feed(-20, 3) // the decay swings back up

    expect(a.gatedCaptureActive).toBe(false)
  })

  it('a dip BELOW the falling threshold does re-arm it (the control)', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'classical'
    a.setSettings({ ...DEFAULT_SETTINGS, tapDetectionThreshold: -40 })
    a.startTapSequence({ arm: false })
    a.detectionState = 'listening'
    const s = a as unknown as { isAboveThreshold: boolean; prevAbove: boolean; consecutive: number }
    s.isAboveThreshold = true
    s.prevAbove = true
    s.consecutive = 0

    let t = 10
    const feed = (lvl: number, n: number) => {
      for (let i = 0; i < n; i++) a.processAudioFrame(new Float32Array(WIRING_CHUNK), lvl, (t += 0.02))
    }

    feed(-60, 3) // the signal genuinely settled
    feed(-20, 3) // a real second strike

    expect(a.gatedCaptureActive).toBe(true)
  })
})
