import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine, type EngineState } from './audio/engine'
import { SpectrumChart } from './components/SpectrumChart'
import type { PeakMarker, SpectrumOverlay } from './presentation/chartTypes'
import { useChartView } from './hooks/useChartView'
import { useAnnotations } from './hooks/useAnnotations'
import { useMaterialSession, type MatPhase } from './hooks/useMaterialSession'
import { useAudioEngine } from './hooks/useAudioEngine'
import { ThresholdMeter } from './components/ThresholdMeter'
import { PeakCard } from './components/PeakCard'
import { SettingsPanel } from './components/SettingsPanel'
import { MetricsPanel, type Metrics } from './components/MetricsPanel'
import { SaveSheet } from './components/SaveSheet'
import { PlayFileSheet } from './components/PlayFileSheet'
import { MeasurementsPanel } from './components/MeasurementsPanel'
import { MaterialResults } from './components/MaterialResults'
import { AnalysisResults } from './components/AnalysisResults'
import { tapToneRatio } from './dsp/analysisQuality'
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
import { decodeWav, encodeWavFloat32 } from './dsp/wav'
import { exportSpectrumPng, type SpectrumImageOpts } from './presentation/spectrumExport'
import { buildGuitarMarkers, buildMaterialMarkers, measurementToPdfData } from './presentation/measurementImage'
import { exportPdfReport } from './presentation/pdfReport'
import type { TapToneMeasurementModel, ComparisonEntryModel } from './measurement'
import { MODE_DISPLAY_NAME } from './presentation/modeColors'
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
import { modeBands, type GuitarTypeName } from './dsp/guitarModes'
import { Pitch } from './dsp/pitch'
import {
  loadSettings,
  saveSettings,
  isGuitarType,
  isMaterialType,
  MEASUREMENT_SHORT_NAME,
  MEASUREMENT_FULL_NAME,
  ANNOTATION_NEXT,
  ANNOTATION_LABEL,
  type Settings,
} from './settings'
import './App.css'

const pitch = new Pitch(440)

// Per-phase material spectra, overlaid on the chart (mirrors Swift's materialSpectra:
// Longitudinal always; Cross + optional FLC for plate). Colors match the markers.
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

