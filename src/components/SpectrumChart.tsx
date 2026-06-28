import { useEffect, useRef, useState } from 'react'
import type { Spectrum } from '../dsp/guitarFFT'
import { renderSpectrum, chartGeometry, DARK_CHART } from './spectrumRender'
import type { GuitarTypeName } from '../dsp/guitarModes'

export interface PeakMarker {
  frequency: number
  magnitude: number
  /** Mode color for the dot (gray when omitted — e.g. unidentified peaks). */
  color?: string
  /** Mode / override name — the badge's first line. */
  label?: string
  /** Pitch line (guitar): note name + cents. Omitted → no pitch line (material). */
  note?: string
  cents?: number
  /** Italic + pencil glyph when the label is a manual override. */
  isOverride?: boolean
  /** Draw the annotation badge. The dot is ALWAYS drawn regardless of this flag —
   *  mirrors Swift's two layers: allPeaksInRange dots vs visiblePeaks annotations. */
  annotated?: boolean
  /** Stable key (peak frequency, `toFixed(1)`) identifying this badge for drag/offset edits.
   *  Present → the badge is draggable; the leader line tracks the peak. */
  annoKey?: string
  /** User-dragged badge position in data-space [absFreqHz, absDB]; omit → default placement. */
  annoOffset?: [number, number]
}

/** A drawn annotation badge's screen rectangle (CSS px), emitted by the renderer for hit-testing. */
export interface AnnotationRect {
  key: string
  x: number
  y: number
  w: number
  h: number
}

export interface ChartView {
  minHz: number
  maxHz: number
  minDb: number
  maxDb: number
}

export type ResetTarget = 'saved' | 'defaults'
export type ResetAxis = 'both' | 'freq' | 'mag'

/** A colored overlay curve (plate/brace per-phase spectra, later comparison curves). */
export interface SpectrumOverlay {
  magnitudesDb: number[]
  frequencies: number[]
  color: string
  label: string
}

export interface SpectrumChartProps {
  spectrum: Spectrum | null
  /** Title shown top-left, e.g. "FFT Peaks — New" (mirrors Swift/Python chartTitle). */
  title?: string
  markers?: PeakMarker[]
  /** Extra colored curves drawn over the plot, with a legend (material L/C/FLC). */
  overlays?: SpectrumOverlay[]
  /** Guitar type → mode-boundary lines + top labels on the plot (omit for material/comparison). */
  guitarType?: GuitarTypeName
  logFreq?: boolean
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
  onAnnotationDrag?: (key: string, pos: [number, number]) => void
  /** "Reset Labels" menu action → clear all dragged label positions. */
  onResetLabels?: () => void
  /** Enables the "Reset Labels" menu item (true when any label has been moved). */
  hasMovedLabels?: boolean
}

// Limits mirror SpectrumView+GestureHandlers.swift.
const FREQ_MIN_SPAN = 50 // Hz
const DB_MIN_SPAN = 10 // dB
const FREQ_MAX = 5000 // maxDisplayFrequency
const DB_FLOOR = -120
const DB_CEIL = 20

type Region = 'plot' | 'xAxis' | 'yAxis' | 'outside'

// Help popover text — mirrors SpectrumView's "Zoom & Pan Controls".
const CONTROLS: [string, string][] = [
  ['Scroll over plot', 'Zoom both axes around cursor'],
  ['Scroll over frequency axis', 'Zoom frequency only'],
  ['Scroll over magnitude axis', 'Zoom magnitude only'],
  ['Shift + Scroll', 'Pan frequency axis'],
  ['Alt / Option + Scroll', 'Pan magnitude axis'],
  ['Cmd / Ctrl + Scroll', 'Zoom both axes (trackpad pinch)'],
  ['Drag over plot', 'Pan both axes'],
  ['Drag over frequency axis', 'Pan frequency only'],
  ['Drag over magnitude axis', 'Pan magnitude only'],
  ['Pinch (touch)', 'Zoom — both axes, or by region'],
  ['Drag (touch)', 'Pan — both axes, or by region'],
  ['⋯ menu / right-click', 'Reset axes (Chart Options)'],
]

