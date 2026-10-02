// The Pause / New Tap / Cancel enablement rule — a pure function of the
// analyzer state, shared by App.tsx (the view) and the button-enablement test.
// Mirrors Swift `buttonRule` (TapToneAnalysisView) and Python `button_rule`.
// If this rule changes, update the B1–B16 truth table on all three platforms.
//
// @parity state/button-enablement  tests=test/button-enablement
import type { DetectionState, DisplayMode, MaterialTapPhase } from './tapToneAnalyzer'
import { isGuitarType, type MeasurementType } from '../settings'

/** Input state for the button rule — mirrors the fields the view reads. */
export interface ButtonState {
  /** Whether the detector is listening, paused mid-sequence, or neither.
   *  One value rather than a detecting/paused boolean pair: the pair could express "detecting AND
   *  paused", which the analyzer cannot represent, so a fixture built from two booleans could
   *  encode a state the app never reaches. */
  detectionState: DetectionState
  isMeasurementComplete: boolean
  isReadyForDetection?: boolean
  fftIsRunning?: boolean
  /** What the spectrum is showing. REQUIRED, and the mode itself rather than a boolean: the rule
   *  reads `tap.displayMode` in Swift and `display_mode` in Python, so it cannot be omitted there.
   *  Required here too, because New Tap is the way back to live from a comparison and the rule
   *  must see the comparison to enable it. */
  displayMode: DisplayMode
  measurementType?: MeasurementType
  materialTapPhase?: MaterialTapPhase
  numberOfTaps?: number
  /** A file is playing through the pipeline. */
  isPlayingFile?: boolean
}

export interface ButtonOutput {
  pauseEnabled: boolean
  newTapDisabled: boolean
  cancelEnabled: boolean
}

export function buttonRule(s: ButtonState): ButtonOutput {
  // During a file playback Cancel stops the file; Pause and New Tap are disabled. A recording
  // delivers taps back to back, so pausing detection while the file plays on would only let taps
  // go by, and a new sequence would be fed the rest of the file.
  if (s.isPlayingFile) return { pauseEnabled: false, newTapDisabled: true, cancelEnabled: true }

  const type = s.measurementType ?? 'generic'
  const isGuitar = isGuitarType(type)
  const phase = s.materialTapPhase ?? 'notStarted'
  const fftIsRunning = s.fftIsRunning ?? true
  const isReadyForDetection = s.isReadyForDetection ?? true
  const numberOfTaps = s.numberOfTaps ?? 1
  const isDetecting = s.detectionState === 'listening'
  const isDetectionPaused = s.detectionState === 'paused'

  const isInReviewPhase =
    !isGuitar && (phase === 'reviewingL' || phase === 'reviewingC' || phase === 'reviewingFlc')

  // A sequence is "in flight" when the analyzer is working toward a measurement: for
  // guitar, detecting or paused; for material, past notStarted and not complete. New Tap
  // is disabled while in flight and enabled otherwise (idle OR complete) — the honest
  // predicate, replacing the old `!isMeasurementComplete` proxy that wrongly locked New
  // Tap in the disarmed-idle state the Dump Capture Audio folder guard can produce on
  // Swift/Python. The web never reaches that state (Downloads-only, no folder guard),
  // so this is a no-op here — kept identical for cross-platform parity. Cancel restarts,
  // offered during a review phase (as "Redo") or an active multi-step sequence (multi-tap
  // or multi-phase = plate; brace is single-phase). Pause/Resume: review, detecting, or paused.
  const sequenceActive = isGuitar
    ? isDetecting || isDetectionPaused
    : phase !== 'notStarted' && !s.isMeasurementComplete
  const multiStep = numberOfTaps > 1 || type === 'plate'
  const inActiveMultiStep = sequenceActive && multiStep

  const pauseEnabled = isInReviewPhase ? true : isDetecting || isDetectionPaused

  let newTapDisabled: boolean
  if (s.displayMode === 'comparison') newTapDisabled = false
  else if (!(fftIsRunning && isReadyForDetection)) newTapDisabled = true
  else newTapDisabled = sequenceActive

  const cancelEnabled = isInReviewPhase || inActiveMultiStep

  return { pauseEnabled, newTapDisabled, cancelEnabled }
}