// @parity view/main
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RealtimeFFTAnalyzer } from './audio/realtimeFFTAnalyzer'
import { SpectrumChart } from './components/SpectrumChart'
import { MaterialInstructionPanel } from './components/MaterialInstructionPanel'
import { AlertModal } from './components/AlertModal'
import { apply as applyAppearance, comparisonRole, cssVariable, seriesRole } from './presentation/palette'
import type { ChartView, PeakMarker, SpectrumOverlay } from './presentation/chartTypes'
import { useChartView } from './hooks/useChartView'
import { type MaterialTapPhase as MatPhase, type DefinitiveModeInfo } from './state/tapToneAnalyzer'
import { useAudioEngine } from './hooks/useAudioEngine'
import { ThresholdMeter } from './components/ThresholdMeter'
import { PeakCard } from './components/PeakCard'
import { SettingsPanel } from './components/SettingsPanel'
import { MetricsPanel, type Metrics } from './components/MetricsPanel'
import { SaveSheet } from './components/SaveSheet'
import { PlayFileSheet } from './components/PlayFileSheet'
import { QuickStartGuide } from './components/QuickStartGuide'
import { ReleaseNotes } from './components/ReleaseNotes'
// Toolbar + tap-control icons live in a shared module so the Quick Start Guide can render the
// exact same glyphs next to each control (Swift SF Symbols / Python qtawesome equivalents).
import { TapIcon, PauseIcon, PlayIcon, CancelIcon, CheckIcon, UndoIcon, AutoDbIcon, EyeIcon, StarIcon, EyeOffIcon, SaveIcon, ClipboardIcon, BarChartIcon, GearIcon, HelpIcon, BookIcon, NotesIcon, FilePlayIcon, DotViewfinderIcon, PlusViewfinderIcon, WandIcon, ResultsIcon, RefreshIcon } from './components/icons'
import { buttonRule } from './state/buttonEnablement'
import { useTapToneAnalyzer } from './hooks/useTapToneAnalyzer'
import { MeasurementsPanel } from './components/MeasurementsPanel'
import { MaterialResults, type MaterialPeaks } from './components/MaterialResults'
import { AnalysisResults } from './components/AnalysisResults'
import { buildComparisonEntries, comparisonEntryModeFreqs, comparisonAxisRange, measurementToLive, measurementToLiveMaterial } from './measurement/fromLive'
import { ComparisonResultsView, type ComparisonRow } from './components/ComparisonResultsView'
import { importMeasurements, saveMeasurement } from './measurement/store'
import { exportStem } from './measurement/exportFilename'
import { parseCalibration, type Calibration } from './dsp/calibration'
import { decodeWav } from './dsp/wav'
import { exportSpectrumPng, type SpectrumImageOpts } from './presentation/spectrumExport'
import { buildGuitarMarkers, buildMaterialMarkers, measurementToPdfData, multiTapPdfData } from './presentation/measurementImage'
import { exportPdfReport, exportMultiTapPdfReport } from './presentation/pdfReport'
import type { TapToneMeasurementModel, ComparisonEntryModel } from './measurement'
import { MODE_DISPLAY_NAME } from './presentation/modeColors'
import { GUITAR_FFT_SIZE } from './dsp/guitarFFT'
import { MultiTapComparisonResultsView, type MultiTapRow } from './components/MultiTapComparisonResultsView'
import { resolvedModePeaks, type ResolvedMode } from './dsp/classify'
import { modeBands, peaksInDisplayRange, type GuitarTypeName } from './dsp/guitarModes'
import { Pitch } from './dsp/pitch'
import { FieldPrecision } from './precision'
import { ANALYSIS_MIN_HZ, ANALYSIS_MAX_HZ, loadSettings, saveSettings, isGuitarType, isMaterialType, minFrequency, maxFrequency, setFrequencyRange, MEASUREMENT_SHORT_NAME, MEASUREMENT_FULL_NAME, ANNOTATION_NEXT, ANNOTATION_LABEL, type Settings, type MeasurementType } from './settings'
import type { ResonantPeak } from './measurement/types'
import { displayRangeLabel } from './presentation/frequencyFormat'
import './App.css'

const pitch = new Pitch(440)