export function SpectrumChart({
  spectrum,
  title,
  markers = [],
  overlays = [],
  guitarType,
  logFreq = false,
  minHz = 30,
  maxHz = 2000,
  minDb = -100,
  maxDb = 0,
  onViewChange,
  onReset,
  onAnnotationDrag,
  onResetLabels,
  hasMovedLabels = false,
}: SpectrumChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  // Reset menu: anchored at the cursor (right-click) via `left`, or under the ⋯ button
  // (top-right) via `right`.
  const [menu, setMenu] = useState<{ left?: number; right?: number; top: number } | null>(null)

  const viewRef = useRef<ChartView>({ minHz, maxHz, minDb, maxDb })
  viewRef.current = { minHz, maxHz, minDb, maxDb }
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  const onAnnotationDragRef = useRef(onAnnotationDrag)
  onAnnotationDragRef.current = onAnnotationDrag
  // Badge screen rects from the most recent render — refreshed every draw, read by the
  // pointer handler for hit-testing (CSS px, matching pointer coords).
  const badgeRectsRef = useRef<AnnotationRect[]>([])

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
    renderSpectrum(ctx, W, H, {
      spectrum,
      markers,
      overlays,
      logFreq,
      title,
      guitarType,
      theme: DARK_CHART,
      view: { minHz, maxHz, minDb, maxDb },
      badgeRectsOut: badgeRectsRef.current,
    })
  }, [spectrum, markers, overlays, logFreq, title, guitarType, minHz, maxHz, minDb, maxDb])

  // ── Interaction (mirrors SpectrumView+GestureHandlers) ──────────────────────
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
      const lo = Math.max(0, aHz - (aHz - v.minHz) / scale)
      const hi = Math.min(FREQ_MAX, aHz + (v.maxHz - aHz) / scale)
      return hi > lo + FREQ_MIN_SPAN ? { minHz: lo, maxHz: hi } : {}
    }
    const zoomDb = (v: ChartView, aDb: number, scale: number): Partial<ChartView> => {
      const lo = Math.max(DB_FLOOR, aDb - (aDb - v.minDb) / scale)
      const hi = Math.min(DB_CEIL, aDb + (v.maxDb - aDb) / scale)
      return hi > lo + DB_MIN_SPAN ? { minDb: lo, maxDb: hi } : {}
    }
    const panFreqBy = (v: ChartView, dHz: number): Partial<ChartView> => {
      let lo = v.minHz - dHz
      let hi = v.maxHz - dHz
      if (lo < 0) {
        hi -= lo
        lo = 0
      }
      if (hi > FREQ_MAX) {
        lo -= hi - FREQ_MAX
        hi = FREQ_MAX
      }
      return { minHz: Math.max(0, lo), maxHz: hi }
    }
    const panDbBy = (v: ChartView, dDb: number): Partial<ChartView> => {
      let lo = v.minDb + dDb
      let hi = v.maxDb + dDb
      if (lo < DB_FLOOR) {
        hi -= lo - DB_FLOOR
        lo = DB_FLOOR
      }
      if (hi > DB_CEIL) {
        lo -= hi - DB_CEIL
        hi = DB_CEIL
      }
      return { minDb: lo, maxDb: hi }
    }

    const onWheel = (e: WheelEvent) => {
      if (!onViewChangeRef.current || logFreq) return
      e.preventDefault()
      const v = viewRef.current
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const cmd = e.metaKey
      const ctrl = e.ctrlKey
      const shift = e.shiftKey
      const opt = e.altKey

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

    // Single-pointer drag-pan (mouse or one finger), region-aware.
    let dragRegion: Region = 'outside'
    let sx = 0
    let sy = 0
    let start: ChartView | null = null
    // Dragging an annotation badge: freeze the grab point + the badge's bottom-center anchor
    // at drag start; every move re-derives the anchor's data-space position (mirrors Swift's
    // frozenChartPosition so the label tracks the cursor through re-renders).
    let annoDrag: { key: string; pStartX: number; pStartY: number; anchorSX: number; anchorSY: number } | null = null
    // Two-finger pinch-zoom (touch). The pinch midpoint picks the region, exactly like
    // the wheel/pointer; zoom is applied from the start view by the cumulative scale.
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { startDist: number; aHz: number; aDb: number; region: Region; view: ChartView } | null = null
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

    const onDown = (e: PointerEvent) => {
      if (!onViewChangeRef.current || logFreq || e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvas.setPointerCapture(e.pointerId)
      // Grab an annotation badge before any pan begins (single pointer only).
      if (pointers.size === 1 && onAnnotationDragRef.current) {
        const hit = hitBadge(e.clientX - rect.left, e.clientY - rect.top)
        if (hit) {
          annoDrag = { key: hit.key, pStartX: e.clientX, pStartY: e.clientY, anchorSX: hit.x + hit.w / 2, anchorSY: hit.y + hit.h }
          start = null
          canvas.style.cursor = 'grabbing'
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
    }
    const onMove = (e: PointerEvent) => {
      // Hover feedback over draggable badges (no buttons pressed).
      if (!annoDrag && !start && !pinch && pointers.size === 0 && onAnnotationDragRef.current) {
        const rect = canvas.getBoundingClientRect()
        canvas.style.cursor = hitBadge(e.clientX - rect.left, e.clientY - rect.top) ? 'grab' : ''
      }
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      // Annotation badge drag takes priority over pan/pinch.
      if (annoDrag && onAnnotationDragRef.current) {
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
      pointers.delete(e.pointerId)
      if (annoDrag) {
        annoDrag = null
        canvas.style.cursor = ''
      }
      if (pointers.size < 2) pinch = null
      if (pointers.size === 0) start = null
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* capture may already be gone */
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [logFreq])

  const closeOverlays = () => {
    setMenu(null)
    setShowHelp(false)
  }
  const doReset = (target: ResetTarget, axis: ResetAxis) => {
    onReset?.(target, axis)
    setMenu(null)
  }

  return (
    <div className="chart-host">
      <canvas
        ref={canvasRef}
        className="spectrum-canvas"
        onContextMenu={(e) => {
          if (!onReset) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          setMenu({ left: e.clientX - rect.left, top: e.clientY - rect.top })
          setShowHelp(false)
        }}
      />

      {overlays.length > 0 && (
        <div className="chart-legend">
          {overlays.map((ov) => (
            <span key={ov.label} className="legend-item">
              <span className="legend-swatch" style={{ background: ov.color }} />
              {ov.label}
            </span>
          ))}
        </div>
      )}

      {/* Two upper-right icons: ⋯ Chart Options and ? help (right-click still opens the
          same reset menu). Mirrors the iPad chart. */}
      {onReset && (
        <button
          className="chart-menu-btn"
          title="Chart options"
          aria-haspopup="menu"
          onClick={() => {
            setShowHelp(false)
            setMenu((m) => (m ? null : { right: 8, top: 32 }))
          }}
        >
          ⋯
        </button>
      )}

      <button className="chart-help" title="Zoom & pan controls" onClick={() => setShowHelp((s) => !s)}>
        ?
      </button>

      {showHelp && (
        <>
          <div className="chart-overlay-backdrop" onClick={closeOverlays} />
          <div className="chart-help-pop">
            <h4>Zoom &amp; Pan Controls</h4>
            {CONTROLS.map(([k, d]) => (
              <div key={k} className="ctrl-row">
                <b>{k}</b>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {menu && (
        <>
          <div className="chart-overlay-backdrop" onClick={closeOverlays} onContextMenu={(e) => { e.preventDefault(); closeOverlays() }} />
          <div className="chart-ctx" style={{ left: menu.left, right: menu.right, top: menu.top }}>
            <div className="ctx-title">Chart Options</div>
            <div className="ctx-header">Reset to Saved</div>
            <button onClick={() => doReset('saved', 'both')}>Both Axes</button>
            <button onClick={() => doReset('saved', 'freq')}>Frequency Axis</button>
            <button onClick={() => doReset('saved', 'mag')}>Magnitude Axis</button>
            <div className="ctx-sep" />
            <div className="ctx-header">Reset to Defaults</div>
            <button onClick={() => doReset('defaults', 'both')}>Both Axes</button>
            <button onClick={() => doReset('defaults', 'freq')}>Frequency Axis</button>
            <button onClick={() => doReset('defaults', 'mag')}>Magnitude Axis</button>
            {onResetLabels && (
              <>
                <div className="ctx-sep" />
                <button
                  disabled={!hasMovedLabels}
                  onClick={() => {
                    onResetLabels()
                    setMenu(null)
                  }}
                >
                  Reset Labels
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}