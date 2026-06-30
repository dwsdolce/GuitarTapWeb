// ViewModel for the spectrum chart's live view (zoom/pan range) + Auto-dB scaling. Owns the
// `view` and `autoDb` state and the logic that mutates them (reset-to-saved/defaults, fit-dB-to-
// spectrum), keeping App.tsx as wiring. Extracted from App as part of Phase 6 6-ARCH.

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ChartView, ResetTarget, ResetAxis } from '../presentation/chartTypes'
import { DEFAULT_SETTINGS, defaultDisplayRange, type MeasurementType, type Settings } from '../settings'
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
  /** Persist the display freq range for a measurement type (merges per-type). */
  updateDisplayRange: (type: MeasurementType, range: Partial<{ minHz: number; maxHz: number }>) => void
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
}: UseChartViewArgs): ChartViewModel {
  const [autoDb, setAutoDb] = useState(false)

  // Live chart view (zoom/pan). The "default" it follows is the persisted per-type range,
  // unless a measurement is loaded — then its saved range overrides transiently (Swift
  // loadedAxisRange). Resets whenever that effective default changes (load, settings edit,
  // type switch, new measurement). Save Current View commits the current view.
  const defaultView = useMemo<ChartView>(
    () => ({ minHz: chartMinHz, maxHz: chartMaxHz, minDb, maxDb }),
    [chartMinHz, chartMaxHz, minDb, maxDb],
  )
  const effectiveDefault = loadedView ?? defaultView
  const [view, setView] = useState<ChartView>(effectiveDefault)
  useEffect(() => setView(effectiveDefault), [effectiveDefault])
  const saveCurrentView = useCallback(() => {
    // Freq range persists per measurement type; the dB range stays global.
    updateDisplayRange(measurementType, { minHz: Math.round(view.minHz), maxHz: Math.round(view.maxHz) })
    updateSettings({ minDb: Math.round(view.minDb), maxDb: Math.round(view.maxDb) })
  }, [view, measurementType, updateDisplayRange, updateSettings])

  // Right-click axis reset. Mirrors Swift resetBothAxesToSaved / resetBothAxesToDefaults:
  // BOTH only move the live view — neither persists. "Saved" → the saved display range;
  // "Defaults" → the factory range (does NOT overwrite the saved range). Save Current
  // View / the Settings dialog are the only things that change what's saved.
  const resetView = useCallback(
    (target: ResetTarget, axis: ResetAxis) => {
      const factory = defaultDisplayRange(measurementType)
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