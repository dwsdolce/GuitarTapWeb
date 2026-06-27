// Spectrum image export — composes the shared plot renderer with a title strip + legend onto an
// off-screen canvas. `renderSpectrumToCanvas` is reused by the PDF report (it embeds the same PNG),
// mirroring Swift, where the PDF generator renders ExportableSpectrumChart to PNG and lays it out.

import { renderSpectrum, type RenderOpts } from './spectrumRender'

export interface SpectrumImageOpts extends RenderOpts {
  /** Title drawn top-left, e.g. "FFT Peaks — Contreras". Omit for no title strip. */
  title?: string
  /** Pixel width of the exported image (default 1600). Height is derived (~2:1 chart + chrome). */
  width?: number
}

const TITLE_H = 44
const LEGEND_H = 30

/** Render title + spectrum + legend to an off-screen canvas (used by PNG export AND the PDF). */
export function renderSpectrumToCanvas(opts: SpectrumImageOpts): HTMLCanvasElement {
  const W = opts.width ?? 1600
  const overlays = opts.overlays ?? []
  const titleH = opts.title ? TITLE_H : 0
  const legendH = overlays.length ? LEGEND_H : 0
  const chartH = Math.round(W * 0.5)
  const H = titleH + chartH + legendH

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#0e1116'
  ctx.fillRect(0, 0, W, H)

  if (opts.title) {
    ctx.fillStyle = '#dfe4ea'
    ctx.font = 'bold 18px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText(opts.title, 16, titleH / 2)
    ctx.textBaseline = 'alphabetic'
  }

  ctx.save()
  ctx.translate(0, titleH)
  renderSpectrum(ctx, W, chartH, opts)
  ctx.restore()

  if (overlays.length) {
    let x = 16
    const y = titleH + chartH + legendH / 2
    ctx.textBaseline = 'middle'
    ctx.font = '13px system-ui, sans-serif'
    for (const ov of overlays) {
      ctx.fillStyle = ov.color
      ctx.fillRect(x, y - 6, 14, 12)
      x += 20
      ctx.fillStyle = '#9aa6b3'
      ctx.fillText(ov.label, x, y)
      x += ctx.measureText(ov.label).width + 22
    }
    ctx.textBaseline = 'alphabetic'
  }
  return canvas
}

/** Trigger a PNG download of the composed spectrum image. */
export async function exportSpectrumPng(opts: SpectrumImageOpts, filename: string): Promise<void> {
  const canvas = renderSpectrumToCanvas(opts)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}