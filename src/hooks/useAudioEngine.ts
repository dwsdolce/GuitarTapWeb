// ViewModel for the audio engine — the web counterpart of Swift's RealtimeFFTAnalyzer /
// Python's tap_tone_analyzer (the audio *model* layer). Owns the engine instance lifecycle
// (auto-start on mount, stop on unmount), the live telemetry state (running / level / spectrum /
// engine state / clipping / multi-tap progress / FFT metrics / sample rate / device label / error),
// and the audio-input + calibration subsystem (device list/switch, calibration import/select/delete
// with device-specific resolution). Extracted from App (Phase 6 6-ARCH).
//
// `engineRef` and `calibrationRef` are owned by App (shared handles: the material session arms the
// engine; build/save read the calibration) and passed in — this hook populates them. The
// capture-result callbacks (guitar tap, material phase, raw-audio dump) are passed in stable so the
// engine's once-registered callbacks never capture stale closures.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { AudioEngine, type EngineState, type EngineMetrics, type MaterialCaptureResult } from '../audio/engine'
import type { Spectrum } from '../dsp/guitarFFT'
import type { Calibration } from '../dsp/calibration'
import { isMaterialType, type MeasurementType } from '../settings'
import {
  listCalibrations,
  saveCalibration,
  deleteCalibration as deleteStoredCalibration,
  setActiveCalibrationId,
  setCalibrationForDevice,
  resolveActiveCalibration,
  getSavedInputDeviceId,
  setSavedInputDeviceId,
  type StoredCalibration,
} from '../measurement/calibrationStore'
import { parseCalibration } from '../dsp/calibration'

interface UseAudioEngineArgs {
  engineRef: MutableRefObject<AudioEngine | null>
  calibrationRef: MutableRefObject<Calibration | null>
  /** Current measurement type — start disarms guitar detection when loaded straight into material. */
  measRef: MutableRefObject<MeasurementType>
  /** Tap-detection threshold for the engine's initial config. */
  tapThresholdRef: MutableRefObject<number>
  /** "Dump Capture Audio" diagnostic flag for the engine's initial config (gates session recording). */
  dumpCaptureRef: MutableRefObject<boolean>
  /** A guitar tap (or averaged multi-tap) was captured — App stores the frozen result. STABLE. */
  onGuitarCapture: (spectrum: Spectrum, taps?: Spectrum[]) => void
  /** A gated material phase was captured — the material session records + advances. STABLE. */
  onMaterialCapture: (r: MaterialCaptureResult) => void
  /** Continuous session WAV for the Dump-Capture-Audio diagnostic (one per measurement). STABLE. */
  onSessionAudio: (samples: Float32Array, sampleRate: number, label: string) => void
}

export interface AudioEngineModel {
  running: boolean
  engineState: EngineState
  level: number
  liveSpectrum: Spectrum | null
  sampleRate: number | null
  audioSettings: MediaTrackSettings | null
  deviceLabel: string
  error: string | null
  /** What kind of error, so the UI shows the right native-style alert title:
   *  'permission' → "Microphone Access Required", else → "Audio Engine Error". */
  errorKind: 'permission' | 'engine' | 'other' | null
  setError: (e: string | null) => void
  inputDevices: { deviceId: string; label: string }[]
  currentDeviceId: string | null
  calibrations: StoredCalibration[]
  activeCalId: string | null
  clipping: boolean
  deviceChanging: boolean
  progress: { collected: number; total: number }
  setProgress: (p: { collected: number; total: number }) => void
  engineMetrics: EngineMetrics | null
  /** Live ring-out (decay) time in seconds, or null — for the Analysis Results panel. */
  decayTime: number | null
  /** Re-attempt engine start after a mic error ("Retry microphone"). */
  retry: () => void
  pauseTap: () => void
  resumeTap: () => void
  refreshDevices: () => Promise<void>
  onSelectDevice: (deviceId: string) => Promise<void>
  onImportCalibration: (file: File) => Promise<void>
  onSelectCalibration: (id: string | null) => void
  onDeleteCalibration: (id: string) => void
  /** Resolve + apply the calibration for a device (device-specific → global → none). */
  applyCalibrationForDevice: (deviceId: string | null) => void
}

