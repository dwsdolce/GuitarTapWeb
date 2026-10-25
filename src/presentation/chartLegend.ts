// @parity view/spectrum-chart tests=test/chart-legend
// The chart's legend for its overlaid curves — a comparison's measurements, a multi-tap measurement's taps, a
// plate's or brace's phases: each curve's line and its label in the curve's colour, on the readout background. It
// sits in the plot's upper-right corner, over everything in the plot, and wraps onto as many lines as it needs, each line
// right-aligned; the plot keeps its size. The screen and the exported image draw the same legend, each in its own
// sizes. Mirrors Swift ChartLegend and TrailingFlowLayout (Views/ChartLegend.swift).

export interface LegendEntry {
  color: string
  label: string
}

/** The legend's sizes, in points: the labels' font size, the line drawn before each label, the space between
 *  entries on a line and between lines, the padding inside the background, and its corner. */
export interface LegendSizes {
  fontSize: number
  swatch: { width: number; height: number }
  spacing: number
  lineSpacing: number
  padding: { top: number; leading: number; bottom: number; trailing: number }
  cornerRadius: number
}

/** The screen's legend (Swift's defaults: caption2). */
export const SCREEN_LEGEND: LegendSizes = {
  fontSize: 11,
  swatch: { width: 16, height: 2 },
  spacing: 12,
  lineSpacing: 4,
  padding: { top: 4, leading: 8, bottom: 4, trailing: 8 },
  cornerRadius: 6,
}

/** The exported image's legend (Swift's export sizes). */
export const EXPORT_LEGEND: LegendSizes = {
  fontSize: 14,
  swatch: { width: 22, height: 3 },
  spacing: 16,
  lineSpacing: 6,
  padding: { top: 6, leading: 10, bottom: 6, trailing: 10 },
  cornerRadius: 8,
}

/** The gap between an entry's line and its label (Swift's HStack(spacing: 4)). */
const SWATCH_GAP = 4

/** The views' indices in lines no wider than `width`; a view wider than `width` has a line of its own. Mirrors
 *  Swift TrailingFlowLayout.lines(_:width:). */
export function legendLines(widths: number[], width: number, spacing: number): number[][] {
  const lines: number[][] = []
  let current: number[] = []
  let lineWidth = 0
  widths.forEach((w, index) => {
    const needed = current.length === 0 ? w : lineWidth + spacing + w
    if (current.length > 0 && needed > width) {
      lines.push(current)
      current = [index]
      lineWidth = w
    } else {
      current.push(index)
      lineWidth = needed
    }
  })
  if (current.length > 0) lines.push(current)
  return lines
}

interface Size {
  width: number
  height: number
}

function lineSize(line: number[], sizes: Size[], spacing: number): Size {
  return {
    width: line.reduce((sum, i) => sum + sizes[i]!.width, 0) + spacing * Math.max(line.length - 1, 0),
    height: Math.max(0, ...line.map((i) => sizes[i]!.height)),
  }
}

/** Draws the legend for `entries` in the plot `plot`, its upper-right corner `inset` in from the plot's, its
 *  lines no wider than the plot less the insets — Swift's ChartLegend placed in the chart's overlay
 *  (ChartLegend.placed(in:inset:)), laid out by TrailingFlowLayout (sizeThatFits, then placeSubviews). */
export function drawChartLegend(
  ctx: CanvasRenderingContext2D,
  entries: LegendEntry[],
  plot: { l: number; t: number; r: number },
  inset: number,
  sizes: LegendSizes,
  background: string,
): void {
  if (entries.length === 0) return
  const { padding, spacing, lineSpacing, swatch } = sizes
  ctx.save()
  ctx.font = `${sizes.fontSize}px system-ui, sans-serif`
  const metrics = entries.map((e) => ctx.measureText(e.label))
  const textHeight = metrics[0]!.fontBoundingBoxAscent + metrics[0]!.fontBoundingBoxDescent
  const entrySizes: Size[] = metrics.map((m) => ({
    width: swatch.width + SWATCH_GAP + m.width,
    height: Math.max(swatch.height, textHeight),
  }))

  // sizeThatFits: the lines no wider than offered; the legend as wide as its widest line, inside its padding.
  const offered = plot.r - plot.l - 2 * inset - padding.leading - padding.trailing
  const lines = legendLines(entrySizes.map((s) => s.width), offered, spacing)
  const lineSizes = lines.map((line) => lineSize(line, entrySizes, spacing))
  const innerW = Math.max(0, ...lineSizes.map((s) => s.width))
  const innerH = lineSizes.reduce((sum, s) => sum + s.height, 0) + lineSpacing * Math.max(lineSizes.length - 1, 0)
  const width = innerW + padding.leading + padding.trailing
  const height = innerH + padding.top + padding.bottom
  const right = plot.r - inset
  const top = plot.t + inset

  ctx.fillStyle = background
  ctx.beginPath()
  ctx.roundRect(right - width, top, width, height, sizes.cornerRadius)
  ctx.fill()

  // placeSubviews: each line right-aligned, each entry centred on its line.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let y = top + padding.top
  lines.forEach((line, n) => {
    const size = lineSizes[n]!
    let x = right - padding.trailing - size.width
    for (const index of line) {
      const entry = entries[index]!
      const entryY = y + (size.height - entrySizes[index]!.height) / 2
      const mid = entryY + entrySizes[index]!.height / 2
      ctx.fillStyle = entry.color
      ctx.fillRect(x, mid - swatch.height / 2, swatch.width, swatch.height)
      ctx.fillText(entry.label, x + swatch.width + SWATCH_GAP,
        entryY + (entrySizes[index]!.height - textHeight) / 2 + metrics[index]!.fontBoundingBoxAscent)
      x += entrySizes[index]!.width + spacing
    }
    y += size.height + lineSpacing
  })
  ctx.restore()
}
