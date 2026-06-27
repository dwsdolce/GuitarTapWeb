import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine, type EngineState, type EngineMetrics, type MaterialSearch } from './audio/engine'
import { SpectrumChart, type PeakMarker, type ChartView, type ResetTarget, type ResetAxis, type SpectrumOverlay } from './components/SpectrumChart'
import { ThresholdMeter } from './components/ThresholdMeter'
import { PeakCard } from './components/PeakCard'
import { SettingsPanel } from './components/SettingsPanel'
import { MetricsPanel, type Metrics } from './components/MetricsPanel'
import { SaveSheet } from './components/SaveSheet'
import { PlayFileSheet } from './components/PlayFileSheet'
import { MeasurementsPanel } from './components/MeasurementsPanel'
import { MaterialResults, type MaterialPeaks } from './components/MaterialResults'
import {
  buildGuitarMeasurement,
  buildMaterialMeasurement,
  buildComparisonEntries,
  buildComparisonMeasurement,
  comparisonEntryModeFreqs,
  comparisonAxisRange,
  colorComponentsToCss,
  measurementToLive,
  measurementToLiveMaterial,
  measurementWarning,
} from './measurement/fromLive'
import { ComparisonResultsView, type ComparisonRow } from './components/ComparisonResultsView'
import { saveMeasurement } from './measurement/store'
import { parseCalibration, type Calibration } from './dsp/calibration'
import { decodeWav } from './dsp/wav'
import { exportSpectrumPng, type SpectrumImageOpts } from './components/spectrumExport'
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
} from './measurement/calibrationStore'
import type { TapToneMeasurementModel, ComparisonEntryModel } from './measurement'
import { MODE_COLOR, MODE_DISPLAY_NAME } from './components/modeColors'
import { GUITAR_FFT_SIZE, modePeaksFromSpectrum, type Spectrum } from './dsp/guitarFFT'
import {
  MultiTapComparisonResultsView,
  MULTITAP_PALETTE,
  MULTITAP_AVG_COLOR,
  type MultiTapRow,
  type TapModeFreqs,
} from './components/MultiTapComparisonResultsView'
import { findPeaks, type Peak } from './dsp/peaks'
import { classifyAll, resolvedModePeaks, type ResolvedMode } from './dsp/classify'
import { PLATE_PHASES, BRACE_PHASE } from './dsp/gatedCapture'
import { modeBands, type GuitarTypeName } from './dsp/guitarModes'
import { Pitch } from './dsp/pitch'
import {
  loadSettings,
  saveSettings,
  isGuitarType,
  isMaterialType,
  MEASUREMENT_SHORT_NAME,
  DEFAULT_SETTINGS,
  ANNOTATION_NEXT,
  ANNOTATION_LABEL,
  type Settings,
} from './settings'
import './App.css'

const pitch = new Pitch(440)

// Per-phase material spectra, overlaid on the chart (mirrors Swift's materialSpectra:
// Longitudinal always; Cross + optional FLC for plate). Colors match the markers.
type MatSpectra = { longitudinal: Spectrum | null; cross: Spectrum | null; flc: Spectrum | null }
const EMPTY_MAT_SPECTRA: MatSpectra = { longitudinal: null, cross: null, flc: null }
const MAT_L_COLOR = '#4ea1ff'
const MAT_C_COLOR = '#f0a03a'
const MAT_FLC_COLOR = '#b07ad8'

const fmtProc = (b: unknown) => (b === undefined ? '?' : b ? 'ON' : 'off')

function statusText(state: EngineState, progress: { collected: number; total: number }): string {
  const { collected, total } = progress
  const multi = total > 1
  const n = `${Math.min(collected + 1, total)} of ${total}`
  switch (state) {
    case 'listening':
      return multi ? `Listening — tap ${n}` : 'Listening — tap the guitar'
    case 'capturing':
      return multi ? `Capturing tap ${n}…` : 'Capturing tap…'
    case 'paused':
      // The exact string Swift/Python use — one message, no per-count variant.
      return 'Detection paused – tap freely, then resume'
    case 'idle':
      return multi ? `Averaged ${total} taps — press New Tap to listen again` : 'Tap captured — press New Tap to listen again'
  }
}

// Material measurement phases (MaterialTapPhase.swift). Brace: capturingL → complete.
type MatPhase =
  | 'notStarted'
  | 'capturingL'
  | 'reviewingL'
  | 'capturingC'
  | 'reviewingC'
  | 'capturingFlc'
  | 'reviewingFlc'
  | 'complete'

const isReviewing = (p: MatPhase) => p === 'reviewingL' || p === 'reviewingC' || p === 'reviewingFlc'

function matInstruction(p: MatPhase, brace: boolean): string {
  switch (p) {
    case 'notStarted':
      return 'Press New Tap to begin measurement'
    case 'capturingL':
      return brace ? 'Tap the brace (longitudinal)…' : 'Tap along the grain (longitudinal)…'
    case 'reviewingL':
      return 'L tap captured — Accept to continue or Redo to re-tap'
    case 'capturingC':
      return 'Tap across the grain (cross)…'
    case 'reviewingC':
      return 'C tap captured — Accept to continue or Redo to re-tap'
    case 'capturingFlc':
      return 'Hold at the long-edge midpoint; tap near the opposite corner (~22%)…'
    case 'reviewingFlc':
      return 'FLC tap captured — Accept to complete or Redo to re-tap'
    case 'complete':
      return 'Measurement complete'
  }
}

// Tap-control button icons (Lucide-style, monochrome `currentColor` so they follow each button's
// text colour and disabled opacity). Mirror the native glyphs: Swift SF Symbols / Python qtawesome —
// New Tap = hand.tap/gesture-tap, Pause = pause.circle, Resume = play.circle, Cancel = xmark/times-
// circle, Accept = checkmark.circle (review), Redo = arrow.counterclockwise/undo (review).
const ICON_SVG = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const
const TapIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M22 14a8 8 0 0 1-8 8" />
    <path d="M18 11v-1a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
    <path d="M14 10V9a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1" />
    <path d="M10 9.5V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v10" />
    <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
)
const PauseIcon = () => (
  <svg {...ICON_SVG}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
)
const PlayIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M6 4 20 12 6 20 Z" />
  </svg>
)
const CancelIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </svg>
)
const CheckIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
const UndoIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 8.97 8.97 0 0 0-6.4 2.6L3 13" />
  </svg>
)
// App control-bar icons (replace the colored emoji ⇅ 👁 ★ 🚫 ⤓ ⚙ with monochrome SVG that match
// the native control-bar glyphs and the tap-control icons above).
const AutoDbIcon = () => (
  <svg {...ICON_SVG}>
    <path d="m21 16-4 4-4-4" />
    <path d="M17 20V4" />
    <path d="m3 8 4-4 4 4" />
    <path d="M7 4v16" />
  </svg>
)
const EyeIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const StarIcon = () => (
  <svg {...ICON_SVG}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
  </svg>
)
const EyeOffIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
)
const SaveIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </svg>
)
const ClipboardIcon = () => (
  <svg {...ICON_SVG}>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" />
    <path d="M12 16h4" />
    <path d="M8 11h.01" />
    <path d="M8 16h.01" />
  </svg>
)
const BarChartIcon = () => (
  <svg {...ICON_SVG}>
    <line x1="6" x2="6" y1="20" y2="14" />
    <line x1="12" x2="12" y1="20" y2="8" />
    <line x1="18" x2="18" y1="20" y2="4" />
  </svg>
)
const GearIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const FilePlayIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="10 8 16 12 10 16 10 8" />
  </svg>
)

