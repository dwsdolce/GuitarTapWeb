// The view's side of the audio engine, as Swift's view is of `tapToneAnalyzer.fftAnalyzer`: it starts
// the analyzer when the app comes up and stops it when the app goes away, reports a start that fails
// (the alerts, and Retry), and shows what the engine reports — the input level, the live spectrum, the
// FFT metrics, the sample rate, the input devices and their calibrations — subscribing only to those.
// The engine belongs to the analyzer, which subscribes to what it acts on (chunks, frames, a dead input,
// an input change). The calibration store's picker actions (import/select/delete) are here.

import { useCallback, useEffect, useState } from 'react'
import { failedOpenMessage, type EngineMetrics } from '../audio/realtimeFFTAnalyzer'
import type { InputLevel } from '../audio/inputLevel'
import type { TapToneAnalyzer } from '../state/tapToneAnalyzer'
import type { Spectrum } from '../dsp/guitarFFT'
import {
  listCalibrations,
  saveCalibration,
  deleteCalibration as deleteStoredCalibration,
  type StoredCalibration,
} from '../measurement/calibrationStore'
import { parseCalibration } from '../dsp/calibration'
import type { Uuid } from '../measurement/newId'

interface UseAudioEngineArgs {
  /** The lifecycle-state owner, whose engine this shows and starts. */
  analyzer: TapToneAnalyzer
}

export interface AudioEngineModel {
  running: boolean
  /** The engine's input level, for the threshold meter to observe; null until the engine exists. */
  inputLevel: InputLevel | null
  liveSpectrum: Spectrum | null
  sampleRate: number | null
  audioSettings: MediaTrackSettings | null
  deviceLabel: string
  error: string | null
  /** What kind of error, so the UI shows the right native-style alert title:
   *  'permission' → "Microphone Access Required", else → "Audio Engine Error". */
  errorKind: 'permission' | 'engine' | 'other' | 'microphone' | 'export' | null
  setError: (e: string | null) => void
  /** Set alongside `setError` so a non-audio failure (e.g. an export error) shows the neutral
   *  "Error" alert with a plain OK, not "Audio Engine Error" with a bogus Retry. */
  setErrorKind: (k: 'permission' | 'engine' | 'other' | 'microphone' | 'export' | null) => void
  inputDevices: { deviceId: string; label: string }[]
  currentDeviceId: string | null
  calibrations: StoredCalibration[]
  activeCalId: Uuid | null
  engineMetrics: EngineMetrics | null
  /** Live ring-out (decay) time in seconds, or null — for the Analysis Results panel. */
  /** Re-attempt engine start after a mic error ("Retry microphone"). */
  retry: () => void
  pauseTap: () => void
  resumeTap: () => void
  onSelectDevice: (deviceId: string) => Promise<void>
  onImportCalibration: (file: File) => Promise<void>
  onSelectCalibration: (id: string | null) => void
  onDeleteCalibration: (id: Uuid) => void
}

export function useAudioEngine({ analyzer }: UseAudioEngineArgs): AudioEngineModel {
  const engine = analyzer.device!
  const [running, setRunning] = useState(false)
  const [inputLevel, setInputLevel] = useState<InputLevel | null>(null)
  const [liveSpectrum, setLiveSpectrum] = useState<Spectrum | null>(null)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [audioSettings, setAudioSettings] = useState<MediaTrackSettings | null>(null)
  const [deviceLabel, setDeviceLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'permission' | 'engine' | 'other' | 'microphone' | 'export' | null>(null)
  const [inputDevices, setInputDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [calibrations, setCalibrations] = useState<StoredCalibration[]>(listCalibrations)
  const [activeCalId, setActiveCalId] = useState<Uuid | null>(null)
  const [engineMetrics, setEngineMetrics] = useState<EngineMetrics | null>(null)

  // Mirror the engine's input state — the device list, the selected input and its calibration.
  const syncDeviceState = useCallback(() => {
    setInputDevices(engine.availableInputDevices)
    setCurrentDeviceId(engine.inputDeviceId)
    setDeviceLabel(engine.deviceLabel)
    setAudioSettings(engine.audioSettings)
    setActiveCalId((engine.activeCalibration as StoredCalibration | null)?.id ?? null)
  }, [engine])

  const onSelectDevice = useCallback(
    async (deviceId: string) => {
      try {
        await engine.setInputDevice(deviceId)
      } catch {
        // Not selected, not saved: the previous input is still in use.
        const label = engine.availableInputDevices.find((d) => d.deviceId === deviceId)?.label ?? deviceId
        setError(failedOpenMessage(label))
        setErrorKind('microphone')
      }
    },
    [engine],
  )

  const onImportCalibration = useCallback(
    async (file: File) => {
      try {
        const cal = parseCalibration(await file.text(), file.name.replace(/\.[^.]+$/, ''))
        if (cal.points.length === 0) throw new Error('No calibration data points found in the file.')
        const stored = saveCalibration(cal)
        setCalibrations(listCalibrations())
        engine.chooseCalibration(stored) // activate the newly imported calibration
      } catch (e) {
        setError(`Couldn't import calibration: ${e instanceof Error ? e.message : String(e)}`)
        setErrorKind('other')
      }
    },
    [engine],
  )

  const onSelectCalibration = useCallback(
    (id: string | null) => {
      engine.chooseCalibration(listCalibrations().find((c) => c.id === id) ?? null)
    },
    [engine],
  )

  const onDeleteCalibration = useCallback(
    (id: Uuid) => {
      deleteStoredCalibration(id)
      setCalibrations(listCalibrations())
      engine.reloadDeviceCalibration()
    },
    [engine],
  )

  // Start the analyzer — its engine, the warm-up and the guarded auto-start — and report a failure as
  // the native-style alert: a blocked/denied mic → "Microphone Access Required"; anything else (no
  // device, engine failure) → "Audio Engine Error". Retry calls it again, on the same engine.
  const start = useCallback(async () => {
    setError(null)
    setErrorKind(null)
    try {
      await analyzer.start()
      if (!engine.running) return // stopped while starting (the app went away)
      setSampleRate(engine.sampleRate)
      syncDeviceState()
      setRunning(true)
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setError(e instanceof Error ? e.message : String(e))
      setErrorKind(denied ? 'permission' : 'engine')
    }
  }, [analyzer, engine, syncDeviceState])

  // Start listening automatically — GuitarTap has no Start button; the only browser-mandated gate is
  // the mic permission prompt itself. The engine handles React's remount (start, stop, start) itself.
  useEffect(() => {
    setInputLevel(engine.level)
    const unsubscribe = [
      engine.onSpectrum(setLiveSpectrum),
      engine.onMetrics(setEngineMetrics),
      engine.onDeviceStateChanged(syncDeviceState),
      // A device plugged in while running could not be opened; the previous input is kept.
      engine.onInputOpenFailed((message) => {
        setError(message)
        setErrorKind('microphone')
      }),
    ]
    void start()
    return () => {
      for (const off of unsubscribe) off()
      void analyzer.stop()
      setRunning(false)
    }
  }, [analyzer, engine, start, syncDeviceState])

  const pauseTap = useCallback(() => analyzer.pauseTapDetection(), [analyzer])
  const resumeTap = useCallback(() => analyzer.resumeTapDetection(), [analyzer])

  return {
    running,
    inputLevel,
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