export function useAudioEngine({
  engineRef,
  calibrationRef,
  measRef,
  tapThresholdRef,
  onGuitarCapture,
  onMaterialCapture,
  onSessionAudio,
  dumpCaptureRef,
}: UseAudioEngineArgs): AudioEngineModel {
  const [running, setRunning] = useState(false)
  const [engineState, setEngineState] = useState<EngineState>('idle')
  const [level, setLevel] = useState(-100)
  const [liveSpectrum, setLiveSpectrum] = useState<Spectrum | null>(null)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [audioSettings, setAudioSettings] = useState<MediaTrackSettings | null>(null)
  const [deviceLabel, setDeviceLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'permission' | 'engine' | 'other' | null>(null)
  const [inputDevices, setInputDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [calibrations, setCalibrations] = useState<StoredCalibration[]>(listCalibrations)
  const [activeCalId, setActiveCalId] = useState<string | null>(null)
  const [clipping, setClipping] = useState(false)
  // Transient "Audio device changed - reinitializing…" flag (Swift route-change status),
  // set on an automatic hardware change and cleared shortly after.
  const [deviceChanging, setDeviceChanging] = useState(false)
  const deviceChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [progress, setProgress] = useState({ collected: 0, total: 1 })
  const [engineMetrics, setEngineMetrics] = useState<EngineMetrics | null>(null)
  const [decayTime, setDecayTime] = useState<number | null>(null)

  // Resolve the calibration for a device (device-specific → global → none) and apply it to the
  // engine + UI + the refs read by matSearch/save. Mirrors RealtimeFFTAnalyzer's auto-apply.
  const applyCalibrationForDevice = useCallback(
    (deviceId: string | null) => {
      const cal = resolveActiveCalibration(deviceId)
      calibrationRef.current = cal
      setActiveCalId(cal?.id ?? null)
      engineRef.current?.setCalibration(cal)
    },
    [calibrationRef, engineRef],
  )

  const refreshDevices = useCallback(async () => {
    const list = await engineRef.current?.listInputs()
    if (list) setInputDevices(list)
  }, [engineRef])

  const onSelectDevice = useCallback(
    async (deviceId: string) => {
      try {
        await engineRef.current?.setInputDevice(deviceId)
      } catch (e) {
        setError(`Couldn't switch input: ${e instanceof Error ? e.message : String(e)}`)
        setErrorKind('other')
        return
      }
      const id = engineRef.current?.inputDeviceId ?? deviceId
      setSavedInputDeviceId(id)
      setCurrentDeviceId(id)
      setDeviceLabel(engineRef.current?.deviceLabel ?? '')
      setSampleRate(engineRef.current?.sampleRate ?? null)
      setAudioSettings(engineRef.current?.audioSettings ?? null)
      applyCalibrationForDevice(id)
      void refreshDevices()
    },
    [engineRef, applyCalibrationForDevice, refreshDevices],
  )

  const onImportCalibration = useCallback(
    async (file: File) => {
      try {
        const cal = parseCalibration(await file.text(), file.name.replace(/\.[^.]+$/, ''))
        if (cal.points.length === 0) throw new Error('No calibration data points found in the file.')
        const stored = saveCalibration(cal)
        setCalibrations(listCalibrations())
        setActiveCalibrationId(stored.id) // global active
        if (currentDeviceId) setCalibrationForDevice(currentDeviceId, stored.id) // remember for this mic
        applyCalibrationForDevice(currentDeviceId)
      } catch (e) {
        setError(`Couldn't import calibration: ${e instanceof Error ? e.message : String(e)}`)
        setErrorKind('other')
      }
    },
    [applyCalibrationForDevice, currentDeviceId],
  )

  const onSelectCalibration = useCallback(
    (id: string | null) => {
      setActiveCalibrationId(id)
      if (currentDeviceId) setCalibrationForDevice(currentDeviceId, id)
      applyCalibrationForDevice(currentDeviceId)
    },
    [applyCalibrationForDevice, currentDeviceId],
  )

  const onDeleteCalibration = useCallback(
    (id: string) => {
      deleteStoredCalibration(id)
      setCalibrations(listCalibrations())
      applyCalibrationForDevice(currentDeviceId)
    },
    [applyCalibrationForDevice, currentDeviceId],
  )

  const start = useCallback(async () => {
    if (engineRef.current) return
    setError(null)
    setErrorKind(null)
    const engine = new AudioEngine(
      {
        onLevel: setLevel,
        onSpectrum: setLiveSpectrum,
        onCapture: onGuitarCapture,
        onState: setEngineState,
        onClipping: setClipping,
        onProgress: (collected, total) => setProgress({ collected, total }),
        onMetrics: setEngineMetrics,
        onMaterialCapture,
        onSessionAudio,
        // A mic was attached (auto-selected) or the active one was unplugged (fell back): re-sync the
        // device + RELOAD that device's calibration (None if it has none). Mirrors Swift's didSet.
        onInputChanged: (deviceId) => {
          setCurrentDeviceId(deviceId)
          setDeviceLabel(engineRef.current?.deviceLabel ?? '')
          setAudioSettings(engineRef.current?.audioSettings ?? null)
          if (deviceId) setSavedInputDeviceId(deviceId) // remember the now-active device (Swift persists it)
          applyCalibrationForDevice(deviceId)
          void refreshDevices()
          // Briefly surface "Audio device changed - reinitializing…" (mirrors Swift route change).
          setDeviceChanging(true)
          if (deviceChangeTimer.current) clearTimeout(deviceChangeTimer.current)
          deviceChangeTimer.current = setTimeout(() => setDeviceChanging(false), 1500)
        },
        onDecay: setDecayTime,
      },
      { tapDetectionThreshold: tapThresholdRef.current, dumpCaptureAudio: dumpCaptureRef.current },
    )
    engineRef.current = engine
    try {
      await engine.start(getSavedInputDeviceId())
      setSampleRate(engine.sampleRate)
      setAudioSettings(engine.audioSettings)
      setDeviceLabel(engine.deviceLabel)
      setCurrentDeviceId(engine.inputDeviceId)
      setRunning(true)
      applyCalibrationForDevice(engine.inputDeviceId) // auto-apply the device's calibration
      void refreshDevices() // labels are available now that permission is granted
      // If we loaded straight into a material type, don't leave guitar detection armed.
      if (isMaterialType(measRef.current)) engine.disarm()
    } catch (e) {
      // Categorize for the native-style alert: a blocked/denied mic → "Microphone Access
      // Required"; anything else (no device, engine failure) → "Audio Engine Error".
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setError(e instanceof Error ? e.message : String(e))
      setErrorKind(denied ? 'permission' : 'engine')
      engineRef.current = null
    }
  }, [engineRef, measRef, tapThresholdRef, dumpCaptureRef, onGuitarCapture, onMaterialCapture, onSessionAudio, applyCalibrationForDevice, refreshDevices])

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

  const pauseTap = useCallback(() => engineRef.current?.pause(), [engineRef])
  const resumeTap = useCallback(() => engineRef.current?.resume(), [engineRef])

  return {
    running,
    engineState,
    level,
    liveSpectrum,
    sampleRate,
    audioSettings,
    deviceLabel,
    error,
    errorKind,
    setError,
    inputDevices,
    currentDeviceId,
    calibrations,
    activeCalId,
    clipping,
    deviceChanging,
    progress,
    setProgress,
    engineMetrics,
    decayTime,
    retry: start,
    pauseTap,
    resumeTap,
    refreshDevices,
    onSelectDevice,
    onImportCalibration,
    onSelectCalibration,
    onDeleteCalibration,
    applyCalibrationForDevice,
  }
}