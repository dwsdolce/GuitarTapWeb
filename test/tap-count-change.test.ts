// @parity test/tap-count-change
// PC-4: changing the tap count while armed-and-waiting must immediately refresh the progress
// display so the status prompt tracks the new count (Swift does this reactively via
// numberOfTaps.didSet; the web must re-fire onProgress from setConfig). Regression for the bug
// where "3-tap brace → Generic → Taps=1" left the status bar stuck on "Tap the guitar 4 times…".
// Web-only mechanism (onProgress refire) — no Swift/Python unit counterpart yet (back-port tracked
// in Development/6-TEST-NORMALIZATION.md § 2).
import { describe, it, expect } from 'vitest'
import { AudioEngine } from '../src/audio/engine'

function makeEngine(numberOfTaps = 1) {
  const progress: Array<{ collected: number; total: number }> = []
  const engine = new AudioEngine(
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