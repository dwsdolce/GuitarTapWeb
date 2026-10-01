// ViewModel for the audio engine — the web counterpart of Swift's RealtimeFFTAnalyzer /
// Python's tap_tone_analyzer (the audio *model* layer). Owns the engine instance lifecycle
// (auto-start on mount, stop on unmount), the live telemetry state (running / level / spectrum /
// engine state / clipping / multi-tap progress / FFT metrics / sample rate / device label / error),
// and the calibration store's picker actions (import/select/delete). The engine owns the input
// devices — their list, the selection, what is saved and each device's calibration — and this hook
// mirrors that state for React whenever the engine reports a change.
//
// `engineRef` is owned by App (a shared handle: the material session arms the engine) and passed
// in — this hook populates it. The
// capture-result callbacks (guitar tap, material phase, raw-audio dump) are passed in stable so the
// engine's once-registered callbacks never capture stale closures.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { RealtimeFFTAnalyzer, failedOpenMessage, type EngineMetrics } from '../audio/realtimeFFTAnalyzer'
import type { TapToneAnalyzer } from '../state/tapToneAnalyzer'
import type { Spectrum } from '../dsp/guitarFFT'
import {
  listCalibrations,
  saveCalibration,
  deleteCalibration as deleteStoredCalibration,
  type StoredCalibration,
} from '../measurement/calibrationStore'
import { parseCalibration } from '../dsp/calibration'

interface UseAudioEngineArgs {
  engineRef: MutableRefObject<RealtimeFFTAnalyzer | null>
  /** Tap-detection threshold for the engine's initial config. */
  tapThresholdRef: MutableRefObject<number>
  /** The guitar tap sequence finished — App averages the analyzer's accumulated taps into the frozen
   *  result (unless a comparison is frozen) and clears the loaded-measurement state. STABLE. */
  /** Continuous session WAV for the Dump-Capture-Audio diagnostic (one per measurement). STABLE. */
  /** Engine came up — App arms a fresh sequence for the current measurement type (the web's
   *  start() → startTapSequence() branch: guitar arms, plate/brace start the phase machine). STABLE. */
  onStarted: () => void
  /** The lifecycle-state owner, which the engine's callbacks drive. */
  analyzer: TapToneAnalyzer
}

export interface AudioEngineModel {
  running: boolean
  level: number
  liveSpectrum: Spectrum | null
  sampleRate: number | null
  audioSettings: MediaTrackSettings | null
  deviceLabel: string
  error: string | null
  /** What kind of error, so the UI shows the right native-style alert title:
   *  'permission' → "Microphone Access Required", else → "Audio Engine Error". */
  errorKind: 'permission' | 'engine' | 'other' | 'microphone' | null
  setError: (e: string | null) => void
  /** Set alongside `setError` so a non-audio failure (e.g. an export error) shows the neutral
   *  "Error" alert with a plain OK, not "Audio Engine Error" with a bogus Retry. */
  setErrorKind: (k: 'permission' | 'engine' | 'other' | 'microphone' | null) => void
  inputDevices: { deviceId: string; label: string }[]
  currentDeviceId: string | null
  calibrations: StoredCalibration[]
  activeCalId: string | null
  engineMetrics: EngineMetrics | null
  /** Live ring-out (decay) time in seconds, or null — for the Analysis Results panel. */
  /** Re-attempt engine start after a mic error ("Retry microphone"). */
  retry: () => void
  pauseTap: () => void
  resumeTap: () => void
  onSelectDevice: (deviceId: string) => Promise<void>
  onImportCalibration: (file: File) => Promise<void>
  onSelectCalibration: (id: string | null) => void
  onDeleteCalibration: (id: string) => void
}

