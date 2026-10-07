// @parity view/spectrum-export tests=test/spectrum-export
// Spectrum REPORT image — a white-background composite (header · chart · peak-summary · mode legend)
// matching Swift's ExportableSpectrumChart. The CHART itself is drawn by the SAME `renderSpectrum`
// the on-screen view uses (light theme here), so the displayed graph and the exported image can't
// drift. Rendered once and reused by BOTH the PNG export and the PDF embed (Swift's note on
// renderSpectrumImageForMeasurement: "used by both ... so both outputs are always consistent").

import type { Spectrum } from '../dsp/guitarFFT'
import type { PeakMarker, SpectrumOverlay, ChartView } from './chartTypes'
import { renderSpectrum, chartTheme, overlayColor, hexA, type ChartTheme } from './spectrumRender'
import { EXPORT } from './chartStyle'
import { type GuitarTypeName } from '../dsp/guitarModes'
import { MODE_DISPLAY_NAME } from './modeColors'
import { color as roleColor, modeRole } from './palette'
import { withPixelsPerInch } from './pngPixelsPerInch'
import { saveFile } from '../saveFile'
import { FieldPrecision } from '../precision'

export interface SpectrumImageOpts {
  /** Chart title (e.g. "FFT Peaks — Contreras Classical"). */
  title: string
  spectrum: Spectrum | null
  overlays?: SpectrumOverlay[]
  markers?: PeakMarker[]
  view: ChartView
  measurementTypeName?: string
  guitarType?: GuitarTypeName
  date?: string
}

/** Pixels per point, as Swift's ImageRenderer(scale: 2.0). */
const PIXEL_SCALE = 2

const FONT = (s: number, w = '') => `${w ? w + ' ' : ''}${s}px system-ui, sans-serif`
const th: ChartTheme = chartTheme('light')

/**
 * The peaks a report is ABOUT — its header count, its Detected Peaks Summary, and its chart dots
 * must all agree on this one set: the markers that carry a badge. The live export builds its markers
 * from the analyzer's `visiblePeaks` (Swift `TapToneAnalyzer.visiblePeaks` / Python `visible_peaks`,
 * all of them, not only those in the chart's range); a saved measurement's from its own annotation
 * mode and selection, as Swift's saved-measurement export does.
 *
 * Regression guard: the header and summary once used ALL detected peaks ("Detected Peaks: 47"
 * against Swift's 6), and later only the peaks in the chart's range. Pinned by
 * `test/annotation-state.test.ts`.
 */
export function reportPeaks(markers: PeakMarker[]): PeakMarker[] {
  return markers.filter((m) => m.annotated)
}

