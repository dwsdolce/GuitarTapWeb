// @parity test/tap-count-change
// PC-4: changing the tap count while armed-and-waiting must immediately refresh the progress
// display so the status prompt tracks the new count (Swift does this reactively via
// numberOfTaps.didSet; the web must re-fire onProgress from setConfig). Regression for the bug
// where "3-tap brace → Generic → Taps=1" left the status bar stuck on "Tap the guitar 4 times…".
//
// Two layers are exercised here: (1) the ENGINE progress-refire (RealtimeFFTAnalyzer.setConfig →
// onProgress) — a web-specific progress-bar mechanism Swift/Python don't have; and (2) the canonical
// MODEL status refresh (TapToneAnalyzer.setNumberOfTaps, mirroring Swift numberOfTaps.didSet), which is
// the 3-way behavior pinned identically in GuitarTapTests/TapCountChangeTests.swift +
// tests/test_tap_count_change.py.
import { describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

function makeEngine(numberOfTaps = 1) {
  const progress: Array<{ collected: number; total: number }> = []
  const engine = new RealtimeFFTAnalyzer(
    { onProgress: (collected, total) => progress.push({ collected, total }) },
    { numberOfTaps },
  )
  engine.initForTesting()
  return { engine, progress }
}

describe('tap-count change refreshes progress immediately (PC-4)', () => {
  it('lowering Taps while armed re-fires progress with the new total', () => {
    const { engine, progress } = makeEngine(4)
    engine.arm() // onProgress(0, 4)
    expect(progress.at(-1)).toEqual({ collected: 0, total: 4 })
    engine.setConfig({ numberOfTaps: 1 })
    expect(progress.at(-1)).toEqual({ collected: 0, total: 1 }) // was: stuck at total 4
  })

  it('raising Taps while armed re-fires too', () => {
    const { engine, progress } = makeEngine(1)
    engine.arm()
    engine.setConfig({ numberOfTaps: 3 })
    expect(progress.at(-1)).toEqual({ collected: 0, total: 3 })
  })

  it('does NOT re-fire while idle (before arming / a frozen loaded result)', () => {
    const { engine, progress } = makeEngine(1)
    engine.setConfig({ numberOfTaps: 5 }) // idle → the loaded/frozen result must not be disturbed
    expect(progress).toHaveLength(0)
  })

  it('does NOT re-fire for a non-tap-count config change', () => {
    const { engine, progress } = makeEngine(2)
    engine.arm()
    progress.length = 0
    engine.setConfig({ tapDetectionThreshold: -30 })
    expect(progress).toHaveLength(0)
  })

  it('does NOT re-fire when the tap count is unchanged', () => {
    const { engine, progress } = makeEngine(2)
    engine.arm()
    progress.length = 0
    engine.setConfig({ numberOfTaps: 2 })
    expect(progress).toHaveLength(0)
  })
})

// The canonical, cross-platform layer: the MODEL (TapToneAnalyzer.setNumberOfTaps) refreshes the
// status prompt when the count changes while armed-and-waiting for the first tap — mirroring Swift
// numberOfTaps.didSet. Pinned identically in Swift TapCountChangeTests + Python test_tap_count_change.
// (The reduce-count-≤-captured branch is NOT pinned 3-way: it diverges — Swift defers with "All taps
// captured. Processing…", Python's set_tap_num processes synchronously. Tracked in 6-TEST 4c.)
describe('tap-count change refreshes the status prompt (model — mirrors Swift numberOfTaps.didSet)', () => {
  it('raising Taps while armed-and-waiting refreshes the prompt to the new count', () => {
    const a = new TapToneAnalyzer()
    a.setEngineState('listening') // armed, waiting for the first tap → "Tap the guitar..."
    a.setNumberOfTaps(3)
    expect(a.statusMessage).toBe('Tap the guitar 3 times...')
  })

  it('lowering Taps while armed-and-waiting refreshes too', () => {
    const a = new TapToneAnalyzer()
    a.setEngineState('listening')
    a.setNumberOfTaps(4)
    expect(a.statusMessage).toBe('Tap the guitar 4 times...')
    a.setNumberOfTaps(1)
    expect(a.statusMessage).toBe('Tap the guitar...')
  })

  it('an idle change (not armed / a frozen result) does NOT refresh the prompt', () => {
    const a = new TapToneAnalyzer() // engineState 'idle', isDetecting false
    expect(a.statusMessage).toBe('Tap the guitar to begin')
    a.setNumberOfTaps(5)
    expect(a.statusMessage).toBe('Tap the guitar to begin')
  })
})