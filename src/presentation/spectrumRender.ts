// Canvas renderer for the spectrum chart — the single source of truth shared by the on-screen
// SpectrumChart (dark theme) and the PNG/PDF export (light theme), so the two CANNOT drift. Draws a
// centered title, gridlines + tick labels OUTSIDE a bordered plot, axis titles, mode-boundary dashed
// lines + top labels (guitar), the spectrum curve(s), peak dots and annotation badges. Mirrors
// Swift's ExportableSpectrumChart / live SpectrumView layout.

import { drawnIndices } from './displayRange'
import type { Spectrum } from '../dsp/guitarFFT'
import { modeBands, type GuitarTypeName } from '../dsp/guitarModes'
import { MODE_LABEL } from './modeColors'
import { color as roleColor, modeRole, type Role } from './palette'
import type { Scheme } from './appearance'
import type { PeakMarker, SpectrumOverlay, ChartView, AnnotationRect, DotHit } from './chartTypes'
import { formattedAsFrequency } from './frequencyFormat'
import { FieldPrecision } from '../precision'
import { SCREEN, EXPORT, diameter, type ChartLines } from './chartStyle'
import { formatTickLabel, formatTickLabels, generateTicks, magnitudeStride } from './axisTicks'

/** Fill a `points`-pointed star centred at (cx, cy) between `outerR` and `innerR`. Used for the
 *  highlighted peak dot (mirrors Swift's `star.fill`). */
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  points: number,
  outerR: number,
  innerR: number,
  color: string,
): void {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const a = (Math.PI / points) * i - Math.PI / 2 // first point up
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

export interface ChartTheme {
  scheme: Scheme // the scheme its colours are from
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
/** The chart's colours in `scheme`, from the palette's chart roles. */
export function chartTheme(scheme: Scheme): ChartTheme {
  const c = (role: Role) => roleColor(role, undefined, scheme)
  return {
    scheme,
    bg: c('chart.background'),
    grid: c('chart.grid'),
    border: c('chart.border'),
    axis: c('chart.axis'),
    title: c('chart.title'),
    curve: c('chart.spectrum'),
    badgeBg: c('chart.readout.background'),
    crosshairLine: c('chart.crosshair.line'),
    crosshairFreq: c('chart.crosshair.frequency'),
    crosshairDb: c('chart.axis'),
    crosshairBg: c('chart.readout.background'),
  }
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
  /** Line and point styles: the screen's (default) or the exported image's. */
  style?: ChartLines
  /** When provided, the renderer pushes each drawn (keyed) badge's screen rect here for hit-testing. */
  badgeRectsOut?: AnnotationRect[]
  /** When provided, the renderer pushes each drawn dot's screen centre+radius+id here, so a click can
   *  hit-test back to a peak (the dot ↔ results-row highlight). Live chart only. */
  dotRectsOut?: DotHit[]
  /** The highlighted peak id (dot ↔ results-row cross-highlight) — its dot renders as a red star
   *  (mirrors Swift's macOS highlighted `star.fill`). Live chart only; omit for exports. */
  highlightedPeakId?: string | null
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
  const th = opts.theme ?? chartTheme('dark')
  const style = opts.style ?? SCREEN
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
  // One grid line per axis tick, no minor lines — Swift's ticks (AxisTickGenerator).
  ctx.strokeStyle = th.grid
  ctx.fillStyle = th.axis
  ctx.lineWidth = style.gridWidth
  ctx.font = '11px system-ui, sans-serif'
  const dbStep = style.magnitudeStride ?? magnitudeStride(maxDb - minDb)
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
  const ticks = generateTicks(minHz, maxHz, 8).filter((hz) => hz >= minHz && hz <= maxHz)
  const screenLabels = formatTickLabels(ticks)
  const tickLabel = (hz: number) => (style === EXPORT ? formatTickLabel(hz) : screenLabels.get(hz)!)
  for (const hz of ticks) {
    const x = xFor(hz)
    ctx.strokeStyle = th.grid
    ctx.beginPath()
    ctx.moveTo(x, plotT)
    ctx.lineTo(x, plotB)
    ctx.stroke()
    ctx.fillStyle = th.axis
    ctx.fillText(tickLabel(hz), x, plotB + 16)
  }
  ctx.textAlign = 'left'

  // Mode-boundary dashed lines + top labels (guitar). TWO lines per mode — the lower (lo) and upper
  // (hi) bound of its frequency range — with the abbreviation label at the lower bound (range start).
  for (const b of bands) {
    const color = roleColor(modeRole(b.name), undefined, th.scheme)
    for (const edge of [b.lo, b.hi]) {
      if (edge < minHz || edge > maxHz) continue
      const ex = xFor(edge)
      ctx.save()
      ctx.strokeStyle = color
      ctx.globalAlpha = style.modeBoundaryOpacity
      ctx.setLineDash(style.modeBoundaryDash)
      ctx.lineWidth = style.modeBoundaryWidth
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
  const drawCurve = (freqs: number[], mags: number[], color: string, width: number) => {
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    let started = false
    // The points inside the range and the one beyond each edge; the clip cuts the crossing segments.
    const [lo, hi] = drawnIndices(freqs, minHz, maxHz)
    for (let i = lo; i < hi; i++) {
      const f = freqs[i]!
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
  // the captured-phase overlays; comparison/multi-tap pass spectrum=null so only overlays draw.
  if (spectrum) drawCurve(spectrum.frequencies, spectrum.magnitudesDb, th.curve, style.spectrumWidth)
  for (const ov of overlays) drawCurve(ov.frequencies, ov.magnitudesDb, overlayColor(ov, th), style.overlayWidth)

  // Peak dots — Layer 1: EVERY in-range peak gets a dot, independent of annotation mode,
  // mirroring Swift's `allPeaksInRange` (SpectrumView+ChartContent peakAnnotationContent Layer 1).
  // The marker SET already encodes which peaks belong: guitar markers are display-range +
  // unknown-mode filtered upstream; material markers are ONLY the fL/fC/fLC peaks. So this loop
  // must NOT re-gate on `annotated` — annotation-mode filtering is the badge layer's job (Layer 2).
  // Peaks below the visible dB floor are omitted (Swift `.filter { $0.magnitude >= minDB }`).
  for (const m of markers) {
    if (m.frequency < minHz || m.frequency > maxHz || m.magnitude < minDb) continue
    const cx = xFor(m.frequency)
    const cy = yFor(m.magnitude)
    if (m.id != null && m.id === opts.highlightedPeakId) {
      // The highlighted peak renders as a red star, enlarged (Swift's macOS highlighted `star.fill`,
      // symbolSize 120 vs the normal circle's 40).
      const starR = diameter(style.highlightedDotArea) / 2
      drawStar(ctx, cx, cy, 5, starR, starR * 0.44, roleColor('chart.highlightedPeak', undefined, th.scheme))
    } else {
      ctx.beginPath()
      ctx.arc(cx, cy, diameter(style.dotArea) / 2, 0, Math.PI * 2)
      ctx.fillStyle = markerColor(m, th)
      ctx.fill()
    }
    // Hit radius 30 (CSS px) matches Swift's nearestPeak hitRadius — a forgiving click target; the
    // nearest dot within it wins (hitDot in SpectrumChart).
    if (opts.dotRectsOut && m.id != null) opts.dotRectsOut.push({ id: m.id, x: cx, y: cy, r: 30 })
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
    ctx.strokeStyle = hexA(roleColor('chart.peakMin', undefined, th.scheme), style.peakMinOpacity)
    ctx.lineWidth = style.peakMinWidth
    ctx.setLineDash(style.peakMinDash)
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
    ctx.fillStyle = th.badgeBg
    ctx.beginPath()
    ctx.roundRect(lx, ly, lw, 15, 4)
    ctx.fill()
    ctx.fillStyle = roleColor('chart.peakMin', undefined, th.scheme)
    ctx.textAlign = 'center'
    ctx.fillText(label, lx + lw / 2, ly + 11)
    ctx.textAlign = 'left'
  }

  // Annotation badges — Layer 2: only annotation-visible peaks, mirroring Swift's `visiblePeaks`
  // (annotationVisibilityMode + selectedPeakIDs). Drawn after restore so they may overflow the plot
  // slightly. Same visible-dB-floor omission as the dot layer.
  for (const m of markers) {
    if (!m.annotated || m.frequency < minHz || m.frequency > maxHz || m.magnitude < minDb) continue
    // Anchor = badge bottom-center. Default: just above the peak dot. Dragged: the stored
    // data-space position (so the label stays put under the peak through zoom/pan).
    const anchorX = m.annoOffset ? xFor(m.annoOffset[0]) : xFor(m.frequency)
    const anchorBottom = m.annoOffset ? yFor(m.annoOffset[1]) : yFor(m.magnitude) - 10
    const rect = drawBadge(ctx, m, xFor(m.frequency), yFor(m.magnitude), anchorX, anchorBottom, plotL, plotR, plotT, th, style, !!m.annoOffset)
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
          freqColor = overlayColor(ov, th)
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
    ctx.lineWidth = style.crosshairWidth
    ctx.setLineDash(style.crosshairDash)
    ctx.beginPath()
    ctx.moveTo(lx, plotT)
    ctx.lineTo(lx, plotB)
    ctx.moveTo(plotL, ly)
    ctx.lineTo(plotR, ly)
    ctx.stroke()

    // Readout label: frequency (colored) over magnitude (gray), boxed, kept inside the plot.
    const freqStr = formattedAsFrequency(dispHz)
    const dbStr = `${FieldPrecision.string(dispDb, FieldPrecision.peakMagnitudeDB)} dB`
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
    ctx.setLineDash([])
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
  style: ChartLines,
  dragged: boolean,
): { x: number; y: number; w: number; h: number } {
  const color = markerColor(m, th)
  const PITCH = roleColor('peak.pitch', undefined, th.scheme)
  const fg = th.title
  const sub = th.axis
  const padX = 7
  const padY = 5
  const lineH = 14
  const lines: { text: string; color: string; font: string }[] = [
    { text: (m.label ?? '') + (m.isOverride ? ' *' : ''), color, font: `${m.isOverride ? 'italic ' : ''}bold 11px system-ui, sans-serif` },
  ]
  if (m.note) {
    const c = Math.round(m.cents ?? 0)
    lines.push({ text: `♪ ${m.note} ${c >= 0 ? '+' : ''}${c} ¢`, color: PITCH, font: '600 11px system-ui, sans-serif' })
  }
  lines.push({ text: formattedAsFrequency(m.frequency), color: fg, font: '500 11px system-ui, sans-serif' })
  lines.push({ text: `${FieldPrecision.string(m.magnitude, FieldPrecision.peakMagnitudeDB)} dB`, color: sub, font: '11px system-ui, sans-serif' })

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
  ctx.save()
  ctx.strokeStyle = hexA(color, style.leaderOpacity)
  ctx.lineWidth = style.leaderWidth
  ctx.setLineDash(style.leaderDash)
  ctx.beginPath()
  ctx.moveTo(peakX, peakY)
  ctx.lineTo(Math.max(boxX, Math.min(peakX, boxX + boxW)), boxBottom)
  ctx.stroke()
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(boxX, boxTop, boxW, boxH, 6)
  ctx.fillStyle = th.badgeBg
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = style.labelBorderWidth
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

/** An overlay curve's colour: its role in the chart's scheme, else its fixed colour. */
export function overlayColor(ov: SpectrumOverlay, th: ChartTheme): string {
  return ov.role ? roleColor(ov.role, undefined, th.scheme) : (ov.color ?? th.curve)
}

/** A marker's dot colour: its role in the chart's scheme, else its fixed colour, else gray. */
function markerColor(m: PeakMarker, th: ChartTheme): string {
  return m.role ? roleColor(m.role, undefined, th.scheme) : (m.color ?? roleColor('mode.unknown', undefined, th.scheme))
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a})`
}