/** Render the full white report image to an off-screen canvas (PNG export + PDF embed). */
export function renderSpectrumToCanvas(opts: SpectrumImageOpts): HTMLCanvasElement {
  // A fixed size, whatever the on-screen chart's: Swift renders its export at 1464 × 1069 pt (a
  // 1400 × 800 chart frame with its header and legend), 119 pt taller with the peak summary. The
  // bands below add up to the same, so the PNG and the PDF's embedded image have Swift's proportions.
  const W = 1464
  const PAD = 28
  // Swift's content edge: the clear 16 pt margin (.padding() outside .background) plus its 16 pt
  // .padding() — and so the 1400 pt chart frame.
  const EDGE = 32
  const MARGIN = 16
  const { minHz, maxHz, minDb, maxDb } = opts.view
  const overlays = opts.overlays ?? []
  const markers = opts.markers ?? []
  const visible = reportPeaks(markers)

  const headerH = 116
  const chartH = 853 // renderSpectrum lays out title + plot + axis titles within this
  const summaryH = visible.length ? 119 : 0
  const legendH = 44
  const H = PAD + headerH + chartH + summaryH + legendH + PAD

  // Drawn at 2x, as Swift's ImageRenderer(scale: 2.0): the canvas holds 2928 × 2376 pixels (2138 without
  // the summary) for the layout below in points.
  const canvas = document.createElement('canvas')
  canvas.width = W * PIXEL_SCALE
  canvas.height = H * PIXEL_SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(PIXEL_SCALE, PIXEL_SCALE)
  // The content on chart.background inside a clear margin — Swift's .background(chart.background)
  // .padding() leaves its padding transparent.
  ctx.fillStyle = th.bg
  ctx.fillRect(MARGIN, MARGIN, W - 2 * MARGIN, H - 2 * MARGIN)
  ctx.textBaseline = 'alphabetic'

  let y = PAD

  // ── Header ───────────────────────────────────────────────────────────────
  ctx.fillStyle = th.title
  ctx.font = FONT(26, 'bold')
  ctx.fillText('Guitar Tap Tone Analysis - Frequency Response', EDGE, y + 26)
  ctx.font = FONT(14)
  ctx.fillStyle = th.axis
  ctx.fillText(`Date: ${opts.date ?? ''}`, EDGE, y + 52)
  // Range and the dB span semibold in the text colour, the bullet secondary — right-aligned.
  const rangeRuns: [string, string, string][] = [
    [`Range: ${fmt(minHz)} - ${fmt(maxHz)}`, FONT(14, '600'), th.title],
    ['•', FONT(14), th.axis],
    [`${Math.round(minDb)} to ${Math.round(maxDb)} dB`, FONT(14, '600'), th.title],
  ]
  ctx.textAlign = 'right'
  let rx = W - EDGE
  for (const [text, font, color] of [...rangeRuns].reverse()) {
    ctx.font = font
    ctx.fillStyle = color
    ctx.fillText(text, rx, y + 52)
    rx -= ctx.measureText(text).width + 8
  }
  ctx.textAlign = 'left'
  // Swift: HStack(spacing: 16) { Type: value • Platform: value • GuitarTap vX.Y (build) } — each label
  // secondary, each value medium in the text colour.
  const metaItems: [string, string][] = [
    ...(opts.measurementTypeName ? [['Type:', opts.measurementTypeName] as [string, string]] : []),
    ['Platform:', 'Web'],
    ['GuitarTap', `v${__APP_VERSION__} (${__APP_BUILD__})`],
  ]
  let mx = EDGE
  metaItems.forEach(([label, value], n) => {
    const runs: [string, string, string, number][] = [
      ...(n ? [['•', FONT(14), th.axis, 16] as [string, string, string, number]] : []),
      [label, FONT(14), th.axis, 4],
      [value, FONT(14, '500'), th.title, 16],
    ]
    for (const [text, font, color, gap] of runs) {
      ctx.font = font
      ctx.fillStyle = color
      ctx.fillText(text, mx, y + 76)
      mx += ctx.measureText(text).width + gap
    }
  })
  ctx.fillStyle = th.axis
  ctx.font = FONT(14)
  // Subtitle — mirrors Swift ExportableSpectrumChart.swift:582-589:
  //     if !materialSpectra.isEmpty { "Comparing N measurements" }
  //     else if !peaks.isEmpty      { "Detected Peaks: N" }
  // `overlays` is the web's materialSpectra (same mapping the legend below uses). "Detected Peaks: N"
  // is CORRECT for guitar — it was only wrong for material, where the web showed it unconditionally.
  if (overlays.length) ctx.fillText(`Comparing ${overlays.length} measurements`, EDGE, y + 98)
  else if (visible.length) ctx.fillText(`Detected Peaks: ${visible.length}`, EDGE, y + 98)
  y += headerH

  // ── Chart (drawn by the SHARED renderer, light theme) ─────────────────────
  ctx.save()
  ctx.translate(EDGE, y)
  renderSpectrum(ctx, W - 2 * EDGE, chartH, {
    spectrum: opts.spectrum,
    markers: visible,
    overlays,
    view: opts.view,
    title: opts.title,
    guitarType: opts.guitarType,
    theme: th,
    style: EXPORT,
    variant: 'export',
  })
  ctx.restore()
  y += chartH

  // ── Detected Peaks Summary ────────────────────────────────────────────────
  if (visible.length) {
    ctx.fillStyle = th.title
    ctx.font = FONT(16, 'bold')
    ctx.fillText('Detected Peaks Summary', EDGE, y + 18)
    // Every visible peak, in frequency order — including ones outside the plotted range
    // (Swift lists all selected peaks, e.g. 409/622/994 Hz under a 75–350 Hz view). Bounded by
    // WIDTH, not by an arbitrary count: the old `.slice(0, 8)` silently dropped peaks even in the
    // normal selected case. The row doesn't wrap, so stop when the next chip won't fit.
    const chips = [...visible].sort((a, b) => a.frequency - b.frequency)
    let cx = EDGE
    const cy = y + 32
    for (const m of chips) {
      const color = m.role ? roleColor(m.role, undefined, 'light') : (m.color ?? roleColor('mode.unknown', undefined, 'light'))
      // Override-aware, matching the callout and the results list: an overridden mode chip is italic
      // with a trailing " *" (m.label + m.color are already override-aware from buildGuitarMarkers).
      const modeText = (m.label ?? '') + (m.isOverride ? ' *' : '')
      const modeFont = FONT(12, m.isOverride ? 'italic' : '')
      const lines = [`${FieldPrecision.string(m.frequency, FieldPrecision.peakFrequencyHz)} Hz`, modeText, `${FieldPrecision.string(m.magnitude, FieldPrecision.peakMagnitudeDB)} dB`]
      ctx.font = FONT(13, 'bold')
      let cw = ctx.measureText(lines[0]!).width
      ctx.font = modeFont
      cw = Math.max(cw, ctx.measureText(lines[1]!).width, ctx.measureText(lines[2]!).width) + 20
      if (cx + cw > W - EDGE) break
      ctx.fillStyle = hexA(color, 0.1)
      ctx.beginPath()
      ctx.roundRect(cx, cy, cw, 56, 6)
      ctx.fill()
      ctx.textAlign = 'center'
      ctx.fillStyle = th.title
      ctx.font = FONT(13, 'bold')
      ctx.fillText(lines[0]!, cx + cw / 2, cy + 18)
      ctx.fillStyle = color
      ctx.font = modeFont
      ctx.fillText(lines[1]!, cx + cw / 2, cy + 34)
      ctx.fillStyle = th.axis
      ctx.fillText(lines[2]!, cx + cw / 2, cy + 50)
      ctx.textAlign = 'left'
      cx += cw + 14
      if (cx > W - EDGE - 80) break
    }
    y += summaryH
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  ctx.fillStyle = th.title
  ctx.font = FONT(13, '600')
  const ly = y + 22
  // Swift: material → "Measurements:", guitar → "Guitar Modes:"
  // (ExportableSpectrumChart.swift:650-671). The web said "Series:" for the material case.
  const legendTitle = overlays.length ? 'Measurements:' : 'Guitar Modes:'
  ctx.fillText(legendTitle, EDGE, ly + 4)
  let lx = EDGE + ctx.measureText(legendTitle).width + 18
  ctx.font = FONT(13)
  const legendItems = overlays.length
    ? overlays.map((o) => ({ color: overlayColor(o, th), label: o.label }))
    : (['air', 'top', 'back', 'dipole', 'ring'] as const).map((k) => ({
        color: roleColor(modeRole(k), undefined, 'light'),
        label: MODE_DISPLAY_NAME[k],
      }))
  for (const it of legendItems) {
    ctx.fillStyle = it.color
    ctx.beginPath()
    ctx.arc(lx + 6, ly, 6, 0, Math.PI * 2)
    ctx.fill()
    lx += 16
    ctx.fillStyle = th.title
    ctx.fillText(it.label, lx, ly + 4)
    lx += ctx.measureText(it.label).width + 22
  }

  return canvas
}

/** Frequency for the CHART's "Range:" line — mirrors Swift's local `formatFreq` closure
 *  (`ExportableSpectrumChart.swift:510`):
 *
 *      freq >= 1000 ? String(format: "%.1fk Hz", freq / 1000) : String(format: "%.0f Hz", freq)
 *
 *  ⚠ Zero decimals here, and note the unusual `"1.5k Hz"` kHz form (the `k` binds to the number, with
 *  the space before `Hz`) — that is Swift's, odd-looking but canonical. This is NOT the same formatter
 *  as the PDF metadata row's (`formattedAsFrequency`, one decimal, "1.5 kHz"). Swift keeps two on
 *  purpose; the web had their rounding swapped. */
function fmt(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k Hz` : `${hz.toFixed(0)} Hz`
}

/** The spectrum report image as a PNG file, as Swift's export writes it: 2x pixels stating 144 pixels per
 *  inch, so a viewer that honours the figure shows it at its point size. */
export async function spectrumPng(opts: SpectrumImageOpts): Promise<Uint8Array<ArrayBuffer> | null> {
  const canvas = renderSpectrumToCanvas(opts)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return withPixelsPerInch(new Uint8Array(await blob.arrayBuffer()), 72 * PIXEL_SCALE)
}

/** Save the composed spectrum report image as a PNG (Chromium "Save As…" dialog / download fallback). */
export async function exportSpectrumPng(opts: SpectrumImageOpts, filename: string): Promise<void> {
  const png = await spectrumPng(opts)
  if (!png) return
  await saveFile(new Blob([png], { type: 'image/png' }), filename, { description: 'PNG image', mime: 'image/png', ext: '.png' })
}