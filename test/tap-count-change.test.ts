// @parity test/tap-count-change
// PC-4: changing the tap count while armed-and-waiting must immediately refresh the progress
// display so the status prompt tracks the new count (Swift does this reactively via
// numberOfTaps.didSet; the web must re-fire onProgress from setConfig). Regression for the bug
// where "3-tap brace → Generic → Taps=1" left the status bar stuck on "Tap the guitar 4 times…".
//
// This used to exercise TWO layers. The first was an ENGINE progress re-fire
// (RealtimeFFTAnalyzer.setConfig → onProgress) described in its own comment as "a web-specific
// progress-bar mechanism Swift/Python don't have" — it went with #17 F30, which moved detection and
// the tap count onto the analyzer, so there is no second mechanism left to keep in step. What
// remains is the canonical one: TapToneAnalyzer.setNumberOfTaps refreshing the prompt, mirroring
// Swift numberOfTaps.didSet, pinned identically in GuitarTapTests/TapCountChangeTests.swift and
// tests/test_tap_count_change.py.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

// The canonical, cross-platform layer: the MODEL (TapToneAnalyzer.setNumberOfTaps) refreshes the
// status prompt when the count changes while armed-and-waiting for the first tap — mirroring Swift
// numberOfTaps.didSet. Pinned identically in Swift TapCountChangeTests + Python test_tap_count_change.
// (The reduce-count-≤-captured branch is NOT pinned 3-way: it diverges — Swift defers with "All taps
// captured. Processing…", Python's set_tap_num processes synchronously. Tracked in 6-TEST 4c.)
describe('tap-count change refreshes the status prompt (model — mirrors Swift numberOfTaps.didSet)', () => {
  it('raising Taps while armed-and-waiting refreshes the prompt to the new count', () => {
    const a = new TapToneAnalyzer()
    a.startTapSequence({ arm: false }) // armed, waiting for the first tap → "Tap the guitar..."
    a.setNumberOfTaps(3)
    expect(a.statusMessage).toBe('Tap the guitar 3 times...')
  })

  it('lowering Taps while armed-and-waiting refreshes too', () => {
    const a = new TapToneAnalyzer()
    a.startTapSequence({ arm: false })
    a.setNumberOfTaps(4)
    expect(a.statusMessage).toBe('Tap the guitar 4 times...')
    a.setNumberOfTaps(1)
    expect(a.statusMessage).toBe('Tap the guitar...')
  })

  it('an idle change (not armed / a frozen result) does NOT refresh the prompt', () => {
    const a = new TapToneAnalyzer() // never armed — isDetecting false
    expect(a.statusMessage).toBe('Tap the guitar to begin')
    a.setNumberOfTaps(5)
    expect(a.statusMessage).toBe('Tap the guitar to begin')
  })
})
// OUT-5: there is deliberately NO "reduce the count mid-sequence → finalise with the taps already
// captured" branch on any platform. The Taps stepper is disabled from the first captured tap
// (`currentTapCount > 0 && !isMeasurementComplete`), so the count cannot change mid-sequence — you
// cancel first. The branch that used to exist in Swift and Python was unreachable, and being
// unreachable it had drifted three ways (Swift deferred + averaged ALL taps; Python finalised
// synchronously + TRUNCATED to the new count; the web never had it). It was removed rather than
// reconciled. These tests pin that removal: a count change with taps in hand must NOT finalise.
describe('OUT-5 — changing the count with taps captured must NOT implicitly finalise', () => {
  const spectrum = () => ({
    magnitudesDb: Array.from({ length: 64 }, () => -60),
    frequencies: Array.from({ length: 64 }, (_, i) => i * 30),
  })

  function armedWithTaps(total: number, taps: number): TapToneAnalyzer {
    const a = new TapToneAnalyzer()
    a.setNumberOfTaps(total)
    a.startTapSequence()
    a.beginGuitarAccumulation()
    for (let i = 0; i < taps; i++) a.recordGuitarTap(spectrum())
    return a
  }

  it('lowering the count TO the captured tap count does not complete the measurement', () => {
    const a = armedWithTaps(4, 2) // 2 of 4 captured
    a.setNumberOfTaps(2) // count == captured — the old Swift/Python branch would have finalised here

    expect(a.isMeasurementComplete).toBe(false)
    expect(a.isDetecting).toBe(true)
    expect(a.capturedTaps.length).toBe(2) // not truncated, not averaged away
  })

  it('lowering the count BELOW the captured tap count does not complete or truncate', () => {
    const a = armedWithTaps(4, 3)
    a.setNumberOfTaps(1) // captured (3) > new total (1)

    expect(a.isMeasurementComplete).toBe(false)
    expect(a.isDetecting).toBe(true)
    expect(a.capturedTaps.length).toBe(3) // Python used to `del captured_taps[new_num:]`
  })

  it('raising the count keeps the taps already captured', () => {
    const a = armedWithTaps(3, 2)
    a.setNumberOfTaps(5)

    expect(a.isMeasurementComplete).toBe(false)
    expect(a.capturedTaps.length).toBe(2)
    expect(a.numberOfTaps).toBe(5)
  })
})
