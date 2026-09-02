// @parity dead-input-threshold — paired with Swift DeadInputThresholdTests.swift and
// Python tests/test_dead_input_threshold.py. All three pin the SAME calibration table.
//
// Why this test exists: the dead-input watchdog decides "the stream is dead" from a
// level threshold, and that threshold is a field calibration, not a derivation. Get it
// too low and a genuinely dead stream (measured at ~-100 dBFS, NOT digital zero) is
// never detected; too high and a quiet room is mistaken for a dead input and the engine
// is restarted mid-measurement. The UMIK-1 is an unusually quiet microphone and can sit
// near -90 dBFS in a silent room, which is what makes the upper bound real.
//
// Source of the numbers: hub docs/AUDIO-WATCHDOG-SILENT-STREAM.md (incidents 2026-07-16).
import { describe, it, expect } from 'vitest'
import { DEAD_INPUT_RMS_THRESHOLD, chunkCarriesSignal } from '../src/audio/deadInput'

/** Amplitude (linear RMS) for a level in dBFS. */
const amp = (dbfs: number): number => 10 ** (dbfs / 20)

describe('dead-input threshold calibration', () => {
  it('treats a dead stream as carrying no signal', () => {
    expect(chunkCarriesSignal(0)).toBe(false)            // digital silence
    expect(chunkCarriesSignal(amp(-120))).toBe(false)    // far below anything real
    expect(chunkCarriesSignal(amp(-100))).toBe(false)    // the measured dead-device level
  })

  it('treats a QUIET UMIK-1 in a silent room as carrying signal', () => {
    // The regression this test exists for: -90 dBFS is quiet, not dead.
    expect(chunkCarriesSignal(amp(-90))).toBe(true)
    expect(chunkCarriesSignal(amp(-95))).toBe(true)
  })

  it('treats a normal room floor and a tap as carrying signal', () => {
    expect(chunkCarriesSignal(amp(-70))).toBe(true)      // room noise floor
    expect(chunkCarriesSignal(amp(-63))).toBe(true)      // UMIK-1 Air peak
    expect(chunkCarriesSignal(amp(-20))).toBe(true)      // a tap
  })

  it('keeps at least 10 dB of margin under the quiet-room level', () => {
    // Guards against someone "tightening" the threshold back up toward -90.
    expect(DEAD_INPUT_RMS_THRESHOLD).toBeLessThanOrEqual(amp(-100))
    expect(amp(-90) / DEAD_INPUT_RMS_THRESHOLD).toBeGreaterThanOrEqual(3.16) // ≥10 dB
  })
})