// "Dump Capture Audio" diagnostic: encode a captured buffer to a 32-bit-float WAV and silently
// download it (the browser equivalent of Swift's write to ~/Documents/GuitarTap — no save dialog,
// since it fires per tap/phase). Filename mirrors Swift's `web_<label>_<ISO8601-dashes>.wav`.
function dumpCaptureWav(samples: Float32Array, sampleRate: number, label: string): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const blob = new Blob([encodeWavFloat32(samples, sampleRate).buffer as ArrayBuffer], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `web_${label}_${ts}.wav`
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [captured, setCaptured] = useState<Spectrum | null>(null)

  // Mirror of the applied calibration for matSearch + save provenance (read from stable refs).
  // Owned here (shared handle); the audio engine hook resolves + writes it.
  const calibrationRef = useRef<Calibration | null>(null)

  const [numberOfTaps, setNumberOfTaps] = useState(1)
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
  const annotationMode = settings.annotationVisibilityMode
  const guitarType: GuitarTypeName = isGuitarType(settings.measurementType) ? settings.measurementType : 'generic'
  const material = isMaterialType(settings.measurementType)
  const brace = settings.measurementType === 'brace'
  const { displayMinHz, displayMaxHz, minDb, maxDb, analysisMinHz, analysisMaxHz, showUnknownModes } = settings
  const peakMin = settings.peakMinThreshold
  const tapThreshold = settings.tapDetectionThreshold

  // Material measurement state. Engine callbacks are registered once, so the phase
  // and measurement type are mirrored into refs for the onMaterialCapture handler.
  const measRef = useRef(settings.measurementType)
  measRef.current = settings.measurementType
  const measureFlcRef = useRef(settings.measureFlc)
  measureFlcRef.current = settings.measureFlc
  const tapThresholdRef = useRef(settings.tapDetectionThreshold)
  tapThresholdRef.current = settings.tapDetectionThreshold
  const dumpAudioRef = useRef(settings.dumpCaptureAudio)
  dumpAudioRef.current = settings.dumpCaptureAudio

  // The audio engine handle (constructed in `start`) — declared early so the material session
  // can arm it. Material measurement (plate/brace phase machine) — see hooks/useMaterialSession.
  const engineRef = useRef<AudioEngine | null>(null)
  const {
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
  } = useMaterialSession({ engineRef, measRef, measureFlcRef, calibrationRef })

  // Browser tab title carries the version+build, like the Swift/Python window titles
  // ("Guitar Tap 1.0.1 (NNN)"). Set once at mount.
  useEffect(() => {
    document.title = `Guitar Tap ${__APP_VERSION__} (${__APP_BUILD__})`
  }, [])

  // Loading a saved measurement sets the type, spectrum, peaks, and selection together;
  // these refs suppress the one-shot "reset on change" effects so the restore isn't clobbered.
  const skipNextTypeResetRef = useRef(false)
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
    resetMaterial()
    const e = engineRef.current
    if (!e?.running) return
    if (isMaterialType(settings.measurementType)) e.disarm()
    else e.arm()
  }, [settings.measurementType, resetMaterial])

  // Stable capture-result callbacks the engine's once-registered handlers delegate to.
  // Guitar tap (or averaged multi-tap): store the frozen result, superseding any loaded measurement.
  const onGuitarCapture = useCallback((s: Spectrum, taps?: Spectrum[]) => {
    if (comparisonRef.current) return // a frozen comparison absorbs in-flight captures
    setLoadedPeaks(null)
    setLoadWarning(null)
    setLoadedName(null)
    setCaptured(s)
    setTapSpectra(taps ?? []) // per-tap spectra for the multi-tap comparison view
    setShowMultiTap(false)
    setComparison(null)
  }, [])
  // Dump-Capture-Audio diagnostic: label the WAV by the material phase just captured (else "guitar").
  const onCaptureAudio = useCallback((samples: Float32Array, sr: number, kind: 'guitar' | 'material') => {
    if (!dumpAudioRef.current) return
    const label =
      kind === 'material'
        ? matPhaseRef.current === 'capturingC' || matPhaseRef.current === 'reviewingC'
          ? 'cross'
          : matPhaseRef.current === 'capturingFlc' || matPhaseRef.current === 'reviewingFlc'
            ? 'flc'
            : 'longitudinal'
        : 'guitar'
    dumpCaptureWav(samples, sr, label)
  }, [matPhaseRef])

  // Audio engine: lifecycle + telemetry + audio-input/calibration — see hooks/useAudioEngine.
  const {
    running,
    engineState,
    level,
    liveSpectrum,
    sampleRate,
    audioSettings,
    deviceLabel,
    error,
    setError,
    inputDevices,
    currentDeviceId,
    calibrations,
    activeCalId,
    clipping,
    progress,
    setProgress,
    engineMetrics,
    decayTime,
    pauseTap,
    resumeTap,
    refreshDevices,
    onSelectDevice,
    onImportCalibration,
    onSelectCalibration,
    onDeleteCalibration,
    retry,
  } = useAudioEngine({ engineRef, calibrationRef, measRef, tapThresholdRef, onGuitarCapture, onMaterialCapture: recordCapture, onCaptureAudio })

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
        // Material: fresh phase machine (no arm — the engine owns the L→C→(FLC) auto-advance session).
        startMaterial(false)
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
  }, [startMaterial])

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

  // Cancel (mirror Swift cancelTapSequence) — engine owns the transition; we reset progress +
  // material phase + the cancelled flag. Pause/Resume live in useAudioEngine.
  const cancelTap = useCallback(() => {
    engineRef.current?.cancel()
    setProgress({ collected: 0, total: numberOfTaps })
    if (isMaterialType(measRef.current)) resetMaterial()
    setCancelled(true)
  }, [numberOfTaps, resetMaterial])

  const changeTaps = useCallback((n: number) => {
    const v = Math.max(1, Math.min(10, n))
    setNumberOfTaps(v)
    engineRef.current?.setConfig({ numberOfTaps: v })
  }, [])

  // New Tap in material mode: clear the cancelled flag, then start the phase machine (hooks/useMaterialSession).
  const onMaterialNewTap = useCallback(() => {
    setCancelled(false)
    startMaterial()
  }, [startMaterial])

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
  // Live tap-tone ratio (f_Top / f_Air) for the Analysis Results panel — same fn the PDF uses.
  const tapRatio = useMemo(() => (material ? null : tapToneRatio(peaks, guitarType)), [material, peaks, guitarType])
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

  // Per-peak selection + mode-label overrides + dragged label positions — see hooks/useAnnotations.
  const {
    selectedIds,
    overrides,
    annotationOffsets,
    userModified,
    toggleSelect,
    selectAll,
    selectNone,
    resetSelection,
    setLabel,
    resetLabel,
    onAnnotationDrag,
    resetLabels,
    restore: restoreAnnotations,
  } = useAnnotations({ peaks, guitarType, captured })

  const keyOf = (p: Peak) => p.frequency.toFixed(1)
  const labelFor = (p: Peak, mode: ResolvedMode) => overrides.get(keyOf(p)) ?? MODE_DISPLAY_NAME[mode]
  const inRangeFor = (p: Peak, mode: ResolvedMode): boolean | null => {
    if (mode === 'unknown' || mode === 'upper') return null
    const band = bandByMode.get(mode)
    return band ? p.frequency >= band.lo && p.frequency <= band.hi : null
  }

  // Two layers, mirroring Swift (SpectrumView+ChartContent):
  //   • dots — EVERY displayed peak always gets one (allPeaksInRange), mode-colored;
  //   • annotation badges — gated by AnnotationVisibilityMode (visiblePeaks):
  //     all = every displayed peak, selected = only chosen results, none = no badges.
  // displayPeaks already applies the showUnknownModes filter, matching allPeaksInRange.
  // Styled markers via the SHARED builder (measurementImage.ts) so the live view and the exported
  // image (incl. saved-measurement export) use identical peak styling.
  const markers = useMemo<PeakMarker[]>(
    () => buildGuitarMarkers(displayPeaks, modeByPeak, selectedIds, overrides, annotationMode, annotationOffsets),
    [displayPeaks, selectedIds, modeByPeak, overrides, annotationMode, annotationOffsets],
  )

  // Material phase markers (L=blue, C=orange, FLC=purple — native phase colors).
  const materialMarkers = useMemo<PeakMarker[]>(() => {
    return buildMaterialMarkers(matPeaks)
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

  // Chart view (zoom/pan range) + Auto-dB — see hooks/useChartView.
  const { view, setView, saveCurrentView, resetView, autoDb, toggleAutoDb } = useChartView({
    chartMinHz,
    chartMaxHz,
    minDb,
    maxDb,
    material,
    displaySpectrum,
    updateSettings,
  })

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
  // Build a TapToneMeasurementModel from the CURRENT frozen result — the one place that
  // assembles a measurement from live state, shared by Save and the PDF/report exports so
  // the saved record and the exported report are built identically. Returns null when
  // there's nothing to capture (no spectrum yet).
  const buildCurrentMeasurement = useCallback(
    (name: string, notes: string): TapToneMeasurementModel | null => {
      if (comparison) return buildComparisonMeasurement({ name, notes, entries: comparison })
      if (material) {
        if (!matSpectra.longitudinal) return null
        return buildMaterialMeasurement({
          name, notes, spectra: matSpectra, peaks: matPeaks, view, settings, sampleRate, deviceLabel,
          microphoneUID: currentDeviceId ?? undefined,
          calibrationName: calibrationRef.current?.name,
        })
      }
      if (!captured) return null
      return buildGuitarMeasurement({
        name,
        notes,
        spectrum: captured,
        peaks,
        modeByPeak,
        selectedIds,
        overridesByFreq: overrides,
        annotationOffsetsByFreq: annotationOffsets,
        decayTime: engineRef.current?.decayTime ?? null,
        view,
        settings,
        numberOfTaps,
        tapSpectra,
        sampleRate,
        deviceLabel,
        microphoneUID: currentDeviceId ?? undefined,
        calibrationName: calibrationRef.current?.name,
      })
    },
    [comparison, material, matSpectra, matPeaks, captured, peaks, modeByPeak, selectedIds, overrides, annotationOffsets, view, settings, numberOfTaps, tapSpectra, sampleRate, deviceLabel, currentDeviceId],
  )

  const onSaveMeasurement = useCallback(
    (name: string, notes: string) => {
      const m = buildCurrentMeasurement(name, notes)
      if (m) void saveMeasurement(m)
    },
    [buildCurrentMeasurement],
  )

  // Export the CURRENT view as a single-page PDF report (live mirror of the Saved-Measurements
  // row menu's "Export PDF Report"), via the same measurement builder → measurementToPdfData.
  const exportPdf = useCallback(() => {
    const m = buildCurrentMeasurement(loadedName ?? '', '')
    if (!m) return
    const stem =
      (loadedName ?? 'report').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'report'
    void exportPdfReport(measurementToPdfData(m), `${stem}-report-${Math.floor(Date.now() / 1000)}.pdf`)
  }, [buildCurrentMeasurement, loadedName])

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
        restoreMaterial({ matSpectra: mat.matSpectra, matPeaks: mat.matPeaks })
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
      if (live.measurementType !== settings.measurementType) skipNextTypeResetRef.current = true
      updateSettings(live.settingsPatch)
      setLoadedPeaks(live.loadedPeaks) // authoritative saved peaks (Peak Min filters them)
      setCaptured(live.captured)
      setComparison(null)
      setView(live.view)
      // Restore selection + overrides + dragged label positions (sets the loading guard so this
      // survives the fresh-capture reset that setCaptured triggers).
      restoreAnnotations({
        overridesByFreq: live.overridesByFreq,
        annotationOffsetsByFreq: live.annotationOffsetsByFreq,
        selectedIndices: live.selectedIndices,
      })
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
      title: `FFT Peaks — ${loadedName ?? 'New'}`,
      spectrum: comparison || material || showMultiTap ? null : displaySpectrum,
      overlays: comparison ? comparisonOverlays : material ? matOverlays : showMultiTap ? multiTapOverlays : undefined,
      markers: comparison || showMultiTap ? [] : chartMarkers,
      view,
      measurementTypeName: comparison ? 'Comparison' : MEASUREMENT_FULL_NAME[settings.measurementType],
      guitarType: material || comparison ? undefined : guitarType,
      date: new Date().toLocaleString(),
    }
    const stem =
      (loadedName ?? 'spectrum').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'spectrum'
    void exportSpectrumPng(opts, `${stem}-spectrum-${Math.floor(Date.now() / 1000)}.png`)
  }, [comparison, material, showMultiTap, displaySpectrum, comparisonOverlays, matOverlays, multiTapOverlays, chartMarkers, view, loadedName, settings.measurementType, guitarType])

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
        <h1>
          Guitar Tap <span className="app-version">{__APP_VERSION__} ({__APP_BUILD__})</span>
        </h1>
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
                onClick={material ? onMaterialNewTap : newTap}
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
          <button className="btn" onClick={() => void retry()}>
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
              guitarType={material || comparison || showMultiTap ? undefined : guitarType}
              markers={comparison || showMultiTap ? [] : chartMarkers}
              minHz={view.minHz}
              maxHz={view.maxHz}
              minDb={view.minDb}
              maxDb={view.maxDb}
              onViewChange={setView}
              onReset={resetView}
              onAnnotationDrag={material || comparison || showMultiTap ? undefined : onAnnotationDrag}
              onResetLabels={material || comparison || showMultiTap ? undefined : resetLabels}
              hasMovedLabels={annotationOffsets.size > 0}
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

          <div className="results-scroll">
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

          {/* Guitar summary (Ring-Out · Tap Ratio) — pinned below the scrollable peak list, above
              the export bar, side by side. Mirrors the native live panel (guitar only). */}
          {!material && !comparison && !showMultiTap && (
            <AnalysisResults decayTime={decayTime} ratio={tapRatio} guitarType={guitarType} />
          )}

          {/* Export footer — running/stopped status (left) + Export Spectrum · Export PDF (right),
              mirroring the native footer row. */}
          <div className="results-foot">
            <span className={`foot-status${running ? ' on' : ''}`}>
              <span className="foot-dot">●</span> {running ? 'Analyzing' : 'Stopped'}
            </span>
            <div className="foot-export">
              <button
                className="btn mini"
                onClick={exportSpectrumImage}
                disabled={!canExportSpectrum}
                title="Export the spectrum as a PNG image"
              >
                ∿ Export Spectrum
              </button>
              <button
                className="btn mini"
                onClick={exportPdf}
                disabled={!canExportSpectrum}
                title="Export a single-page PDF report"
              >
                ▤ Export PDF
              </button>
            </div>
          </div>
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
