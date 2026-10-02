// ViewModel for the spectrum chart's live view (zoom/pan range) + Auto-dB scaling. Owns the
// `view` and `autoDb` state and the logic that mutates them (reset-to-saved/defaults, fit-dB-to-
// spectrum), keeping App.tsx as wiring.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ChartView, ResetTarget, ResetAxis } from '../presentation/chartTypes'
import { DEFAULT_SETTINGS, defaultMinFrequency, defaultMaxFrequency, setMagnitudeRange, type MeasurementType, type Settings } from '../settings'
import { widenedOnto, onSettingsDone, onNewMeasurement, loadedAfterWidening } from '../presentation/displayRange'
import type { ResonantPeak } from '../measurement/types'
import type { Spectrum } from '../dsp/guitarFFT'

interface UseChartViewArgs {
  /** Configured (saved) display range — chart-type aware (material clamps differently). */
  chartMinHz: number
  chartMaxHz: number
  minDb: number
  maxDb: number
  /** Current measurement type — the freq range is saved/reset per type. */
  measurementType: MeasurementType
  /** A loaded measurement's saved axis range — a TRANSIENT override of the persisted
   *  default (mirrors Swift `loadedAxisRange`). Set on load, cleared on a new measurement;
   *  never persisted, and never the target of reset-to-saved. */
  loadedView: ChartView | null
  /** The spectrum Auto-dB fits to (live/captured/material). */
  displaySpectrum: Spectrum | null
  updateSettings: (patch: Partial<Settings>) => void
  /** Persist the display freq range for a measurement type (each bound per type). */
  updateDisplayRange: (type: MeasurementType, range: { minHz?: number; maxHz?: number }) => void
  /** The analyzer's three plate / brace peaks (Swift `selectedLongitudinalPeak` / `selectedCrossPeak`
   *  / `selectedFlcPeak`); the live view widens onto each one identified. */
  longitudinalPeak: ResonantPeak | null
  crossPeak: ResonantPeak | null
  flcPeak: ResonantPeak | null
  /** The analyzer's count of sequence starts — a change is a new sequence (New Tap, Play File, Cancel, a
   *  re-arm). */
  sequenceStarts: number
  /** The three peaks were restored by a load, not identified by a capture — they do not widen. */
  materialPeaksFromLoad: boolean
}

export interface ChartViewModel {
  view: ChartView
  setView: Dispatch<SetStateAction<ChartView>>
  saveCurrentView: () => void
  resetView: (target: ResetTarget, axis: ResetAxis) => void
  autoDb: boolean
  toggleAutoDb: () => void
}

