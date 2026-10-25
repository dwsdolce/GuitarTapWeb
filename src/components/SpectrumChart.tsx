// @parity view/spectrum-chart
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Spectrum } from '../dsp/guitarFFT'
import { renderSpectrum, chartGeometry, chartTheme } from '../presentation/spectrumRender'
import { useScheme } from '../hooks/useScheme'
import type { GuitarTypeName } from '../dsp/guitarModes'
import type { PeakMarker, AnnotationRect, DotHit, ChartView, ResetTarget, ResetAxis, SpectrumOverlay } from '../presentation/chartTypes'
import { pannedRange, zoomedRange } from '../presentation/displayRange'
import {
  MIN_FREQUENCY_HZ,
  MAX_FREQUENCY_HZ,
  MIN_MAGNITUDE_DB,
  MAX_MAGNITUDE_DB,
  MIN_FREQUENCY_SPAN_HZ,
  MIN_MAGNITUDE_SPAN_DB,
} from '../presentation/chartLimits'
import { BackupRestoreIcon, InfoIcon, MoreCircleIcon, UndoArrowIcon, UndoIcon } from './icons'
import type { Uuid } from '../measurement/newId'
import { CHART_MENU_GROUPS, COMPARISON_MENU_GROUPS, LABEL_MENU, axisReset } from '../presentation/chartMenu'
import { CHART_HELP_TITLE, currentHelpDevice, shownHelp } from '../presentation/chartHelp'

/** A menu item's icon, by its Material Design name (chartMenu's `mdi`). */
function MenuIcon({ mdi }: { mdi: string }) {
  if (mdi === 'backup-restore') return <BackupRestoreIcon />
  if (mdi === 'undo') return <UndoArrowIcon />
  return <UndoIcon />
}

/** Props for {@link SpectrumChart} — spectrum data, axis range, overlays/markers, and interaction callbacks. */
export interface SpectrumChartProps {
  spectrum: Spectrum | null
  /** Title shown top-left, e.g. "FFT Peaks — New" (mirrors Swift/Python chartTitle). */
  title?: string
  markers?: PeakMarker[]
  /** Extra colored curves drawn over the plot, with a legend (material L/C/FLC). */
  overlays?: SpectrumOverlay[]
  /** Guitar type → mode-boundary lines + top labels on the plot (omit for material). */
  guitarType?: GuitarTypeName
  /** Whether a guitar's mode lines are drawn (default true). Swift's `showModeBoundaries`. */
  showModeBoundaries?: boolean
  /** Peak Min threshold (dB) → a horizontal "Peak: N dB" reference line (guitar only, in-range only). */
  peakMin?: number
  minHz?: number
  maxHz?: number
  minDb?: number
  maxDb?: number
  /** Wheel-zoom / drag-pan emit a new view here (omit to make the chart static). */
  onViewChange?: (v: ChartView) => void
  /** Right-click menu reset (target = saved range vs factory defaults; axis scope). */
  onReset?: (target: ResetTarget, axis: ResetAxis) => void
  /** A draggable annotation badge was moved → its new data-space position [absFreqHz, absDB].
   *  Omit to make labels non-draggable. */
  onAnnotationDrag?: (key: Uuid, pos: [number, number]) => void
  /** "Reset Labels" menu action → clear all dragged label positions. */
  onResetLabels?: () => void
  /** A comparison measurement is shown: the chart's menu is the comparison's (COMPARISON_MENU_GROUPS). */
  comparisonMenu?: boolean
  /** Right-clicking a SINGLE badge → reset just that label to its auto-position (Swift/Python
   *  `resetAnnotationOffset`). `key` is the badge's `annoKey`. Omit to disable the per-label menu. */
  onResetAnnotation?: (key: Uuid) => void
  /** Enables the "Reset Labels" menu item (true when any label has been moved). */
  hasMovedLabels?: boolean
  /** A frozen/captured result is shown → the crosshair snaps to the nearest spectrum bin
   *  (otherwise it tracks freely). Material/comparison overlays snap to a curve regardless. */
  frozen?: boolean
  /** Touch crosshair mode — owned by the parent (the toggle lives on the control bar, like iOS).
   *  When true, a one-finger drag moves the crosshair instead of panning. */
  crosshairMode?: boolean
  /** The highlighted peak id (dot ↔ results-row cross-highlight) — its dot renders as a red star. */
  highlightedPeakId?: string | null
  /** Clicking a peak dot toggles the highlight (desktop only — the parent omits this on touch, so the
   *  dot-click is inert there, matching Swift's macOS-only behaviour). */
  onToggleHighlight?: (id: Uuid) => void
}

