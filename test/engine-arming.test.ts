// @parity none
//
// Web-only engine machinery, deliberately without a native counterpart. On Swift and Python the
// analyzer owns the detector and arming is an assignment — `isDetecting = true` / `self.is_detecting
// = True` — which cannot be refused. On the web the detector lives in the engine, so arming is a
// REQUEST, and a request can be declined.
//
// It used to be declined silently. A plate measurement that lost its FLC arm showed the FLC prompt
// with the spectrum and level meter running normally and never registered a tap again, until the app
// was restarted: nothing retried, and nothing said anything. These cases pin the compensation — a
// refusal is remembered and applied when the capture completes, and a disarm cancels it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { PLATE_PHASES } from '../src/dsp/gatedCapture'

/** Reach the private deferral seam: the capture machinery needs real audio, the deferral does not. */
type Internals = { applyPendingArm(): void; pendingArm: unknown }
const internals = (e: RealtimeFFTAnalyzer) => e as unknown as Internals

function headlessEngine(): RealtimeFFTAnalyzer {
  const e = new RealtimeFFTAnalyzer()
  e.initForTesting() // headless => `running` is true without an AudioContext
  return e
}

const flcSearch = () => ({ ...PLATE_PHASES[2], calibration: null })

describe('engine arming — a refused arm is deferred, never dropped', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('arms immediately when idle', () => {
    const e = headlessEngine()
    e.armMaterial(flcSearch())
    expect(e.state).toBe('listening')
    expect(internals(e).pendingArm).toBeNull()
  })

  it('defers a material arm requested during a capture', () => {
    const e = headlessEngine()
    e.state = 'capturing'
    e.armMaterial(flcSearch())
    expect(e.state).toBe('capturing') // the in-flight capture is not interrupted
    expect(internals(e).pendingArm).not.toBeNull() // but the request is remembered
  })

  it('applies the deferred arm once the capture completes', () => {
    const e = headlessEngine()
    e.state = 'capturing'
    e.armMaterial(flcSearch())
    e.state = 'idle' // the capture finished
    internals(e).applyPendingArm()
    expect(e.state).toBe('listening') // this is what a restart used to be needed for
    expect(internals(e).pendingArm).toBeNull()
  })

  it('defers a guitar arm the same way', () => {
    const e = headlessEngine()
    e.state = 'capturing'
    e.arm()
    expect(internals(e).pendingArm).not.toBeNull()
    e.state = 'idle'
    internals(e).applyPendingArm()
    expect(e.state).toBe('listening')
  })

  it('disarm cancels a deferred arm, so it cannot resurrect detection over a frozen result', () => {
    const e = headlessEngine()
    e.state = 'capturing'
    e.armMaterial(flcSearch())
    e.disarm()
    expect(internals(e).pendingArm).toBeNull()
    e.state = 'idle'
    internals(e).applyPendingArm()
    expect(e.state).toBe('idle') // still frozen — a load must stay frozen
  })

  it('logs a refusal when the engine is not running', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const e = new RealtimeFFTAnalyzer() // no initForTesting => not running
    e.armMaterial(flcSearch())
    expect(e.state).toBe('idle')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('material arm refused'))
  })
})
