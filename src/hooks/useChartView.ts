// ViewModel for the spectrum chart's live view (zoom/pan range) + Auto-dB scaling. Owns the
// `view` and `autoDb` state and the logic that mutates them (reset-to-saved/defaults, fit-dB-to-
// spectrum), keeping App.tsx as wiring. Extracted from App as part of Phase 6 6-ARCH.

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ChartView, ResetTarget, ResetAxis } from '../presentation/chartTypes'
import { DEFAULT_SETTINGS, type Settings } from '../settings'
import type { Spectrum } from '../dsp/guitarFFT'

interface UseChartViewArgs {
  /** Configured (saved) display range — chart-type aware (material clamps differently). */
  chartMinHz: number
  chartMaxHz: number
  minDb: number
  maxDb: number
  /** Material modes keep their freq range on a "defaults" reset (only dB goes to factory). */
  material: boolean
  /** The spectrum Auto-dB fits to (live/captured/material). */
  displaySpectrum: Spectrum | null
  updateSettings: (patch: Partial<Settings>) => void
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
  material,
  displaySpectrum,
  updateSettings,
}: UseChartViewArgs): ChartViewModel {
  const [autoDb, setAutoDb] = useState(false)

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

  return { view, setView, saveCurrentView, resetView, autoDb, toggleAutoDb }
}