// The chart's limits — one set for Settings, zoom, pan and widening (presentation/chartLimits).
const FREQ_MIN = MIN_FREQUENCY_HZ
const FREQ_MAX = MAX_FREQUENCY_HZ
const DB_FLOOR = MIN_MAGNITUDE_DB
const DB_CEIL = MAX_MAGNITUDE_DB

type Region = 'plot' | 'xAxis' | 'yAxis' | 'outside'
/** The cursor over each region of the chart — Swift's NSCursor for it. */
const REGION_CURSOR: Record<Region, string> = { plot: 'crosshair', xAxis: 'ew-resize', yAxis: 'ns-resize', outside: '' }


/**
 * The interactive FFT spectrum chart — mirrors Swift `SpectrumView` / Python `FftCanvas`.
 * Renders the magnitude curve, mode-boundary lines + labels, peak markers, draggable
 * annotation badges, material/comparison overlay curves + legend, and a snap-to-bin
 * crosshair readout, all custom-drawn on a canvas. Wheel/drag/pinch gestures (region-aware)
 * emit view changes; a ⋯ / right-click menu resets the axes.
 */
export function SpectrumChart({
  spectrum,
  title,
  markers = [],
  overlays = [],
  guitarType,
  showModeBoundaries = true,
  peakMin,
  minHz = 30,
  maxHz = 2000,
  minDb = -100,
  maxDb = 0,
  onViewChange,
  onReset,
  onAnnotationDrag,
  onResetLabels,
  comparisonMenu = false,
  onResetAnnotation,
  hasMovedLabels = false,
  frozen = false,
  crosshairMode = false,
  highlightedPeakId = null,
  onToggleHighlight,
}: SpectrumChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  // Live crosshair cursor position (CSS px), set on hover (buttons===0), cleared on
  // drag/leave. Drives the always-on readout in renderSpectrum.
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  // The overlay curve the crosshair follows (-1: none), kept between draws — Swift's lockedSeriesIndex.
  const crosshairLockRef = useRef({ index: -1 })
  // Touch crosshair mode is OWNED by the parent — the toggle lives on the control bar (between
  // Auto dB and Annotations), mirroring iOS, not on the chart surface. The chart only consumes
  // the flag for its pointer logic, and clears the crosshair when the mode is switched off.
  const crosshairModeRef = useRef(false)
  crosshairModeRef.current = crosshairMode
  useEffect(() => {
    if (!crosshairMode) setHover(null)
  }, [crosshairMode])
  // Reset/⋯ menu — stored in VIEWPORT coords and rendered `position: fixed` so it escapes the
  // chart wrapper's `overflow: hidden` (which used to clip it) and is clamped to stay on screen.
  // `alignRight` anchors the menu's right edge to `x` (for the top-right ⋯ button).
  const [menu, setMenu] = useState<{ x: number; y: number; alignRight?: boolean; annoKey?: Uuid } | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!menu || !ctxRef.current) {
      setMenuStyle(null)
      return
    }
    const r = ctxRef.current.getBoundingClientRect()
    const pad = 8
    let left = menu.alignRight ? menu.x - r.width : menu.x
    left = Math.max(pad, Math.min(left, window.innerWidth - r.width - pad))
    const top = Math.max(pad, Math.min(menu.y, window.innerHeight - r.height - pad))
    setMenuStyle({ left, top })
  }, [menu])

  const viewRef = useRef<ChartView>({ minHz, maxHz, minDb, maxDb })
  viewRef.current = { minHz, maxHz, minDb, maxDb }
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  const onAnnotationDragRef = useRef(onAnnotationDrag)
  onAnnotationDragRef.current = onAnnotationDrag
  const onResetAnnotationRef = useRef(onResetAnnotation)
  onResetAnnotationRef.current = onResetAnnotation
  const onToggleHighlightRef = useRef(onToggleHighlight)
  onToggleHighlightRef.current = onToggleHighlight
  // Badge screen rects from the most recent render — refreshed every draw, read by the
  // pointer handler for hit-testing (CSS px, matching pointer coords).
  const badgeRectsRef = useRef<AnnotationRect[]>([])
  // Peak-dot screen positions from the most recent render — same refresh/read pattern, used to
  // hit-test a mouse click back to a peak for the dot ↔ results-row highlight.
  const dotRectsRef = useRef<DotHit[]>([])

  // The scheme the chart is drawn in; a change of it redraws.
  const scheme = useScheme()

  // ── Draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const W = Math.max(1, Math.floor(rect.width))
    const H = Math.max(1, Math.floor(rect.height))
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    badgeRectsRef.current = []
    dotRectsRef.current = []
    renderSpectrum(ctx, W, H, {
      spectrum,
      markers,
      overlays,
      title,
      guitarType,
      showModeBoundaries,
      peakMin,
      theme: chartTheme(scheme),
      view: { minHz, maxHz, minDb, maxDb },
      badgeRectsOut: badgeRectsRef.current,
      dotRectsOut: dotRectsRef.current,
      highlightedPeakId,
      crosshair: hover,
      frozen,
      crosshairLock: crosshairLockRef.current,
    })
  }, [spectrum, markers, overlays, title, guitarType, showModeBoundaries, peakMin, minHz, maxHz, minDb, maxDb, hover, frozen, highlightedPeakId, scheme])

  // ── Interaction (mirrors SpectrumView+GestureHandlers) ──────────────────────
  // @parity view/spectrum-gestures — the web co-locates gestures with the chart
  // (Swift splits them into SpectrumView+GestureHandlers.swift; Python inlines them in
  // FftCanvas). Wheel/drag/pinch are region-aware and mirror the Swift modifier semantics
  // (Shift=pan-freq, Alt/Option=pan-dB, Cmd/Ctrl=zoom-both, no-modifier=zoom by region).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const emit = (v: ChartView) => onViewChangeRef.current?.(v)

    // Plot rectangle (matches the renderer's geometry) for hit-testing + cursor→data mapping.
    const regionAt = (px: number, py: number, rect: DOMRect): Region => {
      const g = chartGeometry(rect.width, rect.height)
      if (px >= g.l && px <= g.r && py >= g.t && py <= g.b) return 'plot'
      if (px < g.l && py >= g.t && py <= g.b) return 'yAxis'
      if (py > g.b && px >= g.l && px <= g.r) return 'xAxis'
      return 'outside'
    }
    const dataAt = (px: number, py: number, rect: DOMRect, v: ChartView) => {
      const g = chartGeometry(rect.width, rect.height)
      const plotW = g.r - g.l
      const plotH = g.b - g.t
      const fx = Math.min(1, Math.max(0, (px - g.l) / plotW))
      const fy = Math.min(1, Math.max(0, (g.b - py) / plotH))
      return { aHz: v.minHz + fx * (v.maxHz - v.minHz), aDb: v.minDb + fy * (v.maxDb - v.minDb) }
    }
    const zoomFreq = (v: ChartView, aHz: number, scale: number): Partial<ChartView> => {
      const r = zoomedRange(v.minHz, v.maxHz, aHz, scale, FREQ_MIN, FREQ_MAX, MIN_FREQUENCY_SPAN_HZ)
      return r ? { minHz: r[0], maxHz: r[1] } : {}
    }
    const zoomDb = (v: ChartView, aDb: number, scale: number): Partial<ChartView> => {
      const r = zoomedRange(v.minDb, v.maxDb, aDb, scale, DB_FLOOR, DB_CEIL, MIN_MAGNITUDE_SPAN_DB)
      return r ? { minDb: r[0], maxDb: r[1] } : {}
    }
    const panFreqBy = (v: ChartView, dHz: number): Partial<ChartView> => {
      const [minHz, maxHz] = pannedRange(v.minHz, v.maxHz, -dHz, FREQ_MIN, FREQ_MAX)
      return { minHz, maxHz }
    }
    const panDbBy = (v: ChartView, dDb: number): Partial<ChartView> => {
      const [minDb, maxDb] = pannedRange(v.minDb, v.maxDb, dDb, DB_FLOOR, DB_CEIL)
      return { minDb, maxDb }
    }

    // A zoom step by region, as Swift's pinch: over the plot both axes, over an axis that axis alone, about the point
    // under (px, py); nothing outside the axes.
    const zoomByRegion = (px: number, py: number, rect: DOMRect, scale: number) => {
      const v = viewRef.current
      const { aHz, aDb } = dataAt(px, py, rect, v)
      const region = regionAt(px, py, rect)
      if (region === 'plot') emit({ ...v, ...zoomFreq(v, aHz, scale), ...zoomDb(v, aDb, scale) })
      else if (region === 'xAxis') emit({ ...v, ...zoomFreq(v, aHz, scale) })
      else if (region === 'yAxis') emit({ ...v, ...zoomDb(v, aDb, scale) })
    }

    // Whether the Control key is held. Chrome and Firefox send a trackpad's pinch as a wheel event with ctrlKey set
    // and no Control key down: that is a pinch, zoomed by region; a real Ctrl + Scroll zooms both axes.
    let ctrlHeld = false
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlHeld = e.type === 'keydown'
    }
    const onBlur = () => {
      ctrlHeld = false
    }

    const onWheel = (e: WheelEvent) => {
      if (!onViewChangeRef.current) return
      e.preventDefault()
      const v = viewRef.current
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const cmd = e.metaKey
      const ctrl = e.ctrlKey
      const shift = e.shiftKey
      const opt = e.altKey

      if (ctrl && !ctrlHeld && !cmd && !shift && !opt) {
        // A trackpad pinch (Chrome, Firefox): by region, where it is.
        zoomByRegion(px, py, rect, Math.min(1.5, Math.max(0.67, Math.exp(-e.deltaY * 0.01))))
        return
      }

      if (shift && !cmd && !ctrl && !opt) {
        const scroll = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        emit({ ...v, ...panFreqBy(v, (scroll / 400) * (v.maxHz - v.minHz)) })
        return
      }
      if (opt && !cmd && !ctrl && !shift) {
        emit({ ...v, ...panDbBy(v, (e.deltaY / 300) * (v.maxDb - v.minDb)) })
        return
      }
      const { aHz, aDb } = dataAt(px, py, rect, v)
      const scale = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.0015))) // scroll up → zoom in
      if ((cmd || ctrl) && !shift && !opt) {
        emit({ ...v, ...zoomFreq(v, aHz, scale), ...zoomDb(v, aDb, scale) })
        return
      }
      if (!cmd && !ctrl && !shift && !opt) {
        const region = regionAt(px, py, rect)
        if (region === 'plot') emit({ ...v, ...zoomFreq(v, aHz, scale), ...zoomDb(v, aDb, scale) })
        else if (region === 'xAxis') emit({ ...v, ...zoomFreq(v, aHz, scale) })
        else if (region === 'yAxis') emit({ ...v, ...zoomDb(v, aDb, scale) })
        else emit({ ...v, ...panDbBy(v, (e.deltaY / 300) * (v.maxDb - v.minDb)) })
      }
    }

    // Topmost annotation badge under a point (CSS px), or null. Reverse order = last drawn wins.
    const hitBadge = (px: number, py: number) => {
      for (let i = badgeRectsRef.current.length - 1; i >= 0; i--) {
        const r = badgeRectsRef.current[i]!
        if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r
      }
      return null
    }
    // Nearest peak dot within its hit radius (CSS px), for the dot ↔ results-row highlight click.
    const hitDot = (px: number, py: number): DotHit | null => {
      let best: DotHit | null = null
      let bestD = Infinity
      for (const d of dotRectsRef.current) {
        const dd = (px - d.x) ** 2 + (py - d.y) ** 2
        if (dd <= d.r * d.r && dd < bestD) {
          bestD = dd
          best = d
        }
      }
      return best
    }

    // Single-pointer drag-pan (mouse or one finger), region-aware.
    let dragRegion: Region = 'outside'
    let sx = 0
    let sy = 0
    let start: ChartView | null = null
    // Dragging an annotation badge: freeze the grab point + the badge's bottom-center anchor
    // at drag start; every move re-derives the anchor's data-space position (mirrors Swift's
    // frozenChartPosition so the label tracks the cursor through re-renders).
    let annoDrag: { key: Uuid; pStartX: number; pStartY: number; anchorSX: number; anchorSY: number } | null = null
    // Two-finger pinch-zoom (touch). The pinch midpoint picks the region, exactly like
    // the wheel/pointer; zoom is applied from the start view by the cumulative scale.
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { startDist: number; aHz: number; aDb: number; region: Region; view: ChartView } | null = null
    let crosshairTouch: number | null = null // pointerId of a touch positioning the crosshair (crosshair mode)
    // A finger held still on a peak label opens its menu (Reset Position), as a long press does on iPhone and iPad
    // in Swift; touch has no right-click. Moving first makes it a drag instead.
    let longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null
    const LONG_PRESS_MS = 500
    const LONG_PRESS_SLOP_PX = 8
    const cancelLongPress = () => {
      if (longPress) clearTimeout(longPress.timer)
      longPress = null
    }
    // A plain mouse press in the plot (not a badge grab / pan / pinch), tracked so pointer-up can tell a
    // click (toggle the peak-dot highlight) from a drag. Mouse only — the parent gates onToggleHighlight
    // off on touch, so this stays inert there anyway.
    let pressStart: { x: number; y: number } | null = null
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

    const onDown = (e: PointerEvent) => {
      // Touch crosshair mode: a finger positions the crosshair instead of panning. Gate on
      // "not a real mouse" rather than pointerType==='touch' — iPadOS desktop mode can label
      // finger input inconsistently; the toggle is only shown on touch devices anyway.
      if (crosshairModeRef.current && e.pointerType !== 'mouse') {
        const r = canvas.getBoundingClientRect()
        setHover({ x: e.clientX - r.left, y: e.clientY - r.top })
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {
          /* capture may be unavailable */
        }
        crosshairTouch = e.pointerId
        return
      }
      setHover(null) // a press starts a pan/pinch/drag — hide the hover crosshair
      if (!onViewChangeRef.current || e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvas.setPointerCapture(e.pointerId)
      // Grab an annotation badge before any pan begins (single pointer only).
      if (pointers.size === 1 && onAnnotationDragRef.current) {
        const hit = hitBadge(e.clientX - rect.left, e.clientY - rect.top)
        if (hit) {
          // From the label's centre, which a drag stores (as Swift's and Python's).
          annoDrag = { key: hit.key, pStartX: e.clientX, pStartY: e.clientY, anchorSX: hit.cx, anchorSY: hit.cy }
          start = null
          canvas.style.cursor = 'grabbing'
          if (e.pointerType !== 'mouse' && onResetAnnotationRef.current) {
            const at = { x: e.clientX, y: e.clientY, key: hit.key, pointerId: e.pointerId }
            longPress = {
              x: at.x,
              y: at.y,
              timer: setTimeout(() => {
                longPress = null
                annoDrag = null
                pointers.delete(at.pointerId)
                setMenu({ x: at.x, y: at.y, annoKey: at.key })
                setShowHelp(false)
              }, LONG_PRESS_MS),
            }
          }
          return
        }
      }
      if (pointers.size >= 2) {
        // Begin pinch; cancel any single-finger drag.
        start = null
        const [p1, p2] = [...pointers.values()]
        const mx = (p1!.x + p2!.x) / 2 - rect.left
        const my = (p1!.y + p2!.y) / 2 - rect.top
        const v = viewRef.current
        const { aHz, aDb } = dataAt(mx, my, rect, v)
        pinch = { startDist: dist(p1!, p2!), aHz, aDb, region: regionAt(mx, my, rect), view: { ...v } }
        return
      }
      dragRegion = regionAt(e.clientX - rect.left, e.clientY - rect.top, rect)
      if (dragRegion === 'outside') {
        start = null
        return
      }
      sx = e.clientX
      sy = e.clientY
      start = { ...viewRef.current }
      // Plain mouse press in the plot — remember it so pointer-up can distinguish a click (toggle the
      // peak-dot highlight) from a pan.
      pressStart = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null
    }
    const onMove = (e: PointerEvent) => {
      // Touch crosshair mode: the finger drags the crosshair.
      if (crosshairTouch === e.pointerId) {
        const r = canvas.getBoundingClientRect()
        setHover({ x: e.clientX - r.left, y: e.clientY - r.top })
        return
      }
      // Hover (no button pressed): drive the live crosshair + badge-grab cursor. A touch
      // pointer never reports buttons===0 while moving, so this is naturally hover-only
      // (touch gets the toggle instead). Mirrors the desktop always-live crosshair.
      if (e.buttons === 0 && !annoDrag && !start && !pinch) {
        const rect = canvas.getBoundingClientRect()
        setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        // Swift's cursors: the open hand over a peak label (the closed hand while dragging one), the crosshair
        // over the plot, left-right over the frequency axis, up-down over the magnitude axis, the arrow elsewhere.
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        canvas.style.cursor = onAnnotationDragRef.current && hitBadge(px, py) ? 'grab' : REGION_CURSOR[regionAt(px, py, rect)]
      }
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      // Annotation badge drag takes priority over pan/pinch.
      if (annoDrag && onAnnotationDragRef.current) {
        // While a long press may still open the label's menu, small movements are the finger's wobble.
        if (longPress) {
          if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) <= LONG_PRESS_SLOP_PX) return
          cancelLongPress()
        }
        const rect = canvas.getBoundingClientRect()
        const newSX = annoDrag.anchorSX + (e.clientX - annoDrag.pStartX)
        const newSY = annoDrag.anchorSY + (e.clientY - annoDrag.pStartY)
        const { aHz, aDb } = dataAt(newSX, newSY, rect, viewRef.current)
        onAnnotationDragRef.current(annoDrag.key, [aHz, aDb])
        return
      }
      if (pinch && pointers.size >= 2 && pinch.startDist > 0) {
        const [p1, p2] = [...pointers.values()]
        const scale = Math.min(8, Math.max(0.125, dist(p1!, p2!) / pinch.startDist)) // fingers apart → zoom in
        const v = pinch.view
        let out: ChartView = { ...v }
        if (pinch.region === 'xAxis') out = { ...out, ...zoomFreq(v, pinch.aHz, scale) }
        else if (pinch.region === 'yAxis') out = { ...out, ...zoomDb(v, pinch.aDb, scale) }
        else out = { ...out, ...zoomFreq(v, pinch.aHz, scale), ...zoomDb(v, pinch.aDb, scale) } // plot/outside → both
        emit(out)
        return
      }
      if (!start) return
      const rect = canvas.getBoundingClientRect()
      const g = chartGeometry(rect.width, rect.height)
      const plotW = g.r - g.l
      const plotH = g.b - g.t
      const dHz = ((e.clientX - sx) / plotW) * (start.maxHz - start.minHz)
      const dDb = ((e.clientY - sy) / plotH) * (start.maxDb - start.minDb)
      let out: ChartView = { ...start }
      if (dragRegion === 'plot' || dragRegion === 'xAxis') out = { ...out, ...panFreqBy(start, dHz) }
      if (dragRegion === 'plot' || dragRegion === 'yAxis') out = { ...out, ...panDbBy(start, dDb) }
      emit(out)
    }
    const onUp = (e: PointerEvent) => {
      if (crosshairTouch === e.pointerId) {
        crosshairTouch = null // leave the crosshair at its last position so the value stays readable
        try {
          canvas.releasePointerCapture(e.pointerId)
        } catch {
          /* capture may already be gone */
        }
        return
      }
      // A click (not a pan/drag) on a peak dot toggles its highlight. Checked here, before the gesture
      // state is torn down, so a real pan (moved > 4px) or a badge drag/pinch is excluded.
      if (pressStart && onToggleHighlightRef.current && !annoDrag && !pinch) {
        const moved = Math.abs(e.clientX - pressStart.x) + Math.abs(e.clientY - pressStart.y) > 4
        if (!moved) {
          const rect = canvas.getBoundingClientRect()
          const dot = hitDot(e.clientX - rect.left, e.clientY - rect.top)
          if (dot) onToggleHighlightRef.current(dot.id)
        }
      }
      pressStart = null
      cancelLongPress()
      pointers.delete(e.pointerId)
      if (annoDrag) {
        annoDrag = null
        canvas.style.cursor = 'grab' // still over the label, as Swift's
      }
      if (pointers.size < 2) pinch = null
      if (pointers.size === 0) start = null
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* capture may already be gone */
      }
    }

    // Safari's trackpad pinch: its own gesture events, the scale cumulative from the gesture's start. A two-finger
    // pinch on a touch screen also sends them; that one is the pointers' (above), so it is left alone here.
    let gestureScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      if (pointers.size >= 2 || !onViewChangeRef.current) return
      const rect = canvas.getBoundingClientRect()
      zoomByRegion(g.clientX - rect.left, g.clientY - rect.top, rect, g.scale / gestureScale)
      gestureScale = g.scale
    }

    const onLeave = () => setHover(null) // pointer left the chart — hide the crosshair
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    canvas.addEventListener('gesturestart', onGestureStart)
    canvas.addEventListener('gesturechange', onGestureChange)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      cancelLongPress()
    }
    // Listeners read live state via refs, so bind once on mount.
  }, [])

  const closeOverlays = () => {
    setMenu(null)
    setShowHelp(false)
  }
  const doReset = (target: ResetTarget, axis: ResetAxis) => {
    onReset?.(target, axis)
    setMenu(null)
  }

  // @parity view/spectrum-chart — the chart's elements: the canvas and its buttons
  return (
    <div className="chart-host">
      <canvas
        ref={canvasRef}
        className="spectrum-canvas"
        onContextMenu={(e) => {
          // Right-clicking a badge opens the per-label menu (Reset Position); the empty chart opens
          // the axes/Reset-Labels menu. hitBadge is scoped to the gesture effect, so hit-test the
          // shared badge-rect ref directly here (topmost = last drawn).
          const canvas = canvasRef.current
          if (canvas && onResetAnnotation) {
            const rect = canvas.getBoundingClientRect()
            const px = e.clientX - rect.left
            const py = e.clientY - rect.top
            const hit = [...badgeRectsRef.current].reverse().find(
              (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
            )
            if (hit) {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, annoKey: hit.key })
              setShowHelp(false)
              return
            }
          }
          if (!onReset) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
          setShowHelp(false)
        }}
      />

      {/* Two upper-right icons: ⋯ the chart's menu (a right-click opens the same) and ⓘ the help, as Swift's. */}
      {onReset && (
        <button
          className="chart-menu-btn btn-icon"
          title="Chart options"
          aria-haspopup="menu"
          onClick={(e) => {
            setShowHelp(false)
            const r = e.currentTarget.getBoundingClientRect()
            setMenu((m) => (m ? null : { x: r.right, y: r.bottom + 4, alignRight: true }))
          }}
        >
          <MoreCircleIcon />
        </button>
      )}

      <button className="chart-help btn-icon" title="Zoom & Pan Controls" onClick={() => setShowHelp((s) => !s)}>
        <InfoIcon />
      </button>

      {showHelp && (
        <>
          <div className="chart-overlay-backdrop" onClick={closeOverlays} />
          {/* The lines that work on the device in use (chartHelp), below the ⓘ; it scrolls when the chart is too
              short to show it whole. Mirrors Swift's ChartHelpView. */}
          <div className="chart-help-pop">
            <h4>{CHART_HELP_TITLE}</h4>
            {shownHelp(currentHelpDevice()).map((group, i) => (
              <Fragment key={i}>
                {i > 0 && <div className="help-sep" />}
                {group.map(([gesture, effect]) => (
                  <div key={gesture} className="help-line">
                    {gesture}
                    <span>: {effect}</span>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </>
      )}

      {menu && (
        <>
          <div className="chart-overlay-backdrop" onClick={closeOverlays} onContextMenu={(e) => { e.preventDefault(); closeOverlays() }} />
          <div
            ref={ctxRef}
            className="chart-ctx"
            style={{
              left: menuStyle?.left ?? menu.x,
              top: menuStyle?.top ?? menu.y,
              visibility: menuStyle ? 'visible' : 'hidden',
            }}
          >
            {menu.annoKey != null ? (
              // Per-label menu: right-clicked a single badge → reset just that label. Mirrors Swift
              // PeakAnnotations `.contextMenu` exactly — a single Label(icon+text) "Reset Position"
              // (SF Symbol arrow.counterclockwise), disabled when the label is unmoved. No header.
              (() => {
                const mk = markers.find((m) => m.annoKey === menu.annoKey)
                const moved = mk?.annoOffset != null
                return LABEL_MENU.map((entry) => (
                  <button
                    key={entry.action}
                    className="ctx-icon-item"
                    disabled={!moved}
                    onClick={() => {
                      onResetAnnotation?.(menu.annoKey!)
                      setMenu(null)
                    }}
                  >
                    <span className="ctx-icon" aria-hidden><MenuIcon mdi={entry.mdi} /></span>
                    {entry.title}
                  </button>
                ))
              })()
            ) : (
              // The chart's menu — CHART_MENU_GROUPS, the same items, words and icons as Swift's, from the ⋯ and from
              // a right-click; no title or headers (style guide S1a).
              <>
                {(comparisonMenu ? COMPARISON_MENU_GROUPS : CHART_MENU_GROUPS).map((group, i) => {
                  const items = group.filter((e) => e.action !== 'resetLabels' || onResetLabels)
                  if (items.length === 0) return null
                  return (
                    <Fragment key={i}>
                      {i > 0 && <div className="ctx-sep" />}
                      {items.map((entry) => {
                        const reset = axisReset(entry.action)
                        return (
                          <button
                            key={entry.action}
                            className="ctx-icon-item"
                            disabled={entry.action === 'resetLabels' && !hasMovedLabels}
                            onClick={() => {
                              if (reset) doReset(reset.target, reset.axis)
                              else {
                                onResetLabels?.()
                                setMenu(null)
                              }
                            }}
                          >
                            <span className="ctx-icon" aria-hidden><MenuIcon mdi={entry.mdi} /></span>
                            {entry.title}
                          </button>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}