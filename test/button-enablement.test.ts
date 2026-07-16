// @parity test/button-enablement
//
// Truth-table tests for the Pause / New Tap / Cancel button enablement rules.
// Mirrors GuitarTapTests/ButtonEnablementTests.swift and Python
// tests/test_button_enablement.py: the rule is duplicated here on purpose as a
// pure function of the analyzer state, and asserted across the state
// combinations that actually occur. If App.tsx's inline button logic drifts
// from this table, one side has to give — update all three together.
import { describe, it, expect } from 'vitest'
import { buttonRule } from '../src/state/buttonEnablement'

describe('ButtonEnablement', () => {
  // B1: Disarmed-idle guitar — nothing complete, nothing in flight. New Tap is ENABLED so
  // the user can re-arm; Pause and Cancel stay disabled. (On Swift/Python this is the state
  // the Dump Capture Audio folder guard can produce, §4b; the web can't reach it, but the
  // rule is identical for parity.)
  it('B1 — guitar disarmed-idle: new tap enabled', () => {
    expect(buttonRule({ isDetecting: false, isDetectionPaused: false, isMeasurementComplete: false })).toEqual({
      pauseEnabled: false,
      newTapDisabled: false, // idle (no sequence in flight) → New Tap enabled to re-arm
      cancelEnabled: false,
    })
  })

  // B2: Guitar mid single-tap — detecting, not complete, numberOfTaps == 1.
  it('B2 — guitar mid single-tap: pause only', () => {
    expect(
      buttonRule({ isDetecting: true, isDetectionPaused: false, isMeasurementComplete: false, numberOfTaps: 1 }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: false })
  })

  // B3: Guitar single-tap complete — New Tap enabled, others off.
  it('B3 — guitar single-tap complete: new tap only', () => {
    expect(
      buttonRule({ isDetecting: false, isDetectionPaused: false, isMeasurementComplete: true, numberOfTaps: 1 }),
    ).toEqual({ pauseEnabled: false, newTapDisabled: false, cancelEnabled: false })
  })

  // B4: impossible (isDetecting && isMeasurementComplete) — invariant-forbidden. New Tap now
  // keys off "sequence in flight" (detecting||paused) rather than complete, so this
  // contradictory state disables New Tap (detecting) while Pause is on — no longer both.
  it('B4 — guitar impossible detecting+complete: new tap disabled, pause on', () => {
    const out = buttonRule({ isDetecting: true, isDetectionPaused: false, isMeasurementComplete: true })
    expect(out.newTapDisabled).toBe(true) // in flight (detecting) → New Tap disabled
    expect(out.pauseEnabled).toBe(true) // detecting → Pause enabled
  })

  // B5: Guitar mid multi-tap — pause and cancel both enabled.
  it('B5 — guitar mid multi-tap: pause and cancel enabled', () => {
    expect(
      buttonRule({
        isDetecting: true,
        isDetectionPaused: false,
        isMeasurementComplete: false,
        currentTapCount: 1,
        numberOfTaps: 3,
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B6: Guitar multi-tap paused — still an active multi-step sequence: Pause/Resume + Cancel
  // (restart) enabled; New Tap off (not complete).
  it('B6 — guitar multi-tap paused: cancel still enabled', () => {
    expect(
      buttonRule({
        isDetecting: false,
        isDetectionPaused: true,
        isMeasurementComplete: false,
        currentTapCount: 1,
        numberOfTaps: 3,
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B7: Plate review — multi-phase active: New Tap disabled (Cancel restarts), Accept + Redo on.
  it('B7 — plate review: new tap disabled, cancel + pause on', () => {
    expect(
      buttonRule({
        isDetecting: false,
        isDetectionPaused: false,
        isMeasurementComplete: false,
        measurementType: 'plate',
        materialTapPhase: 'reviewingL',
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B8: Plate active capture — multi-phase active: New Tap disabled, Pause + Cancel enabled.
  it('B8 — plate capturing: new tap disabled, cancel + pause on', () => {
    expect(
      buttonRule({
        isDetecting: true,
        isDetectionPaused: false,
        isMeasurementComplete: false,
        measurementType: 'plate',
        materialTapPhase: 'capturingL',
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B9: FFT not running — New Tap disabled regardless of other state.
  it('B9 — fft not running: new tap always disabled', () => {
    expect(
      buttonRule({ isDetecting: false, isDetectionPaused: false, isMeasurementComplete: true, fftIsRunning: false })
        .newTapDisabled,
    ).toBe(true)
  })

  // B10: Comparison mode overrides — New Tap always enabled.
  it('B10 — comparison mode: new tap always enabled', () => {
    expect(
      buttonRule({
        isDetecting: false,
        isDetectionPaused: false,
        isMeasurementComplete: false,
        displayModeIsComparison: true,
      }).newTapDisabled,
    ).toBe(false)
  })

  // B11: Brace single-tap capturing — single-phase + single-tap (like single-tap guitar):
  // not complete → New Tap disabled; Pause on (threshold-setting); Cancel disabled.
  it('B11 — brace single-tap capturing: pause only', () => {
    expect(
      buttonRule({
        isDetecting: true,
        isDetectionPaused: false,
        isMeasurementComplete: false,
        measurementType: 'brace',
        materialTapPhase: 'capturingL',
        numberOfTaps: 1,
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: false })
  })

  // B12: Brace multi-tap capturing — multi-tap makes it multi-step: New Tap disabled,
  // Cancel (restart) enabled.
  it('B12 — brace multi-tap capturing: cancel enabled', () => {
    expect(
      buttonRule({
        isDetecting: true,
        isDetectionPaused: false,
        isMeasurementComplete: false,
        measurementType: 'brace',
        materialTapPhase: 'capturingL',
        numberOfTaps: 3,
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B13: Disarmed-idle material (plate, phase notStarted, nothing complete/in flight) —
  // New Tap ENABLED to re-arm; Pause/Cancel disabled. The material counterpart of B1.
  it('B13 — plate disarmed-idle: new tap enabled', () => {
    expect(
      buttonRule({
        isDetecting: false,
        isDetectionPaused: false,
        isMeasurementComplete: false,
        measurementType: 'plate',
        materialTapPhase: 'notStarted',
      }),
    ).toEqual({ pauseEnabled: false, newTapDisabled: false, cancelEnabled: false })
  })
})