// @parity test/button-enablement
//
// Truth-table tests for the Pause / New Tap / Cancel button enablement rules.
// Mirrors GuitarTapTests/ButtonEnablementTests.swift and Python
// tests/test_button_enablement.py. `buttonRule` is the PRODUCTION rule, the same
// function App.tsx calls — App has no inline button logic to drift from it. In all
// three editions the tests assert against the production rule. Update the table on
// all three together.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { buttonRule } from '../src/state/buttonEnablement'

describe('ButtonEnablement', () => {
  // B1: Disarmed-idle guitar — nothing complete, nothing in flight. New Tap is ENABLED so
  // the user can re-arm; Pause and Cancel stay disabled. (On Swift/Python this is the state
  // the Dump Capture Audio folder guard can produce; the web can't reach it, but the
  // rule is identical for parity.)
  it('B1 — guitar disarmed-idle: new tap enabled', () => {
    expect(buttonRule({ displayMode: 'live', detectionState: 'idle', isMeasurementComplete: false })).toEqual({
      pauseEnabled: false,
      newTapDisabled: false, // idle (no sequence in flight) → New Tap enabled to re-arm
      cancelEnabled: false,
    })
  })

  // B2: Guitar mid single-tap — detecting, not complete, numberOfTaps == 1.
  it('B2 — guitar mid single-tap: pause only', () => {
    expect(
      buttonRule({ displayMode: 'live', detectionState: 'listening', isMeasurementComplete: false, numberOfTaps: 1 }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: false })
  })

  // B3: Guitar single-tap complete — New Tap enabled, others off.
  it('B3 — guitar single-tap complete: new tap only', () => {
    expect(
      buttonRule({ displayMode: 'live', detectionState: 'idle', isMeasurementComplete: true, numberOfTaps: 1 }),
    ).toEqual({ pauseEnabled: false, newTapDisabled: false, cancelEnabled: false })
  })

  // B4: impossible (isDetecting && isMeasurementComplete) — invariant-forbidden. New Tap now
  // keys off "sequence in flight" (detecting||paused) rather than complete, so this
  // contradictory state disables New Tap (detecting) while Pause is on — no longer both.
  it('B4 — guitar impossible detecting+complete: new tap disabled, pause on', () => {
    const out = buttonRule({ displayMode: 'live', detectionState: 'listening', isMeasurementComplete: true })
    expect(out.newTapDisabled).toBe(true) // in flight (detecting) → New Tap disabled
    expect(out.pauseEnabled).toBe(true) // detecting → Pause enabled
  })

  // B5: Guitar mid multi-tap — pause and cancel both enabled.
  it('B5 — guitar mid multi-tap: pause and cancel enabled', () => {
    expect(
      buttonRule({
        displayMode: 'live',
        detectionState: 'listening',
        isMeasurementComplete: false,
        numberOfTaps: 3,
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B6: Guitar multi-tap paused — still an active multi-step sequence: Pause/Resume + Cancel
  // (restart) enabled; New Tap off (not complete).
  it('B6 — guitar multi-tap paused: cancel still enabled', () => {
    expect(
      buttonRule({
        displayMode: 'live',
        detectionState: 'paused',
        isMeasurementComplete: false,
        numberOfTaps: 3,
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B7: Plate review — multi-phase active: New Tap disabled (Cancel restarts), Accept + Redo on.
  it('B7 — plate review: new tap disabled, cancel + pause on', () => {
    expect(
      buttonRule({
        displayMode: 'live',
        detectionState: 'idle',
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
        displayMode: 'live',
        detectionState: 'listening',
        isMeasurementComplete: false,
        measurementType: 'plate',
        materialTapPhase: 'capturingL',
      }),
    ).toEqual({ pauseEnabled: true, newTapDisabled: true, cancelEnabled: true })
  })

  // B9: FFT not running — New Tap disabled regardless of other state.
  it('B9 — fft not running: new tap always disabled', () => {
    expect(
      buttonRule({ displayMode: 'live', detectionState: 'idle', isMeasurementComplete: true, fftIsRunning: false })
        .newTapDisabled,
    ).toBe(true)
  })

  // B10: Comparison mode overrides — New Tap always enabled.
  it('B10 — comparison mode: new tap always enabled', () => {
    expect(
      buttonRule({
        displayMode: 'comparison',
        detectionState: 'idle',
        isMeasurementComplete: false,
      }).newTapDisabled,
    ).toBe(false)
  })

  // B11: Brace single-tap capturing — single-phase + single-tap (like single-tap guitar):
  // not complete → New Tap disabled; Pause on (threshold-setting); Cancel disabled.
  it('B11 — brace single-tap capturing: pause only', () => {
    expect(
      buttonRule({
        displayMode: 'live',
        detectionState: 'listening',
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
        displayMode: 'live',
        detectionState: 'listening',
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
        displayMode: 'live',
        detectionState: 'idle',
        isMeasurementComplete: false,
        measurementType: 'plate',
        materialTapPhase: 'notStarted',
      }),
    ).toEqual({ pauseEnabled: false, newTapDisabled: false, cancelEnabled: false })
  })

  // B14–B16: During a file playback Cancel (stop the file) is enabled; Pause and New Tap are
  // disabled — whatever the detector is doing.
  const cancelOnly = { pauseEnabled: false, newTapDisabled: true, cancelEnabled: true }

  // B14: Guitar single-tap playback, listening — Cancel is enabled even though a single-tap
  // sequence offers no Cancel live.
  it('B14 — playback, guitar listening: cancel only', () => {
    expect(
      buttonRule({ displayMode: 'live', detectionState: 'listening', isMeasurementComplete: false, isPlayingFile: true }),
    ).toEqual(cancelOnly)
  })

  // B15: Guitar multi-tap playback between taps — the detector idle while it rests and re-arms.
  it('B15 — playback, guitar between taps: cancel only', () => {
    expect(
      buttonRule({
        displayMode: 'live',
        detectionState: 'idle',
        isMeasurementComplete: false,
        numberOfTaps: 8,
        isPlayingFile: true,
      }),
    ).toEqual(cancelOnly)
  })

  // B16: Plate playback complete while the file still plays — Cancel still stops the file.
  it('B16 — playback, plate complete, file still playing: cancel only', () => {
    expect(
      buttonRule({
        displayMode: 'live',
        detectionState: 'idle',
        isMeasurementComplete: true,
        measurementType: 'plate',
        materialTapPhase: 'complete',
        isPlayingFile: true,
      }),
    ).toEqual(cancelOnly)
  })

  // Save and the exports: enabled only when there is something to save or export — a complete
  // measurement or a comparison. One analyzer rule, read by the Save and export buttons. Mirrors Swift
  // hasResultToSaveOrExport_onlyForACompleteMeasurementOrAComparison.
  it('hasResultToSaveOrExport — only a complete measurement or a comparison', () => {
    const a = new TapToneAnalyzer()
    expect(a.hasResultToSaveOrExport, 'nothing to save or export while live').toBe(false)
    a.isMeasurementComplete = true
    expect(a.hasResultToSaveOrExport, 'a complete measurement').toBe(true)
    a.isMeasurementComplete = false
    a.displayMode = 'comparison'
    expect(a.hasResultToSaveOrExport, 'a comparison').toBe(true)
  })
})