export default function App() {
  const [running, setRunning] = useState(false)
  const [engineState, setEngineState] = useState<EngineState>('idle')
  const [level, setLevel] = useState(-100)
  const [liveSpectrum, setLiveSpectrum] = useState<Spectrum | null>(null)
  const [captured, setCaptured] = useState<Spectrum | null>(null)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [audioSettings, setAudioSettings] = useState<MediaTrackSettings | null>(null)
  const [deviceLabel, setDeviceLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Audio Input & Calibration (apply immediately; NOT part of the buffered Settings dialog).
  const [inputDevices, setInputDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [calibrations, setCalibrations] = useState<StoredCalibration[]>(listCalibrations)
  // The calibration id currently *applied* for the active device (resolved: device map > global).
  const [activeCalId, setActiveCalId] = useState<string | null>(null)
  // Mirror of the applied calibration for matSearch + save provenance (read from stable refs).
  const calibrationRef = useRef<Calibration | null>(null)

  const [numberOfTaps, setNumberOfTaps] = useState(1)
  const [clipping, setClipping] = useState(false)
  const [progress, setProgress] = useState({ collected: 0, total: 1 })
  // True after a Cancel until the next New Tap — drives the "Cancelled" status (mirrors
  // Swift's "Cancelled — press New Tap to start again").
  const [cancelled, setCancelled] = useState(false)
  // Per-tap spectra from a multi-tap capture (or loaded measurement) + the comparison toggle.
  const [tapSpectra, setTapSpectra] = useState<Spectrum[]>([])
  const [showMultiTap, setShowMultiTap] = useState(false)
  // Active comparison overlay (created from a selection or loaded). Non-null = comparison mode.
  const [comparison, setComparison] = useState<ComparisonEntryModel[] | null>(null)

  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showPlayFile, setShowPlayFile] = useState(false)
  // Name of the file currently playing through the pipeline (drives the status bar), or null.
  const [playingFileName, setPlayingFileName] = useState<string | null>(null)
  const [showMetrics, setShowMetrics] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [showMeasurements, setShowMeasurements] = useState(false)
  // Load-time provenance warning for a loaded measurement (mic/calibration/sample rate).
  const [loadWarning, setLoadWarning] = useState<string | null>(null)
  // Name of the currently loaded measurement → chart title ("FFT Peaks — {name}", else "New").
  const [loadedName, setLoadedName] = useState<string | null>(null)
  // Auto-dB is session-only (Swift keeps isAutoScaleEnabled as transient @State);
  // annotation visibility persists via settings.
  const [autoDb, setAutoDb] = useState(false)
  const [engineMetrics, setEngineMetrics] = useState<EngineMetrics | null>(null)
  const annotationMode = settings.annotationVisibilityMode
  const guitarType: GuitarTypeName = isGuitarType(settings.measurementType) ? settings.measurementType : 'generic'
  const material = isMaterialType(settings.measurementType)
  const brace = settings.measurementType === 'brace'
  const { displayMinHz, displayMaxHz, minDb, maxDb, analysisMinHz, analysisMaxHz, showUnknownModes } = settings
  const peakMin = settings.peakMinThreshold
  const tapThreshold = settings.tapDetectionThreshold

  // Material measurement state. Engine callbacks are registered once, so the phase
  // and measurement type are mirrored into refs for the onMaterialCapture handler.
  const [matPhase, setMatPhaseState] = useState<MatPhase>('notStarted')
  const [matPeaks, setMatPeaks] = useState<MaterialPeaks>({ longitudinal: null, cross: null, flc: null })
  const [matSpectra, setMatSpectra] = useState<MatSpectra>(EMPTY_MAT_SPECTRA)
  const matPhaseRef = useRef<MatPhase>('notStarted')
  const setMatPhase = useCallback((p: MatPhase) => {
    matPhaseRef.current = p
    setMatPhaseState(p)
  }, [])
  const measRef = useRef(settings.measurementType)
  measRef.current = settings.measurementType
  const measureFlcRef = useRef(settings.measureFlc)
  measureFlcRef.current = settings.measureFlc
  const tapThresholdRef = useRef(settings.tapDetectionThreshold)
  tapThresholdRef.current = settings.tapDetectionThreshold

  // Loading a saved measurement sets the type, spectrum, peaks, and selection together;
  // these refs suppress the one-shot "reset on change" effects so the restore isn't clobbered.
  const skipNextTypeResetRef = useRef(false)
  const loadingRef = useRef(false)
  // While a comparison is frozen, a tap-capture already in flight (started before Compare)
  // must not clobber it — onCapture checks this ref. Kept in sync with `comparison` below.
  const comparisonRef = useRef(false)
  // Peaks from a loaded measurement are authoritative: while set, Peak Min only FILTERS
  // them by magnitude — findPeaks is never re-run on the loaded spectrum (matches Swift
  // recalculateFrozenPeaksIfNeeded / Python recalculate_frozen_peaks_if_needed). Cleared
  // on a fresh live capture / New Tap / measurement-type change, reverting to findPeaks.
  const [loadedPeaks, setLoadedPeaks] = useState<Peak[] | null>(null)

  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])
  useEffect(() => saveSettings(settings), [settings])
  // Ask the browser to make storage persistent so the saved-measurements library (IndexedDB)
  // isn't evicted under pressure. Best-effort: Chrome/Firefox honor it; Safari mostly ignores
  // it (there, installing the app is what makes storage durable — see the Measurements hint).
  useEffect(() => {
    void navigator.storage?.persist?.()
  }, [])
  useEffect(() => {
    comparisonRef.current = comparison != null
  }, [comparison])
  // Switching measurement type resets the current result (mirrors the native
  // measurementChanged reset across the guitar↔material boundary) and arms/disarms
  // the always-on guitar detector accordingly. Skipped while loading a measurement,
  // which sets the type and the restored result in the same commit.
  useEffect(() => {
    if (skipNextTypeResetRef.current) {
      skipNextTypeResetRef.current = false
      return
    }
    setLoadedPeaks(null)
    setCaptured(null)
    setLoadedName(null)
    setTapSpectra([])
    setShowMultiTap(false)
    setComparison(null)
    comparisonRef.current = false
    setMatPhase('notStarted')
    setMatPeaks({ longitudinal: null, cross: null, flc: null })
    setMatSpectra(EMPTY_MAT_SPECTRA)
    const e = engineRef.current
    if (!e?.running) return
    if (isMaterialType(settings.measurementType)) e.disarm()
    else e.arm()
  }, [settings.measurementType, setMatPhase])

  const engineRef = useRef<AudioEngine | null>(null)

  // Resolve the calibration for a device (device-specific → global → none) and apply it to the
  // engine + UI + the refs read by matSearch/save. Mirrors RealtimeFFTAnalyzer's auto-apply.
  const applyCalibrationForDevice = useCallback((deviceId: string | null) => {
    const cal = resolveActiveCalibration(deviceId)
    calibrationRef.current = cal
    setActiveCalId(cal?.id ?? null)
    engineRef.current?.setCalibration(cal)
  }, [])

  const refreshDevices = useCallback(async () => {
    const list = await engineRef.current?.listInputs()
    if (list) setInputDevices(list)
  }, [])

  const onSelectDevice = useCallback(
    async (deviceId: string) => {
      try {
        await engineRef.current?.setInputDevice(deviceId)
      } catch (e) {
        setError(`Couldn't switch input: ${e instanceof Error ? e.message : String(e)}`)
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
    [applyCalibrationForDevice, refreshDevices],
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

  // Play a recorded WAV through the live pipeline (Swift openAudioFile/startFromFile). Resets the
  // view like New Tap, applies an optional calibration for the playback, then pumps. Guitar arms a
  // tap sequence; material (plate/brace) arms phase L and auto-advances L→C→FLC during playback.
  const onPlayFile = useCallback(async (audio: File, calFile: File | null) => {
    if (!engineRef.current) return
    try {
      // downmix:true → average channels to mono (matches Swift readAudioFileAsMonoFloat32 and the
      // mono live-mic path); a no-op for already-mono files.
      const { samples, sampleRate: fileRate } = decodeWav(new Uint8Array(await audio.arrayBuffer()), {
        downmix: true,
      })
      let cal: Calibration | null = null
      if (calFile) {
        const parsed = parseCalibration(await calFile.text(), calFile.name.replace(/\.[^.]+$/, ''))
        if (parsed.points.length) cal = parsed
      }
      setLoadedPeaks(null)
      setLoadWarning(null)
      setLoadedName(null)
      setCaptured(null)
      setTapSpectra([])
      setShowMultiTap(false)
      setComparison(null)
      setCancelled(false)
      comparisonRef.current = false
      setPlayingFileName(audio.name)
      if (isMaterialType(measRef.current)) {
        // Material: fresh phase machine; the engine owns the L→C→(FLC) auto-advance session.
        setMatPeaks({ longitudinal: null, cross: null, flc: null })
        setMatSpectra(EMPTY_MAT_SPECTRA)
        setMatPhase('capturingL')
        await engineRef.current.playFile(samples, fileRate, {
          material: { brace: measRef.current === 'brace', measureFlc: measureFlcRef.current, calibration: cal },
        })
      } else {
        await engineRef.current.playFile(samples, fileRate, { calibration: cal })
      }
    } catch (e) {
      setError(`Couldn't play file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPlayingFileName(null)
    }
  }, [setMatPhase])

  const start = useCallback(async () => {
    if (engineRef.current) return
    setError(null)
    const engine = new AudioEngine({
      onLevel: setLevel,
      onSpectrum: setLiveSpectrum,
      onCapture: (s, taps) => {
        if (comparisonRef.current) return // a frozen comparison absorbs in-flight captures
        setLoadedPeaks(null) // a fresh capture supersedes any loaded measurement
        setLoadWarning(null)
        setLoadedName(null)
        setCaptured(s)
        setTapSpectra(taps ?? []) // per-tap spectra for the multi-tap comparison view
        setShowMultiTap(false)
        setComparison(null)
      },
      onState: setEngineState,
      onClipping: setClipping,
      onProgress: (collected, total) => setProgress({ collected, total }),
      onMetrics: setEngineMetrics,
      onMaterialCapture: ({ spectrum, peak, phase }) => {
        // `phase` is set by the engine during a file-playback session (it owns the L→C→FLC
        // auto-advance, mirroring Swift's isPlayingFile); for LIVE capture it's undefined and we
        // derive it from the current UI phase. We update the captured slot + reflect progress in
        // the UI phase. During playback the engine re-arms the next phase (we do NOT here); during
        // live capture the user advances via Accept (acceptMaterial).
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
          if (measRef.current === 'brace') setMatPhase('complete')
          else setMatPhase(playing ? 'capturingC' : 'reviewingL')
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
    }, { tapDetectionThreshold: tapThresholdRef.current })
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
      setError(e instanceof Error ? e.message : String(e))
      engineRef.current = null
    }
  }, [setMatPhase, applyCalibrationForDevice, refreshDevices])

  // Start listening automatically — GuitarTap has no Start button; the only
  // browser-mandated gate is the mic permission prompt itself.
  useEffect(() => {
    void start()
    return () => {
      void engineRef.current?.stop()
      engineRef.current = null
      setRunning(false)
    }
  }, [start])

  // Re-enumerate inputs whenever the Settings dialog opens, so a freshly-plugged
  // microphone shows up in the device picker without a reload.
  useEffect(() => {
    if (showSettings && running) void refreshDevices()
  }, [showSettings, running, refreshDevices])

  const newTap = useCallback(() => {
    setLoadedPeaks(null)
    setLoadWarning(null)
    setLoadedName(null)
    setCaptured(null)
    setTapSpectra([])
    setShowMultiTap(false)
    setComparison(null)
    setCancelled(false)
    comparisonRef.current = false // re-arm cleanly: don't absorb the next tap
    engineRef.current?.arm()
  }, [])

  // ── Pause / Resume / Cancel (mirror Swift pauseTapDetection / resumeTapDetection /
  //    cancelTapSequence; the engine owns the state transitions). ─────────────────
  const pauseTap = useCallback(() => engineRef.current?.pause(), [])
  const resumeTap = useCallback(() => engineRef.current?.resume(), [])
  const cancelTap = useCallback(() => {
    engineRef.current?.cancel()
    setProgress({ collected: 0, total: numberOfTaps })
    if (isMaterialType(measRef.current)) {
      setMatPhase('notStarted')
      setMatPeaks({ longitudinal: null, cross: null, flc: null })
      setMatSpectra(EMPTY_MAT_SPECTRA)
    }
    setCancelled(true)
  }, [numberOfTaps, setMatPhase])

  const changeTaps = useCallback((n: number) => {
    const v = Math.max(1, Math.min(10, n))
    setNumberOfTaps(v)
    engineRef.current?.setConfig({ numberOfTaps: v })
  }, [])

  // ── Material measurement: phase machine drives gated captures ─────────────
  const matSearch = useCallback((phase: 'longitudinal' | 'cross' | 'flc'): MaterialSearch => {
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
  }, [])

  const startMaterial = useCallback(() => {
    setCancelled(false)
    setMatPeaks({ longitudinal: null, cross: null, flc: null })
    setMatSpectra(EMPTY_MAT_SPECTRA)
    setMatPhase('capturingL')
    engineRef.current?.armMaterial(matSearch('longitudinal'))
  }, [matSearch, setMatPhase])

  const acceptMaterial = useCallback(() => {
    const phase = matPhaseRef.current
    if (phase === 'reviewingL') {
      setMatPhase('capturingC')
      engineRef.current?.armMaterial(matSearch('cross'))
    } else if (phase === 'reviewingC') {
      if (measureFlcRef.current) {
        setMatPhase('capturingFlc')
        engineRef.current?.armMaterial(matSearch('flc'))
      } else {
        setMatPhase('complete')
      }
    } else if (phase === 'reviewingFlc') {
      setMatPhase('complete')
    }
  }, [matSearch, setMatPhase])

  const redoMaterial = useCallback(() => {
    const phase = matPhaseRef.current
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
  }, [matSearch, setMatPhase])

  // Lock the stepper while a tap is being captured or a multi-tap sequence is underway.
  const tapsLocked =
    engineState === 'capturing' ||
    ((engineState === 'listening' || engineState === 'paused') && progress.collected > 0)

  // Live-tap path: re-analyze the frozen spectrum as Peak Min / guitar type change.
  // Loaded-measurement path: the saved peaks are authoritative — only filter them by
  // magnitude, never re-run findPeaks on the loaded spectrum (the spectrum is stored
  // for display only and may not reproduce the saved peaks). Mirrors Swift/Python
  // recalculateFrozenPeaksIfNeeded.
  const peaks = useMemo(() => {
    if (material) return []
    if (loadedPeaks) return loadedPeaks.filter((p) => p.magnitude >= peakMin)
    if (!captured) return []
    return findPeaks(captured.magnitudesDb, captured.frequencies, {
      guitarType,
      minHz: analysisMinHz,
      maxHz: analysisMaxHz,
      peakMinThreshold: peakMin,
    })
  }, [captured, material, loadedPeaks, guitarType, analysisMinHz, analysisMaxHz, peakMin])

  const sortedPeaks = useMemo(() => [...peaks].sort((a, b) => a.frequency - b.frequency), [peaks])
  const modeByPeak = useMemo(() => classifyAll(peaks, guitarType), [peaks, guitarType])
  const displayPeaks = useMemo(
    () =>
      showUnknownModes
        ? sortedPeaks
        : sortedPeaks.filter((p) => (modeByPeak.get(p.id) ?? 'unknown') !== 'unknown'),
    [sortedPeaks, modeByPeak, showUnknownModes],
  )
  const bandByMode = useMemo(() => {
    const m = new Map<string, { lo: number; hi: number }>()
    for (const b of modeBands(guitarType)) m.set(b.name, { lo: b.lo, hi: b.hi })
    return m
  }, [guitarType])

  // Auto-selected peaks = the strongest in each identified mode.
  const autoIds = useMemo(
    () => new Set([...resolvedModePeaks(peaks, guitarType).values()].map((p) => p.id)),
    [peaks, guitarType],
  )

  // Per-peak selection + mode-label overrides. A new capture resets both;
  // changing Peak Min recomputes peaks but keeps the user's selection/overrides.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [userModified, setUserModified] = useState(false)
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map())

  // A fresh capture clears the user's selection/overrides. Loading a measurement sets
  // `loadingRef` so its restored selection/overrides survive this reset.
  useEffect(() => {
    if (loadingRef.current) {
      loadingRef.current = false
      return
    }
    setUserModified(false)
    setOverrides(new Map())
  }, [captured])

  useEffect(() => {
    if (!userModified) setSelectedIds(autoIds)
  }, [autoIds, userModified])

  const keyOf = (p: Peak) => p.frequency.toFixed(1)
  const labelFor = (p: Peak, mode: ResolvedMode) => overrides.get(keyOf(p)) ?? MODE_DISPLAY_NAME[mode]
  const inRangeFor = (p: Peak, mode: ResolvedMode): boolean | null => {
    if (mode === 'unknown' || mode === 'upper') return null
    const band = bandByMode.get(mode)
    return band ? p.frequency >= band.lo && p.frequency <= band.hi : null
  }

  const toggleSelect = useCallback((id: number) => {
    setUserModified(true)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const selectAll = useCallback(() => {
    setUserModified(true)
    setSelectedIds(new Set(peaks.map((p) => p.id)))
  }, [peaks])
  const selectNone = useCallback(() => {
    setUserModified(true)
    setSelectedIds(new Set())
  }, [])
  const resetSelection = useCallback(() => setUserModified(false), [])
  const setLabel = useCallback((p: Peak, label: string) => {
    setOverrides((prev) => new Map(prev).set(p.frequency.toFixed(1), label))
  }, [])
  const resetLabel = useCallback((p: Peak) => {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.delete(p.frequency.toFixed(1))
      return next
    })
  }, [])

  // Two layers, mirroring Swift (SpectrumView+ChartContent):
  //   • dots — EVERY displayed peak always gets one (allPeaksInRange), mode-colored;
  //   • annotation badges — gated by AnnotationVisibilityMode (visiblePeaks):
  //     all = every displayed peak, selected = only chosen results, none = no badges.
  // displayPeaks already applies the showUnknownModes filter, matching allPeaksInRange.
  const markers = useMemo<PeakMarker[]>(
    () =>
      displayPeaks.map((p) => {
        const mode = modeByPeak.get(p.id) ?? 'unknown'
        const override = overrides.get(p.frequency.toFixed(1))
        const annotated =
          annotationMode === 'all' ? true : annotationMode === 'selected' ? selectedIds.has(p.id) : false
        const note = pitch.note(p.frequency)
        return {
          frequency: p.frequency,
          magnitude: p.magnitude,
          color: mode !== 'unknown' ? MODE_COLOR[mode] : undefined,
          // Badge first line uses the full display name (Air (Helmholtz) …), matching
          // the native annotation; the dot color stays undefined (gray) for unknown.
          label: override ?? MODE_DISPLAY_NAME[mode],
          note: note ?? undefined,
          cents: note ? pitch.cents(p.frequency) : undefined,
          isOverride: override !== undefined,
          annotated,
        }
      }),
    [displayPeaks, selectedIds, modeByPeak, overrides, annotationMode],
  )

  // Material phase markers (L=blue, C=orange, FLC=purple — native phase colors).
  const materialMarkers = useMemo<PeakMarker[]>(() => {
    const out: PeakMarker[] = []
    // Annotation labels match Swift/Python (PeakAnnotations): Longitudinal / Cross-grain / FLC.
    if (matPeaks.longitudinal) out.push({ ...matPeaks.longitudinal, color: '#4ea1ff', label: 'Longitudinal', annotated: true })
    if (matPeaks.cross) out.push({ ...matPeaks.cross, color: '#f0a03a', label: 'Cross-grain', annotated: true })
    if (matPeaks.flc) out.push({ ...matPeaks.flc, color: '#b07ad8', label: 'FLC', annotated: true })
    return out
  }, [matPeaks])

  // ── Multi-tap comparison (guitar, >1 tap) ───────────────────────────────────
  // Per-tap mode peaks are (re)found from each tap spectrum at the current Peak Min,
  // mirroring Swift TapEntry recomputing on threshold change.
  const multiTapAvailable = !material && !!captured && tapSpectra.length > 1
  const tapRows = useMemo<MultiTapRow[]>(
    () =>
      tapSpectra.map((sp, i) => {
        const mp = modePeaksFromSpectrum(sp, { guitarType, peakMinThreshold: peakMin })
        return { tapIndex: i + 1, air: mp.air?.frequency ?? null, top: mp.top?.frequency ?? null, back: mp.back?.frequency ?? null }
      }),
    [tapSpectra, guitarType, peakMin],
  )
  // Averaged row uses the displayed peaks (respects loaded-authoritative peaks).
  const avgModes = useMemo<TapModeFreqs>(() => {
    const m = resolvedModePeaks(peaks, guitarType)
    return { air: m.get('air')?.frequency ?? null, top: m.get('top')?.frequency ?? null, back: m.get('back')?.frequency ?? null }
  }, [peaks, guitarType])
  const multiTapOverlays = useMemo<SpectrumOverlay[]>(() => {
    const out: SpectrumOverlay[] = tapSpectra.map((sp, i) => ({
      magnitudesDb: sp.magnitudesDb,
      frequencies: sp.frequencies,
      color: MULTITAP_PALETTE[i % MULTITAP_PALETTE.length]!,
      label: `Tap ${i + 1}`,
    }))
    if (captured) out.push({ magnitudesDb: captured.magnitudesDb, frequencies: captured.frequencies, color: MULTITAP_AVG_COLOR, label: 'Averaged' })
    return out
  }, [tapSpectra, captured])

  const binHz = sampleRate ? sampleRate / GUITAR_FFT_SIZE : null
  const frameMs = sampleRate ? (GUITAR_FFT_SIZE / sampleRate) * 1000 : null
  // For auto-dB / metrics, use the primary material spectrum; the chart itself draws all
  // per-phase curves via `matOverlays`.
  const displaySpectrum = material
    ? (matSpectra.longitudinal ?? matSpectra.cross ?? matSpectra.flc)
    : (captured ?? liveSpectrum)
  const matOverlays = useMemo<SpectrumOverlay[]>(() => {
    if (!material) return []
    const out: SpectrumOverlay[] = []
    if (matSpectra.longitudinal)
      out.push({ ...matSpectra.longitudinal, color: MAT_L_COLOR, label: brace ? 'Longitudinal (fL)' : 'Longitudinal (L)' })
    if (matSpectra.cross) out.push({ ...matSpectra.cross, color: MAT_C_COLOR, label: 'Cross-grain (C)' })
    if (matSpectra.flc) out.push({ ...matSpectra.flc, color: MAT_FLC_COLOR, label: 'FLC' })
    return out
  }, [material, brace, matSpectra])
  const chartMarkers = material ? materialMarkers : markers
  const chartMinHz = material ? (brace ? 50 : 10) : displayMinHz
  const chartMaxHz = material ? (brace ? 1200 : 300) : displayMaxHz

  // Live chart view (zoom/pan). Resets to the configured range whenever that range
  // changes (settings edit, measurement-type switch). Save Current View commits it.
  const defaultView = useMemo<ChartView>(
    () => ({ minHz: chartMinHz, maxHz: chartMaxHz, minDb, maxDb }),
    [chartMinHz, chartMaxHz, minDb, maxDb],
  )
  const [view, setView] = useState<ChartView>(defaultView)
  useEffect(() => setView(defaultView), [defaultView])
  const saveCurrentView = useCallback(() => {
    updateSettings({
      displayMinHz: Math.round(view.minHz),
      displayMaxHz: Math.round(view.maxHz),
      minDb: Math.round(view.minDb),
      maxDb: Math.round(view.maxDb),
    })
  }, [view, updateSettings])

  // Right-click axis reset. Mirrors Swift resetBothAxesToSaved / resetBothAxesToDefaults:
  // BOTH only move the live view — neither persists. "Saved" → the saved display range;
  // "Defaults" → the factory range (does NOT overwrite the saved range). Save Current
  // View / the Settings dialog are the only things that change what's saved.
  const resetView = useCallback(
    (target: ResetTarget, axis: ResetAxis) => {
      const tgt: ChartView =
        target === 'saved'
          ? defaultView // configured (saved) display range
          : {
              minHz: material ? defaultView.minHz : DEFAULT_SETTINGS.displayMinHz,
              maxHz: material ? defaultView.maxHz : DEFAULT_SETTINGS.displayMaxHz,
              minDb: DEFAULT_SETTINGS.minDb,
              maxDb: DEFAULT_SETTINGS.maxDb,
            }
      setView((v) => ({
        minHz: axis === 'mag' ? v.minHz : tgt.minHz,
        maxHz: axis === 'mag' ? v.maxHz : tgt.maxHz,
        minDb: axis === 'freq' ? v.minDb : tgt.minDb,
        maxDb: axis === 'freq' ? v.maxDb : tgt.maxDb,
      }))
    },
    [defaultView, material],
  )

  // ── Auto-dB (autoScaleDB): fit the dB axis to the displayed spectrum ───────
  // Mirrors Swift toggleAutoScale: enabling fits now and on every update; disabling
  // resets the dB axis to the configured (saved) range. Session-only (not persisted).
  const autoScaleDb = useCallback(() => {
    const sp = displaySpectrum
    if (!sp) return
    let lo = Infinity
    let hi = -Infinity
    for (const m of sp.magnitudesDb) {
      if (m > -100 && m < 20) {
        if (m < lo) lo = m
        if (m > hi) hi = m
      }
    }
    if (!isFinite(lo)) return
    const padding = Math.max(10, (hi - lo) * 0.1)
    let newMin = Math.max(-120, lo - padding)
    let newMax = Math.min(20, hi + padding)
    if (newMax - newMin < 20) {
      const center = (newMin + newMax) / 2
      newMin = center - 10
      newMax = center + 10
    }
    setView((v) => ({ ...v, minDb: newMin, maxDb: newMax }))
  }, [displaySpectrum])

  const toggleAutoDb = useCallback(() => {
    setAutoDb((on) => {
      const next = !on
      if (next) autoScaleDb()
      else setView((v) => ({ ...v, minDb, maxDb })) // resetDBToDefaults → saved range
      return next
    })
  }, [autoScaleDb, minDb, maxDb])

  // Re-fit on every new spectrum while enabled (Swift "scale on each update").
  useEffect(() => {
    if (autoDb) autoScaleDb()
  }, [autoDb, displaySpectrum, autoScaleDb])

  const cycleAnnotations = useCallback(() => {
    updateSettings({ annotationVisibilityMode: ANNOTATION_NEXT[annotationMode] })
  }, [annotationMode, updateSettings])

  // ── Metrics panel inputs (FFTAnalysisMetricsView) ─────────────────────────
  const metrics = useMemo<Metrics>(() => {
    const sp = displaySpectrum
    let peakFrequency: number | null = null
    let peakMagnitude: number | null = null
    if (sp) {
      let bi = -1
      let bv = -Infinity
      for (let i = 0; i < sp.magnitudesDb.length; i++) {
        if (sp.magnitudesDb[i]! > bv) {
          bv = sp.magnitudesDb[i]!
          bi = i
        }
      }
      if (bi >= 0) {
        peakFrequency = sp.frequencies[bi]!
        peakMagnitude = bv
      }
    }
    return {
      frequencyResolution: binHz,
      binCount: !material && captured ? captured.frequencies.length : null,
      sampleRate,
      bandwidth: sampleRate ? sampleRate / 2 : null,
      sampleLengthSeconds: sampleRate ? GUITAR_FFT_SIZE / sampleRate : null,
      frameRate: engineMetrics?.frameRate ?? (sampleRate ? sampleRate / GUITAR_FFT_SIZE : null),
      processingTimeMs: engineMetrics?.processingMs ?? null,
      avgProcessingTimeMs: engineMetrics?.avgProcessingMs ?? null,
      peakFrequency,
      peakMagnitude,
      isRunning: running,
    }
  }, [displaySpectrum, binHz, material, captured, sampleRate, engineMetrics, running])

  // ── Library (Phase 4b): save the frozen guitar result, load one back in ───
  const onSaveMeasurement = useCallback(
    (name: string, notes: string) => {
      if (comparison) {
        void saveMeasurement(buildComparisonMeasurement({ name, notes, entries: comparison }))
        return
      }
      if (material) {
        if (!matSpectra.longitudinal) return
        void saveMeasurement(
          buildMaterialMeasurement({
            name, notes, spectra: matSpectra, peaks: matPeaks, view, settings, sampleRate, deviceLabel,
            microphoneUID: currentDeviceId ?? undefined,
            calibrationName: calibrationRef.current?.name,
          }),
        )
        return
      }
      if (!captured) return
      void saveMeasurement(
        buildGuitarMeasurement({
          name,
          notes,
          spectrum: captured,
          peaks,
          modeByPeak,
          selectedIds,
          overridesByFreq: overrides,
          view,
          settings,
          numberOfTaps,
          tapSpectra,
          sampleRate,
          deviceLabel,
          microphoneUID: currentDeviceId ?? undefined,
          calibrationName: calibrationRef.current?.name,
        }),
      )
    },
    [comparison, material, matSpectra, matPeaks, captured, peaks, modeByPeak, selectedIds, overrides, view, settings, numberOfTaps, tapSpectra, sampleRate, deviceLabel, currentDeviceId],
  )

  const onLoadMeasurement = useCallback(
    (m: TapToneMeasurementModel) => {
      // Comparison record: restore the overlay spectra directly from the saved entries.
      if (m.comparisonEntries) {
        comparisonRef.current = true
        const range = comparisonAxisRange(m.comparisonEntries)
        if (range) setView(range)
        setComparison(m.comparisonEntries)
        setLoadedPeaks(null)
        setCaptured(null)
        setTapSpectra([])
        setShowMultiTap(false)
        setLoadWarning(null)
        setLoadedName(m.measurementName ?? null)
        setShowMeasurements(false)
        engineRef.current?.disarm() // freeze the comparison (see onCompare)
        return
      }
      // Material (plate/brace): has per-phase snapshots, no guitar spectrumSnapshot.
      if (m.longitudinalSnapshot) {
        const mat = measurementToLiveMaterial(m)
        if (mat.measurementType !== settings.measurementType) skipNextTypeResetRef.current = true
        updateSettings(mat.settingsPatch)
        setLoadedPeaks(null)
        setCaptured(null)
        setComparison(null)
        setMatSpectra(mat.matSpectra)
        setMatPeaks(mat.matPeaks)
        setMatPhase('complete')
        setLoadWarning(measurementWarning(m, { microphoneName: deviceLabel, sampleRate }))
        setLoadedName(m.measurementName ?? null)
        setTapSpectra([]) // material has no per-tap entries
        setShowMultiTap(false)
        setShowMeasurements(false)
        return
      }
      let live
      try {
        live = measurementToLive(m)
      } catch {
        return // not a guitar measurement (no snapshot)
      }
      loadingRef.current = true
      if (live.measurementType !== settings.measurementType) skipNextTypeResetRef.current = true
      updateSettings(live.settingsPatch)
      setLoadedPeaks(live.loadedPeaks) // authoritative saved peaks (Peak Min filters them)
      setCaptured(live.captured)
      setComparison(null)
      setView(live.view)
      setOverrides(live.overridesByFreq)
      setSelectedIds(live.selectedIndices) // saved selection, 1:1 with the injected peaks
      setUserModified(true)
      // Load-time provenance check (mic / calibration / sample rate) — closes the web
      // side of the sample-rate epic. Cleared on New Tap / fresh capture.
      setLoadWarning(measurementWarning(m, { microphoneName: deviceLabel, sampleRate }))
      setLoadedName(m.measurementName ?? null)
      // Restore per-tap spectra so the multi-tap comparison view is available.
      setTapSpectra((m.tapEntries ?? []).map((e) => ({ magnitudesDb: e.snapshot.magnitudes, frequencies: e.snapshot.frequencies })))
      setShowMultiTap(false)
      setComparison(null)
      setShowMeasurements(false)
    },
    [settings.measurementType, updateSettings, deviceLabel, sampleRate],
  )

  // Create a comparison from ≥2 selected library measurements (mirrors Swift loadComparison).
  const onCompare = useCallback((measurements: TapToneMeasurementModel[]) => {
    const entries = buildComparisonEntries(measurements)
    if (entries.length < 2) return
    comparisonRef.current = true // guard immediately (before the sync effect) against in-flight captures
    const range = comparisonAxisRange(entries)
    if (range) setView(range)
    setComparison(entries)
    setLoadedPeaks(null)
    setCaptured(null)
    setTapSpectra([])
    setShowMultiTap(false)
    setLoadWarning(null)
    setLoadedName(null)
    setShowMeasurements(false)
    // Freeze the comparison: stop the always-on listener so a stray tap can't clobber it
    // (mirrors Swift displayMode == .comparison). New Tap re-arms.
    engineRef.current?.disarm()
  }, [])

  // Comparison chart overlays + results rows (derived from the active comparison entries).
  const comparisonOverlays = useMemo<SpectrumOverlay[]>(
    () =>
      (comparison ?? []).map((e) => ({
        magnitudesDb: e.snapshot.magnitudes,
        frequencies: e.snapshot.frequencies,
        color: colorComponentsToCss(e.colorComponents),
        label: e.label,
      })),
    [comparison],
  )
  // Export the CURRENT chart (whatever's displayed) as a PNG — same props passed to SpectrumChart.
  const canExportSpectrum = !!(displaySpectrum || comparison || showMultiTap || (material && matSpectra.longitudinal))
  const exportSpectrumImage = useCallback(() => {
    const opts: SpectrumImageOpts = {
      spectrum: comparison || material || showMultiTap ? null : displaySpectrum,
      overlays: comparison ? comparisonOverlays : material ? matOverlays : showMultiTap ? multiTapOverlays : undefined,
      markers: comparison || showMultiTap ? [] : chartMarkers,
      view,
      title: `FFT Peaks — ${loadedName ?? 'New'}`,
    }
    const stem =
      (loadedName ?? 'spectrum').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'spectrum'
    void exportSpectrumPng(opts, `${stem}-spectrum-${Math.floor(Date.now() / 1000)}.png`)
  }, [comparison, material, showMultiTap, displaySpectrum, comparisonOverlays, matOverlays, multiTapOverlays, chartMarkers, view, loadedName])

  const comparisonRows = useMemo<ComparisonRow[]>(
    () =>
      (comparison ?? []).map((e) => ({
        label: e.label,
        color: colorComponentsToCss(e.colorComponents),
        ...comparisonEntryModeFreqs(e),
      })),
    [comparison],
  )

  return (
    <div className="app">
      {/* Three stacked bars like the native apps: (1) slim title, (2) app control bar,
          (3) tap-control bar — none of them wrap (the app gets a min-content floor and
          scrolls horizontally instead, mirroring the native window's minimum width). */}
      <header className="app-titlebar">
        <h1>Guitar Tap</h1>
        <span className="subtitle">Web · live tap analysis</span>
      </header>

      <div className="toolbar toolbar-app">
        <button
          className="btn"
          onClick={() => setShowPlayFile(true)}
          disabled={!running || comparison != null}
          title="Play a recorded WAV through the analysis pipeline"
        >
          <FilePlayIcon />
          <span>Play File</span>
        </button>
        <button
          className={`btn toggle ${autoDb ? 'on' : ''}`}
          onClick={toggleAutoDb}
          disabled={!running}
          aria-pressed={autoDb}
          title="Auto-scale the dB axis to the spectrum"
        >
          <AutoDbIcon />
          <span>Auto dB</span>
        </button>
        <button
          className={`btn toggle ${annotationMode !== 'none' ? 'on' : ''}`}
          onClick={cycleAnnotations}
          disabled={!running || material || displayPeaks.length === 0}
          title={`Annotation visibility: ${ANNOTATION_LABEL[annotationMode]} (click to cycle)`}
        >
          {annotationMode === 'all' ? <EyeIcon /> : annotationMode === 'selected' ? <StarIcon /> : <EyeOffIcon />}
          <span>Annotations</span>
        </button>
        <button
          className="btn"
          onClick={() => setShowSave(true)}
          disabled={comparison ? false : material ? matPhase !== 'complete' : !captured}
          title="Save measurement to the library"
        >
          <SaveIcon />
          <span>Save</span>
        </button>
        <button className="btn" onClick={() => setShowMeasurements(true)} title="Measurements library">
          <ClipboardIcon />
          <span>Measurements</span>
        </button>
        <button className="btn" onClick={() => setShowMetrics(true)} disabled={!running} title="Analysis metrics">
          <BarChartIcon />
          <span>Metrics</span>
        </button>
        <button className="btn" onClick={() => setShowSettings(true)} title="Settings">
          <GearIcon />
          <span>Settings</span>
        </button>
      </div>

      {/* Row 2 — Tap Controls (measurement controls). Native macOS order
          (regularTapControlsWide): Taps │ Threshold │ Peak Min, actions right-aligned. */}
      <div className="toolbar toolbar-taps">
        {running && (
          <>
            {!material && (
              <>
                <div className="field">
                  <label>Taps</label>
                  <div className="stepper">
                    <button
                      className="btn step"
                      onClick={() => changeTaps(numberOfTaps - 1)}
                      disabled={tapsLocked || numberOfTaps <= 1}
                      aria-label="Fewer taps"
                    >
                      −
                    </button>
                    <span className="step-val">{numberOfTaps}</span>
                    <button
                      className="btn step"
                      onClick={() => changeTaps(numberOfTaps + 1)}
                      disabled={tapsLocked || numberOfTaps >= 10}
                      aria-label="More taps"
                    >
                      +
                    </button>
                  </div>
                </div>
                <span className="divider" />
              </>
            )}

            <div className="field">
              <label>Threshold</label>
              <ThresholdMeter
                level={level}
                value={tapThreshold}
                clipping={clipping}
                onChange={(v) => {
                  updateSettings({ tapDetectionThreshold: v })
                  engineRef.current?.setConfig({ tapDetectionThreshold: v })
                }}
              />
            </div>

            {!material && (
              <>
                <span className="divider" />
                <div className="field">
                  <label>Peak Min</label>
                  <input
                    type="range"
                    min={-100}
                    max={-20}
                    step={1}
                    value={peakMin}
                    onChange={(e) => updateSettings({ peakMinThreshold: Number(e.target.value) })}
                  />
                  <span className="val">{peakMin} dB</span>
                </div>
              </>
            )}
          </>
        )}

        {/* New Tap · Pause/Resume · Cancel — ALWAYS visible, in the same order as Swift
            (vertical stack) and Python (horizontal), enabled/disabled by state rather than
            shown/hidden. During a material (plate/brace) review phase the Pause and Cancel
            slots relabel to Accept / Redo, exactly as the native apps' same buttons do. */}
        {(() => {
          // Mirrors the REAL Swift/Python runtime logic (verified against
          // tap_tone_analysis_view.py button-update + Swift computed props, not comments):
          //   isDetecting is FALSE while paused, so Cancel is disabled (greyed) while paused —
          //   but every button stays VISIBLE; both apps enable/disable, never hide.
          const reviewing = material && isReviewing(matPhase)
          const paused = engineState === 'paused'
          const detecting = engineState === 'listening' || engineState === 'capturing'
          // New Tap: guitar → only when idle/complete; material → always while running (start over).
          const newTapDisabled = material ? !running : !running || engineState !== 'idle'
          // Pause/Resume: enabled while detecting OR paused (or Accept in review).
          const pauseEnabled = running && (reviewing || detecting || paused)
          // Cancel: only while detecting (NOT paused); material aborts the whole sequence,
          // guitar only mid multi-tap. Orange when enabled, grey (default disabled) otherwise —
          // matches Python's `color: orange/gray` and Swift's `.foregroundStyle(.orange/.gray)`.
          const cancelEnabled =
            running &&
            (reviewing || (detecting && (material ? true : numberOfTaps > 1 && progress.collected < numberOfTaps)))
          return (
            // No-wrap group so the trio never splits across rows, and each button has a fixed
            // min-width so relabeling (Pause→Resume, Cancel→Redo) can't change widths and reflow
            // the row — a button's state change must not re-lay out the controls.
            <div className="tap-actions">
              <button
                className="btn btn-primary tap-action"
                onClick={material ? startMaterial : newTap}
                disabled={newTapDisabled}
              >
                <TapIcon />
                <span>New Tap</span>
              </button>
              <button
                className={`btn tap-action${reviewing ? ' btn-accept' : ''}`}
                onClick={reviewing ? acceptMaterial : paused ? resumeTap : pauseTap}
                disabled={!pauseEnabled}
              >
                {reviewing ? <CheckIcon /> : paused ? <PlayIcon /> : <PauseIcon />}
                <span>{reviewing ? 'Accept' : paused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                className={`btn tap-action${cancelEnabled ? ' btn-cancel' : ''}`}
                onClick={reviewing ? redoMaterial : cancelTap}
                disabled={!cancelEnabled}
              >
                {reviewing ? <UndoIcon /> : <CancelIcon />}
                <span>{reviewing ? 'Redo' : 'Cancel'}</span>
              </button>
            </div>
          )
        })()}

        {error && (
          <button className="btn" onClick={() => void start()}>
            Retry microphone
          </button>
        )}
      </div>

      {error && <p className="error">⚠ {error}</p>}

      {loadWarning && (
        <div className="load-warning" role="status">
          <span>⚠ {loadWarning}</span>
          <button className="btn mini" onClick={() => setLoadWarning(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="main">
        <div className="chart-pane">
          <div className="chart-wrap">
            <SpectrumChart
              spectrum={comparison || material || showMultiTap ? null : displaySpectrum}
              title={`FFT Peaks — ${loadedName ?? 'New'}`}
              overlays={comparison ? comparisonOverlays : material ? matOverlays : showMultiTap ? multiTapOverlays : undefined}
              markers={comparison || showMultiTap ? [] : chartMarkers}
              minHz={view.minHz}
              maxHz={view.maxHz}
              minDb={view.minDb}
              maxDb={view.maxDb}
              onViewChange={setView}
              onReset={resetView}
            />
          </div>
        </div>

        <aside className="results-pane">
          <div className="results-inner">
          <div className="results-head">
            <h2>Analysis Results</h2>
            {multiTapAvailable && (
              <button
                className={`btn mini taps-toggle${showMultiTap ? ' active' : ''}`}
                onClick={() => setShowMultiTap((v) => !v)}
                title={showMultiTap ? 'Hide per-tap comparison' : 'Compare each tap vs the average'}
              >
                ∿ Taps
              </button>
            )}
            <span className={`type-badge ${comparison ? 'comparison' : material ? 'material' : 'guitar'}`}>
              {comparison ? 'Comparison' : MEASUREMENT_SHORT_NAME[settings.measurementType]}
            </span>
          </div>

          {comparison ? (
            <ComparisonResultsView rows={comparisonRows} />
          ) : material ? (
            matPhase === 'notStarted' ? (
              <p className="empty">Press New Tap to begin the {brace ? 'brace' : 'plate'} measurement.</p>
            ) : (
              <MaterialResults type={brace ? 'brace' : 'plate'} settings={settings} peaks={matPeaks} />
            )
          ) : showMultiTap && multiTapAvailable ? (
            <MultiTapComparisonResultsView taps={tapRows} avg={avgModes} />
          ) : (
            <>
              {displayPeaks.length > 0 && (
                <div className="results-sub">
                  <span className="range-text">
                    Showing {displayMinHz} – {displayMaxHz} Hz
                  </span>
                  <div className="sel-buttons">
                    <button className="btn mini" onClick={selectAll} title="Select all peaks">
                      All
                    </button>
                    <button className="btn mini" onClick={selectNone} title="Deselect all peaks">
                      None
                    </button>
                    <button className="btn mini" onClick={resetSelection} disabled={!userModified} title="Reset to automatic selection">
                      Auto
                    </button>
                  </div>
                </div>
              )}

              {displayPeaks.length > 0 ? (
                <div className="cards">
                  {displayPeaks.map((p) => {
                    const mode = modeByPeak.get(p.id) ?? 'unknown'
                    const note = pitch.note(p.frequency)
                    return (
                      <PeakCard
                        key={p.id}
                        peak={p}
                        mode={mode}
                        effectiveLabel={labelFor(p, mode)}
                        isManualOverride={overrides.has(keyOf(p))}
                        inRange={inRangeFor(p, mode)}
                        note={note}
                        cents={note ? pitch.cents(p.frequency) : null}
                        selected={selectedIds.has(p.id)}
                        onToggle={() => toggleSelect(p.id)}
                        onSetLabel={(label) => setLabel(p, label)}
                        onResetLabel={() => resetLabel(p)}
                      />
                    )
                  })}
                </div>
              ) : (
                <p className="empty">{captured ? 'No peaks above Peak Min.' : 'No tap captured yet.'}</p>
              )}
            </>
          )}
          </div>
          {/* Export footer — mirrors the native Analysis Results footer (Export Spectrum · Export PDF). */}
          <div className="results-foot">
            <button
              className="btn mini"
              onClick={exportSpectrumImage}
              disabled={!canExportSpectrum}
              title="Export the spectrum as a PNG image"
            >
              ∿ Export Spectrum
            </button>
            <button className="btn mini" disabled title="PDF report — coming next">
              ▤ Export PDF
            </button>
          </div>
        </aside>
      </div>

      <div className={`statusbar state-${engineState}`}>
        <span className="status-text">
          {error
            ? 'Microphone unavailable'
            : !running
              ? 'Requesting microphone…'
              : playingFileName
                ? `Playing ${playingFileName}…`
                : cancelled && engineState === 'idle'
                ? 'Cancelled — press New Tap to start again'
                : engineState === 'paused'
                  ? 'Detection paused – tap freely, then resume'
                  : material
                    ? matInstruction(matPhase, brace)
                    : statusText(engineState, progress)}
        </span>
        <span className="spacer" />
        <span className="level">{level.toFixed(1)} dBFS</span>
        {sampleRate && binHz && frameMs && (
          <span className="rate">
            {(sampleRate / 1000).toFixed(1)} kHz · {binHz.toFixed(2)} Hz/bin · {(1000 / frameMs).toFixed(2)} fps
          </span>
        )}
        {audioSettings && (
          <span className="rate" title="Mic processing the browser actually applied">
            AGC {fmtProc(audioSettings.autoGainControl)} · EC {fmtProc(audioSettings.echoCancellation)} · NS{' '}
            {fmtProc(audioSettings.noiseSuppression)}
          </span>
        )}
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          sampleRate={sampleRate}
          deviceLabel={deviceLabel}
          currentView={view}
          onApply={setSettings}
          onSaveCurrentView={saveCurrentView}
          onClose={() => setShowSettings(false)}
          inputDevices={inputDevices}
          currentDeviceId={currentDeviceId}
          onSelectDevice={(id) => void onSelectDevice(id)}
          calibrations={calibrations}
          activeCalibrationId={activeCalId}
          onImportCalibration={(f) => void onImportCalibration(f)}
          onSelectCalibration={onSelectCalibration}
          onDeleteCalibration={onDeleteCalibration}
        />
      )}

      {showMetrics && <MetricsPanel metrics={metrics} onClose={() => setShowMetrics(false)} />}

      {showSave && (
        <SaveSheet
          defaultName={comparison ? 'Comparison' : MEASUREMENT_SHORT_NAME[settings.measurementType]}
          onSave={onSaveMeasurement}
          onClose={() => setShowSave(false)}
        />
      )}

      {showMeasurements && (
        <MeasurementsPanel onClose={() => setShowMeasurements(false)} onLoad={onLoadMeasurement} onCompare={onCompare} />
      )}

      {showPlayFile && (
        <PlayFileSheet onPlay={(audio, cal) => void onPlayFile(audio, cal)} onClose={() => setShowPlayFile(false)} />
      )}
    </div>
  )
}
