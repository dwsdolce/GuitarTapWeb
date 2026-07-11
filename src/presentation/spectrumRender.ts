// Canvas renderer for the spectrum chart — the single source of truth shared by the on-screen
// SpectrumChart (dark theme) and the PNG/PDF export (light theme), so the two CANNOT drift. Draws a
// centered title, gridlines + tick labels OUTSIDE a bordered plot, axis titles, mode-boundary dashed
// lines + top labels (guitar), the spectrum curve(s), peak dots and annotation badges. Mirrors
// Swift's ExportableSpectrumChart / live SpectrumView layout.

import type { Spectrum } from '../dsp/guitarFFT'
import { modeBands, type GuitarTypeName } from '../dsp/guitarModes'
import { MODE_COLOR, MODE_LABEL } from './modeColors'
import type { PeakMarker, SpectrumOverlay, ChartView, AnnotationRect } from './chartTypes'

export function fmtFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`
}

export function niceLinearTicks(minHz: number, maxHz: number): number[] {
  const span = Math.max(1, maxHz - minHz)
  const raw = span / 8
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let t = Math.ceil(minHz / step) * step; t <= maxHz; t += step) out.push(t)
  return out
}

export interface ChartTheme {
  bg: string
  grid: string
  border: string
  axis: string // tick labels + axis titles
  title: string
  curve: string // spectrum curve
  badgeBg: string
  crosshairLine: string // crosshair lines + readout box border
  crosshairFreq: string // default frequency-readout color (when not snapped to a colored curve)
  crosshairDb: string // magnitude-readout color
  crosshairBg: string // readout box fill
}
export const DARK_CHART: ChartTheme = {
  bg: '#0e1116',
  grid: '#1c242e',
  border: '#2a3543',
  axis: '#8a97a6',
  title: '#dfe4ea',
  // The primary spectrum line is RED, matching Swift `spectrumLineContent` (.foregroundStyle(.red)) for guitar
  // AND material live/frozen — and distinct from the material Longitudinal overlay (blue #4ea1ff = MAT_L_COLOR).
  // (Was #4ea1ff, which collided with the L overlay and hid the live spectrum during material capture.)
  curve: '#e0584a',
  badgeBg: 'rgba(20, 25, 33, 0.92)',
  crosshairLine: 'rgba(150, 160, 170, 0.55)',
  crosshairFreq: '#dc6464',
  crosshairDb: '#8a97a6',
  crosshairBg: 'rgba(20, 25, 33, 0.92)',
}
export const LIGHT_CHART: ChartTheme = {
  bg: '#ffffff',
  grid: '#e3e8ee',
  border: '#c2cad4',
  axis: '#6b7785',
  title: '#1a2330',
  curve: '#e0584a',
  badgeBg: 'rgba(255, 255, 255, 0.96)',
  crosshairLine: 'rgba(90, 100, 110, 0.5)',
  crosshairFreq: '#cc3232',
  crosshairDb: '#6b7785',
  crosshairBg: 'rgba(255, 255, 255, 0.96)',
}

// Margins around the plot: room for the title + mode labels (top), the y-axis title + labels (left),
// and the x-axis title + labels (bottom). Used by BOTH the renderer and the interaction hit-testing.
export const PLOT_TOP = 46
export const PLOT_LEFT = 56
export const PLOT_BOTTOM = 42
export const PLOT_RIGHT = 14

export interface PlotRect {
  l: number
  t: number
  r: number
  b: number
}
export function chartGeometry(W: number, H: number): PlotRect {
  return { l: PLOT_LEFT, t: PLOT_TOP, r: W - PLOT_RIGHT, b: H - PLOT_BOTTOM }
}

export interface RenderOpts {
  spectrum: Spectrum | null
  markers?: PeakMarker[]
  overlays?: SpectrumOverlay[]
  view: ChartView
  /** Centered title above the plot. */
  title?: string
  /** Guitar type → mode-boundary lines + top labels (omit for material/comparison). */
  guitarType?: GuitarTypeName
  /** Peak Min threshold (dB) → a horizontal "Peak: N dB" reference line (guitar only, live chart only —
   *  omitted for exports, matching Swift). Drawn only when within the visible dB range. */
  peakMin?: number
  theme?: ChartTheme
  /** When provided, the renderer pushes each drawn (keyed) badge's screen rect here for hit-testing. */
  badgeRectsOut?: AnnotationRect[]
  /** Live pointer crosshair (CSS px). Always-on hover readout; mirrors Python fft_canvas
   *  `_on_mouse_moved` / Swift desktop crosshair. Omitted for exports (no crosshair in PNG/PDF). */
  crosshair?: { x: number; y: number } | null
  /** When true (a frozen/captured result is shown), the crosshair snaps to the nearest
   *  spectrum bin so the readout reflects actual data; otherwise it tracks freely. */
  frozen?: boolean
}

/** Nearest index in a sorted ascending array to `target` (for crosshair bin snap). */
function nearestIndex(sorted: ArrayLike<number>, target: number): number {
  const n = sorted.length
  if (n === 0) return -1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! < target) lo = mid + 1
    else hi = mid
  }
  // lo is the first >= target; check the neighbor for the truly nearest.
  if (lo > 0 && Math.abs(sorted[lo - 1]! - target) <= Math.abs(sorted[lo]! - target)) return lo - 1
  return lo
}

/** Draw the spectrum chart into ctx over a W×H region (origin at 0,0). */
export function renderSpectrum(ctx: CanvasRenderingContext2D, W: number, H: number, opts: RenderOpts): void {
  const { spectrum, markers = [], overlays = [], title, guitarType } = opts
  const th = opts.theme ?? DARK_CHART
  const { minHz, maxHz, minDb, maxDb } = opts.view
  const { l: plotL, t: plotT, r: plotR, b: plotB } = chartGeometry(W, H)
  const plotW = plotR - plotL
  const plotH = plotB - plotT
  const bands = guitarType && overlays.length === 0 ? modeBands(guitarType) : []

  ctx.fillStyle = th.bg
  ctx.fillRect(0, 0, W, H)

  // Centered title.
  if (title) {
    ctx.fillStyle = th.title
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(title, (plotL + plotR) / 2, 20)
    ctx.textAlign = 'left'
  }

  const xFor = (hz: number) => plotL + ((hz - minHz) / (maxHz - minHz)) * plotW
  const yFor = (db: number) => plotB - ((db - minDb) / (maxDb - minDb)) * plotH

  // Gridlines + tick labels OUTSIDE the plot.
  ctx.strokeStyle = th.grid
  ctx.fillStyle = th.axis
  ctx.lineWidth = 1
  ctx.font = '11px system-ui, sans-serif'
  const dbStep = maxDb - minDb > 60 ? 20 : 10
  ctx.textAlign = 'right'
  for (let db = Math.ceil(minDb / dbStep) * dbStep; db <= maxDb; db += dbStep) {
    const y = yFor(db)
    ctx.beginPath()
    ctx.moveTo(plotL, y)
    ctx.lineTo(plotR, y)
    ctx.stroke()
    ctx.fillText(`${db}`, plotL - 7, y + 4)
  }
  ctx.textAlign = 'center'
  const ticks = niceLinearTicks(minHz, maxHz)
  for (const hz of ticks) {
    const x = xFor(hz)
    if (x < plotL || x > plotR) continue
    ctx.strokeStyle = th.grid
    ctx.beginPath()
    ctx.moveTo(x, plotT)
    ctx.lineTo(x, plotB)
    ctx.stroke()
    ctx.fillStyle = th.axis
    ctx.fillText(`${Math.round(hz)}`, x, plotB + 16)
  }
  ctx.textAlign = 'left'

  // Mode-boundary dashed lines + top labels (guitar). TWO lines per mode — the lower (lo) and upper
  // (hi) bound of its frequency range — with the abbreviation label at the lower bound (range start).
  for (const b of bands) {
    const color = MODE_COLOR[b.name]
    for (const edge of [b.lo, b.hi]) {
      if (edge < minHz || edge > maxHz) continue
      const ex = xFor(edge)
      ctx.save()
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.5
      ctx.setLineDash([7, 7])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(ex, plotT)
      ctx.lineTo(ex, plotB)
      ctx.stroke()
      ctx.restore()
    }
    if (b.lo < minHz || b.lo > maxHz) continue
    const bx = xFor(b.lo)
    const label = MODE_LABEL[b.name]
    ctx.font = '600 12px system-ui, sans-serif'
    const lw = ctx.measureText(label).width + 10
    const lx = Math.max(plotL, Math.min(bx - lw / 2, plotR - lw))
    ctx.fillStyle = hexA(color, 0.16)
    ctx.beginPath()
    ctx.roundRect(lx, plotT - 20, lw, 16, 4)
    ctx.fill()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(label, lx + lw / 2, plotT - 8)
    ctx.textAlign = 'left'
  }

  // Plot border.
  ctx.strokeStyle = th.border
  ctx.lineWidth = 1
  ctx.strokeRect(plotL, plotT, plotW, plotH)

  // Axis titles.
  ctx.fillStyle = th.axis
  ctx.font = '500 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Frequency (Hz)', (plotL + plotR) / 2, plotB + 34)
  ctx.save()
  ctx.translate(14, (plotT + plotB) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText('FFT Magnitude (dB)', 0, 0)
  ctx.restore()
  ctx.textAlign = 'left'

  // Curves (clipped to the plot).
  ctx.save()
  ctx.beginPath()
  ctx.rect(plotL, plotT, plotW, plotH)
  ctx.clip()
  const drawCurve = (freqs: number[], mags: number[], color: string) => {
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    let started = false
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i]!
      if (f < minHz) continue
      if (f > maxHz) break
      const x = xFor(f)
      const y = yFor(mags[i]!)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // Draw the primary (live/frozen) spectrum FIRST, then any overlays on top — matching Swift's
  // SpectrumView (primary line + materialSpectra together). Material capture paints the live base under
  // the captured-phase overlays; comparison/multi-tap pass spectrum=null so only overlays draw (EG-2).
  if (spectrum) drawCurve(spectrum.frequencies, spectrum.magnitudesDb, th.curve)
  for (const ov of overlays) drawCurve(ov.frequencies, ov.magnitudesDb, ov.color)

  // Peak dots.
  for (const m of markers) {
    if (m.frequency < minHz || m.frequency > maxHz) continue
    ctx.beginPath()
    ctx.arc(xFor(m.frequency), yFor(m.magnitude), m.annotated ? 4 : 3, 0, Math.PI * 2)
    ctx.fillStyle = m.color ?? '#8a96a5'
    ctx.fill()
  }
  ctx.restore()

  // Peak Min threshold line (guitar only) — a horizontal dashed green line at the Peak Min dB level,
  // mirroring Swift's thresholdLinesContent RuleMark (.green.opacity(0.7), width 1.5, dash [8,3],
  // "Peak: N dB" label top/trailing). Guitar-only (guitarType present) + within the visible dB range;
  // omitted for material/comparison (no guitarType) and for exports (peakMin not passed).
  const peakMin = opts.peakMin
  if (guitarType && overlays.length === 0 && peakMin != null && peakMin > minDb && peakMin < maxDb) {
    const y = yFor(peakMin)
    ctx.save()
    ctx.strokeStyle = 'rgba(52, 199, 89, 0.7)' // Swift .green.opacity(0.7) (systemGreen)
    ctx.lineWidth = 1.5
    ctx.setLineDash([8, 3])
    ctx.beginPath()
    ctx.moveTo(plotL, y)
    ctx.lineTo(plotR, y)
    ctx.stroke()
    ctx.restore()
    // "Peak: N dB" — green text on a light rounded background, at the top-right just above the line.
    const label = `Peak: ${Math.round(peakMin)} dB`
    ctx.font = '600 11px system-ui, sans-serif'
    const lw = ctx.measureText(label).width + 10
    const lx = plotR - lw - 4
    const ly = y - 18
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.beginPath()
    ctx.roundRect(lx, ly, lw, 15, 4)
    ctx.fill()
    ctx.fillStyle = 'rgb(52, 199, 89)'
    ctx.textAlign = 'center'
    ctx.fillText(label, lx + lw / 2, ly + 11)
    ctx.textAlign = 'left'
  }

  // Annotation badges (drawn after restore so they may overflow the plot slightly).
  for (const m of markers) {
    if (!m.annotated || m.frequency < minHz || m.frequency > maxHz) continue
    // Anchor = badge bottom-center. Default: just above the peak dot. Dragged: the stored
    // data-space position (so the label stays put under the peak through zoom/pan).
    const anchorX = m.annoOffset ? xFor(m.annoOffset[0]) : xFor(m.frequency)
    const anchorBottom = m.annoOffset ? yFor(m.annoOffset[1]) : yFor(m.magnitude) - 10
    const rect = drawBadge(ctx, m, xFor(m.frequency), yFor(m.magnitude), anchorX, anchorBottom, plotL, plotR, plotT, th, !!m.annoOffset)
    if (opts.badgeRectsOut && m.annoKey) opts.badgeRectsOut.push({ key: m.annoKey, ...rect })
  }

  // ── Crosshair (always-live pointer readout; mirrors Python fft_canvas._on_mouse_moved) ──
  const ch = opts.crosshair
  if (ch && ch.x >= plotL && ch.x <= plotR && ch.y >= plotT && ch.y <= plotB) {
    // Inverse of xFor/yFor.
    const hzAt = minHz + ((ch.x - plotL) / plotW) * (maxHz - minHz)
    let dispHz = hzAt
    let dispDb = minDb + ((plotB - ch.y) / plotH) * (maxDb - minDb)
    let freqColor = th.crosshairFreq

    if (overlays.length > 0) {
      // Always lock to the nearest overlay curve (vertically follows it), colored to it.
      // Mirrors Python: when comparing, the crosshair snaps to a curve at all times; the
      // 12 px "gravity" is only hysteresis for switching which curve (added later).
      let bestDy = Infinity
      for (const ov of overlays) {
        const fs = ov.frequencies
        const ms = ov.magnitudesDb
        if (!fs.length) continue
        const i = nearestIndex(fs, hzAt)
        const dy = Math.abs(ch.y - yFor(ms[i]!))
        if (dy < bestDy) {
          bestDy = dy
          dispHz = fs[i]!
          dispDb = ms[i]!
          freqColor = ov.color
        }
      }
    } else if (opts.frozen && spectrum && spectrum.frequencies.length) {
      // Snap to the nearest FFT bin of the frozen curve so the readout is an actual data value.
      const i = nearestIndex(spectrum.frequencies, hzAt)
      dispHz = spectrum.frequencies[i]!
      dispDb = spectrum.magnitudesDb[i]!
    }
    // else: live — free cursor tracking.

    const lx = xFor(dispHz)
    const ly = yFor(dispDb)
    ctx.save()
    ctx.strokeStyle = th.crosshairLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(lx, plotT)
    ctx.lineTo(lx, plotB)
    ctx.moveTo(plotL, ly)
    ctx.lineTo(plotR, ly)
    ctx.stroke()

    // Readout label: frequency (colored) over magnitude (gray), boxed, kept inside the plot.
    const freqStr = dispHz >= 1000 ? `${(dispHz / 1000).toFixed(2)} kHz` : `${dispHz.toFixed(1)} Hz`
    const dbStr = `${dispDb.toFixed(1)} dB`
    ctx.font = '600 12px system-ui, sans-serif'
    const tw = Math.max(ctx.measureText(freqStr).width, ctx.measureText(dbStr).width)
    const padX = 6
    const boxW = tw + padX * 2
    const boxH = 32
    let bx = lx + 10
    let by = ly + 10
    if (bx + boxW > plotR) bx = lx - 10 - boxW
    if (by + boxH > plotB) by = ly - 10 - boxH
    ctx.fillStyle = th.crosshairBg
    ctx.strokeStyle = th.crosshairLine
    ctx.beginPath()
    ctx.rect(bx, by, boxW, boxH)
    ctx.fill()
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillStyle = freqColor
    ctx.fillText(freqStr, bx + padX, by + 13)
    ctx.fillStyle = th.crosshairDb
    ctx.fillText(dbStr, bx + padX, by + 26)
    ctx.restore()
  }
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  m: PeakMarker,
  peakX: number,
  peakY: number,
  anchorX: number,
  anchorBottom: number,
  plotL: number,
  plotR: number,
  plotT: number,
  th: ChartTheme,
  dragged: boolean,
): { x: number; y: number; w: number; h: number } {
  const color = m.color ?? '#8a96a5'
  const PITCH = th === LIGHT_CHART ? '#9b51c2' : '#c389e8'
  const fg = th === LIGHT_CHART ? '#1a2330' : '#dfe4ea'
  const sub = th === LIGHT_CHART ? '#6b7785' : '#9aa6b3'
  const padX = 7
  const padY = 5
  const lineH = 14
  const lines: { text: string; color: string; font: string }[] = [
    { text: (m.label ?? '') + (m.isOverride ? ' ✎' : ''), color, font: `${m.isOverride ? 'italic ' : ''}bold 11px system-ui, sans-serif` },
  ]
  if (m.note) {
    const c = Math.round(m.cents ?? 0)
    lines.push({ text: `♪ ${m.note} ${c >= 0 ? '+' : ''}${c} ¢`, color: PITCH, font: '600 11px system-ui, sans-serif' })
  }
  lines.push({ text: fmtFreq(m.frequency), color: fg, font: '500 11px system-ui, sans-serif' })
  lines.push({ text: `${m.magnitude.toFixed(1)} dB`, color: sub, font: '11px system-ui, sans-serif' })

  let boxW = 0
  for (const ln of lines) {
    ctx.font = ln.font
    boxW = Math.max(boxW, ctx.measureText(ln.text).width)
  }
  boxW += padX * 2
  const boxH = lines.length * lineH + padY * 2
  const boxX = Math.max(plotL + 2, Math.min(anchorX - boxW / 2, plotR - boxW - 2))
  let boxBottom = anchorBottom
  let boxTop = boxBottom - boxH
  // Auto-placed badges nudge down if they'd clip the plot top; dragged badges keep the
  // user's exact position (the drag already constrains the anchor to the plot).
  if (!dragged && boxTop < plotT + 2) {
    boxTop = plotT + 2
    boxBottom = boxTop + boxH
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(peakX, peakY)
  ctx.lineTo(Math.max(boxX, Math.min(peakX, boxX + boxW)), boxBottom)
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(boxX, boxTop, boxW, boxH, 6)
  ctx.fillStyle = th.badgeBg
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
  ctx.textBaseline = 'alphabetic'
  return { x: boxX, y: boxTop, w: boxW, h: boxH }
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a})`
}