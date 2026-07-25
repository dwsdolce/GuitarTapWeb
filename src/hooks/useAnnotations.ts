// ViewModel for per-peak SELECTION (which candidate is the definitive Air/Top/Back). Owns the
// selection state, the auto-select derivation, and the fresh-capture reset. Overrides (RA) and dragged
// annotation offsets (RB) have moved onto the analyzer, keyed by peak id; only selection still lives
// here, until RC moves it onto the analyzer too and this hook is deleted.
//
// Lifecycle (mirrors Swift): a fresh capture resets selection to auto; loading a measurement restores
// it (the `loadingRef` guard makes the restore survive the capture-reset effect the same load triggers).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Peak } from '../dsp/peaks'
import { resolvedModePeaks } from '../dsp/classify'
import type { GuitarTypeName } from '../dsp/guitarModes'
import type { Spectrum } from '../dsp/guitarFFT'

interface UseAnnotationsArgs {
  peaks: Peak[]
  guitarType: GuitarTypeName
  /** A new frozen spectrum → fresh capture; resets selection to auto (unless loading). */
  captured: Spectrum | null
  /** Material mode has no per-peak selection, so the fresh-capture reset is skipped for it. */
  material: boolean
}

/** Values a loaded measurement restores into this slice. (Overrides + offsets moved to the analyzer in
 *  RA/RB — the load path restores them via `analyzer.restoreOverrides` / `analyzer.restoreOffsets`.) */
export interface AnnotationRestore {
  selectedIndices: Set<number>
  /** Whether the loaded selection was hand-modified (default true for legacy files). An automatic
   *  selection re-runs auto-selection on Peak Min change; a manual one is parked. */
  userModified: boolean
}

export interface AnnotationsModel {
  selectedIds: Set<number>
  userModified: boolean
  toggleSelect: (id: number) => void
  selectAll: () => void
  selectNone: () => void
  resetSelection: () => void
  /** Restore selection from a loaded measurement (survives the capture reset). */
  restore: (r: AnnotationRestore) => void
}

export function useAnnotations({ peaks, guitarType, captured, material }: UseAnnotationsArgs): AnnotationsModel {
  // Set by `restore` so the fresh-capture reset below skips clobbering a just-loaded measurement.
  const loadingRef = useRef(false)

  // Auto-selected peaks = the strongest in each identified mode.
  const autoIds = useMemo(
    () => new Set([...resolvedModePeaks(peaks, guitarType).values()].map((p) => p.id)),
    [peaks, guitarType],
  )

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [userModified, setUserModified] = useState(false)

  // A fresh capture resets selection to auto; a load sets `loadingRef` so its restored value survives.
  useEffect(() => {
    if (material) {
      loadingRef.current = false
      return
    }
    if (loadingRef.current) {
      loadingRef.current = false
      return
    }
    setUserModified(false)
  }, [captured, material])

  // The EFFECTIVE selection: while the user hasn't touched it, it IS `autoIds` — computed
  // synchronously from the current peaks, so it never lags a Peak Min change (which regenerates the
  // numeric peak ids). Mirrors Swift applyFrozenPeakState setting selectedPeakIDs in the same pass as
  // currentPeaks. Only a manual change parks the choice in `selectedIds` state (userModified). NOTE:
  // manual selection is still keyed by id, so it doesn't yet survive Peak Min id-churn by frequency —
  // that carry moves onto the analyzer in RC (RESTRUCTURE-NOTES.md).
  const effectiveSelectedIds = userModified ? selectedIds : autoIds

  const toggleSelect = useCallback((id: number) => {
    // Seed from the current auto-selection on the first manual change, so toggling adds/removes
    // relative to what's shown rather than a stale/empty stored set.
    const next = new Set(userModified ? selectedIds : autoIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
    setUserModified(true)
  }, [userModified, selectedIds, autoIds])
  const selectAll = useCallback(() => {
    setUserModified(true)
    setSelectedIds(new Set(peaks.map((p) => p.id)))
  }, [peaks])
  const selectNone = useCallback(() => {
    setUserModified(true)
    setSelectedIds(new Set())
  }, [])
  const resetSelection = useCallback(() => setUserModified(false), [])

  const restore = useCallback((r: AnnotationRestore) => {
    loadingRef.current = true // make this restore survive the fresh-capture reset the load triggers
    setSelectedIds(r.selectedIndices)
    // Restore the manual/auto flag instead of forcing manual: an AUTOMATIC loaded measurement then
    // re-runs auto-selection on Peak Min change (revealing a peak selects it as its mode winner),
    // matching live. Legacy files (no flag) arrive as true = manual. Mirrors Swift/Python.
    setUserModified(r.userModified)
  }, [])

  return {
    selectedIds: effectiveSelectedIds,
    userModified,
    toggleSelect,
    selectAll,
    selectNone,
    resetSelection,
    restore,
  }
}
