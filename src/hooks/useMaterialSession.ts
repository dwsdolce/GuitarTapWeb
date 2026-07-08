// ViewModel for a plate/brace material measurement — the L → (C) → (FLC) gated-capture phase
// machine. Owns the phase + per-phase spectra/peaks state and the logic that drives the engine
// (arm each phase) and reacts to each gated capture. Extracted from App (Phase 6 6-ARCH).
//
// Coupling to the audio engine is unavoidable (the session arms the engine; the engine's
// once-registered onMaterialCapture callback delegates to this hook's STABLE `recordCapture`).
// All settings-derived values are read through refs so the handlers/callback stay stable.

import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { AudioEngine, MaterialSearch, MaterialCaptureResult } from '../audio/engine'
import type { MaterialPeaks } from '../components/MaterialResults'
import { PLATE_PHASES, BRACE_PHASE } from '../dsp/gatedCapture'
import type { Spectrum } from '../dsp/guitarFFT'
import type { Calibration } from '../dsp/calibration'
import type { MeasurementType } from '../settings'

// Material measurement phases (MaterialTapPhase.swift). Brace: capturingL → complete.
export type MatPhase =
  | 'notStarted'
  | 'capturingL'
  | 'reviewingL'
  | 'capturingC'
  | 'reviewingC'
  | 'waitingForFlcTap'
  | 'capturingFlc'
  | 'reviewingFlc'
  | 'complete'

export type MatSpectra = { longitudinal: Spectrum | null; cross: Spectrum | null; flc: Spectrum | null }
export const EMPTY_MAT_SPECTRA: MatSpectra = { longitudinal: null, cross: null, flc: null }
const EMPTY_MAT_PEAKS: MaterialPeaks = { longitudinal: null, cross: null, flc: null }

// Swift tapCooldown (0.5 s): after the C tap is accepted, the FLC capture is held disarmed for
// this long while the user repositions, so the repositioning bump can't be taken as the FLC tap.
// Mirrors MaterialTapPhase.waitingForFlcTap (Swift acceptCurrentPhase / Python accept_current_phase).
const FLC_COOLDOWN_MS = 500

interface UseMaterialSessionArgs {
  engineRef: RefObject<AudioEngine | null>
  /** Current measurement type (brace vs plate selects the phase set). */
  measRef: RefObject<MeasurementType>
  /** Whether the plate's FLC tap is enabled. */
  measureFlcRef: RefObject<boolean>
  /** Active mic calibration applied to the gated spectrum before its peak-find. */
  calibrationRef: RefObject<Calibration | null>
}

export interface MaterialSessionModel {
  matPhase: MatPhase
  matPhaseRef: RefObject<MatPhase>
  matPeaks: MaterialPeaks
  matSpectra: MatSpectra
  /** Begin a fresh L→C→FLC capture. `arm` false for file playback (the engine arms its own session). */
  startMaterial: (arm?: boolean) => void
  /** Review → advance to the next phase (Accept). */
  acceptMaterial: () => void
  /** Review → re-capture the current phase (Redo). */
  redoMaterial: () => void
  /** Engine callback: a gated phase was captured — store it and advance the UI phase. */
  recordCapture: (result: MaterialCaptureResult) => void
  /** Back to notStarted + cleared (measurement-type change, cancel). */
  resetMaterial: () => void
  /** Restore a loaded material measurement (per-phase spectra + selected peaks, phase=complete). */
  restoreMaterial: (m: { matSpectra: MatSpectra; matPeaks: MaterialPeaks }) => void
}

