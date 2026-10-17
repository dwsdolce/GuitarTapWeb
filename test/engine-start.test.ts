// @parity none — React's remount (start, stop, start) is the web's alone.
//
// The engine's start and stop: a start while one is in flight joins it, and a stop during a start ends it
// at its next step — so a remount leaves one input running, and a stop that stays stopped leaves none.
// The input itself (a microphone and an AudioContext) is not in the test environment, so the step that
// opens it is replaced by one that waits for a gate, then does what the real one does at each step: ask
// whether the start was withdrawn, and if not, hold an input.
import { describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'

type Internals = {
  startInput(): Promise<void>
  withdrawn(): Promise<boolean>
  teardown(): Promise<void>
  context: unknown
}

/** An engine whose input opens when `open()` is called; counts the inputs opened and torn down. */
function gatedEngine() {
  const engine = new RealtimeFFTAnalyzer()
  const internals = engine as unknown as Internals
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const counts = { opened: 0, tornDown: 0 }
  internals.startInput = async () => {
    await gate
    if (await internals.withdrawn()) return
    internals.context = {}
    counts.opened++
  }
  const teardown = internals.teardown.bind(internals)
  internals.teardown = async () => {
    counts.tornDown++
    internals.context = null
    await teardown().catch(() => {})
  }
  return { engine, open: release, counts }
}

describe('the engine start and stop', () => {
  it('a start while one is in flight joins it: one input', async () => {
    const { engine, open, counts } = gatedEngine()
    const first = engine.start()
    const second = engine.start()
    open()
    await Promise.all([first, second])
    expect(counts.opened).toBe(1)
    expect(engine.running).toBe(true)
  })

  it('a stop during a start ends it: no input', async () => {
    const { engine, open, counts } = gatedEngine()
    const starting = engine.start()
    void engine.stop()
    open()
    await starting
    expect(counts.opened).toBe(0)
    expect(engine.running).toBe(false)
  })

  it("React's remount — start, stop, start — leaves one input running", async () => {
    const { engine, open, counts } = gatedEngine()
    const mount = engine.start()
    void engine.stop()
    const remount = engine.start()
    open()
    await Promise.all([mount, remount])
    expect(counts.opened).toBe(1)
    expect(counts.tornDown).toBe(0)
    expect(engine.running).toBe(true)
  })
})
