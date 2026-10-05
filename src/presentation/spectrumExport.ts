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
 * must all agree on this one set.
 *
 * Mirrors Swift `TapToneAnalyzer.visiblePeaks` / Python `visible_peaks`: the `annotated` flag on each
 * marker already encodes that rule (all → every peak, selected → selectedPeakIDs only, none → nothing),
 * so honouring it here is what keeps the web report identical to the native ones.
 *
 * Regression guard: the header and summary used to use ALL detected peaks — a 3-app capture of one tap
 * reported "Detected Peaks: 47" against Swift's 6, and summarised the lowest-frequency peaks instead of
 * the selected ones (dropping selected peaks above the visible range). Pinned by
 * `test/annotation-state.test.ts` (the web side of that group, previously absent — which is why this
 * shipped while Swift/Python, which both test the rule, were correct).
 *
 * NOTE: the rule itself is untagged on every platform — Swift `visiblePeaks` and Python `visible_peaks`
 * carry no `@parity` slug, and the web re-derives it here rather than owning it on the analyzer. Giving
 * it a real 3-way `state/` slug belongs with the view-layer restructure.
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
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  let y = PAD

  // ── Header ───────────────────────────────────────────────────────────────
  ctx.fillStyle = th.title
  ctx.font = FONT(26, 'bold')
  ctx.fillText('Guitar Tap Tone Analysis - Frequency Response', PAD, y + 26)
  ctx.font = FONT(14)
  ctx.fillStyle = th.axis
  ctx.fillText(`Date: ${opts.date ?? ''}`, PAD, y + 52)
  ctx.textAlign = 'right'
  ctx.fillStyle = th.title
  ctx.font = FONT(14, '600')
  ctx.fillText(
    `Range: ${fmt(minHz)} - ${fmt(maxHz)}   •   ${Math.round(minDb)} to ${Math.round(maxDb)} dB`,
    W - PAD,
    y + 52,
  )
  ctx.textAlign = 'left'
  ctx.fillStyle = th.axis
  ctx.font = FONT(14)
  const meta = [opts.measurementTypeName ? `Type: ${opts.measurementTypeName}` : '', 'Platform: Web'].filter(Boolean)
  ctx.fillText(meta.join('   •   '), PAD, y + 76)
  // Subtitle — mirrors Swift ExportableSpectrumChart.swift:582-589:
  //     if !materialSpectra.isEmpty { "Comparing N measurements" }
  //     else if !peaks.isEmpty      { "Detected Peaks: N" }
  // `overlays` is the web's materialSpectra (same mapping the legend below uses). "Detected Peaks: N"
  // is CORRECT for guitar — it was only wrong for material, where the web showed it unconditionally.
  if (overlays.length) ctx.fillText(`Comparing ${overlays.length} measurements`, PAD, y + 98)
  else if (visible.length) ctx.fillText(`Detected Peaks: ${visible.length}`, PAD, y + 98)
  y += headerH

  // ── Chart (drawn by the SHARED renderer, light theme) ─────────────────────
  ctx.save()
  ctx.translate(PAD, y)
  renderSpectrum(ctx, W - 2 * PAD, chartH, {
    spectrum: opts.spectrum,
    markers,
    overlays,
    view: opts.view,
    title: opts.title,
    guitarType: opts.guitarType,
    theme: th,
    style: EXPORT,
  })
  ctx.restore()
  y += chartH

  // ── Detected Peaks Summary ────────────────────────────────────────────────
  if (visible.length) {
    ctx.fillStyle = th.title
    ctx.font = FONT(16, 'bold')
    ctx.fillText('Detected Peaks Summary', PAD, y + 18)
    // Every visible peak, in frequency order — including ones outside the plotted range
    // (Swift lists all selected peaks, e.g. 409/622/994 Hz under a 75–350 Hz view). Bounded by
    // WIDTH, not by an arbitrary count: the old `.slice(0, 8)` silently dropped peaks even in the
    // normal selected case. The row doesn't wrap, so stop when the next chip won't fit.
    const chips = [...visible].sort((a, b) => a.frequency - b.frequency)
    let cx = PAD
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
      if (cx + cw > W - PAD) break
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
      if (cx > W - PAD - 80) break
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
  ctx.fillText(legendTitle, PAD, ly + 4)
  let lx = PAD + ctx.measureText(legendTitle).width + 18
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