const isReviewing = (p: MatPhase) => p === 'reviewingL' || p === 'reviewingC' || p === 'reviewingFlc'


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
  // Mirror of the applied calibration for matSearch + save provenance (read from stable refs).
  // Owned here (shared handle); the audio engine hook resolves + writes it.

  // The lifecycle-state owner (mirrors Swift/Python TapToneAnalyzer). App reads its immutable snapshot
  // via useSyncExternalStore; the device + the handlers below drive it.
  const { analyzer, snapshot } = useTapToneAnalyzer()
  const numberOfTaps = snapshot.numberOfTaps
  const currentTapCount = snapshot.currentTapCount
  // Clipping is an analyzer fact (no duplicate React state in useAudioEngine) — the threshold-slider
  // red zone reads the snapshot.
  const clipping = snapshot.isClipping
  // The frozen guitar result + per-tap comparison spectra live on the analyzer (mirrors Swift
  // frozenMagnitudes/Frequencies + tapEntries), exposed via the snapshot. App reads them through
  // these aliases; writes go through analyzer transitions
  // (processMultipleTaps on completion, loadMeasurement on load, clearResult on reset).
  const captured = snapshot.frozenSpectrum
  const tapEntries = snapshot.tapEntries
  // The per-tap overlay toggle is analyzer state (Swift `showingMultiTapComparison`).
  const showMultiTap = snapshot.showingMultiTapComparison
  // Active comparison overlay (created from a selection or loaded). Non-null = comparison mode.
  // Derived from the analyzer, which owns the display mode and the overlay data together. Named
  // `comparison` for the render paths below; null when not comparing.
  const comparison =
    snapshot.displayMode === 'comparison' && snapshot.comparisonEntries.length > 0
      ? snapshot.comparisonEntries
      : null

  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showHelpMenu, setShowHelpMenu] = useState(false)
  const [showQuickStart, setShowQuickStart] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
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
  // The load-time provenance warning (microphone / calibration / sample rate), the loaded name and
  // the loaded notes are MODEL state — Swift's `microphoneWarning` / `loadedMeasurementName` /
  // `loadedNotes` — so every load path sets and clears them the same way.
  const loadWarning = snapshot.microphoneWarning
  // Loaded-measurement settings banner (Swift showLoadedSettingsWarning): shown after a
  // load while its restored Threshold/Taps are active; cleared on a new measurement or
  // when the user changes Taps. It is MODEL state (snapshot.showLoadedSettingsWarning), as in
  // Swift and Python.
  // The chart title names the file being played (or last played), else the loaded measurement, else
  // "New" — Swift chartTitle: fft.playingFileName ?? tap.loadedMeasurementName ?? "New".
  const playingFileName = snapshot.playingFileName
  const loadedName = snapshot.loadedMeasurementName
  const loadedNotes = snapshot.loadedNotes
  const annotationMode = settings.annotationVisibilityMode
  const guitarType: GuitarTypeName = isGuitarType(settings.measurementType) ? settings.measurementType : 'generic'
  const material = isMaterialType(settings.measurementType)
  const brace = settings.measurementType === 'brace'
  const { minDb, maxDb, showUnknownModes } = settings
  // Display frequency range resolves per measurement type (Swift minFrequency(for:)).
  const displayMinHz = minFrequency(settings, settings.measurementType)
  const displayMaxHz = maxFrequency(settings, settings.measurementType)
  const peakMin = settings.peakMinThreshold
  const tapThreshold = settings.tapDetectionThreshold

  // Material measurement state. Engine callbacks are registered once, so the phase
  // and measurement type are mirrored into refs for the onMaterialCapture handler.
  const measRef = useRef(settings.measurementType)
  measRef.current = settings.measurementType
  const tapThresholdRef = useRef(settings.tapDetectionThreshold)
  tapThresholdRef.current = settings.tapDetectionThreshold

  // The audio engine handle (constructed in `start`) — declared early so the material session
  // can arm it. The analyzer owns the plate/brace phase machine: App reads the phase +
  // per-phase spectra/peaks from the snapshot and drives the transitions via thin stable wrappers.
  const engineRef = useRef<RealtimeFFTAnalyzer | null>(null)
  const matPhase = snapshot.materialTapPhase
  // The identified peaks (the analyzer's selected…Peak, Swift's names) as the per-role bundle the material
  // views take.
  const matPeaks = useMemo<MaterialPeaks>(
    () => ({ longitudinal: snapshot.selectedLongitudinalPeak, cross: snapshot.selectedCrossPeak, flc: snapshot.selectedFlcPeak }),
    [snapshot.selectedLongitudinalPeak, snapshot.selectedCrossPeak, snapshot.selectedFlcPeak],
  )
  const materialIdentifiedPeaks = snapshot.materialIdentifiedPeaks
  const matSpectra = snapshot.matSpectra
  // Store B — the current material measurement's OWN dimensions. Owned by the ANALYZER, like Swift
  // `analyzer.materialInputs` and Python `analyzer.material_inputs`: seeded from Settings by the
  // completion setter (the didSet), restored from the file by restoreMaterial, edited through
  // setMaterialInputs. `null` for guitar and before a material measurement completes. The sole source
  // for MaterialResults' calc + Save, never the live Settings.
  const matInputs = snapshot.materialInputs

  // Mirror the settings the analyzer needs onto it: Swift/Python read these from the TapDisplaySettings
  // singleton, but the web has no analyzer-visible global. `measurementType` drives the material search
  // ranges + WAV label + brace auto-complete; `measureFlc` drives the plate phase plan. A LAYOUT effect
  // declared BEFORE the measurement-type transition layout effect, so the analyzer sees the new type
  // before the transition re-arms and reclassifies for it.
  useLayoutEffect(() => {
    analyzer.setMeasurementTypeAndNotify(settings.measurementType)
    analyzer.setMeasureFlc(settings.measureFlc)
    // The whole settings object, for the completion setter's Store B seed.
    analyzer.setSettings(settings)
  }, [analyzer, settings])

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
  // Peaks from a loaded measurement are authoritative: while set, Peak Min only FILTERS
  // them by magnitude — findPeaks is never re-run on the loaded spectrum (matches Swift
  // recalculateFrozenPeaksIfNeeded / Python recalculate_frozen_peaks_if_needed). Cleared
  // on a fresh live capture / New Tap / measurement-type change, reverting to findPeaks.
  // `loadedPeaks` lives on the ANALYZER now (Swift `loadedMeasurementPeaks`). It used to be React
  // state here, which meant the peaks and the frozen spectrum were applied in two different places
  // and could be observed half-applied. Reading it from the snapshot keeps one source of truth.
  const loadedPeaks = snapshot.loadedPeaks
  const setLoadedPeaks = useCallback(
    (v: ResonantPeak[] | null) => { if (v === null) analyzer.clearLoadedPeaks(); else analyzer.loadedPeaks = v },
    [analyzer],
  )
  // Ring-out of what is on screen — ONE value on the analyzer (Swift `currentDecayTime`): the file's
  // when a measurement is loaded, the live tracker's during a capture. The view used to hold both a
  // `loadedDecayTime` and the engine's live value and choose between them by `loadedName != null`.
  const currentDecayTime = snapshot.currentDecayTime

  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])
  // Persist the display frequency range for a specific measurement type (Swift
  // setMinFrequency(_:for:) / setMaxFrequency(_:for:)). Functional update so it never clobbers
  // another type's stored range.
  const updateDisplayRange = useCallback(
    (type: MeasurementType, range: { minHz?: number; maxHz?: number }) =>
      setSettings((s) => ({ ...s, ...setFrequencyRange(s, range, type) })),
    [],
  )
  useEffect(() => saveSettings(settings), [settings])
  // Draw the app in the scheme the Appearance setting resolves to — at launch and whenever the setting changes
  // (mirrors Swift's root onAppear and applySettings).
  useEffect(() => applyAppearance(settings.appearance), [settings.appearance])
  // Ask the browser to make storage persistent so the saved-measurements library (IndexedDB)
  // isn't evicted under pressure. Best-effort: Chrome/Firefox honor it; Safari mostly ignores
  // it (there, installing the app is what makes storage durable — see the Measurements hint).
  useEffect(() => {
    void navigator.storage?.persist?.()
  }, [])
  // The web's startTapSequence()-equivalent: arm a fresh sequence for the CURRENT measurement
  // type. Guitar arms the always-on detector; plate/brace start the phase machine straight into
  // capturingLongitudinal + armed. There is no not-yet-started gate. One branch, and the single
  // arming path for both engine-start (via useAudioEngine's onStarted) and a measurement-type
  // switch — mirrors Swift/Python start() → startTapSequence() and onApply(measurementChanged)
  // → startTapSequence(). Reads measRef so it always sees the live type (fires outside render).
  const armForCurrentType = useCallback(() => {
    if (!engineRef.current?.running) return
    analyzer.requestStartTapSequence() // one path, guitar or material; stops a playing file first
  }, [analyzer])
  // Tracks the previous measurement type so a type change can distinguish a guitar-SUBTYPE change (both
  // types guitar) from a paradigm change (crossing guitar↔material, or plate↔brace).
  const prevTypeRef = useRef(settings.measurementType)
  // Switching measurement type. A guitar-subtype change (both guitar, e.g. Generic → Flamenco) is a
  // CLEAN SLATE for the new type — reclassify + clear manual labels + re-auto-select, KEEPING the frozen
  // measurement (Swift reclassifyForGuitarTypeChange / Python reclassify_for_guitar_type_change). Crossing
  // the guitar↔material boundary, or plate↔brace, is a paradigm change that needs a fresh sequence. A
  // LAYOUT effect, so the clean slate (or reset) is applied before paint — synchronous, no intermediate
  // frame, matching Swift
  // (onApply) and Python (_on_measurement_type_changed), both synchronous. Skipped while loading a
  // measurement (which sets the type + the restored result in the same commit).
  useLayoutEffect(() => {
    const prev = prevTypeRef.current
    const next = settings.measurementType
    prevTypeRef.current = next
    if (skipNextTypeResetRef.current) {
      skipNextTypeResetRef.current = false
      return
    }
    if (prev !== next && isGuitarType(prev) && isGuitarType(next)) {
      // Guitar subtype change: clean-slate re-classification for the new type, keeping the frozen
      // spectrum, peaks and dragged offsets (Swift reclassifyForGuitarTypeChange — no re-detection).
      analyzer.reclassifyForGuitarTypeChange()
      return
    }
    // Initial mount (prev === next) or a paradigm change: drop the result + per-peak state and arm afresh.
    setLoadedPeaks(null)
    analyzer.clearResult() // drop the frozen guitar spectrum + per-tap comparison spectra
    setLoadedView(null) // a new measurement context drops the loaded measurement's transient range
    analyzer.resetMaterial()
    armForCurrentType()
  }, [analyzer, settings.measurementType, guitarType, armForCurrentType, setLoadedPeaks])

  // Stable capture-result callback the engine's once-registered handler delegates to. The guitar tap
  // sequence finished: average the analyzer's accumulated taps into the frozen result (which also
  // builds the per-tap comparison spectra + marks complete), superseding any loaded measurement. A
  // frozen comparison absorbs an in-flight capture (guard) so processMultipleTaps doesn't run.

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
    setErrorKind,
    inputDevices,
    currentDeviceId,
    calibrations,
    activeCalId,
    engineMetrics,
    pauseTap,
    resumeTap,
    onSelectDevice,
    onImportCalibration,
    onSelectCalibration,
    onDeleteCalibration,
    retry,
  } = useAudioEngine({ engineRef, tapThresholdRef, onStarted: armForCurrentType, analyzer })

  // Play a recorded WAV through the live pipeline (Swift openAudioFile). The calibration is the one the
  // user gives for the file, or none — never the live input's.
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
      setLoadedView(null) // playing a file starts a new measurement — drop any loaded range
      // The analyzer applies the calibration, arms the sequence and plays the file (the app's one Play
      // File path, which the file-playback regressions also run). Mirrors Swift openAudioFile calling
      // tapToneAnalyzer.playFile(url:calibrationURL:completion:).
      await analyzer.playFile(samples, fileRate, cal, audio.name.replace(/\.[^.]+$/, ''))
    } catch (e) {
      setError(`Couldn't play file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [analyzer, setError, setLoadedPeaks])

  /** Everything a fresh measurement must drop from the previously LOADED one, whatever the mode.
   *
   *  Swift/Python clear this inside their single shared `startTapSequence` / `start_tap_sequence`, so
   *  guitar and material cannot drift apart. The web splits New Tap into two handlers (`newTap` /
   *  `onMaterialNewTap`), and material silently cleared only `loadedView` — so after New Tap on a
   *  plate/brace the Save sheet still offered the LOADED measurement's name (its `defaultName` is
   *  `loadedName`), and the load-time provenance warning stayed live too. Both paths now call this,
   *  which is the closest the web gets to the native single arm path. */
  const clearLoadedMeasurement = useCallback(() => {
    setLoadedPeaks(null)
    setLoadedView(null) // drop the loaded measurement's transient axis range
    // Store B is NOT nulled here: Swift never clears materialInputs on New Tap, and it does not need
    // to — the completion setter re-seeds on the next transition.
  }, [setLoadedPeaks])

  const newTap = useCallback(() => {
    clearLoadedMeasurement()
    analyzer.requestStartTapSequence() // clears, returns to live, and arms — guitar or material
  }, [analyzer, clearLoadedMeasurement])

  const changeTaps = useCallback((n: number) => {
    const v = Math.max(1, Math.min(10, n))
    analyzer.setNumberOfTaps(v)
    engineRef.current?.setConfig({ numberOfTaps: v })
  }, [analyzer])

  // Cancel is a restart (Swift cancelTapSequence): re-arm a fresh sequence exactly like New Tap, and
  // during a file playback stop the file first. Offered while a multi-step sequence is active and
  // throughout a playback; during a material review phase the Cancel button acts as Redo instead
  // (see its onClick).
  const cancelTap = useCallback(() => {
    clearLoadedMeasurement()
    analyzer.cancelTapSequence()
  }, [analyzer, clearLoadedMeasurement])

  // Lock the stepper once a tap has been captured mid-sequence, so the per-phase tap total can't
  // change — the exact canonical single expression, guitar AND material (Swift `.disabled(currentTapCount
  // > 0 && !isMeasurementComplete)` / Python `not (tap_count > 0 and not complete)`). Unlocked while merely
  // waiting for the first tap; re-enabled when the measurement completes (material flips
  // isMeasurementComplete too). `analyzer.setNumberOfTaps` re-fires the prompt on change.
  const tapsLocked = currentTapCount > 0 && !snapshot.isMeasurementComplete

  // Peaks + classification live on the analyzer and are set at the event, as in Swift: a live FFT frame
  // (onFftFrame, wired in useAudioEngine), completion (processMultipleTaps), a load (loadMeasurement),
  // Re-analyze (reanalyzePeaks) and a guitar-type change (reclassifyForGuitarTypeChange). Peak Min is a
  // display projection (`peaksAbovePeakMin`), never a re-detection.
  const peaks = snapshot.peaks // the durable FULL set (down to -100) — used for selection state + save

  // Peak Min is a DISPLAY control, so it is pushed into the analyzer on its OWN effect and never
  // triggers detection. Making it a detection input would re-run findPeaks on every slider tick,
  // re-minting peak ids and churning the per-peak state hanging off them (a deselected peak
  // re-selecting, dragged labels snapping back). Setting the threshold only re-projects. Mirrors
  // Swift, where the slider writes
  // TapDisplaySettings.peakMinThreshold and the analyzer's didSet calls refreshDisplayedPeaks().
  useLayoutEffect(() => {
    analyzer.setPeakMinThreshold(peakMin)
  }, [analyzer, peakMin])

  const modeByPeak = snapshot.modeByPeak

  // The Peak-Min display projection, computed BY THE ANALYZER (Swift peaksAbovePeakMin / Python
  // peaks_above_peak_min). It used to be a useMemo right here — which put a rule about the
  // measurement ("Peak Min is guitar-only; material is never filtered") in the view, where the save
  // path, the PDF and the tests each had to re-derive it. The display list, chart dots/markers and
  // the live ratio read THIS; selection state and the save path read the full set above.
  const peaksAbovePeakMin = snapshot.peaksAbovePeakMin

  const sortedPeaks = useMemo(() => [...peaksAbovePeakMin].sort((a, b) => a.frequency - b.frequency), [peaksAbovePeakMin])
  // Live tap-tone ratio (f_Top / f_Air) over the DEFINITIVE Air/Top (selected + override-aware), so a
  // renamed/deselected Top drops it — matching the saved-list and PDF ratios. Recomputes on any snapshot
  // change (selection / overrides / peaks). Mirrors Swift analyzer.calculateTapToneRatio.
  // `snapshot` is a deliberate recompute trigger for the imperative analyzer read — not a lexical dep,
  // so exhaustive-deps flags it; removing it would stop the ratio updating on selection/override changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tapRatio = useMemo(() => (material ? null : analyzer.tapToneRatio()), [material, analyzer, snapshot])
  // displayPeaks / displayPeaksInRange are defined below useAnnotations — they now depend on the
  // override state (a user-named peak is "known"), which the hook provides.
  const bandByMode = useMemo(() => {
    const m = new Map<string, { lo: number; hi: number }>()
    for (const b of modeBands(guitarType)) m.set(b.name, { lo: b.lo, hi: b.hi })
    return m
  }, [guitarType])

  // Per-peak SELECTION, overrides, and dragged offsets all live on the analyzer, keyed by peak id —
  // read them from the snapshot, write via analyzer methods.
  const selectedIds = snapshot.selectedPeakIds
  const userModified = snapshot.userModifiedSelection
  const toggleSelect = useCallback((id: string) => analyzer.togglePeakSelection(id), [analyzer])
  const selectNone = useCallback(() => analyzer.selectNoPeaks(), [analyzer])
  const resetSelection = useCallback(() => analyzer.resetToAutoSelection(), [analyzer])
  const overrides = snapshot.overrides
  const annotationOffsets = snapshot.annotationOffsets // id-keyed dragged label positions
  // Chart drag → analyzer (markers carry the peak id as their annoKey); Reset Labels clears the store.
  const onAnnotationDrag = useCallback((k: string, pos: [number, number]) => analyzer.updateAnnotationOffset(k, pos), [analyzer])
  const resetLabels = useCallback(() => analyzer.resetAllAnnotationOffsets(), [analyzer])

  // Re-analyze — re-detect peaks on the loaded/frozen spectrum with the current guitar type, letting you
  // retune a saved measurement without re-tapping. Swift reanalyzePeaks() / Python reanalyze_peaks().
  const reanalyze = useCallback(() => analyzer.reanalyzePeaks(), [analyzer])

  const labelFor = (p: ResonantPeak, mode: ResolvedMode) => overrides.get(p.id) ?? MODE_DISPLAY_NAME[mode]

  // The ids of user-NAMED peaks. A named peak is "known" everywhere — the ONE predicate the
  // results table + chart dots + badges share, so it never vanishes when Show Unknown Modes is off.
  // Mirrors Swift `overriddenPeakIDs` / Python `overridden_peak_ids`. The overrides are id-keyed on
  // the analyzer, so this is a direct read of the map's keys (no frequency conversion).
  const overriddenPeakIds = useMemo(() => new Set(overrides.keys()), [overrides])
  // Results-panel list: hide unknown peaks when Show Unknown Modes is off, UNLESS the user named one
  // (override-aware — mirrors Swift `!isUnknown`). Then filtered to the chart's live range
  // (displayPeaksInRange, below useChartView); the chart's dot/badge layers apply their own per-marker
  // range guard so a zoom can reveal out-of-band dots.
  const displayPeaks = useMemo(
    () =>
      showUnknownModes
        ? sortedPeaks
        : sortedPeaks.filter((p) => (modeByPeak.get(p.id) ?? 'unknown') !== 'unknown' || overriddenPeakIds.has(p.id)),
    [sortedPeaks, modeByPeak, showUnknownModes, overriddenPeakIds],
  )
  const inRangeFor = (p: ResonantPeak, mode: ResolvedMode): boolean | null => {
    if (mode === 'unknown' || mode === 'upper') return null
    const band = bandByMode.get(mode)
    return band ? p.frequency >= band.lo && p.frequency <= band.hi : null
  }


  // Material phase markers (L=blue, C=orange, FLC=purple — native phase colors). Reuses the shared
  // annotation-offset store so L/C/FLC labels drag exactly like guitar labels (Swift/Python parity).
  const materialMarkers = useMemo<PeakMarker[]>(() => {
    return buildMaterialMarkers(matPeaks, annotationMode, annotationOffsets)
  }, [matPeaks, annotationMode, annotationOffsets])

  // ── Multi-tap comparison (guitar, >1 tap) ───────────────────────────────────
  const multiTapAvailable = !material && !!captured && tapEntries.length > 1
  const tapRows = useMemo<MultiTapRow[]>(
    () =>
      tapEntries.map((e) => {
        // Each tap's own auto-selected peaks, classified under the current guitar type — as Swift's
        // MultiTapComparisonResultsView calls entry.resolvedModePeaks(guitarType:).
        const m = e.resolvedModePeaks(guitarType)
        return { tapIndex: e.tapIndex, air: m.get('air')?.frequency ?? null, top: m.get('top')?.frequency ?? null, back: m.get('back')?.frequency ?? null }
      }),
    [tapEntries, guitarType],
  )
  // Averaged row = the DEFINITIVE Air/Top/Back (the SELECTED, override-aware peak per mode), over the
  // durable set — a fact about the measurement, independent of the Peak-Min slider. An
  // overridden value carries an isOverride flag so the row can mark it italic + " *". Recomputes on any
  // snapshot change (selection / overrides / peaks). Mirrors Swift analyzer.definitiveModeInfo().
  // `snapshot` is a deliberate recompute trigger for the imperative analyzer read — not a lexical dep,
  // so exhaustive-deps flags it; removing it would stop the averaged modes updating on selection/override changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const avgModes = useMemo<DefinitiveModeInfo>(() => analyzer.definitiveModeInfo(), [analyzer, snapshot])
  const multiTapOverlays = useMemo<SpectrumOverlay[]>(() => {
    const out: SpectrumOverlay[] = tapEntries.map((e, i) => ({
      magnitudesDb: e.snapshot.magnitudes,
      frequencies: e.snapshot.frequencies,
      role: seriesRole(i),
      label: `Tap ${e.tapIndex}`,
    }))
    if (captured) out.push({ magnitudesDb: captured.magnitudesDb, frequencies: captured.frequencies, role: 'series.average', label: 'Averaged' })
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
      // Chart legend uses the frequency notation (fL/fC) and the "Diagonal (fLC)" name uniformly for
      // plate AND brace, matching Swift/Python.
      out.push({ ...matSpectra.longitudinal, role: 'material.longitudinal', label: 'Longitudinal (fL)' })
    if (matSpectra.cross) out.push({ ...matSpectra.cross, role: 'material.cross', label: 'Cross-grain (fC)' })
    if (matSpectra.flc) out.push({ ...matSpectra.flc, role: 'material.flc', label: 'Diagonal (fLC)' })
    return out
  }, [material, matSpectra])
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
    longitudinalPeak: snapshot.selectedLongitudinalPeak,
    crossPeak: snapshot.selectedCrossPeak,
    flcPeak: snapshot.selectedFlcPeak,
    sequenceStarts: snapshot.sequenceStarts,
    materialPeaksFromLoad: snapshot.materialPeaksFromLoad,
  })
  // The guitar peak list: the peaks within the chart's live range, so zoom, pan, a load or a widening
  // changes what is listed (Swift TapAnalysisResultsView.sortedPeaksWithModes → [minFreq, maxFreq],
  // the view's range).
  const displayPeaksInRange = useMemo(
    () => displayPeaks.filter((p) => p.frequency >= view.minHz && p.frequency <= view.maxHz),
    [displayPeaks, view.minHz, view.maxHz],
  )
  // Swift's results list (TapAnalysisResultsView.sortedPeaksWithModes): none in a saved-measurement
  // comparison; a plate's or brace's every peak above Peak Min; a guitar's listed peaks.
  const resultsListPeaks = comparison ? [] : material ? peaksAbovePeakMin : displayPeaksInRange

  // Chart peak layers, mirroring Swift SpectrumView+ChartContent:
  //   • dots   — EVERY peak in the visible range gets one (allPeaksInRange), mode-colored;
  //   • badges — gated by AnnotationVisibilityMode (visiblePeaks):
  //     all = every peak in range, selected = only chosen results, none = no badges.
  // The candidate set is the SHARED dot-list rule (peaksInDisplayRange, `@parity view/dot-layer`):
  // the CURRENT view range — so dots follow zoom/pan exactly like Swift's minFreq/maxFreq — then
  // the `isKnown` frequency-band filter. Deliberately NOT the assigned-mode filter the Results
  // panel uses (displayPeaksInRange): a peak carrying a freeform mode override still sits in a
  // band, so Swift/Python keep its dot — the web used to drop it.
  // Styled markers via the SHARED builder (measurementImage.ts) so the live view and the exported
  // image (incl. saved-measurement export) use identical peak styling.
  const chartPeaks = useMemo(
    () => peaksInDisplayRange(sortedPeaks, view.minHz, view.maxHz, !material, showUnknownModes, overriddenPeakIds, guitarType),
    [sortedPeaks, view.minHz, view.maxHz, material, showUnknownModes, overriddenPeakIds, guitarType],
  )
  const markers = useMemo<PeakMarker[]>(
    () => buildGuitarMarkers(chartPeaks, modeByPeak, selectedIds, overrides, annotationMode, annotationOffsets),
    [chartPeaks, selectedIds, modeByPeak, overrides, annotationMode, annotationOffsets],
  )
  const chartMarkers = material ? materialMarkers : markers

  const cycleAnnotations = useCallback(() => {
    updateSettings({ annotationVisibilityMode: ANNOTATION_NEXT[annotationMode] })
  }, [annotationMode, updateSettings])

  // ── Metrics panel inputs (FFTAnalysisMetricsView) ─────────────────────────
  const metrics = useMemo<Metrics>(() => {
    // The Peak readout (status bar + Metrics panel) is LIVE telemetry — the current frame's loudest
    // bin, owned by the FFT engine and published with the frame's metrics, as Swift's
    // `fft.peakFrequency`/`peakMagnitude` and Python's `mic.peak_frequency`/`peak_magnitude` are
    // (independent of what's displayed/frozen). A silent input reads -∞ dB @ 0.0 Hz.
    const sp = liveSpectrum
    const peakFrequency: number | null = engineMetrics?.peakFrequency ?? null
    const peakMagnitude: number | null = engineMetrics?.peakMagnitude ?? null
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
  // Complete = the shared flag; material completion flips isMeasurementComplete too.
  const sbComplete = !sbDetecting && snapshot.isMeasurementComplete

  // ── Library: save the frozen guitar result, load one back in ─────────────
  // Build a TapToneMeasurementModel from the CURRENT frozen result — the one place that
  // assembles a measurement from live state, shared by Save and the PDF/report exports so
  // the saved record and the exported report are built identically. Returns null when
  // there's nothing to capture (no spectrum yet).
  // The current measurement for a save or a PDF: the analyzer builds it from its own state (Swift
  // saveMeasurement); App passes only the view's state — the name, the notes and the displayed range. A
  // comparison is App's, as Swift's view branches to saveComparison.
  const buildCurrentMeasurement = useCallback(
    (name: string, notes: string): TapToneMeasurementModel | null => {
      if (comparison) return analyzer.buildComparisonMeasurement(name, notes)
      return analyzer.buildMeasurement(name, notes, view)
    },
    [analyzer, comparison, view],
  )

  const onSaveMeasurement = useCallback(
    (name: string, notes: string) => {
      if (comparison) {
        void analyzer.saveComparison(name, notes)
        return
      }
      void analyzer.saveMeasurement(name, notes, view)
    },
    [analyzer, comparison, view],
  )

  // Export the CURRENT view as a single-page PDF report (live mirror of the Saved-Measurements
  // row menu's "Export PDF Report"), via the same measurement builder → measurementToPdfData.
  // Guards the export handlers against re-entry and double-click, using synchronous refs. A useState
  // flag / the button's `disabled` update too late to catch the 2nd click of a double-click, and on
  // the download-fallback path (no showSaveFilePicker) the export finishes *instantly* — so an
  // "in-flight" ref alone is already cleared (in `finally`) by the time the 2nd click's handler runs.
  // So: `isExportingRef` blocks an overlapping export while a save picker is open, and the per-button
  // `last…ExportRef` timestamps debounce a rapid repeat (the double-click) regardless of how fast the
  // export completed. `isExporting` state only drives the button's disabled look.
  const isExportingRef = useRef(false)
  const lastPdfExportRef = useRef(0)
  const lastSpectrumExportRef = useRef(0)
  const [isExporting, setIsExporting] = useState(false)

  const exportPdf = useCallback(async () => {
    const m = buildCurrentMeasurement(loadedName ?? '', '')
    if (!m) return
    const now = performance.now()
    if (isExportingRef.current || now - lastPdfExportRef.current < 700) return  // in-flight or double-click
    isExportingRef.current = true
    lastPdfExportRef.current = now
    setIsExporting(true)
    // A report is a report — multi-tap and comparison included: no `-multitap-`/`-report-` infix,
    // "report" only as the unnamed default.
    const filename = `${exportStem(loadedName, Math.floor(Date.now() / 1000), 'report')}.pdf`
    // Multi-tap guitar measurements always produce the two-page report (averaged + per-tap
    // comparison), mirroring Swift exportMultiTapPDFReport (gated on tapEntries, not the on-screen toggle).
    try {
      if (m.tapEntries && m.tapEntries.length > 0) {
        await exportMultiTapPdfReport(multiTapPdfData(m), filename)
      } else {
        await exportPdfReport(measurementToPdfData(m), filename)
      }
    } catch (e) {
      // Never let a PDF failure die as a console-only unhandled rejection. The likeliest cause is a
      // stale service worker after a deploy: the report code lazy-loads jsPDF, and an old cached shell
      // asks for a jsPDF chunk the new build renamed ("Importing a module script failed") — a reload
      // updates the worker and fixes it. Hence the reload hint, unlike the spectrum/PNG path.
      setError(`Couldn't export the PDF report. A newer version of the app may be available — reload the page (or fully close and reopen), then try again.\n\n(${e instanceof Error ? e.message : String(e)})`)
      setErrorKind('other')
    } finally {
      isExportingRef.current = false
      setIsExporting(false)
    }
  }, [buildCurrentMeasurement, loadedName, setError, setErrorKind])

  const onLoadMeasurement = useCallback(
    (m: TapToneMeasurementModel) => {
      // The MODEL loads: it works out guitar / material / comparison record, converts the file,
      // restores itself, and records what it loaded. This handler applies the parts that live
      // outside the model — the settings store and the chart — exactly as Swift's
      // `.onReceive(tap.$loadedMeasurementType / $loadedAxisRange)` handlers do. It used to BE the
      // load: ~110 lines of conversion and sequencing, which is why an import could not perform one.
      analyzer.loadMeasurement(m)

      // The measurement's own display settings (type, measureFlc, thresholds, annotation mode).
      // The skip-ref suppresses the one-shot "reset on type change" effect so the restore stands.
      const patch = analyzer.loadedSettings
      if (patch) {
        if (patch.measurementType && patch.measurementType !== settings.measurementType) {
          skipNextTypeResetRef.current = true
        }
        updateSettings(patch)
      }
      // The saved axis range is the loaded range — for a comparison as for a single measurement — shown
      // without changing the user's saved per-type range, and left by a new sequence the user has not
      // moved the chart since (Swift setLoadedAxisRange → loadedChartRange).
      const range = analyzer.loadedAxisRange
      setLoadedView(range)
      if (range && !m.comparisonEntries && !m.longitudinalSnapshot) setView(range)
      // The device is told the tap count the model restored.
      engineRef.current?.setConfig({ numberOfTaps: analyzer.numberOfTaps })
      setShowMeasurements(false)
    },
    [analyzer, settings.measurementType, updateSettings, setView],
  )

  // Create a comparison from ≥2 selected library measurements (mirrors Swift loadComparison).
  const onCompare = useCallback((measurements: TapToneMeasurementModel[]) => {
    const entries = buildComparisonEntries(measurements)
    if (entries.length < 2) return
    // The union of the compared measurements' ranges, as the loaded range (Swift loadComparison →
    // setLoadedAxisRange).
    setLoadedView(comparisonAxisRange(entries))
    setLoadedPeaks(null)
    analyzer.clearResult() // returns to live and drops any overlay...
    analyzer.loadComparison(entries) // ...then enters comparison. Order matters: clearResult
    // would otherwise wipe what we just set. The analyzer is readable synchronously, so the
    // in-flight-capture guard in onGuitarCapture sees this immediately — no ref to keep in sync.
    setShowMeasurements(false)
    // Freeze the comparison: stop the always-on listener so a stray tap can't clobber it
    // (mirrors Swift displayMode == .comparison). New Tap re-arms.
  }, [analyzer, setLoadedView, setLoadedPeaks])

  // Comparison chart overlays + results rows (derived from the active comparison entries).
  const comparisonOverlays = useMemo<SpectrumOverlay[]>(
    () =>
      (comparison ?? []).map((e, i) => ({
        magnitudesDb: e.snapshot.magnitudes,
        frequencies: e.snapshot.frequencies,
        role: comparisonRole(i, e.label),
        label: e.label,
      })),
    [comparison],
  )
  // Export the CURRENT chart (whatever's displayed) as a PNG — same props passed to SpectrumChart.
  const exportSpectrumImage = useCallback(async () => {
    const now = performance.now()
    if (isExportingRef.current || now - lastSpectrumExportRef.current < 700) return  // in-flight or double-click
    isExportingRef.current = true
    lastSpectrumExportRef.current = now
    setIsExporting(true)
    const opts: SpectrumImageOpts = {
      title: `FFT Peaks — ${playingFileName ?? loadedName ?? 'New'}`,
      spectrum: comparison || material || showMultiTap ? null : displaySpectrum,
      overlays: comparison ? comparisonOverlays : material ? matOverlays : showMultiTap ? multiTapOverlays : undefined,
      markers: comparison || showMultiTap ? [] : chartMarkers,
      view,
      measurementTypeName: comparison ? 'Comparison' : MEASUREMENT_FULL_NAME[settings.measurementType],
      guitarType: material || comparison ? undefined : guitarType,
      date: new Date().toLocaleString(),
    }
    try {
      await exportSpectrumPng(opts, `${exportStem(loadedName, Math.floor(Date.now() / 1000), 'spectrum')}.png`)
    } catch (e) {
      // Surface the failure instead of a console-only rejection (mirrors the PDF path). No jsPDF/lazy
      // chunk here, so no reload hint — a plain image/save error.
      setError(`Couldn't export the spectrum image.\n\n(${e instanceof Error ? e.message : String(e)})`)
      setErrorKind('other')
    } finally {
      isExportingRef.current = false
      setIsExporting(false)
    }
  }, [comparison, material, showMultiTap, displaySpectrum, comparisonOverlays, matOverlays, multiTapOverlays, chartMarkers, view, playingFileName, loadedName, settings.measurementType, guitarType, setError, setErrorKind])

  const comparisonRows = useMemo<ComparisonRow[]>(
    () =>
      (comparison ?? []).map((e, i) => ({
        label: e.label,
        color: `var(${cssVariable(comparisonRole(i, e.label))})`,
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
          className={`btn tint tint-accent phone-only${showResults ? ' on' : ''}`}
          onClick={() => setShowResults((v) => !v)}
          aria-pressed={showResults}
          title="Analysis Results"
        >
          <ResultsIcon />
          <span>Results</span>
        </button>
        <button
          className={`btn tint ${snapshot.isPlayingFile ? 'tint-playing-file' : 'tint-accent'}`}
          onClick={() => setShowPlayFile(true)}
          disabled={!running || comparison != null}
          title={HINTS.playFile}
        >
          <FilePlayIcon />
          <span>Play File</span>
        </button>
        <button
          className={`btn tint tint-accent toggle ${autoDb ? 'on' : ''}`}
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
            className={`btn tint tint-accent toggle ${crosshairMode ? 'on' : ''}`}
            onClick={() => setCrosshairMode((m) => !m)}
            aria-pressed={crosshairMode}
            title={crosshairMode ? 'Crosshair on — drag the chart to read values' : 'Crosshair — drag the chart to read values'}
          >
            {crosshairMode ? <PlusViewfinderIcon /> : <DotViewfinderIcon />}
            <span>Crosshair</span>
          </button>
        )}
        <button
          className={`btn tint tint-accent toggle ${annotationMode !== 'none' ? 'on' : ''}`}
          onClick={cycleAnnotations}
          // Something to annotate, and no comparison on screen: the Peak-Min projection (guitar) or the
          // identified L/C/FLC (material) — the same test as Swift's and Python's.
          disabled={snapshot.displayMode === 'comparison' || (material ? materialIdentifiedPeaks : peaksAbovePeakMin).length === 0}
          title={HINTS.annotations(ANNOTATION_LABEL[annotationMode])}
        >
          {annotationMode === 'all' ? <EyeIcon /> : annotationMode === 'selected' ? <StarIcon /> : <EyeOffIcon />}
          <span>Annotations</span>
        </button>
        <button
          className="btn tint tint-accent"
          onClick={() => setShowSave(true)}
          disabled={!snapshot.hasResultToSaveOrExport}
          title={HINTS.save}
        >
          <SaveIcon />
          <span>Save</span>
        </button>
        <button className="btn tint tint-accent" onClick={() => setShowMeasurements(true)} title={HINTS.measurements}>
          <ClipboardIcon />
          <span>Measurements</span>
        </button>
        <button className="btn tint tint-accent" onClick={() => setShowMetrics(true)} disabled={!running} title={HINTS.showMetrics}>
          <BarChartIcon />
          <span>Metrics</span>
        </button>
        <button className="btn tint tint-accent" onClick={() => setShowSettings(true)} title={HINTS.settings}>
          <GearIcon />
          <span>Settings</span>
        </button>
        <div className="help-menu-wrap">
          <button
            className="btn tint tint-accent"
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
                {/* Release Notes — browser edition only. The web is always the latest version the
                    moment it loads, so the notes for the running build belong in the app; the Apple
                    edition ships its notes through the App Store and the desktop edition with its
                    GitHub release. */}
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowHelpMenu(false)
                    setShowReleaseNotes(true)
                  }}
                >
                  <NotesIcon />
                  <span>Release Notes</span>
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
            {/* Taps stepper — applies to guitar AND each material phase (Swift numberOfTaps).
                The WHOLE field dims when the count locks, not just the ± buttons: Swift wraps the
                label, the value and the stepper in one `.disabledDimmed(tapCountLocked)`, and a
                bright label beside a greyed value reads as though the label were still live. */}
            <div className={`field${tapsLocked ? ' is-disabled' : ''}`} title={HINTS.taps}>
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
                  // Swift/Python clear the banner inside tapDetectionThreshold's own setter; web's
                  // threshold is settings state, so the change is reported instead.
                  analyzer.noteLoadedSettingsDeviation()
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
          // Every button stays VISIBLE; all three apps enable/disable, never hide. `paused` drives
          // only the Pause→Resume relabel below — enablement comes from the shared rule, which
          // treats a paused sequence as still in flight (B6 pins Cancel ENABLED while paused).
          const reviewing = material && isReviewing(matPhase)
          const paused = snapshot.isDetectionPaused
          // Enablement via the shared canonical rule (mirrors Swift `buttonRule` / Python
          // `button_rule`; pinned by test/button-enablement). The measurement is "complete"
          // when a guitar tap was captured, or the material phase machine reached `complete`.
          // (Cancel now re-arms rather than completing, so there's no cancelled→complete term.)
          const { newTapDisabled, pauseEnabled, cancelEnabled } = buttonRule({
            detectionState: snapshot.detectionState,
            isMeasurementComplete: material ? matPhase === 'complete' : snapshot.isMeasurementComplete,
            fftIsRunning: running,
            isReadyForDetection: snapshot.isReadyForDetection,
            displayMode: snapshot.displayMode,
            measurementType: material ? (brace ? 'brace' : 'plate') : 'generic',
            materialTapPhase: matPhase,
            numberOfTaps,
            isPlayingFile: snapshot.isPlayingFile,
          })
          return (
            // No-wrap group so the trio never splits across rows, and each button has a fixed
            // min-width so relabeling (Pause→Resume, Cancel→Redo) can't change widths and reflow
            // the row — a button's state change must not re-lay out the controls.
            <div className="tap-actions">
              <button
                className="btn btn-primary tap-action"
                onClick={newTap}
                disabled={newTapDisabled}
                title={HINTS.newTap}
              >
                <TapIcon />
                <span>New Tap</span>
              </button>
              <button
                className={`btn tint tap-action ${reviewing ? 'tint-complete' : 'tint-accent'}`}
                onClick={reviewing ? () => analyzer.acceptMaterial() : paused ? resumeTap : pauseTap}
                disabled={!pauseEnabled}
                title={reviewing ? HINTS.acceptTap : paused ? HINTS.resumeDetection : HINTS.pauseDetection}
              >
                {reviewing ? <CheckIcon /> : paused ? <PlayIcon /> : <PauseIcon />}
                <span>{reviewing ? 'Accept' : paused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                className={`btn tint tap-action ${cancelEnabled ? 'tint-warning' : 'tint-inactive'}`}
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
              // and no base once complete. Comparison/multi-tap suppress the base.
              spectrum={
                // A device change is settling: show nothing rather than the new device's
                // not-yet-valid audio, matching Swift/Python.
                snapshot.isSettling
                  ? null
                  : comparison || showMultiTap
                  ? null
                  : material
                    ? snapshot.isMeasurementComplete
                      ? null
                      : liveSpectrum
                    : displaySpectrum
              }
              title={`FFT Peaks — ${playingFileName ?? loadedName ?? 'New'}`}
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
              onResetAnnotation={comparison || showMultiTap ? undefined : (k) => analyzer.resetAnnotationOffset(k)}
              hasMovedLabels={annotationOffsets.size > 0}
              frozen={captured != null || (material && matPhase === 'complete')}
              crosshairMode={crosshairMode}
              highlightedPeakId={comparison || showMultiTap ? null : snapshot.highlightedPeakId}
              // Dot ↔ results-row highlight is a guitar, desktop-only feature (mirrors Swift's macOS-only
              // behaviour — on touch the results panel is a modal overlay, so cross-highlight is moot).
              onToggleHighlight={
                isTouch || comparison || showMultiTap || material ? undefined : (id) => analyzer.toggleHighlightedPeak(id)
              }
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
                className={`btn mini tint taps-toggle ${showMultiTap ? 'tint-taps-active' : 'tint-accent'}`}
                onClick={() => analyzer.setMultiTapComparison(!showMultiTap)}
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
              {/* The microphone the result was captured with: the input for a live result, the recorded
                  one — or "unknown" — for a played file or a loaded measurement. Swift
                  TapAnalysisResultsView reading analyzer.captureMicrophoneName. */}
              <span className="results-mic-name">
                {snapshot.resultProvenance ? (snapshot.resultProvenance.microphoneName ?? 'unknown') : deviceLabel}
              </span>
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

          {/* The range line — always shown, as Swift's results header — and the selection controls,
              FIXED above the scroll (only peak cards scroll). The controls follow Swift's rule: shown
              when its results list (sortedPeaksWithModes) has peaks and the per-tap table is not up;
              Deselect All is disabled for a plate or brace, whose peaks are fixed, and Reset to Auto
              is guitar-only. Icon-only, matching Swift: xmark.circle (None) / wand.and.stars. */}
          <div className="results-sub">
            <span className="range-text">
              {displayRangeLabel(view.minHz, view.maxHz)}
            </span>
            {resultsListPeaks.length > 0 && !showMultiTap && (
              <div className="sel-buttons">
                <button
                  className="btn mini icon"
                  onClick={selectNone}
                  disabled={material || displayPeaks.every((p) => !selectedIds.has(p.id))}
                  title={material ? 'Peak selection is fixed during plate/brace measurements' : 'Deselect all peaks'}
                  aria-label="Deselect all peaks"
                >
                  <CancelIcon />
                </button>
                {!material && (
                  <button
                    className="btn mini icon"
                    onClick={resetSelection}
                    disabled={!userModified}
                    title="Reset to automatic mode selection"
                    aria-label="Reset to automatic mode selection"
                  >
                    <WandIcon />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="results-scroll">
          {comparison ? (
            <ComparisonResultsView rows={comparisonRows} />
          ) : material ? (
            <MaterialResults type={brace ? 'brace' : 'plate'} matInputs={matInputs} onInputsChange={(next) => analyzer.setMaterialInputs(next)} measureFlc={settings.measureFlc} peaks={matPeaks} complete={matPhase === 'complete'} />
          ) : showMultiTap && multiTapAvailable ? (
            <MultiTapComparisonResultsView taps={tapRows} avg={avgModes} />
          ) : (
            <>
              {displayPeaksInRange.length > 0 ? (
                <div className="cards">
                  {displayPeaksInRange.map((p) => {
                    const mode = modeByPeak.get(p.id) ?? 'unknown'
                    const note = pitch.note(p.frequency)
                    return (
                      <PeakCard
                        key={p.id}
                        peak={p}
                        mode={mode}
                        effectiveLabel={labelFor(p, mode)}
                        isManualOverride={overrides.has(p.id)}
                        inRange={inRangeFor(p, mode)}
                        note={note}
                        cents={note ? pitch.cents(p.frequency) : null}
                        selected={selectedIds.has(p.id)}
                        onToggle={() => toggleSelect(p.id)}
                        onSetLabel={(label) => analyzer.setModeOverride(p.id, label)}
                        onResetLabel={() => analyzer.resetModeOverride(p.id)}
                        highlighted={snapshot.highlightedPeakId === p.id}
                        // Reverse direction (row → dot): desktop only, matching the chart's dot click.
                        onHighlight={isTouch ? undefined : () => analyzer.toggleHighlightedPeak(p.id)}
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
            <AnalysisResults decayTime={currentDecayTime} decayThreshold={analyzer.decayThreshold} ratio={tapRatio} guitarType={guitarType} />
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
                disabled={!snapshot.hasResultToSaveOrExport || isExporting}
                title={HINTS.exportSpectrum}
              >
                ∿ Export Spectrum
              </button>
              <button
                className="btn mini"
                onClick={exportPdf}
                disabled={!snapshot.hasResultToSaveOrExport || isExporting}
                title="Export a single-page PDF report"
              >
                ▤ Export PDF
              </button>
            </div>
          </div>
          </div>
        </aside>
      </div>

      {snapshot.showLoadedSettingsWarning && !snapshot.isSavedMeasurementComparison && (
        <div className="loaded-settings-banner" role="status">
          ⚠ Settings from loaded measurement — Threshold: {Math.round(settings.tapDetectionThreshold)} dB · Taps:{' '}
          {numberOfTaps}
        </div>
      )}
      {snapshot.captureAudioSaved && (
        <div className="capture-audio-saved" role="status">
          <span>Capture audio saved: {snapshot.captureAudioSaved} (Downloads)</span>
          <button type="button" aria-label="Dismiss" onClick={() => analyzer.dismissCaptureAudioSaved()}>
            ×
          </button>
        </div>
      )}
      <div className="statusbar">
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
          {FieldPrecision.string(material ? (engineMetrics?.displayLevelDB ?? -100) : (metrics.peakMagnitude ?? -100), FieldPrecision.peakMagnitudeDB)} dB
        </span>
        <span className="spacer" />
        {/* RIGHT — complete badge + peak + active dot + statusMessage + progress. */}
        {sbComplete && <span className="sb-frozen">⏸ Complete</span>}
        {running && (
          <span className="sb-peak">
            {metrics.peakFrequency != null && metrics.peakMagnitude != null
              ? `Peak: ${FieldPrecision.string(metrics.peakMagnitude, FieldPrecision.peakMagnitudeDB)} dB @ ${FieldPrecision.string(metrics.peakFrequency, FieldPrecision.peakFrequencyHz)} Hz`
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
              : errorKind === 'microphone'
              ? 'Microphone Unavailable'
              : errorKind === 'other'
              ? 'Error'
              : 'Audio Engine Error'
            const message = permission
              ? 'GuitarTap needs microphone access to analyse tap tones. Please allow microphone access for this site in your browser settings, then retry.'
              : error
            const buttons =
              errorKind === 'other' || errorKind === 'microphone'
                ? [{ label: 'OK', primary: true, onClick: () => setError(null) }]
                : [
                    { label: 'Retry', primary: true, onClick: () => { setError(null); void retry() } },
                    { label: permission ? 'Cancel' : 'OK', onClick: () => setError(null) },
                  ]
            return <AlertModal title={title} message={message} buttons={buttons} onDismiss={() => setError(null)} />
          })()
        : loadWarning && (
            <AlertModal
              title={snapshot.microphoneWarningTitle}
              message={loadWarning}
              buttons={[{ label: 'OK', primary: true, onClick: () => analyzer.clearMicrophoneWarning() }]}
              onDismiss={() => analyzer.clearMicrophoneWarning()}
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
          defaultName={loadedName ?? ''}
          defaultNotes={loadedNotes ?? ''}
          onSave={onSaveMeasurement}
          onClose={() => setShowSave(false)}
        />
      )}

      {showMeasurements && (
        <MeasurementsPanel
          onClose={() => setShowMeasurements(false)}
          onLoad={onLoadMeasurement}
          onCompare={onCompare}
          onImport={(text) => analyzer.importAndLoadMeasurements(text, importMeasurements)}
        />
      )}

      {showPlayFile && (
        <PlayFileSheet onPlay={(audio, cal) => void onPlayFile(audio, cal)} onClose={() => setShowPlayFile(false)} />
      )}

      {showQuickStart && <QuickStartGuide onClose={() => setShowQuickStart(false)} />}
      {showReleaseNotes && <ReleaseNotes onClose={() => setShowReleaseNotes(false)} />}
    </div>
  )
}
