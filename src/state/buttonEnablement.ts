// The Pause / New Tap / Cancel enablement rule — a pure function of the
// analyzer state, shared by App.tsx (the view) and the button-enablement test.
// Mirrors Swift `buttonRule` (TapToneAnalysisView) and Python `button_rule`.
// If this rule changes, update the B1–B10 truth table on all three platforms.
//
// @parity state/button-enablement  tests=test/button-enablement
import type { MaterialTapPhase } from './tapToneAnalyzer'
import { isGuitarType, type MeasurementType } from '../settings'

/** Input state for the button rule — mirrors the fields the view reads. */
export interface ButtonState {
  isDetecting: boolean
  isDetectionPaused: boolean
  isMeasurementComplete: boolean
  isReadyForDetection?: boolean
  fftIsRunning?: boolean
  displayModeIsComparison?: boolean
  measurementType?: MeasurementType
  materialTapPhase?: MaterialTapPhase
  currentTapCount?: number
  numberOfTaps?: number
}

export interface ButtonOutput {
  pauseEnabled: boolean
  newTapDisabled: boolean
  cancelEnabled: boolean
}

export function buttonRule(s: ButtonState): ButtonOutput {
  const type = s.measurementType ?? 'classical'
  const isGuitar = isGuitarType(type)
  const phase = s.materialTapPhase ?? 'notStarted'
  const fftIsRunning = s.fftIsRunning ?? true
  const isReadyForDetection = s.isReadyForDetection ?? true
  const numberOfTaps = s.numberOfTaps ?? 1

  const isInReviewPhase =
    !isGuitar && (phase === 'reviewingL' || phase === 'reviewingC' || phase === 'reviewingFlc')

  // New Tap starts a fresh measurement → enabled only once one is complete (every
  // type-switch auto-arms into capturing, so there is no disarmed idle state). Cancel
  // restarts, offered during a review phase (as "Redo") or an active multi-step sequence
  // (multi-tap or multi-phase = plate; brace is single-phase). Pause/Resume: review,
  // detecting, or paused (works even single-tap, for setting the threshold).
  const active = isGuitar
    ? s.isDetecting || s.isDetectionPaused
    : phase !== 'notStarted' && !s.isMeasurementComplete
  const multiStep = numberOfTaps > 1 || type === 'plate'
  const inActiveMultiStep = active && multiStep

  const pauseEnabled = isInReviewPhase ? true : s.isDetecting || s.isDetectionPaused

  let newTapDisabled: boolean
  if (s.displayModeIsComparison) newTapDisabled = false
  else if (!(fftIsRunning && isReadyForDetection)) newTapDisabled = true
  else newTapDisabled = !s.isMeasurementComplete

  const cancelEnabled = isInReviewPhase || inActiveMultiStep

  return { pauseEnabled, newTapDisabled, cancelEnabled }
}