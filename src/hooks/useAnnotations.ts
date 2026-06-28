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
}

export function useAnnotations({ peaks, guitarType, captured }: UseAnnotationsArgs): AnnotationsModel {
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
    if (loadingRef.current) {
      loadingRef.current = false
      return
    }
    setUserModified(false)
    setOverrides(new Map())
    setAnnotationOffsets(new Map())
  }, [captured])

  useEffect(() => {
    if (!userModified) setSelectedIds(autoIds)
  }, [autoIds, userModified])

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

  return {
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
    restore,
  }
}