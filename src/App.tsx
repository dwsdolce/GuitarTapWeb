// @parity view/main
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RealtimeFFTAnalyzer } from './audio/realtimeFFTAnalyzer'
import { SpectrumChart } from './components/SpectrumChart'
import { MaterialInstructionPanel } from './components/MaterialInstructionPanel'
import { AlertModal } from './components/AlertModal'
import type { ChartView, PeakMarker, SpectrumOverlay } from './presentation/chartTypes'
import { useChartView } from './hooks/useChartView'
import { useAnnotations } from './hooks/useAnnotations'
import { type MaterialTapPhase as MatPhase } from './state/tapToneAnalyzer'
import { useAudioEngine } from './hooks/useAudioEngine'
import { ThresholdMeter } from './components/ThresholdMeter'
import { PeakCard } from './components/PeakCard'
import { SettingsPanel } from './components/SettingsPanel'
import { MetricsPanel, type Metrics } from './components/MetricsPanel'
import { SaveSheet } from './components/SaveSheet'
import { PlayFileSheet } from './components/PlayFileSheet'
import { QuickStartGuide } from './components/QuickStartGuide'
// Toolbar + tap-control icons live in a shared module so the Quick Start Guide can render the
// exact same glyphs next to each control (Swift SF Symbols / Python qtawesome equivalents).
import {
  TapIcon,
  PauseIcon,
  PlayIcon,
  CancelIcon,
  CheckIcon,
  UndoIcon,
  AutoDbIcon,
  EyeIcon,
  StarIcon,
  EyeOffIcon,
  SaveIcon,
  ClipboardIcon,
  BarChartIcon,
  GearIcon,
  HelpIcon,
  BookIcon,
  FilePlayIcon,
  DotViewfinderIcon,
  PlusViewfinderIcon,
  WandIcon,
  ResultsIcon,
  RefreshIcon,
} from './components/icons'
import { buttonRule } from './state/buttonEnablement'
import { useTapToneAnalyzer } from './hooks/useTapToneAnalyzer'
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
import { buildGuitarMarkers, buildMaterialMarkers, measurementToPdfData, multiTapPdfData } from './presentation/measurementImage'
import { exportPdfReport, exportMultiTapPdfReport } from './presentation/pdfReport'
import type { TapToneMeasurementModel, ComparisonEntryModel } from './measurement'
import { MODE_DISPLAY_NAME } from './presentation/modeColors'
import { GUITAR_FFT_SIZE } from './dsp/guitarFFT'
import {
  MultiTapComparisonResultsView,
  MULTITAP_PALETTE,
  MULTITAP_AVG_COLOR,
  type MultiTapRow,
  type TapModeFreqs,
} from './components/MultiTapComparisonResultsView'
import { type Peak } from './dsp/peaks'
import { resolvedModePeaks, type ResolvedMode } from './dsp/classify'
import { modeBands, type GuitarTypeName } from './dsp/guitarModes'
import { Pitch } from './dsp/pitch'
import {
  loadSettings,
  saveSettings,
  isGuitarType,
  isMaterialType,
  displayRangeFor,
  MEASUREMENT_SHORT_NAME,
  MEASUREMENT_FULL_NAME,
  ANNOTATION_NEXT,
  ANNOTATION_LABEL,
  type Settings,
  type MeasurementType,
} from './settings'
import './App.css'

const pitch = new Pitch(440)

// Per-phase material spectra, overlaid on the chart (mirrors Swift's materialSpectra:
// Longitudinal always; Cross + optional FLC for plate). Colors match the markers.
const MAT_L_COLOR = '#4ea1ff'
const MAT_C_COLOR = '#f0a03a'
const MAT_FLC_COLOR = '#b07ad8'


const isReviewing = (p: MatPhase) => p === 'reviewingL' || p === 'reviewingC' || p === 'reviewingFlc'


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

// Hover-tip text mirrored verbatim from Swift `HintText` (Views/Utilities/Extensions.swift) so the
// web tooltips match the desktop app. Shown via the `title` attribute (desktop hover; no-op on touch,
// exactly like macOS `.help()`).
const HINTS = {
  playFile: 'Feed an audio file through the analysis pipeline',
  autoScale: (on: boolean) =>
    on ? 'Auto-scale dB enabled - click to disable and reset' : 'Automatically scale dB range to fit the current spectrum',
  annotations: (label: string) => `Annotation visibility: ${label}`,
  save: 'Save the current measurement with measurement name and notes',
  measurements: 'View and manage saved measurements',
  showMetrics: 'View FFT analysis metrics including sample rate and resolution',
  settings: 'Configure spectrum display, analysis parameters, and audio input',
  taps: 'Number of taps to average for peak detection (1-10)',
  threshold:
    'Signal level that triggers tap detection. Lower values detect quieter taps. In brace/plate mode this is used as the headroom above the ambient noise floor, not an absolute level.',
  peakMin:
    'Minimum peak magnitude shown on the spectrum chart. In guitar mode this also gates which peaks are reported. In brace/plate mode the tap capture uses its own adaptive noise floor, so this only affects chart display.',
  newTap: 'Start a new tap sequence to detect and analyze resonance peaks',
  pauseDetection: 'Pause tap detection to experiment with taps without advancing the sequence; spectrum stays live',
  resumeDetection: 'Resume tap detection to continue the in-progress sequence',
  acceptTap: 'Accept this tap and continue',
  cancel: 'Cancel the current tap sequence and start over',
  redoTap: 'Redo this tap phase',
  exportSpectrum: 'Export spectrum image as PNG file',
  compareTaps: 'Compare individual taps',
  showAveraged: 'Show averaged result only',
} as const

/**
 * Top-level app: the live-analysis orchestrator. Mirrors Swift `TapToneAnalysisView` /
 * Python `TapToneAnalysisView` (MainWindow) — owns the {@link RealtimeFFTAnalyzer}, wires the
 * spectrum chart, controls, threshold meter, results / peak cards, and the Settings /
 * Metrics / Help / Save / Measurements modals, delegating chart, annotation, material,
 * and engine concerns to the `useChartView` / `useAnnotations` / `useMaterialSession` /
 * `useAudioEngine` hooks.
 */
