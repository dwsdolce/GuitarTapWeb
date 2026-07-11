// ViewModel for per-peak selection + mode-label overrides + dragged annotation-label
// positions. Owns the selection/override/offset state, the auto-select and fresh-capture-reset
// effects, and the handlers the results panel + chart call. Extracted from App (Phase 6 6-ARCH).
//
// Lifecycle (mirrors Swift): a fresh capture clears selection/overrides/labels; loading a
// measurement restores them (the `loadingRef` guard makes the restore survive the capture-reset
// effect that the same load triggers). Overrides + offsets are keyed by `frequency.toFixed(1)`
// so they survive Peak-Min re-derivation (numeric peak ids are regenerated).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Peak } from '../dsp/peaks'
import { resolvedModePeaks } from '../dsp/classify'
import type { GuitarTypeName } from '../dsp/guitarModes'
import type { Spectrum } from '../dsp/guitarFFT'

interface UseAnnotationsArgs {
  peaks: Peak[]
  guitarType: GuitarTypeName
  /** A new frozen spectrum → fresh capture; clears selection/overrides/labels (unless loading). */
  captured: Spectrum | null
  /** In material mode the offset store is driven by the material lifecycle (startMaterial clears,
   *  load restores), NOT by fresh `captured` spectra — so the capture-reset effect leaves it alone.
   *  Mirrors the gold standard: Swift/Python use ONE peakAnnotationOffsets store for all peaks. */
  material: boolean
}

/** Values a loaded measurement restores into this slice. */
export interface AnnotationRestore {
  overridesByFreq: Map<string, string>
  annotationOffsetsByFreq: Map<string, [number, number]>
  selectedIndices: Set<number>
}

export interface AnnotationsModel {
  selectedIds: Set<number>
  overrides: Map<string, string>
  annotationOffsets: Map<string, [number, number]>
  userModified: boolean
  toggleSelect: (id: number) => void
  selectAll: () => void
  selectNone: () => void
  resetSelection: () => void
  setLabel: (p: Peak, label: string) => void
  resetLabel: (p: Peak) => void
  onAnnotationDrag: (key: string, pos: [number, number]) => void
  resetLabels: () => void
  /** Restore selection/overrides/labels from a loaded measurement (survives the capture reset). */
  restore: (r: AnnotationRestore) => void
  /** Restore only the dragged-label positions for a loaded MATERIAL measurement (material reuses
   *  this same offset store; its capture-reset is suppressed so no loading-guard dance is needed). */
  restoreMaterialOffsets: (offsets: Map<string, [number, number]>) => void
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
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map())
  // Dragged annotation-label positions, keyed by `frequency.toFixed(1)` → [absFreqHz, absDB].
  const [annotationOffsets, setAnnotationOffsets] = useState<Map<string, [number, number]>>(new Map())

  // A fresh capture clears the user's selection/overrides/label positions; a load sets
  // `loadingRef` so its restored values survive this reset.
  useEffect(() => {
    // Material drives the offset store via its own lifecycle (startMaterial clears, load restores),
    // so don't clobber it on the captured→null transition. Clear the loading guard too so it can't
    // leak into a later guitar capture. Leaving material back to guitar (material→false) runs the
    // reset below, wiping any leftover material offsets.
    if (material) {
      loadingRef.current = false
      return
    }
    if (loadingRef.current) {
      loadingRef.current = false
      return
    }
    setUserModified(false)
    setOverrides(new Map())
    setAnnotationOffsets(new Map())
  }, [captured, material])

  // The EFFECTIVE selection: while the user hasn't touched it, it IS `autoIds` — computed
  // synchronously from the current peaks, so it never lags a Peak Min change (which regenerates the
  // numeric peak ids). Mirrors Swift applyFrozenPeakState setting selectedPeakIDs in the same pass as
  // currentPeaks. Only a manual change parks the choice in `selectedIds` state (userModified). NOTE:
  // manual selection is still keyed by id, so it doesn't yet survive Peak Min id-churn by frequency —
  // that by-frequency carry is P3 (RESTRUCTURE-NOTES.md).
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

  // Draggable annotation labels (mirrors Swift updateAnnotationOffset / resetAllAnnotationOffsets):
  // a drag stores the badge's absolute [Hz, dB] position by peak-frequency key; Reset Labels clears all.
  const onAnnotationDrag = useCallback((key: string, pos: [number, number]) => {
    setAnnotationOffsets((prev) => new Map(prev).set(key, pos))
  }, [])
  const resetLabels = useCallback(() => setAnnotationOffsets(new Map()), [])

  const restore = useCallback((r: AnnotationRestore) => {
    loadingRef.current = true // make this restore survive the fresh-capture reset the load triggers
    setOverrides(r.overridesByFreq)
    setAnnotationOffsets(r.annotationOffsetsByFreq)
    setSelectedIds(r.selectedIndices)
    setUserModified(true)
  }, [])

  // Material load: the capture-reset effect is suppressed in material mode, so just set the offsets
  // (no loading-guard needed). Overrides/selection are guitar-only and stay empty for material.
  const restoreMaterialOffsets = useCallback((offsets: Map<string, [number, number]>) => {
    setAnnotationOffsets(offsets)
  }, [])

  return {
    selectedIds: effectiveSelectedIds,
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
    restore,
    restoreMaterialOffsets,
  }
}