export function useAudioEngine({
  engineRef,
  tapThresholdRef,
  onStarted,
  analyzer,
}: UseAudioEngineArgs): AudioEngineModel {
  const [running, setRunning] = useState(false)
  const [level, setLevel] = useState(-100)
  const [liveSpectrum, setLiveSpectrum] = useState<Spectrum | null>(null)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [audioSettings, setAudioSettings] = useState<MediaTrackSettings | null>(null)
  const [deviceLabel, setDeviceLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'permission' | 'engine' | 'other' | 'microphone' | null>(null)
  const [inputDevices, setInputDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [calibrations, setCalibrations] = useState<StoredCalibration[]>(listCalibrations)
  const [activeCalId, setActiveCalId] = useState<string | null>(null)
  // Route-change settle timer: on an automatic hardware change the analyzer shows "Audio device changed
  // - reinitializing…" then restores the prompt after this fires (the status is analyzer-owned).
  const deviceChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [engineMetrics, setEngineMetrics] = useState<EngineMetrics | null>(null)

  // Mirror the engine's input state — the device list, the selected input and its calibration.
  const syncDeviceState = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    setInputDevices(engine.availableInputDevices)
    setCurrentDeviceId(engine.inputDeviceId)
    setDeviceLabel(engine.deviceLabel)
    setAudioSettings(engine.audioSettings)
    setActiveCalId((engine.activeCalibration as StoredCalibration | null)?.id ?? null)
  }, [engineRef])

  const onSelectDevice = useCallback(
    async (deviceId: string) => {
      try {
        await engineRef.current?.setInputDevice(deviceId)
      } catch {
        // Not selected, not saved: the previous input is still in use.
        const label = engineRef.current?.availableInputDevices.find((d) => d.deviceId === deviceId)?.label ?? deviceId
        setError(failedOpenMessage(label))
        setErrorKind('microphone')
      }
    },
    [engineRef],
  )

  const onImportCalibration = useCallback(
    async (file: File) => {
      try {
        const cal = parseCalibration(await file.text(), file.name.replace(/\.[^.]+$/, ''))
        if (cal.points.length === 0) throw new Error('No calibration data points found in the file.')
        const stored = saveCalibration(cal)
        setCalibrations(listCalibrations())
        engineRef.current?.chooseCalibration(stored) // activate the newly imported calibration
      } catch (e) {
        setError(`Couldn't import calibration: ${e instanceof Error ? e.message : String(e)}`)
        setErrorKind('other')
      }
    },
    [engineRef],
  )

  const onSelectCalibration = useCallback(
    (id: string | null) => {
      engineRef.current?.chooseCalibration(listCalibrations().find((c) => c.id === id) ?? null)
    },
    [engineRef],
  )

  const onDeleteCalibration = useCallback(
    (id: string) => {
      deleteStoredCalibration(id)
      setCalibrations(listCalibrations())
      engineRef.current?.reloadDeviceCalibration()
    },
    [engineRef],
  )

  const start = useCallback(async () => {
    if (engineRef.current) return
    setError(null)
    setErrorKind(null)
    const engine = new RealtimeFFTAnalyzer(
      {
        onLevel: setLevel,
        // Each live spectrum is shown AND handed to the analyzer, which finds the live peaks from it
        // while a sequence runs (Swift onFftFrame → analyzeMagnitudes).
        onSpectrum: (spectrum) => {
          setLiveSpectrum(spectrum)
          analyzer.onFftFrame(spectrum.magnitudesDb, spectrum.frequencies)
        },
        // The device is the microphone, the FFT and the watchdogs — it hands every chunk up and the
        // TapToneAnalyzer does the rest: pre-roll, detection, gated capture, the tap count, the
        // status strings and the L→C→FLC phase machine. That is Swift's split.
        onAudioFrame: (samples, levelDb, audioTime) => analyzer.processAudioFrame(samples, levelDb, audioTime),
        // Edge-triggered clipping → the analyzer's status override/restore AND the snapshot's isClipping
        // (which drives the threshold-slider red zone), from one source. Swift `$isClipping` sink.
        onClipping: (c) => analyzer.setClipping(c),
        onMetrics: setEngineMetrics,
        onDeviceStateChanged: syncDeviceState,
        // A device plugged in while running could not be opened; the previous input is kept.
        onInputOpenFailed: (message) => {
          setError(message)
          setErrorKind('microphone')
        },
        // The hardware changed the input (a mic attached and selected, or the active one unplugged).
        onInputChanged: () => {
          // Briefly surface "Audio device changed - reinitializing…" then restore the resting prompt
          // (mirrors Swift route change). The analyzer owns the status field.
          analyzer.handleDeviceChange(true)
          if (deviceChangeTimer.current) clearTimeout(deviceChangeTimer.current)
          // 3000 ms matches Swift's fftSettleTime and Python's mirror of it. The settle is how long
          // New Tap stays disabled after a device change, so the number is user-visible behaviour.
          deviceChangeTimer.current = setTimeout(() => analyzer.handleDeviceChange(false), 3000)
        },
      },
      { tapDetectionThreshold: tapThresholdRef.current },
    )
    engineRef.current = engine
    // The dead-input watchdog's user-visible half: the engine detects a silent input, warns to the
    // console and retries; this hands its verdict to the analyzer, which shows the "no audio input"
    // warning in the status line as both natives do. Swift `$inputAppearsDead` sink / Python
    // `inputAppearsDeadChanged` → `_set_input_appears_dead`.
    engine.onInputAppearsDeadChange = (dead) => analyzer.setInputAppearsDead(dead)
    analyzer.setDevice(engine) // the analyzer holds the device to orchestrate material
    try {
      await engine.start()
      // Remount / StrictMode guard: start() is async, so if this component was torn down mid-start the
      // cleanup already nulled engineRef and a second start() may have created a replacement. This
      // engine is orphaned — stop it (so its mic worklet doesn't keep feeding the pipeline as a ghost
      // second instance) and bail before touching any React state. Without this, React's dev double-mount
      // leaves two live mics, and any real remount would leak the same way. stop() is idempotent.
      if (engineRef.current !== engine) {
        void engine.stop()
        return
      }
      setSampleRate(engine.sampleRate)
      syncDeviceState()
      setRunning(true)
      onStarted() // arm a fresh sequence for the current type (guitar or material) — one branch
    } catch (e) {
      // Categorize for the native-style alert: a blocked/denied mic → "Microphone Access
      // Required"; anything else (no device, engine failure) → "Audio Engine Error".
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setError(e instanceof Error ? e.message : String(e))
      setErrorKind(denied ? 'permission' : 'engine')
      engineRef.current = null
    }
  }, [analyzer, engineRef, tapThresholdRef, onStarted, syncDeviceState])

  // Start listening automatically — GuitarTap has no Start button; the only
  // browser-mandated gate is the mic permission prompt itself.
  useEffect(() => {
    void start()
    return () => {
      void engineRef.current?.stop()
      engineRef.current = null
      setRunning(false)
    }
  }, [start, engineRef])

  const pauseTap = useCallback(() => analyzer.pauseTapDetection(), [analyzer])
  const resumeTap = useCallback(() => analyzer.resumeTapDetection(), [analyzer])

  return {
    running,
    level,
    liveSpectrum,
    sampleRate,
    audioSettings,
    deviceLabel,
    error,
    errorKind,
    setError,
    setErrorKind,
    inputDevices,
    currentDeviceId,
    calibrations,
    activeCalId,
    engineMetrics,
    retry: start,
    pauseTap,
    resumeTap,
    onSelectDevice,
    onImportCalibration,
    onSelectCalibration,
    onDeleteCalibration,
  }
}