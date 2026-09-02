// @parity dead-input — paired with Swift GuitarTapTests/DeadInputThresholdTests.swift
// and Python tests/test_dead_input_threshold.py. All three pin the SAME table.
//
// Why these exist: the threshold is a FIELD CALIBRATION, not a derivation. Set it too
// low and a genuinely dead stream (measured at ~-100 dBFS, NOT digital zero) is never
// detected; too high and a quiet room is mistaken for a dead input and the stream is
// re-acquired mid-measurement. The UMIK-1 is an unusually quiet microphone and can sit
// near -90 dBFS in a silent room, which is what makes the upper bound real.
//
// Source of the numbers: hub docs/AUDIO-WATCHDOG-SILENT-STREAM.md (incidents
// 2026-07-16, recurrence 2026-08-21).
import { describe, it, expect } from 'vitest'
import {
  BUFFER_DELIVERY_TIMEOUT_MS,
  DEAD_INPUT_DWELL_MS,
  DEAD_INPUT_RMS_THRESHOLD,
  chunkCarriesSignal,
  watchdogDecision,
  type WatchdogDecision,
} from '../src/audio/deadInput'

/** Amplitude (linear RMS) for a level in dBFS. */
const amp = (dbfs: number): number => 10 ** (dbfs / 20)

describe('dead-input threshold calibration', () => {
  it('reads digital silence as no signal', () => {
    expect(chunkCarriesSignal(0)).toBe(false)
  })

  it('reads far below anything real as no signal', () => {
    expect(chunkCarriesSignal(amp(-120))).toBe(false)
  })

  it('reads the measured dead-device level as no signal', () => {
    expect(chunkCarriesSignal(amp(-100))).toBe(false)
  })

  it('reads a QUIET UMIK-1 in a silent room as alive', () => {
    // The regression these tests exist for: -90 dBFS is quiet, not dead.
    expect(chunkCarriesSignal(amp(-90))).toBe(true)
    expect(chunkCarriesSignal(amp(-95))).toBe(true)
  })

  it('reads a normal room floor and a tap as alive', () => {
    expect(chunkCarriesSignal(amp(-70))).toBe(true)  // room noise floor
    expect(chunkCarriesSignal(amp(-63))).toBe(true)  // UMIK-1 Air peak
    expect(chunkCarriesSignal(amp(-20))).toBe(true)  // a tap
  })

  it('keeps at least 10 dB of margin under the quiet-room level', () => {
    // Guards against anyone "tightening" the threshold back up toward -90 dBFS.
    expect(DEAD_INPUT_RMS_THRESHOLD).toBeLessThanOrEqual(amp(-100))
    expect(amp(-90) / DEAD_INPUT_RMS_THRESHOLD).toBeGreaterThanOrEqual(3.16)
  })
})

describe('dead-input dwell', () => {
  it('outlasts a quiet passage', () => {
    // A short dwell would let an ordinary silent moment between taps trip the
    // watchdog. The recorded incidents persisted for minutes, so patience is free.
    expect(DEAD_INPUT_DWELL_MS).toBeGreaterThanOrEqual(10000)
  })

  it('is longer than the delivery timeout', () => {
    // Content-based inference should always be more patient than the arrival-based
    // check it sits beside.
    expect(DEAD_INPUT_DWELL_MS).toBeGreaterThan(BUFFER_DELIVERY_TIMEOUT_MS)
  })
})

describe('watchdog decision', () => {
  const NOW = 1_000_000

  const decide = (chunksAgo: number, signalAgo: number, exhausted = false): WatchdogDecision =>
    watchdogDecision(NOW, NOW - chunksAgo, NOW - signalAgo, exhausted)

  it('is healthy while signal flows', () => {
    expect(decide(20, 20)).toBe('healthy')
  })

  it('is still healthy through a quiet passage shorter than the dwell', () => {
    // The case that must never re-acquire the stream: a silent moment between taps.
    expect(decide(20, DEAD_INPUT_DWELL_MS - 1000)).toBe('healthy')
  })

  it('is starved when no chunks arrive at all', () => {
    const t = BUFFER_DELIVERY_TIMEOUT_MS + 1000
    expect(decide(t, t)).toBe('starved')
  })

  it('is deadInput when chunks arrive carrying nothing', () => {
    // The failure this whole mechanism exists for.
    expect(decide(20, DEAD_INPUT_DWELL_MS + 1000)).toBe('deadInput')
  })

  it('reports starvation ahead of dead input', () => {
    // A starved stream is trivially signal-less too; report the deeper failure.
    expect(decide(BUFFER_DELIVERY_TIMEOUT_MS + 1000, DEAD_INPUT_DWELL_MS + 1000)).toBe('starved')
  })

  it('warns without re-acquiring once attempts are exhausted', () => {
    expect(decide(20, DEAD_INPUT_DWELL_MS + 1000, true)).toBe('deadInputExhausted')
  })

  it('returns to healthy when signal comes back after exhaustion', () => {
    // The regression from 2026-09-01: raising the input volume again must heal the app
    // rather than leave it deaf until reload.
    expect(decide(20, 20, true)).toBe('healthy')
  })

  it('never re-acquires while exhausted, even when starved', () => {
    expect(decide(BUFFER_DELIVERY_TIMEOUT_MS + 1000, DEAD_INPUT_DWELL_MS + 1000, true))
      .toBe('deadInputExhausted')
  })
})