export function useChartView({
  chartMinHz,
  chartMaxHz,
  minDb,
  maxDb,
  measurementType,
  loadedView,
  displaySpectrum,
  updateSettings,
  updateDisplayRange,
  longitudinalPeak,
  crossPeak,
  flcPeak,
  sequenceStarts,
  materialPeaksFromLoad,
}: UseChartViewArgs): ChartViewModel {
  const [autoDb, setAutoDb] = useState(false)

  // Live chart view (zoom/pan) — Swift's @State minFreq/maxFreq/minDB/maxDB. It starts at the saved
  // view (the persisted per-type range) and moves only when the user moves it, when the app must show
  // something (a loaded measurement's range; a newly identified plate or brace peak), or on a
  // measurement-type switch. Save Current View commits the current view.
  const defaultView = useMemo<ChartView>(
    () => ({ minHz: chartMinHz, maxHz: chartMaxHz, minDb, maxDb }),
    [chartMinHz, chartMaxHz, minDb, maxDb],
  )
  const [view, setView] = useState<ChartView>(loadedView ?? defaultView)

  // The saved range or the measurement type changed (Settings' Done, Save Current View): the chart
  // moves only if one of them did (Swift applySettings → DisplayRange.onSettingsDone).
  const prevSaved = useRef(defaultView)
  const prevType = useRef(measurementType)
  useEffect(() => {
    const moveTo = onSettingsDone(defaultView, prevSaved.current, measurementType !== prevType.current)
    prevSaved.current = defaultView
    prevType.current = measurementType
    if (moveTo) setView(moveTo)
  }, [defaultView, measurementType])

  // A load shows its saved range, remembered while the chart is still showing it (Swift's
  // .onReceive(tap.$loadedAxisRange) → loadedChartRange). Declared before the widening, so a load's
  // widening applies on top of its range.
  const loadedRef = useRef<ChartView | null>(null)
  useEffect(() => {
    if (!loadedView) return
    loadedRef.current = loadedView
    setView(loadedView)
  }, [loadedView])

  // Widen the live view onto a plate / brace peak as it is identified, so it is in view even if
  // outside the saved range; the saved range is not changed. Mirrors Swift's .onReceive of
  // tap.$selectedLongitudinalPeak / $selectedCrossPeak / $selectedFlcPeak →
  // expandFreqRangeToInclude. Each effect runs when its peak changes; declared after the reset to
  // the default above, so a load's widening applies on top of its range.
  const measurementTypeRef = useRef(measurementType)
  measurementTypeRef.current = measurementType
  const fromLoadRef = useRef(materialPeaksFromLoad)
  fromLoadRef.current = materialPeaksFromLoad
  const widenOnto = useCallback((peak: ResonantPeak | null) => {
    if (!peak) return
    setView((v) => {
      const r = widenedOnto(peak.frequency, measurementTypeRef.current, fromLoadRef.current, v.minHz, v.maxHz)
      if (r.minHz === v.minHz && r.maxHz === v.maxHz) return v
      const after = { ...v, ...r }
      loadedRef.current = loadedAfterWidening(loadedRef.current, v, after)
      return after
    })
  }, [])
  useEffect(() => widenOnto(longitudinalPeak), [widenOnto, longitudinalPeak])
  useEffect(() => widenOnto(crossPeak), [widenOnto, crossPeak])
  useEffect(() => widenOnto(flcPeak), [widenOnto, flcPeak])

  // A new sequence (New Tap, Play File, Cancel, a re-arm): after a load or a comparison the user has
  // not moved, the chart returns to the saved view; otherwise it stays (Swift applyNewMeasurementRange →
  // DisplayRange.onNewMeasurement).
  const lastSequenceStarts = useRef(sequenceStarts)
  useEffect(() => {
    const started = sequenceStarts !== lastSequenceStarts.current
    lastSequenceStarts.current = sequenceStarts
    if (!started) return
    const loaded = loadedRef.current
    loadedRef.current = null
    const saved = defaultView
    setView((v) => onNewMeasurement(v, loaded, saved) ?? v)
  }, [sequenceStarts, defaultView])
  const saveCurrentView = useCallback(() => {
    // Freq range persists per measurement type; the dB range stays global.
    updateDisplayRange(measurementType, { minHz: view.minHz, maxHz: view.maxHz })
    updateSettings(setMagnitudeRange(view.minDb, view.maxDb))
  }, [view, measurementType, updateDisplayRange, updateSettings])

  // Right-click axis reset. Mirrors Swift resetBothAxesToSaved / resetBothAxesToDefaults:
  // BOTH only move the live view — neither persists. "Saved" → the saved display range;
  // "Defaults" → the factory range (does NOT overwrite the saved range). Save Current
  // View / the Settings dialog are the only things that change what's saved.
  const resetView = useCallback(
    (target: ResetTarget, axis: ResetAxis) => {
      const factory = { minHz: defaultMinFrequency(measurementType), maxHz: defaultMaxFrequency(measurementType) }
      const tgt: ChartView =
        target === 'saved'
          ? defaultView // configured (saved) display range
          : {
              minHz: factory.minHz,
              maxHz: factory.maxHz,
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
    [defaultView, measurementType],
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

  return { view, setView, saveCurrentView, resetView, autoDb, toggleAutoDb }
}