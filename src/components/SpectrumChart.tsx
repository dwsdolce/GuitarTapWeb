import { useEffect, useRef, useState } from 'react'
import type { Spectrum } from '../dsp/guitarFFT'

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
}

/** Frequency label like Swift's formattedAsFrequency (Hz under 1 kHz, else kHz). */
function fmtFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`
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
  logFreq?: boolean
  minHz?: number
  maxHz?: number
  minDb?: number
  maxDb?: number
  /** Wheel-zoom / drag-pan emit a new view here (omit to make the chart static). */
  onViewChange?: (v: ChartView) => void
  /** Right-click menu reset (target = saved range vs factory defaults; axis scope). */
  onReset?: (target: ResetTarget, axis: ResetAxis) => void
}

const FREQ_TICKS_LOG = [30, 50, 100, 200, 300, 500, 1000, 2000]
// Limits mirror SpectrumView+GestureHandlers.swift.
const FREQ_MIN_SPAN = 50 // Hz
const DB_MIN_SPAN = 10 // dB
const FREQ_MAX = 5000 // maxDisplayFrequency
const DB_FLOOR = -120
const DB_CEIL = 20
// Axis gutters (label strips) = the x-axis / y-axis hit-zones (pointerRegion).
const LEFT_GUTTER = 38 // px — magnitude (y) axis
const BOTTOM_GUTTER = 16 // px — frequency (x) axis

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
  logFreq = false,
  minHz = 30,
  maxHz = 2000,
  minDb = -100,
  maxDb = 0,
  onViewChange,
  onReset,
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

    const plotL = LEFT_GUTTER
    const plotR = W
    const plotT = 0
    const plotB = H - BOTTOM_GUTTER
    const plotW = plotR - plotL
    const plotH = plotB - plotT

    ctx.fillStyle = '#0e1116'
    ctx.fillRect(0, 0, W, H)

    const lo = Math.max(1, minHz)
    const logLo = Math.log10(lo)
    const logHi = Math.log10(maxHz)
    const xFor = (hz: number) =>
      plotL +
      (logFreq
        ? ((Math.log10(Math.max(hz, lo)) - logLo) / (logHi - logLo)) * plotW
        : ((hz - minHz) / (maxHz - minHz)) * plotW)
    const yFor = (db: number) => plotB - ((db - minDb) / (maxDb - minDb)) * plotH

    ctx.strokeStyle = '#1c242e'
    ctx.fillStyle = '#5b6673'
    ctx.lineWidth = 1
    ctx.font = '10px system-ui, sans-serif'
    const dbStep = maxDb - minDb > 60 ? 20 : 10
    for (let db = Math.ceil(minDb / dbStep) * dbStep; db <= maxDb; db += dbStep) {
      const y = yFor(db)
      ctx.beginPath()
      ctx.moveTo(plotL, y)
      ctx.lineTo(plotR, y)
      ctx.stroke()
      ctx.fillText(`${db}`, 2, Math.min(plotB - 1, y + 3))
    }
    const ticks = logFreq
      ? FREQ_TICKS_LOG.filter((t) => t >= minHz && t <= maxHz)
      : niceLinearTicks(minHz, maxHz)
    for (const hz of ticks) {
      const x = xFor(hz)
      if (x < plotL) continue
      ctx.beginPath()
      ctx.moveTo(x, plotT)
      ctx.lineTo(x, plotB)
      ctx.stroke()
      ctx.fillText(`${Math.round(hz)}`, x + 2, plotB + 12)
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(plotL, plotT, plotW, plotH)
    ctx.clip()

    if (spectrum) {
      const { magnitudesDb, frequencies } = spectrum
      ctx.beginPath()
      ctx.strokeStyle = '#4ea1ff'
      ctx.lineWidth = 1.5
      let started = false
      for (let i = 0; i < frequencies.length; i++) {
        const f = frequencies[i]!
        if (f < minHz) continue
        if (f > maxHz) break
        const x = xFor(f)
        const y = yFor(magnitudesDb[i]!)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    }

    // Colored overlay curves (material per-phase L/C/FLC; later comparison curves).
    for (const ov of overlays) {
      ctx.beginPath()
      ctx.strokeStyle = ov.color
      ctx.lineWidth = 1.5
      let started = false
      for (let i = 0; i < ov.frequencies.length; i++) {
        const f = ov.frequencies[i]!
        if (f < minHz) continue
        if (f > maxHz) break
        const x = xFor(f)
        const y = yFor(ov.magnitudesDb[i]!)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    }

    // Pass 1 — dots for every peak in range, always (independent of annotation mode).
    for (const m of markers) {
      if (m.frequency < minHz || m.frequency > maxHz) continue
      ctx.beginPath()
      ctx.arc(xFor(m.frequency), yFor(m.magnitude), m.annotated ? 4 : 3, 0, Math.PI * 2)
      ctx.fillStyle = m.color ?? '#8a96a5'
      ctx.fill()
    }

    // Pass 2 — annotation badges (mode · ♪ pitch · freq · dB), only when annotated.
    // Mirrors the native PeakAnnotationLabel callout (PeakAnnotations.swift).
    const PITCH = '#c389e8'
    const padX = 7
    const padY = 5
    const lineH = 14
    for (const m of markers) {
      if (!m.annotated || m.frequency < minHz || m.frequency > maxHz) continue
      const x = xFor(m.frequency)
      const y = yFor(m.magnitude)
      const color = m.color ?? '#8a96a5'

      const lines: { text: string; color: string; font: string }[] = [
        {
          text: (m.label ?? '') + (m.isOverride ? ' ✎' : ''),
          color,
          font: `${m.isOverride ? 'italic ' : ''}bold 11px system-ui, sans-serif`,
        },
      ]
      if (m.note) {
        const c = Math.round(m.cents ?? 0)
        lines.push({ text: `♪ ${m.note} ${c >= 0 ? '+' : ''}${c} ¢`, color: PITCH, font: '600 11px system-ui, sans-serif' })
      }
      lines.push({ text: fmtFreq(m.frequency), color: '#dfe4ea', font: '500 11px system-ui, sans-serif' })
      lines.push({ text: `${m.magnitude.toFixed(1)} dB`, color: '#9aa6b3', font: '11px system-ui, sans-serif' })

      let boxW = 0
      for (const ln of lines) {
        ctx.font = ln.font
        boxW = Math.max(boxW, ctx.measureText(ln.text).width)
      }
      boxW += padX * 2
      const boxH = lines.length * lineH + padY * 2
      const boxX = Math.max(plotL + 2, Math.min(x - boxW / 2, plotR - boxW - 2))
      let boxBottom = y - 10
      let boxTop = boxBottom - boxH
      if (boxTop < plotT + 2) {
        boxTop = plotT + 2
        boxBottom = boxTop + boxH
      }

      // Leader line from the peak dot up to the badge.
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(Math.max(boxX, Math.min(x, boxX + boxW)), boxBottom)
      ctx.stroke()

      // Badge: dark rounded rect with a mode-colored border.
      ctx.beginPath()
      ctx.roundRect(boxX, boxTop, boxW, boxH, 6)
      ctx.fillStyle = 'rgba(20, 25, 33, 0.92)'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.textBaseline = 'top'
      for (let i = 0; i < lines.length; i++) {
        ctx.font = lines[i]!.font
        ctx.fillStyle = lines[i]!.color
        ctx.fillText(lines[i]!.text, boxX + padX, boxTop + padY + i * lineH)
      }
    }
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
  }, [spectrum, markers, overlays, logFreq, minHz, maxHz, minDb, maxDb])

  // ── Interaction (mirrors SpectrumView+GestureHandlers) ──────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const emit = (v: ChartView) => onViewChangeRef.current?.(v)

    const regionAt = (px: number, py: number, rect: DOMRect): Region => {
      const pb = rect.height - BOTTOM_GUTTER
      if (px >= LEFT_GUTTER && px <= rect.width && py >= 0 && py <= pb) return 'plot'
      if (px < LEFT_GUTTER && py >= 0 && py <= pb) return 'yAxis'
      if (py > pb && px >= LEFT_GUTTER && px <= rect.width) return 'xAxis'
      return 'outside'
    }
    const dataAt = (px: number, py: number, rect: DOMRect, v: ChartView) => {
      const plotW = rect.width - LEFT_GUTTER
      const plotH = rect.height - BOTTOM_GUTTER
      const fx = Math.min(1, Math.max(0, (px - LEFT_GUTTER) / plotW))
      const fy = Math.min(1, Math.max(0, (plotH - py) / plotH))
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

    // Single-pointer drag-pan (mouse or one finger), region-aware.
    let dragRegion: Region = 'outside'
    let sx = 0
    let sy = 0
    let start: ChartView | null = null
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
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
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
      const plotW = rect.width - LEFT_GUTTER
      const plotH = rect.height - BOTTOM_GUTTER
      const dHz = ((e.clientX - sx) / plotW) * (start.maxHz - start.minHz)
      const dDb = ((e.clientY - sy) / plotH) * (start.maxDb - start.minDb)
      let out: ChartView = { ...start }
      if (dragRegion === 'plot' || dragRegion === 'xAxis') out = { ...out, ...panFreqBy(start, dHz) }
      if (dragRegion === 'plot' || dragRegion === 'yAxis') out = { ...out, ...panDbBy(start, dDb) }
      emit(out)
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
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
      {title && <div className="chart-title">{title}</div>}
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
          </div>
        </>
      )}
    </div>
  )
}

/** Linear frequency ticks at a "nice" step for the current span (~6–10 ticks). */
function niceLinearTicks(minHz: number, maxHz: number): number[] {
  const span = Math.max(1, maxHz - minHz)
  const raw = span / 8
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let t = Math.ceil(minHz / step) * step; t <= maxHz; t += step) out.push(t)
  return out
}