export default function App() {
  // A loaded measurement's saved axis range — transient override of the persisted display
  // range (mirrors Swift loadedAxisRange). Set on load, cleared on any new measurement.
  const [loadedView, setLoadedView] = useState<ChartView | null>(null)
  // Stable handle to useAnnotations' resetLabels so the material start handlers (defined above the
  // annotations hook) can clear dragged labels on a fresh capture (mirrors Swift resetAllAnnotationOffsets).
  const resetLabelsRef = useRef<() => void>(() => {})

  // Mirror of the applied calibration for matSearch + save provenance (read from stable refs).
  // Owned here (shared handle); the audio engine hook resolves + writes it.
  const calibrationRef = useRef<Calibration | null>(null)

  // The lifecycle-state owner (mirrors Swift/Python TapToneAnalyzer). App reads its immutable snapshot
  // via useSyncExternalStore; the device + the handlers below drive it. 6-TEST 3c-A migrates the two
  // count facts here (numberOfTaps, currentTapCount); completion/detection + material follow in 3c-A2/B.
  const { analyzer, snapshot } = useTapToneAnalyzer()
  const numberOfTaps = snapshot.numberOfTaps
  const currentTapCount = snapshot.currentTapCount
  // Engine state + clipping are analyzer facts now (no duplicate React state in useAudioEngine) — the
  // status-bar className / capturing distinction and the threshold-slider red zone read the snapshot (3c-C5).
  const engineState = snapshot.engineState
  const clipping = snapshot.isClipping
  // The frozen guitar result + per-tap comparison spectra now live on the analyzer (mirrors Swift
  // frozenMagnitudes/Frequencies + tapEntries), exposed via the snapshot. App reads them through
  // these aliases (all downstream reads unchanged); writes go through analyzer transitions
  // (processMultipleTaps on completion, loadMeasurement on load, clearResult on reset). 6-TEST 3c-C2b.
  const captured = snapshot.frozenSpectrum
  const tapEntries = snapshot.tapEntries
  const [showMultiTap, setShowMultiTap] = useState(false)
  // Active comparison overlay (created from a selection or loaded). Non-null = comparison mode.
  const [comparison, setComparison] = useState<ComparisonEntryModel[] | null>(null)

  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showHelpMenu, setShowHelpMenu] = useState(false)
  const [showQuickStart, setShowQuickStart] = useState(false)
  // Phone only: the Analysis Results panel is a button-triggered bottom sheet (mirrors iOS
  // `showingResults`). On desktop/tablet the panel is always visible and this is ignored (the
  // Results button + sheet styling only activate at the phone breakpoint).
  const [showResults, setShowResults] = useState(false)
  // Touch-only crosshair toggle (mirrors the iOS crosshair control on the toolbar, between
  // Auto dB and Annotations). Shown only on touch devices — a device with a real hovering
  // pointer (mouse/trackpad) gets the always-live crosshair and needs no toggle. Detect touch
  // via `maxTouchPoints` (+ `any-pointer: coarse`) rather than `(hover: hover)`: iPadOS Safari
  // defaults to a "desktop" UA that reports hover:hover=true with no mouse. `maxTouchPoints` is
  // 5 on iPad/iPhone regardless of desktop mode.
  const [crosshairMode, setCrosshairMode] = useState(false)
  const [isTouch] = useState(
    () =>
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      window.matchMedia('(any-pointer: coarse)').matches,
  )
  // The one shared online User Manual (versioned), same URL as Swift DocumentationLinks.userManual
  // and Python _open_user_manual.
  const userManualUrl = `https://www.dolcesfogato.com/guitar_tap/manual/GuitarTap-User-Manual-${__APP_VERSION__}.html`
  const [showPlayFile, setShowPlayFile] = useState(false)
  const [showMetrics, setShowMetrics] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [showMeasurements, setShowMeasurements] = useState(false)
  // Load-time provenance warning for a loaded measurement (mic/calibration/sample rate).
  const [loadWarning, setLoadWarning] = useState<string | null>(null)
  // Loaded-measurement settings banner (Swift showLoadedSettingsWarning): shown after a
  // load while its restored Threshold/Taps are active; cleared on a new measurement or
  // when the user changes Taps.
  const [showLoadedSettings, setShowLoadedSettings] = useState(false)
  // Name of the currently loaded measurement → chart title ("FFT Peaks — {name}", else "New").
  const [loadedName, setLoadedName] = useState<string | null>(null)
  const annotationMode = settings.annotationVisibilityMode
  const guitarType: GuitarTypeName = isGuitarType(settings.measurementType) ? settings.measurementType : 'generic'
  const material = isMaterialType(settings.measurementType)
  const brace = settings.measurementType === 'brace'
  const { minDb, maxDb, analysisMinHz, analysisMaxHz, showUnknownModes } = settings
  // Display frequency range resolves per measurement type (Swift minFrequency(for:)).
  const { minHz: displayMinHz, maxHz: displayMaxHz } = displayRangeFor(settings, settings.measurementType)
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
  // Keep the engine's dump flag in sync so it (de)activates continuous session recording on the next
  // measurement (the engine gates session accumulation on this to avoid buffering when the diagnostic is off).
  useEffect(() => {
    engineRef.current?.setConfig({ dumpCaptureAudio: settings.dumpCaptureAudio })
  }, [settings.dumpCaptureAudio])

  // The audio engine handle (constructed in `start`) — declared early so the material session
  // can arm it. The analyzer owns the plate/brace phase machine (6-TEST 3c-C3): App reads the phase +
  // per-phase spectra/peaks from the snapshot and drives the transitions via thin stable wrappers.
  const engineRef = useRef<RealtimeFFTAnalyzer | null>(null)
  const matPhase = snapshot.materialTapPhase
  const matPeaks = snapshot.matPeaks
  const matSpectra = snapshot.matSpectra

  // Mirror the settings the analyzer needs onto it: Swift/Python read these from the TapDisplaySettings
  // singleton, but the web has no analyzer-visible global. `measurementType` drives the material search
  // ranges + WAV label + brace auto-complete; `measureFlc` drives the plate phase plan. Declared BEFORE
  // the measurement-type reset effect so the analyzer sees the new type before that effect re-arms. 3c-C3.
  useEffect(() => {
    analyzer.setMeasurementTypeAndNotify(settings.measurementType)
    analyzer.setMeasureFlc(settings.measureFlc)
  }, [analyzer, settings.measurementType, settings.measureFlc])

  // Browser tab title carries the version+build, like the Swift/Python window titles
  // ("Guitar Tap 1.0.1 (NNN)"). Set once at mount.
  useEffect(() => {
    document.title = `Guitar Tap ${__APP_VERSION__} (${__APP_BUILD__})`
  }, [])

  // Loading a saved measurement sets the type, spectrum, peaks, and selection together;
  // these refs suppress the one-shot "reset on change" effects so the restore isn't clobbered.
  const skipNextTypeResetRef = useRef(false)
  // While a comparison is frozen, a tap-capture already in flight (started before Compare)
  // must not clobber it — onGuitarCapture checks this ref. Kept in sync with `comparison` below.
  const comparisonRef = useRef(false)
  // Peaks from a loaded measurement are authoritative: while set, Peak Min only FILTERS
  // them by magnitude — findPeaks is never re-run on the loaded spectrum (matches Swift
  // recalculateFrozenPeaksIfNeeded / Python recalculate_frozen_peaks_if_needed). Cleared
  // on a fresh live capture / New Tap / measurement-type change, reverting to findPeaks.
  const [loadedPeaks, setLoadedPeaks] = useState<Peak[] | null>(null)
  // Ring-out time of a LOADED guitar measurement (its stored `decayTime`). Read by the Analysis panel
  // only while `loadedPeaks != null`; live captures use the engine's live decayTime instead. Set on
  // the guitar-load path (the only place loadedPeaks becomes non-null), so it's always in sync there.
  const [loadedDecayTime, setLoadedDecayTime] = useState<number | null>(null)

  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])
  // Persist the display frequency range for a specific measurement type, merging with
  // the existing per-type map (Swift setMinFrequency(_:for:)). Functional update so it
  // never clobbers another type's stored range.
  const updateDisplayRange = useCallback(
    (type: MeasurementType, range: Partial<{ minHz: number; maxHz: number }>) =>
      setSettings((s) => ({
        ...s,
        displayRanges: { ...s.displayRanges, [type]: { ...displayRangeFor(s, type), ...range } },
      })),
    [],
  )
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
  // The web's startTapSequence()-equivalent: arm a fresh sequence for the CURRENT measurement
  // type. Guitar arms the always-on detector; plate/brace start the phase machine straight into
  // capturingLongitudinal + armed. There is no not-yet-started gate. One branch, and the single
  // arming path for both engine-start (via useAudioEngine's onStarted) and a measurement-type
  // switch — mirrors Swift/Python start() → startTapSequence() and onApply(measurementChanged)
  // → startTapSequence(). Reads measRef so it always sees the live type (fires outside render).
  const armForCurrentType = useCallback(() => {
    const e = engineRef.current
    if (!e?.running) return
    if (isMaterialType(measRef.current)) analyzer.startMaterial()
    else e.arm()
  }, [analyzer])
  // Switching measurement type resets the current result (mirrors the native measurementChanged
  // reset across the guitar↔material boundary) then arms a fresh sequence for the new type.
  // Skipped while loading a measurement, which sets the type and the restored result in the same commit.
  useEffect(() => {
    if (skipNextTypeResetRef.current) {
      skipNextTypeResetRef.current = false
      return
    }
    setLoadedPeaks(null)
    analyzer.clearResult() // drop the frozen guitar spectrum + per-tap comparison spectra
    setLoadedName(null)
    setLoadedView(null) // a new measurement context drops the loaded measurement's transient range
    setShowLoadedSettings(false)
    setShowMultiTap(false)
    setComparison(null)
    comparisonRef.current = false
    analyzer.resetMaterial()
    armForCurrentType()
  }, [analyzer, settings.measurementType, armForCurrentType])

  // Stable capture-result callback the engine's once-registered handler delegates to. The guitar tap
  // sequence finished: average the analyzer's accumulated taps into the frozen result (which also
  // builds the per-tap comparison spectra + marks complete), superseding any loaded measurement. A
  // frozen comparison absorbs an in-flight capture (guard) so processMultipleTaps doesn't run.
  const onGuitarCapture = useCallback(() => {
    if (comparisonRef.current) return
    setLoadedPeaks(null)
    setLoadWarning(null)
    setLoadedName(null)
    setLoadedView(null) // a live capture supersedes the loaded measurement's transient range
    setShowLoadedSettings(false)
    setShowMultiTap(false)
    setComparison(null)
    analyzer.processMultipleTaps() // average capturedTaps → frozen + per-tap (notifies the snapshot)
  }, [analyzer])
  // Continuous session WAV (one per measurement) — the engine already gated it on the dump setting.
  const onSessionAudio = useCallback((samples: Float32Array, sr: number, label: string) => {
    dumpCaptureWav(samples, sr, `session_${label}`)
  }, [])

  // Audio engine: lifecycle + telemetry + audio-input/calibration — see hooks/useAudioEngine.
  const {
    running,
    level,
    liveSpectrum,
    sampleRate,
    deviceLabel,
    error,
    errorKind,
    setError,
    inputDevices,
    currentDeviceId,
    calibrations,
    activeCalId,
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
  } = useAudioEngine({ engineRef, calibrationRef, tapThresholdRef, dumpCaptureRef: dumpAudioRef, onGuitarCapture, onSessionAudio, onStarted: armForCurrentType, analyzer })

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
      setLoadedView(null) // playing a file starts a new measurement — drop any loaded range
      setShowLoadedSettings(false)
      analyzer.clearResult()
      setShowMultiTap(false)
      setComparison(null)
      comparisonRef.current = false
      if (isMaterialType(measRef.current)) {
        // Material: fresh phase machine (no arm — the engine owns the L→C→(FLC) auto-advance session).
        resetLabelsRef.current() // a fresh capture starts with un-dragged labels (Swift resets offsets on start)
        analyzer.startMaterial(false)
        await engineRef.current.playFile(samples, fileRate, {
          material: { brace: measRef.current === 'brace', measureFlc: measureFlcRef.current, calibration: cal },
        })
      } else {
        await engineRef.current.playFile(samples, fileRate, { calibration: cal })
      }
    } catch (e) {
      setError(`Couldn't play file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [analyzer, setError])

  // Re-enumerate inputs whenever the Settings dialog opens, so a freshly-plugged
  // microphone shows up in the device picker without a reload.
  useEffect(() => {
    if (showSettings && running) void refreshDevices()
  }, [showSettings, running, refreshDevices])

  const newTap = useCallback(() => {
    setLoadedPeaks(null)
    setLoadWarning(null)
    setLoadedName(null)
    setLoadedView(null) // new tap → drop the loaded measurement's transient range
    setShowLoadedSettings(false)
    analyzer.clearResult()
    setShowMultiTap(false)
    setComparison(null)
    comparisonRef.current = false // re-arm cleanly: don't absorb the next tap
    engineRef.current?.arm()
  }, [analyzer])

  const changeTaps = useCallback((n: number) => {
    const v = Math.max(1, Math.min(10, n))
    analyzer.setNumberOfTaps(v)
    engineRef.current?.setConfig({ numberOfTaps: v })
    setShowLoadedSettings(false) // user changed Taps → the loaded-settings banner no longer applies
  }, [analyzer])

  // New Tap in material mode: clear any dragged labels (Swift resets offsets on start), then start
  // the analyzer's phase machine.
  const onMaterialNewTap = useCallback(() => {
    setLoadedView(null) // new material measurement → drop the loaded transient range
    setShowLoadedSettings(false)
    resetLabelsRef.current()
    analyzer.startMaterial()
  }, [analyzer])

  // Cancel is a restart (mirror Swift cancelTapSequence → startTapSequence): re-arm a fresh
  // sequence exactly like New Tap. Only offered while a multi-step sequence is active; during a
  // material review phase the Cancel button acts as Redo instead (see its onClick).
  const cancelTap = useCallback(() => {
    if (isMaterialType(measRef.current)) onMaterialNewTap()
    else newTap()
  }, [newTap, onMaterialNewTap])

  // Lock the stepper once a tap has been captured mid-sequence, so the per-phase tap total can't
  // change — the exact canonical single expression, guitar AND material (Swift `.disabled(currentTapCount
  // > 0 && !isMeasurementComplete)` / Python `not (tap_count > 0 and not complete)`). Unlocked while merely
  // waiting for the first tap; re-enabled when the measurement completes (material now flips
  // isMeasurementComplete too, 3c-D). 3c-C4 §12a: `analyzer.setNumberOfTaps` re-fires the prompt on change.
  const tapsLocked = currentTapCount > 0 && !snapshot.isMeasurementComplete

  // Live-tap path: re-analyze the frozen spectrum as Peak Min / guitar type change.
  // Loaded-measurement path: the saved peaks are authoritative — only filter them by
  // magnitude, never re-run findPeaks on the loaded spectrum (the spectrum is stored
  // for display only and may not reproduce the saved peaks). Mirrors Swift/Python
  // recalculateFrozenPeaksIfNeeded.
  // Peaks + classification now live on the analyzer (mirrors Swift currentPeaks / identifiedModes),
  // recomputed by recalculatePeaks whenever the frozen spectrum, loaded peaks, or the analysis settings
  // (Peak Min / guitar type / range) change — the web's TapDisplaySettings.didSet. Driven here via a
  // layout effect (recompute before paint, no stale flash), read via the snapshot. 3c §10 P1.
  // While detecting, peaks track the live spectrum (Swift analyzeMagnitudes per frame); once frozen
  // (complete) they use the frozen result, so gate the live spectrum off after completion to avoid
  // recomputing frozen peaks on every continuous FFT frame.
  const liveForPeaks = snapshot.isMeasurementComplete ? null : liveSpectrum
  useLayoutEffect(() => {
    analyzer.recalculatePeaks({ material, loadedPeaks, liveSpectrum: liveForPeaks, guitarType, minHz: analysisMinHz, maxHz: analysisMaxHz, peakMin })
  }, [analyzer, material, loadedPeaks, liveForPeaks, guitarType, analysisMinHz, analysisMaxHz, peakMin, captured])
  const peaks = snapshot.peaks
  const modeByPeak = snapshot.modeByPeak

  const sortedPeaks = useMemo(() => [...peaks].sort((a, b) => a.frequency - b.frequency), [peaks])
  // Live tap-tone ratio (f_Top / f_Air) for the Analysis Results panel — same fn the PDF uses.
  const tapRatio = useMemo(() => (material ? null : tapToneRatio(peaks, guitarType)), [material, peaks, guitarType])
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
    restoreMaterialOffsets,
  } = useAnnotations({ peaks, guitarType, captured, material })
  resetLabelsRef.current = resetLabels // bridge for the material start handlers defined above the hook

  // Re-analyze — re-detect peaks on the loaded/frozen spectrum using the CURRENT analysis settings
  // (Peak Min, analysis range, guitar type), letting you retune a saved measurement without
  // re-tapping. Loaded peaks are otherwise authoritative (never recomputed); this is the manual
  // "re-detect with current settings" action. Mirrors Swift reanalyzePeaks() / Python
  // reanalyze_peaks(): it CLEARS the loaded peaks so the `peaks` memo falls through to live
  // findPeaks() on the frozen spectrum, resets manual selection to auto, and — because loadedPeaks
  // is now null — disables the button (one-shot, exactly like the native apps). The stored ring-out
  // (loadedDecayTime) is left intact; decay is gated on loadedName, not loadedPeaks, so it persists.
  const reanalyze = useCallback(() => {
    if (!captured) return
    setLoadedPeaks(null)
    resetSelection()
  }, [captured, resetSelection])

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

  // Material phase markers (L=blue, C=orange, FLC=purple — native phase colors). Reuses the shared
  // annotation-offset store so L/C/FLC labels drag exactly like guitar labels (Swift/Python parity).
  const materialMarkers = useMemo<PeakMarker[]>(() => {
    return buildMaterialMarkers(matPeaks, annotationOffsets)
  }, [matPeaks, annotationOffsets])

  // ── Multi-tap comparison (guitar, >1 tap) ───────────────────────────────────
  // Per-tap mode peaks are (re)found from each tap spectrum at the current Peak Min,
  // mirroring Swift TapEntry recomputing on threshold change.
  const multiTapAvailable = !material && !!captured && tapEntries.length > 1
  const tapRows = useMemo<MultiTapRow[]>(
    () =>
      tapEntries.map((e) => {
        // Per-tap peaks live on the entry (found by the analyzer at the current Peak Min); resolve
        // the strongest per mode — identical to the old modePeaksFromSpectrum(sp).air/top/back.
        const m = resolvedModePeaks(e.peaks, guitarType)
        return { tapIndex: e.tapIndex, air: m.get('air')?.frequency ?? null, top: m.get('top')?.frequency ?? null, back: m.get('back')?.frequency ?? null }
      }),
    [tapEntries, guitarType],
  )
  // Averaged row uses the displayed peaks (respects loaded-authoritative peaks).
  const avgModes = useMemo<TapModeFreqs>(() => {
    const m = resolvedModePeaks(peaks, guitarType)
    return { air: m.get('air')?.frequency ?? null, top: m.get('top')?.frequency ?? null, back: m.get('back')?.frequency ?? null }
  }, [peaks, guitarType])
  const multiTapOverlays = useMemo<SpectrumOverlay[]>(() => {
    const out: SpectrumOverlay[] = tapEntries.map((e, i) => ({
      magnitudesDb: e.spectrum.magnitudesDb,
      frequencies: e.spectrum.frequencies,
      color: MULTITAP_PALETTE[i % MULTITAP_PALETTE.length]!,
      label: `Tap ${e.tapIndex}`,
    }))
    if (captured) out.push({ magnitudesDb: captured.magnitudesDb, frequencies: captured.frequencies, color: MULTITAP_AVG_COLOR, label: 'Averaged' })
    return out
  }, [tapEntries, captured])

  const binHz = sampleRate ? sampleRate / GUITAR_FFT_SIZE : null
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
  // Per-measurement-type display range (plate 20–200, brace 30–1000, guitar 75–350),
  // matching Swift/Python — no special-cased material override.
  const chartMinHz = displayMinHz
  const chartMaxHz = displayMaxHz

  // Chart view (zoom/pan range) + Auto-dB — see hooks/useChartView.
  const { view, setView, saveCurrentView, resetView, autoDb, toggleAutoDb } = useChartView({
    chartMinHz,
    chartMaxHz,
    minDb,
    maxDb,
    measurementType: settings.measurementType,
    loadedView,
    displaySpectrum,
    updateSettings,
    updateDisplayRange,
  })

  const cycleAnnotations = useCallback(() => {
    updateSettings({ annotationVisibilityMode: ANNOTATION_NEXT[annotationMode] })
  }, [annotationMode, updateSettings])

  // ── Metrics panel inputs (FFTAnalysisMetricsView) ─────────────────────────
  const metrics = useMemo<Metrics>(() => {
    // The Peak readout (status bar + Metrics panel) is LIVE telemetry — the current mic frame's loudest
    // bin — mirroring Swift `fft.peakFrequency`/`peakMagnitude` (always the live FFT analyzer's peak,
    // independent of what's displayed/frozen). Reading `displaySpectrum` here left it null during material
    // capture (matSpectra empty) → a bogus "Starting…"; the live spectrum is the correct source.
    const sp = liveSpectrum
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
      // Bin Count is Analysis *Configuration*, not a property of a capture: it is the live/continuous
      // FFT's output bin count, so it reads in every mode and before any tap. Mirrors Swift
      // `analyzer.frequencies.isEmpty ? "—" : analyzer.frequencies.count` (Python: `fft_size // 2`).
      binCount: sp ? sp.frequencies.length : null,
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
  }, [liveSpectrum, binHz, sampleRate, engineMetrics, running])

  // Status-bar progress + frozen indicators (mirror Swift "Phase X/Y · Tap N/M" / "⏸ Complete").
  // Mirrors Swift Controls:404-423: the label and the progress BAR share ONE gate — detecting AND
  // (material OR at least one guitar tap captured) — so they appear and vanish together.
  // The count means taps COMPLETED (never a provisional +1 for the tap in flight), which is exactly
  // what the bar measures — text and bar therefore stay in lock-step. Material `currentTapCount` is
  // CUMULATIVE across phases, so the plate label subtracts the completed phases to show the WITHIN-phase
  // count (Swift's identical expression); brace and guitar are single-phase and print it directly.
  const sbDetecting = snapshot.isDetecting
  // The BAR and the LABEL have DIFFERENT gates in Swift's macOS `fullStatusBar` — deliberately:
  //   bar:   `if tap.currentTapCount > 0`                                    (NO isDetecting)
  //   label: `if tap.isDetecting && (isPlateOrBrace || currentTapCount > 0)` (WITH isDetecting)
  // isDetecting drops for the 0.5 s per-tap cooldown, so gating the BAR on it would make it blink
  // out after every tap. Keying the bar on the tap count instead makes it appear on the first tap
  // and stay up for the whole measurement; New Tap / Cancel zero the count and clear it.
  // (The iOS `compactStatusBar` DOES gate its 50 pt bar on isDetecting — that is the variant the
  // desktop ports wrongly copied. Desktop mirrors fullStatusBar.)
  const sbShowBar = currentTapCount > 0
  const sbShowProgress = sbDetecting && (material || currentTapCount > 0)
  const sbProgress = (() => {
    if (!sbShowProgress) return ''
    if (material && !brace) {
      const step = matPhase.startsWith('capturingC')
        ? 2
        : matPhase.startsWith('capturingFlc') || matPhase === 'waitingForFlcTap'
          ? 3
          : 1
      const totalPhases = settings.measureFlc ? 3 : 2
      if (numberOfTaps <= 1) return `Phase ${step}/${totalPhases}`
      const withinPhase = Math.max(0, currentTapCount - (step - 1) * numberOfTaps)
      return `Phase ${step}/${totalPhases} · Tap ${withinPhase}/${numberOfTaps}`
    }
    // Brace + guitar: single phase, so the cumulative count IS the within-phase count.
    return `Tap ${currentTapCount}/${numberOfTaps}`
  })()
  // Complete = the shared flag now that material completion flips isMeasurementComplete too (3c-D).
  const sbComplete = !sbDetecting && snapshot.isMeasurementComplete

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
          annotationOffsetsByFreq: annotationOffsets,
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
        // A loaded measurement keeps its stored ring-out (don't overwrite with the live engine's).
        // Gated on loadedName, not loadedPeaks, so Re-analyze (which clears loadedPeaks) preserves
        // the stored ring-out — mirrors Swift currentDecayTime surviving reanalyzePeaks().
        decayTime: loadedName != null ? loadedDecayTime : (engineRef.current?.decayTime ?? null),
        view,
        settings,
        numberOfTaps,
        tapEntries,
        sampleRate,
        deviceLabel,
        microphoneUID: currentDeviceId ?? undefined,
        calibrationName: calibrationRef.current?.name,
      })
    },
    [comparison, material, matSpectra, matPeaks, captured, peaks, modeByPeak, selectedIds, overrides, annotationOffsets, loadedName, loadedDecayTime, view, settings, numberOfTaps, tapEntries, sampleRate, deviceLabel, currentDeviceId],
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
    const ts = Math.floor(Date.now() / 1000)
    // Multi-tap guitar measurements always produce the two-page report (averaged + per-tap
    // comparison), mirroring Swift exportMultiTapPDFReport (gated on tapEntries, not the on-screen toggle).
    if (m.tapEntries && m.tapEntries.length > 1) {
      void exportMultiTapPdfReport(multiTapPdfData(m), `${stem}-multitap-report-${ts}.pdf`)
    } else {
      void exportPdfReport(measurementToPdfData(m), `${stem}-report-${ts}.pdf`)
    }
  }, [buildCurrentMeasurement, loadedName])

  const onLoadMeasurement = useCallback(
    (m: TapToneMeasurementModel) => {
      // Comparison record: restore the overlay spectra directly from the saved entries.
      if (m.comparisonEntries) {
        comparisonRef.current = true
        const range = comparisonAxisRange(m.comparisonEntries)
        if (range) setView(range)
        setComparison(m.comparisonEntries)
        setShowLoadedSettings(false) // comparison isn't a settings-load (Swift gates on !isSavedComparison)
        setLoadedPeaks(null)
        analyzer.clearResult()
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
        setLoadedView(mat.view) // transient loaded axis range (Swift loadedAxisRange)
        setLoadedPeaks(null)
        analyzer.clearResult() // material uses matSpectra; no frozen guitar spectrum or per-tap entries
        setComparison(null)
        analyzer.restoreMaterial({ matSpectra: mat.matSpectra, matPeaks: mat.matPeaks })
        restoreMaterialOffsets(mat.annotationOffsetsByFreq) // dragged L/C/FLC label positions (shared store)
        setLoadWarning(measurementWarning(m, { microphoneName: deviceLabel, sampleRate }))
        setLoadedName(m.measurementName ?? null)
        {
          const loadedTaps = m.numberOfTaps ?? 1
          analyzer.setNumberOfTaps(loadedTaps)
          engineRef.current?.setConfig({ numberOfTaps: loadedTaps })
          setShowLoadedSettings(true)
        }
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
      // The loaded measurement's axis range is a TRANSIENT override (Swift loadedAxisRange):
      // shown now, but the user's persisted per-type display range is left untouched.
      setLoadedView(live.view)
      setLoadedPeaks(live.loadedPeaks) // authoritative saved peaks (Peak Min filters them)
      setLoadedDecayTime(m.decayTime ?? null) // show the FILE's stored ring-out, not the live engine's
      // Freeze the loaded spectrum + restore per-tap comparison spectra on the analyzer (mirrors Swift
      // loadMeasurement restoring frozenMagnitudes/Frequencies + tapEntries).
      analyzer.loadMeasurement({
        magnitudes: live.captured.magnitudesDb,
        frequencies: live.captured.frequencies,
        taps: (m.tapEntries ?? []).map((e) => ({ magnitudesDb: e.snapshot.magnitudes, frequencies: e.snapshot.frequencies })),
      })
      setComparison(null)
      setView(live.view)
      // Restore selection + overrides + dragged label positions (sets the loading guard so this
      // survives the fresh-capture reset that loading triggers).
      restoreAnnotations({
        overridesByFreq: live.overridesByFreq,
        annotationOffsetsByFreq: live.annotationOffsetsByFreq,
        selectedIndices: live.selectedIndices,
      })
      // Load-time provenance check (mic / calibration / sample rate) — closes the web
      // side of the sample-rate epic. Cleared on New Tap / fresh capture.
      setLoadWarning(measurementWarning(m, { microphoneName: deviceLabel, sampleRate }))
      setLoadedName(m.measurementName ?? null)
      // Restore the measurement's Taps and show the loaded-settings banner (Swift parity).
      {
        const loadedTaps = m.numberOfTaps ?? 1
        analyzer.setNumberOfTaps(loadedTaps)
        engineRef.current?.setConfig({ numberOfTaps: loadedTaps })
        setShowLoadedSettings(true)
      }
      setShowMultiTap(false)
      setComparison(null)
      setShowMeasurements(false)
    },
    [analyzer, settings.measurementType, updateSettings, deviceLabel, sampleRate, restoreAnnotations, restoreMaterialOffsets, setView],
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
    analyzer.clearResult()
    setShowMultiTap(false)
    setLoadWarning(null)
    setLoadedName(null)
    setShowMeasurements(false)
    // Freeze the comparison: stop the always-on listener so a stray tap can't clobber it
    // (mirrors Swift displayMode == .comparison). New Tap re-arms.
    engineRef.current?.disarm()
  }, [analyzer, setView])

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
        {/* Phone only: open the Analysis Results bottom sheet (mirrors the iOS Results button).
            Hidden on desktop/tablet, where the results panel is always visible. */}
        <button
          className={`btn phone-only${showResults ? ' on' : ''}`}
          onClick={() => setShowResults((v) => !v)}
          aria-pressed={showResults}
          title="Analysis Results"
        >
          <ResultsIcon />
          <span>Results</span>
        </button>
        <button
          className="btn"
          onClick={() => setShowPlayFile(true)}
          disabled={!running || comparison != null}
          title={HINTS.playFile}
        >
          <FilePlayIcon />
          <span>Play File</span>
        </button>
        <button
          className={`btn toggle ${autoDb ? 'on' : ''}`}
          onClick={toggleAutoDb}
          disabled={!running}
          aria-pressed={autoDb}
          title={HINTS.autoScale(autoDb)}
        >
          <AutoDbIcon />
          <span>Auto dB</span>
        </button>
        {isTouch && (
          <button
            className={`btn toggle ${crosshairMode ? 'on' : ''}`}
            onClick={() => setCrosshairMode((m) => !m)}
            aria-pressed={crosshairMode}
            title={crosshairMode ? 'Crosshair on — drag the chart to read values' : 'Crosshair — drag the chart to read values'}
          >
            {crosshairMode ? <PlusViewfinderIcon /> : <DotViewfinderIcon />}
            <span>Crosshair</span>
          </button>
        )}
        <button
          className={`btn toggle ${annotationMode !== 'none' ? 'on' : ''}`}
          onClick={cycleAnnotations}
          disabled={!running || material || displayPeaks.length === 0}
          title={HINTS.annotations(ANNOTATION_LABEL[annotationMode])}
        >
          {annotationMode === 'all' ? <EyeIcon /> : annotationMode === 'selected' ? <StarIcon /> : <EyeOffIcon />}
          <span>Annotations</span>
        </button>
        <button
          className="btn"
          onClick={() => setShowSave(true)}
          disabled={comparison ? false : material ? matPhase !== 'complete' : !captured}
          title={HINTS.save}
        >
          <SaveIcon />
          <span>Save</span>
        </button>
        <button className="btn" onClick={() => setShowMeasurements(true)} title={HINTS.measurements}>
          <ClipboardIcon />
          <span>Measurements</span>
        </button>
        <button className="btn" onClick={() => setShowMetrics(true)} disabled={!running} title={HINTS.showMetrics}>
          <BarChartIcon />
          <span>Metrics</span>
        </button>
        <button className="btn" onClick={() => setShowSettings(true)} title={HINTS.settings}>
          <GearIcon />
          <span>Settings</span>
        </button>
        <div className="help-menu-wrap">
          <button
            className="btn"
            onClick={() => setShowHelpMenu((v) => !v)}
            title="Help"
            aria-haspopup="menu"
            aria-expanded={showHelpMenu}
          >
            <HelpIcon />
            <span>Help</span>
          </button>
          {showHelpMenu && (
            <>
              <div className="menu-backdrop" onClick={() => setShowHelpMenu(false)} />
              <div className="help-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowHelpMenu(false)
                    setShowQuickStart(true)
                  }}
                >
                  <HelpIcon />
                  <span>Quick Start Guide</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowHelpMenu(false)
                    window.open(userManualUrl, '_blank', 'noopener,noreferrer')
                  }}
                >
                  <BookIcon />
                  <span>User Manual</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 2 — Tap Controls (measurement controls). Native macOS order
          (regularTapControlsWide): Taps │ Threshold │ Peak Min, actions right-aligned. */}
      <div className="toolbar toolbar-taps">
        {running && (
          <>
            {/* Taps stepper — applies to guitar AND each material phase (Swift numberOfTaps). */}
            <div className="field" title={HINTS.taps}>
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

            <div className="field" title={HINTS.threshold}>
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
                <div className="field" title={HINTS.peakMin}>
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
          const paused = snapshot.isDetectionPaused
          const detecting = snapshot.isDetecting
          // Enablement via the shared canonical rule (mirrors Swift `buttonRule` / Python
          // `button_rule`; pinned by test/button-enablement). The measurement is "complete"
          // when a guitar tap was captured, or the material phase machine reached `complete`.
          // (Cancel now re-arms rather than completing, so there's no cancelled→complete term.)
          const { newTapDisabled, pauseEnabled, cancelEnabled } = buttonRule({
            isDetecting: detecting,
            isDetectionPaused: paused,
            isMeasurementComplete: material ? matPhase === 'complete' : snapshot.isMeasurementComplete,
            fftIsRunning: running,
            displayModeIsComparison: comparison != null,
            measurementType: material ? (brace ? 'brace' : 'plate') : 'classical',
            materialTapPhase: matPhase,
            currentTapCount: currentTapCount,
            numberOfTaps,
          })
          return (
            // No-wrap group so the trio never splits across rows, and each button has a fixed
            // min-width so relabeling (Pause→Resume, Cancel→Redo) can't change widths and reflow
            // the row — a button's state change must not re-lay out the controls.
            <div className="tap-actions">
              <button
                className="btn btn-primary tap-action"
                onClick={material ? onMaterialNewTap : newTap}
                disabled={newTapDisabled}
                title={HINTS.newTap}
              >
                <TapIcon />
                <span>New Tap</span>
              </button>
              <button
                className={`btn tap-action${reviewing ? ' btn-accept' : ''}`}
                onClick={reviewing ? () => analyzer.acceptMaterial() : paused ? resumeTap : pauseTap}
                disabled={!pauseEnabled}
                title={reviewing ? HINTS.acceptTap : paused ? HINTS.resumeDetection : HINTS.pauseDetection}
              >
                {reviewing ? <CheckIcon /> : paused ? <PlayIcon /> : <PauseIcon />}
                <span>{reviewing ? 'Accept' : paused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                className={`btn tap-action${cancelEnabled ? ' btn-cancel' : ''}`}
                onClick={reviewing ? () => analyzer.redoMaterial() : cancelTap}
                disabled={!cancelEnabled}
                title={reviewing ? HINTS.redoTap : HINTS.cancel}
              >
                {reviewing ? <UndoIcon /> : <CancelIcon />}
                <span>{reviewing ? 'Redo' : 'Cancel'}</span>
              </button>
            </div>
          )
        })()}
      </div>

      <div className="main">
        <div className="chart-pane">
          <div className="chart-wrap">
            <SpectrumChart
              // The primary line = isMeasurementComplete ? frozen : live, matching Swift's displaySpectrum
              // (SpectrumViews.swift) for guitar AND material. Material's frozen base is intentionally empty
              // (the per-phase spectra are matOverlays), so material paints the LIVE spectrum while capturing
              // (EG-2 fix — was `null`) and no base once complete. Comparison/multi-tap suppress the base.
              spectrum={
                comparison || showMultiTap
                  ? null
                  : material
                    ? snapshot.isMeasurementComplete
                      ? null
                      : liveSpectrum
                    : displaySpectrum
              }
              title={`FFT Peaks — ${loadedName ?? 'New'}`}
              overlays={comparison ? comparisonOverlays : material ? matOverlays : showMultiTap ? multiTapOverlays : undefined}
              guitarType={material || comparison || showMultiTap ? undefined : guitarType}
              peakMin={peakMin}
              markers={comparison || showMultiTap ? [] : chartMarkers}
              minHz={view.minHz}
              maxHz={view.maxHz}
              minDb={view.minDb}
              maxDb={view.maxDb}
              onViewChange={setView}
              onReset={resetView}
              onAnnotationDrag={comparison || showMultiTap ? undefined : onAnnotationDrag}
              onResetLabels={comparison || showMultiTap ? undefined : resetLabels}
              hasMovedLabels={annotationOffsets.size > 0}
              frozen={captured != null || (material && matPhase === 'complete')}
              crosshairMode={crosshairMode}
            />
          </div>
          {material && !comparison && (
            <MaterialInstructionPanel phase={matPhase} brace={brace} measureFlc={settings.measureFlc} />
          )}
        </div>

        {/* Phone: tap outside the results sheet to close it. */}
        {showResults && <div className="results-sheet-backdrop phone-only" onClick={() => setShowResults(false)} />}
        <aside className={`results-pane${showResults ? ' open' : ''}`}>
          <div className="results-inner">
          <div className="results-head">
            <h2>Analysis Results</h2>
            {/* Multi-tap toggle: shown whenever it could ever be useful (guitar context),
                enabled only when there's a >1-tap sequence to compare (or it's already open).
                Hidden in material / saved-comparison, where it can never do anything — so it
                enables/disables in place instead of appearing and disappearing (all 3 platforms). */}
            {!material && !comparison && (
              <button
                className={`btn mini taps-toggle${showMultiTap ? ' active' : ''}`}
                onClick={() => setShowMultiTap((v) => !v)}
                disabled={!(multiTapAvailable || showMultiTap)}
                title={showMultiTap ? HINTS.showAveraged : HINTS.compareTaps}
              >
                ∿ Taps
              </button>
            )}
            <span className={`type-badge ${comparison ? 'comparison' : material ? 'material' : 'guitar'}`}>
              {comparison ? 'Comparison' : MEASUREMENT_SHORT_NAME[settings.measurementType]}
            </span>
          </div>

          {/* Active input device + Re-analyze — mirrors the Swift/Python results header (row 2).
              Enabled state is the analyzer's `canReanalyze`, so all three platforms answer it
              identically: any complete guitar measurement with a frozen spectrum, never material.
              Material DISABLES rather than hides (matching native) — the button is greyed, not
              absent, so the header doesn't reflow between measurement types. */}
          {!comparison && (
            <div className="results-mic">
              <span className="results-mic-name">{deviceLabel}</span>
              <button
                className="btn mini icon"
                onClick={reanalyze}
                disabled={!snapshot.canReanalyze}
                title={
                  material
                    ? 'Re-analyze applies to guitar measurements only'
                    : 'Re-analyze peaks from the spectrum using the current settings'
                }
                aria-label="Re-analyze peaks"
              >
                <RefreshIcon />
              </button>
            </div>
          )}

          {/* Selection controls — FIXED above the scroll (only peak cards scroll), mirroring the
              Swift/Python header. Shown in the guitar peak view whether or not peaks exist yet (like
              native, the header stays put while waiting); the buttons disable themselves when empty.
              Icon-only, matching Swift: checkmark.circle (All) / xmark.circle (None) / wand.and.stars. */}
          {!comparison && !material && !showMultiTap && (
            <div className="results-sub">
              <span className="range-text">
                Showing {displayMinHz} – {displayMaxHz} Hz
              </span>
              <div className="sel-buttons">
                <button
                  className="btn mini icon"
                  onClick={selectAll}
                  disabled={displayPeaks.every((p) => selectedIds.has(p.id))}
                  title="Select all peaks"
                  aria-label="Select all peaks"
                >
                  <CheckIcon />
                </button>
                <button
                  className="btn mini icon"
                  onClick={selectNone}
                  disabled={displayPeaks.every((p) => !selectedIds.has(p.id))}
                  title="Deselect all peaks"
                  aria-label="Deselect all peaks"
                >
                  <CancelIcon />
                </button>
                <button
                  className="btn mini icon"
                  onClick={resetSelection}
                  disabled={!userModified}
                  title="Reset to automatic mode selection"
                  aria-label="Reset to automatic mode selection"
                >
                  <WandIcon />
                </button>
              </div>
            </div>
          )}

          <div className="results-scroll">
          {comparison ? (
            <ComparisonResultsView rows={comparisonRows} />
          ) : material ? (
            <MaterialResults type={brace ? 'brace' : 'plate'} settings={settings} peaks={matPeaks} complete={matPhase === 'complete'} />
          ) : showMultiTap && multiTapAvailable ? (
            <MultiTapComparisonResultsView taps={tapRows} avg={avgModes} />
          ) : (
            <>
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
              ) : captured ? (
                <p className="empty">No peaks above Peak Min.</p>
              ) : null}
            </>
          )}
          </div>

          {/* Guitar summary (Ring-Out · Tap Ratio) — pinned below the scrollable peak list, above
              the export bar, side by side. Mirrors the native live panel (guitar only). */}
          {!material && !comparison && !showMultiTap && (
            <AnalysisResults decayTime={loadedName != null ? loadedDecayTime : decayTime} ratio={tapRatio} guitarType={guitarType} />
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
                title={HINTS.exportSpectrum}
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

      {showLoadedSettings && !comparison && (
        <div className="loaded-settings-banner" role="status">
          ⚠ Settings from loaded measurement — Threshold: {Math.round(settings.tapDetectionThreshold)} dB · Taps:{' '}
          {numberOfTaps}
        </div>
      )}
      <div className={`statusbar state-${engineState}`}>
        {/* Full-width linear progress bar on its OWN ROW above the status line — mirrors Swift's macOS
            fullStatusBar, a VStack of "ProgressView when currentTapCount > 0" then the status HStack.
            Gated on the tap count alone (see sbShowBar) so it never blinks during the per-tap cooldown. */}
        {sbShowBar && (
          <div
            className="sb-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={snapshot.tapProgress}
          >
            <div className="sb-progress-fill" style={{ width: `${snapshot.tapProgress * 100}%` }} />
          </div>
        )}
        <div className="statusbar-row">
        {/* LEFT — detection state: dot + Waiting/Detected + level (mirrors Swift order). */}
        <span className={`sb-state-dot${sbComplete ? ' complete' : ''}`} />
        {/* Swift: isMeasurementComplete ? "Tap Detected!" : "Waiting for tap...". */}
        <span className="sb-detect">{sbComplete ? 'Tap Detected!' : 'Waiting for tap...'}</span>
        <span className="sb-sep">•</span>
        {/* Swift: guitar shows peak magnitude here, material shows the input level. */}
        {/* Swift Controls: guitar shows fft.peakMagnitude, material shows fft.displayLevelDB — both at the
            FFT-frame rate (engineMetrics), NOT the fast per-chunk level (which drives the threshold meter).
            Before the first complete frame both default to -100 in Swift (fft.peakMagnitude / displayLevelDB),
            so fall back to -100 here too — not the fast `level` — to hold -100 dB until the first frame. */}
        <span className="level">
          {(material ? (engineMetrics?.displayLevelDB ?? -100) : (metrics.peakMagnitude ?? -100)).toFixed(1)} dB
        </span>
        <span className="spacer" />
        {/* RIGHT — complete badge + peak + active dot + statusMessage + progress. */}
        {sbComplete && <span className="sb-frozen">⏸ Complete</span>}
        {running && (
          <span className="sb-peak">
            {metrics.peakFrequency != null && metrics.peakMagnitude != null
              ? `Peak: ${metrics.peakMagnitude.toFixed(1)} dB @ ${metrics.peakFrequency.toFixed(1)} Hz`
              : 'Starting...'}
          </span>
        )}
        <span className={`sb-active-dot${sbDetecting ? ' on' : ''}`} />
        <span className={`sb-msg${sbDetecting ? '' : ' idle'}`}>{snapshot.statusMessage}</span>
        {sbProgress && <span className="sb-progress">{sbProgress}</span>}
        </div>
      </div>

      {/* Mic-error / load-warning alerts as modal dialogs, mirroring the native apps'
          .alert(...) popups (Microphone Access Required / Audio Engine Error / Microphone
          Not Connected) instead of an inline banner. */}
      {error
        ? (() => {
            const permission = errorKind === 'permission'
            const title = permission
              ? 'Microphone Access Required'
              : errorKind === 'other'
              ? 'Error'
              : 'Audio Engine Error'
            const message = permission
              ? 'GuitarTap needs microphone access to analyse tap tones. Please allow microphone access for this site in your browser settings, then retry.'
              : error
            const buttons =
              errorKind === 'other'
                ? [{ label: 'OK', primary: true, onClick: () => setError(null) }]
                : [
                    { label: 'Retry', primary: true, onClick: () => { setError(null); void retry() } },
                    { label: permission ? 'Cancel' : 'OK', onClick: () => setError(null) },
                  ]
            return <AlertModal title={title} message={message} buttons={buttons} onDismiss={() => setError(null)} />
          })()
        : loadWarning && (
            <AlertModal
              title="Microphone Not Connected"
              message={loadWarning}
              buttons={[{ label: 'OK', primary: true, onClick: () => setLoadWarning(null) }]}
              onDismiss={() => setLoadWarning(null)}
            />
          )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          sampleRate={sampleRate}
          deviceLabel={deviceLabel}
          currentView={view}
          onApply={setSettings}
          onSaveCurrentView={saveCurrentView}
          onClose={() => setShowSettings(false)}
          userManualUrl={userManualUrl}
          onShowQuickStart={() => {
            setShowSettings(false)
            setShowQuickStart(true)
          }}
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

      {showQuickStart && <QuickStartGuide onClose={() => setShowQuickStart(false)} />}
    </div>
  )
}
