// Canvas renderer for the spectrum plot — the single source of truth shared by the on-screen
// SpectrumChart and the PNG/PDF export. Draws background, axes + gridlines, the spectrum curve,
// colored overlay curves, peak dots, and annotation badges into a (W × H) region using local
// coordinates (the caller sets up dpr/translate). Mirrors Swift's ExportableSpectrumChart so a
// saved/exported image looks like the live chart.

import type { Spectrum } from '../dsp/guitarFFT'
import type { PeakMarker, SpectrumOverlay, ChartView } from './SpectrumChart'

// Axis gutters (label strips) = the x-axis / y-axis hit-zones.
export const LEFT_GUTTER = 38 // px — magnitude (y) axis
export const BOTTOM_GUTTER = 16 // px — frequency (x) axis

const FREQ_TICKS_LOG = [30, 50, 100, 200, 300, 500, 1000, 2000]

/** Frequency label like Swift's formattedAsFrequency (Hz under 1 kHz, else kHz). */
export function fmtFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`
}

function niceLinearTicks(minHz: number, maxHz: number): number[] {
  const span = Math.max(1, maxHz - minHz)
  const raw = span / 8
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let t = Math.ceil(minHz / step) * step; t <= maxHz; t += step) out.push(t)
  return out
}

export interface RenderOpts {
  spectrum: Spectrum | null
  markers?: PeakMarker[]
  overlays?: SpectrumOverlay[]
  view: ChartView
  logFreq?: boolean
}

/** Draw the spectrum plot into ctx over a W×H region (origin at 0,0). */
export function renderSpectrum(ctx: CanvasRenderingContext2D, W: number, H: number, opts: RenderOpts): void {
  const { spectrum, markers = [], overlays = [], logFreq = false } = opts
  const { minHz, maxHz, minDb, maxDb } = opts.view

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
  const ticks = logFreq ? FREQ_TICKS_LOG.filter((t) => t >= minHz && t <= maxHz) : niceLinearTicks(minHz, maxHz)
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

  // Colored overlay curves (material per-phase L/C/FLC; comparison curves).
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
}