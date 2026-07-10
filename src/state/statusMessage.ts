// @parity state/status-message  tests=test/status-message
// Bottom status-bar text — the web mirror of Swift `TapToneAnalyzer.statusMessage` / Python
// `tap_tone_analyzer.status_message`. In the native apps `statusMessage` is a mutable string set
// imperatively at ~30 points; here it's derived functionally from the current state. This reproduces
// every canonical string for a state the web can actually be in. Native *transients* that a stateless
// function can't reproduce are intentionally omitted: "Initializing… (Ns)" (the web has no warm-up),
// "All taps captured. Processing…" (sub-frame), and "No signal/resonance detected — tap again" (the web
// engine has no empty/no-peak failure path yet — see 6-TEST-NORMALIZATION.md § EG-1).
//
// The detailed per-phase instructions live in the MaterialInstructionPanel; the bar carries the short
// capture status. The web-only status strings that used to live here ("Requesting microphone…",
// "Playing <file>…", "Comparing…", "Tap comparison…", "Microphone unavailable") were NOT canonical —
// the native apps express those states through the initial statusMessage, the File: playback messages,
// the Comparison/MultiTap panels, and the mic-error dialog instead.

import type { EngineState } from '../audio/engine'
import type { MatPhase } from '../hooks/useMaterialSession'

// Resting "waiting for a tap" prompt. Swift/Python show a phase-specific string only for the
// instant before warm-up ends, then the detection loop overwrites it with this type-agnostic
// prompt (TapToneAnalyzer+TapDetection warm-up exit). The web has no warm-up, so this is the
// steady-state message for guitar AND every armed material phase — the phase-specific guidance
// lives in the instruction panel, not the status bar.
export const tapPrompt = (total: number) => (total === 1 ? 'Tap the guitar...' : `Tap the guitar ${total} times...`)

export function guitarBarStatus(
  state: EngineState,
  progress: { collected: number; total: number },
  peakCount: number,
  hasCapture: boolean,
): string {
  const { collected, total } = progress
  switch (state) {
    case 'listening':
      if (collected === 0) return tapPrompt(total)
      return `Tap ${collected}/${total} captured. Tap again...`
    case 'capturing': {
      const prov = Math.min(collected + 1, total)
      return prov < total ? `Tap ${prov}/${total} capturing...` : 'All taps captured. Processing...'
    }
    case 'paused':
      return 'Detection paused – tap freely, then resume'
    case 'idle':
      return hasCapture ? `Analysis complete! ${peakCount} peaks identified (from ${total} averaged taps).` : ''
  }
}

export type MatBarPeaks = {
  longitudinal: { frequency: number } | null
  cross: { frequency: number } | null
  flc: { frequency: number } | null
}
const fHz = (p: { frequency: number } | null) => (p ? p.frequency.toFixed(1) : '?')

export function materialBarStatus(
  phase: MatPhase,
  brace: boolean,
  measureFlc: boolean,
  progress: { collected: number; total: number },
  peaks: MatBarPeaks,
): string {
  const { collected, total } = progress
  switch (phase) {
    case 'notStarted':
      return '' // switching auto-arms into capturingL; notStarted is only a transient pre-engine state
    case 'capturingL':
      // Armed and waiting: the resting message is the type-agnostic tap prompt (mirrors the
      // canonical warm-up-exit override). Phase guidance ("Hold brace at 22%…") is in the panel.
      if (collected === 0) return tapPrompt(total)
      return `L tap ${collected}/${total} captured. Tap again...`
    case 'reviewingL':
      return `fL: ${fHz(peaks.longitudinal)} Hz — Accept to continue or Redo to re-tap`
    case 'capturingC':
      if (collected === 0) return tapPrompt(total)
      return `C tap ${collected}/${total} captured. Tap again...`
    case 'reviewingC':
      return `fC: ${fHz(peaks.cross)} Hz — Accept to continue or Redo to re-tap`
    case 'waitingForFlcTap':
      // Detection is disarmed during the FLC-reposition cooldown, so no warm-up override fires —
      // this phase keeps its specific prompt in canonical too.
      return 'Set up for FLC tap, then tap'
    case 'capturingFlc':
      if (collected === 0) return tapPrompt(total)
      return `FLC tap ${collected}/${total} captured. Tap again...`
    case 'reviewingFlc':
      return `fLC: ${fHz(peaks.flc)} Hz — Accept to complete or Redo to re-tap`
    case 'complete':
      if (!brace && !measureFlc) return `Complete — fL: ${fHz(peaks.longitudinal)} Hz, fC: ${fHz(peaks.cross)} Hz`
      return 'Complete - check Results'
  }
}

export interface StatusInputs {
  clipping: boolean
  deviceChanging: boolean
  running: boolean
  /** A file is being played through the pipeline (drives the material File: transition messages). */
  playingFile: boolean
  engineState: EngineState
  loadedName: string | null
  material: boolean
  brace: boolean
  measureFlc: boolean
  matPhase: MatPhase
  progress: { collected: number; total: number }
  matPeaks: MatBarPeaks
  /** Guitar peak count for the completion message (displayed peaks). */
  guitarPeakCount: number
  /** A guitar capture is frozen (captured != null). */
  hasCapture: boolean
}

/** The canonical `statusMessage`, priority-ordered to mirror the native imperative overrides. */
export function statusMessage(s: StatusInputs): string {
  // 1-2. Clipping / device-change overrides (Swift clippingWarningStatus + reinitializing).
  if (s.clipping) return '⚠ Input clipping — reduce mic gain'
  if (s.deviceChanging) return 'Audio device changed - reinitializing...'
  // 3. Pre-running (permission/startup): the native apps' initial statusMessage.
  if (!s.running) return 'Tap the guitar to begin'
  // 4. Material file-playback phase transitions (Swift isPlayingFile branch).
  if (s.playingFile && s.material) {
    if (s.matPhase === 'capturingC') return 'File: L complete, capturing C...'
    if (s.matPhase === 'capturingFlc') return 'File: C complete, capturing FLC...'
  }
  // 5. Paused (covers guitar and material — Pause works single-tap for threshold-setting).
  if (s.engineState === 'paused') return 'Detection paused – tap freely, then resume'
  // 6. Loaded, frozen result.
  if (s.loadedName && s.engineState === 'idle')
    return 'Loaded measurement (frozen). Press ‘New Tap’ to start a new measurement.'
  // 7. Otherwise the capture/phase status.
  return s.material
    ? materialBarStatus(s.matPhase, s.brace, s.measureFlc, s.progress, s.matPeaks)
    : guitarBarStatus(s.engineState, s.progress, s.guitarPeakCount, s.hasCapture)
}

/** The detection-state label (Swift: isMeasurementComplete ? "Tap Detected!" : "Waiting for tap..."). */
export const detectLabel = (isComplete: boolean): string => (isComplete ? 'Tap Detected!' : 'Waiting for tap...')