export function useMaterialSession({
  engineRef,
  measRef,
  measureFlcRef,
  calibrationRef,
}: UseMaterialSessionArgs): MaterialSessionModel {
  const [matPhase, setMatPhaseState] = useState<MatPhase>('notStarted')
  const [matPeaks, setMatPeaks] = useState<MaterialPeaks>(EMPTY_MAT_PEAKS)
  const [matSpectra, setMatSpectra] = useState<MatSpectra>(EMPTY_MAT_SPECTRA)
  const matPhaseRef = useRef<MatPhase>('notStarted')
  const setMatPhase = useCallback((p: MatPhase) => {
    matPhaseRef.current = p
    setMatPhaseState(p)
  }, [])

  const matSearch = useCallback(
    (phase: 'longitudinal' | 'cross' | 'flc'): MaterialSearch => {
      const base =
        phase === 'cross'
          ? PLATE_PHASES[1]
          : phase === 'flc'
            ? PLATE_PHASES[2]
            : measRef.current === 'brace'
              ? BRACE_PHASE
              : PLATE_PHASES[0]
      // Apply the active mic calibration to the gated spectrum before its peak-find (gatedCapture).
      // (File-playback material uses the engine's own session with the file's calibration.)
      return { ...base, calibration: calibrationRef.current }
    },
    [measRef, calibrationRef],
  )

  // Continuous session WAV label for a completed material measurement (Swift Plate_LC / Plate_LCF /
  // Brace). Engine no-ops if no session is recording (dump setting off, or file playback).
  const finishMaterialSession = useCallback(() => {
    const label = measRef.current === 'brace' ? 'Brace' : measureFlcRef.current ? 'Plate_LCF' : 'Plate_LC'
    engineRef.current?.finishSessionRecording(label)
  }, [engineRef, measRef, measureFlcRef])

  const startMaterial = useCallback(
    (arm = true) => {
      setMatPeaks(EMPTY_MAT_PEAKS)
      setMatSpectra(EMPTY_MAT_SPECTRA)
      setMatPhase('capturingL')
      if (arm) {
        // Begin the continuous session WAV (dump-gated). startSessionRecording seeds checkpoint [0]
        // (the L-phase truncation anchor), so no explicit checkpoint is needed here.
        engineRef.current?.startSessionRecording()
        engineRef.current?.armMaterial(matSearch('longitudinal'))
      }
    },
    [engineRef, matSearch, setMatPhase],
  )

  const acceptMaterial = useCallback(() => {
    const phase = matPhaseRef.current
    if (phase === 'reviewingL') {
      setMatPhase('capturingC')
      engineRef.current?.checkpointSession() // C phase start (so a redo can drop it)
      engineRef.current?.armMaterial(matSearch('cross'))
    } else if (phase === 'reviewingC') {
      if (measureFlcRef.current) {
        // Mirror Swift acceptCurrentPhase: show the FLC reposition prompt during a
        // tapCooldown with detection DISARMED (waitingForFlcTap), so the plate-
        // repositioning bump isn't taken as the FLC tap; then arm the FLC capture.
        setMatPhase('waitingForFlcTap')
        engineRef.current?.checkpointSession() // FLC phase start (so a redo can drop it)
        setTimeout(() => {
          if (matPhaseRef.current !== 'waitingForFlcTap') return // canceled (reset / measurement-type change)
          setMatPhase('capturingFlc')
          engineRef.current?.armMaterial(matSearch('flc'))
        }, FLC_COOLDOWN_MS)
      } else {
        setMatPhase('complete')
        finishMaterialSession()
      }
    } else if (phase === 'reviewingFlc') {
      setMatPhase('complete')
      finishMaterialSession()
    }
  }, [engineRef, measureFlcRef, matSearch, setMatPhase, finishMaterialSession])

  const redoMaterial = useCallback(() => {
    const phase = matPhaseRef.current
    engineRef.current?.redoSession() // drop the rejected phase's audio from the session WAV
    if (phase === 'reviewingL') {
      setMatPhase('capturingL')
      engineRef.current?.armMaterial(matSearch('longitudinal'))
    } else if (phase === 'reviewingC') {
      setMatPhase('capturingC')
      engineRef.current?.armMaterial(matSearch('cross'))
    } else if (phase === 'reviewingFlc') {
      setMatPhase('capturingFlc')
      engineRef.current?.armMaterial(matSearch('flc'))
    }
  }, [engineRef, matSearch, setMatPhase])

  // Engine onMaterialCapture: `phase` is set during file playback (engine owns the L→C→FLC
  // auto-advance); for LIVE capture it's undefined and we derive it from the current UI phase.
  // During playback we only reflect progress in the UI phase (the engine re-arms); during live
  // capture the user advances via Accept (acceptMaterial).
  const recordCapture = useCallback(
    ({ spectrum, peak, phase }: MaterialCaptureResult) => {
      const playing = engineRef.current?.playingFile ?? false
      const ph: 'longitudinal' | 'cross' | 'flc' =
        phase ??
        (matPhaseRef.current === 'capturingC'
          ? 'cross'
          : matPhaseRef.current === 'capturingFlc'
            ? 'flc'
            : 'longitudinal')
      if (ph === 'longitudinal') {
        setMatSpectra((s) => ({ ...s, longitudinal: spectrum }))
        setMatPeaks((p) => ({ ...p, longitudinal: peak }))
        if (measRef.current === 'brace') {
          setMatPhase('complete')
          finishMaterialSession() // brace = single phase → session done
        } else setMatPhase(playing ? 'capturingC' : 'reviewingL')
      } else if (ph === 'cross') {
        setMatSpectra((s) => ({ ...s, cross: spectrum }))
        setMatPeaks((p) => ({ ...p, cross: peak }))
        if (playing) setMatPhase(measureFlcRef.current ? 'capturingFlc' : 'complete')
        else setMatPhase('reviewingC')
      } else {
        setMatSpectra((s) => ({ ...s, flc: spectrum }))
        setMatPeaks((p) => ({ ...p, flc: peak }))
        setMatPhase(playing ? 'complete' : 'reviewingFlc')
      }
    },
    [engineRef, measRef, measureFlcRef, setMatPhase, finishMaterialSession],
  )

  const resetMaterial = useCallback(() => {
    setMatPhase('notStarted')
    setMatPeaks(EMPTY_MAT_PEAKS)
    setMatSpectra(EMPTY_MAT_SPECTRA)
    engineRef.current?.cancelSessionRecording() // abandon any partial session WAV
  }, [engineRef, setMatPhase])

  const restoreMaterial = useCallback(
    (m: { matSpectra: MatSpectra; matPeaks: MaterialPeaks }) => {
      setMatSpectra(m.matSpectra)
      setMatPeaks(m.matPeaks)
      setMatPhase('complete')
    },
    [setMatPhase],
  )

  return {
    matPhase,
    matPhaseRef,
    matPeaks,
    matSpectra,
    startMaterial,
    acceptMaterial,
    redoMaterial,
    recordCapture,
    resetMaterial,
    restoreMaterial,
  }
}