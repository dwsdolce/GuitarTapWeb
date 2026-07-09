// Spectrum REPORT image — a white-background composite (header · chart · peak-summary · mode legend)
// matching Swift's ExportableSpectrumChart. The CHART itself is drawn by the SAME `renderSpectrum`
// the on-screen view uses (light theme here), so the displayed graph and the exported image can't
// drift. Rendered once and reused by BOTH the PNG export and the PDF embed (Swift's note on
// renderSpectrumImageForMeasurement: "used by both ... so both outputs are always consistent").

import type { Spectrum } from '../dsp/guitarFFT'
import type { PeakMarker, SpectrumOverlay, ChartView } from './chartTypes'
import { renderSpectrum, LIGHT_CHART, hexA, type ChartTheme } from './spectrumRender'
import { type GuitarTypeName } from '../dsp/guitarModes'
import { MODE_COLOR, MODE_DISPLAY_NAME } from './modeColors'
import { saveFile } from '../saveFile'

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
  width?: number
  /** Plot height (px) inside the composite. Default 660 (full-size PNG). The PDF passes a smaller
   *  value so the embedded image is shorter — fixed Letter pages have less vertical room than
   *  Swift's auto-grown page, so the report stays compact enough to keep the analysis on page 1. */
  chartHeight?: number
}

const FONT = (s: number, w = '') => `${w ? w + ' ' : ''}${s}px system-ui, sans-serif`
const th: ChartTheme = LIGHT_CHART

/** Render the full white report image to an off-screen canvas (PNG export + PDF embed). */
export function renderSpectrumToCanvas(opts: SpectrumImageOpts): HTMLCanvasElement {
  const W = opts.width ?? 1480
  const PAD = 28
  const { minHz, maxHz, minDb, maxDb } = opts.view
  const overlays = opts.overlays ?? []
  const markers = opts.markers ?? []

  const headerH = 116
  const chartH = opts.chartHeight ?? 660 // renderSpectrum lays out title + plot + axis titles within this
  const summaryH = markers.length ? 110 : 0
  const legendH = 44
  const H = PAD + headerH + chartH + summaryH + legendH + PAD

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
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
  if (markers.length) ctx.fillText(`Detected Peaks: ${markers.length}`, PAD, y + 98)
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
  })
  ctx.restore()
  y += chartH

  // ── Detected Peaks Summary ────────────────────────────────────────────────
  if (markers.length) {
    ctx.fillStyle = th.title
    ctx.font = FONT(16, 'bold')
    ctx.fillText('Detected Peaks Summary', PAD, y + 18)
    const chips = [...markers].sort((a, b) => a.frequency - b.frequency).slice(0, 8)
    let cx = PAD
    const cy = y + 32
    for (const m of chips) {
      const color = m.color ?? MODE_COLOR.unknown
      const lines = [`${m.frequency.toFixed(1)} Hz`, m.label ?? '', `${m.magnitude.toFixed(1)} dB`]
      ctx.font = FONT(13, 'bold')
      let cw = ctx.measureText(lines[0]!).width
      ctx.font = FONT(12)
      cw = Math.max(cw, ctx.measureText(lines[1]!).width, ctx.measureText(lines[2]!).width) + 20
      ctx.fillStyle = hexA(color, 0.1)
      ctx.beginPath()
      ctx.roundRect(cx, cy, cw, 56, 6)
      ctx.fill()
      ctx.textAlign = 'center'
      ctx.fillStyle = th.title
      ctx.font = FONT(13, 'bold')
      ctx.fillText(lines[0]!, cx + cw / 2, cy + 18)
      ctx.fillStyle = color
      ctx.font = FONT(12)
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
  const legendTitle = overlays.length ? 'Series:' : 'Guitar Modes:'
  ctx.fillText(legendTitle, PAD, ly + 4)
  let lx = PAD + ctx.measureText(legendTitle).width + 18
  ctx.font = FONT(13)
  const legendItems = overlays.length
    ? overlays.map((o) => ({ color: o.color, label: o.label }))
    : (['air', 'top', 'back', 'dipole', 'ring'] as const).map((k) => ({ color: MODE_COLOR[k], label: MODE_DISPLAY_NAME[k] }))
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

function fmt(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`
}

/** Save the composed spectrum report image as a PNG (Chromium "Save As…" dialog / download fallback). */
export async function exportSpectrumPng(opts: SpectrumImageOpts, filename: string): Promise<void> {
  const canvas = renderSpectrumToCanvas(opts)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  await saveFile(blob, filename, { description: 'PNG image', mime: 'image/png', ext: '.png' })
}