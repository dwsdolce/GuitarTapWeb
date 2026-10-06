// @parity view/pdf-report tests=test/pdf-report
// Single-page PDF tap-tone report — a web port of Swift's PDFReportGenerator /
// PDFReportContentView (GuitarTap/Views/Utilities/PDFReportGenerator.swift). The page is
// US Letter wide (612 pt, 36 pt margins), as tall as its content. Sections stack top-down as in Swift:
// header · accent bar · metadata · embedded spectrum image · peaks table · analysis
// (guitar boxes / plate · brace properties) · tap instructions · footer.
//
// The embedded chart is the SAME white composite the PNG export produces
// (renderSpectrumToCanvas), so the PDF and the standalone PNG never drift. The caller
// assembles a fully-resolved PdfReportData (peak rows, analysis numbers, quality
// labels/colors) — this module is pure layout, mirroring how Swift's PDFReportData is
// built before the view renders it.
//
// LAYOUT NOTE: every draw routine threads a single mutable `Cur` cursor ({doc, y}), where `y` is the
// top of the next element; all helpers advance `cur.y` directly. There is no second copy of the
// y-position, so sections can never overdraw each other.

import type { SpectrumImageOpts } from './spectrumExport'
import { renderSpectrumToCanvas } from './spectrumExport'
import { saveFile } from '../saveFile'
import { formattedAsFrequency } from './frequencyFormat'
import { formatDisplayDate } from '../format/date'
// jsPDF is imported STATICALLY (not `await import('jspdf')`) on purpose. A lazy chunk goes missing for
// a client running a stale service-worker shell after a deploy: the old shell requests a jsPDF chunk
// the new build renamed, the fetch fails ("Importing a module script failed"), and PDF export silently
// dies. Bundling jsPDF into the main entry — which the service worker always precaches — makes the shell
// self-contained, so that failure mode can't occur. Do NOT switch this back to a dynamic import.
// jsPDF's own optional html2canvas/dompurify deps stay lazy and are never fetched (we use only core drawing).
import { jsPDF } from 'jspdf'
import { FieldPrecision } from '../precision'
import { pair, type Role } from './palette'

export interface PdfPeakRow {
  frequency: number
  magnitude: number
  note: string
  quality: number
  /** Guitar: classified/overridden mode label + its color; isOverride italicises it. */
  modeLabel?: string
  modeColor?: string
  isOverride?: boolean
  /** Material: phase role ("Longitudinal (fL)" / "Cross-grain (fC)" / "Diagonal (fLC)" / "–"). */
  role?: string
  roleColor?: string
}

export interface PdfGuitarAnalysis {
  decayTime?: number | null
  decayQuality?: string
  decayColor?: string
  tapToneRatio?: number | null
  ratioQuality?: string
  ratioColor?: string
}

export interface PdfMaterialProp {
  label: string
  value: string
  color?: string
  /** Inline suffix drawn immediately after the value, 9pt, in the ROW'S OWN colour, upright —
   *  Swift `specificModulusRow` (PDFReportGenerator.swift:1012-1024) draws `("(\(quality.rawValue))")`
   *  at `.font(.system(size: 9)).foregroundColor(quality.color)`. Include the parentheses.
   *  ⚠ NOT italic and NOT grey — that was the bug: "(Excellent)" rendered grey+italic while its
   *  value was green. */
  hint?: string
  /** Sub-line BELOW the row: 9pt, secondary, ITALIC, and WITHOUT parentheses — Swift's ratios block
   *  (PDFReportGenerator.swift:837-856) puts `Text("typical: 0.04–0.08").italic()` in a VStack under
   *  the row rather than inline. Distinct from `hint`: the web previously forced both through one
   *  inline italic-grey mechanism, which was correct for neither. */
  note?: string
}

export interface PdfMaterialAnalysis {
  title: string // "Plate Properties" / "Brace Properties"
  /** Plate only: the Gore Target Thickness result — JUST the number now (Swift
   *  `goreThicknessPDFSection`:975-997). The body inputs + f_vs live in `body`, GLC among the moduli. */
  gore?: { thickness: string } | null
  /** Plate only: Body Dimensions block (Swift `plateBodyDimensionsPDFSection`:945-970) — body a/b on
   *  one line (`dims`, two columns), Panel Stiffness (f_vs) on its own full-width line. */
  body?: { dims: PdfMaterialProp[]; stiffness: PdfMaterialProp } | null
  dimensions: PdfMaterialProp[] // sample dimension rows (label/value) — 3 columns, grey box
  props: PdfMaterialProp[] // speed/young/specmod/radiation rows (color = quality where relevant)
  /** Plate only: the GLC row Swift draws FULL-WIDTH after the two-column property block
   *  (PDFReportGenerator.swift:825-834) — a label/value row when the FLC tap was performed, or
   *  `glcNote` (italic) when it was not. The web omitted this row entirely; GLC appeared only inside
   *  the Gore box. */
  glc?: PdfMaterialProp | null
  glcNote?: string | null
  ratios: PdfMaterialProp[] // cross/long etc. (plate only)
  overall: { value: string; color: string }
}

export interface PdfTapInstructions {
  heading: string
  steps: { color: string; title: string; detail: string }[]
  foot: string
}

export interface PdfComparison {
  spectraCount: number
  /** One row per overlaid spectrum: colored dot + label, and the Air/Top/Back peak freqs. */
  rows: { label: string; color: string; air: number | null; top: number | null; back: number | null }[]
}

export interface PdfReportData {
  image: SpectrumImageOpts
  timestamp: string
  measurementName?: string
  notes?: string
  measurementTypeName: string
  kind: 'guitar' | 'plate' | 'brace' | 'comparison'
  freqRange: { min: number; max: number }
  microphoneName?: string
  calibrationName?: string
  peaks: PdfPeakRow[]
  guitarAnalysis?: PdfGuitarAnalysis
  materialAnalysis?: PdfMaterialAnalysis
  tapInstructions?: PdfTapInstructions
  /** Comparison record → a "Peak Mode Comparison" table replaces peaks/analysis. */
  comparison?: PdfComparison
}

// ── Page geometry (points) ──────────────────────────────────────────────────
// The page is US Letter WIDTH (612 pt) with a VARIABLE height: like Swift's ImageRenderer, each report
// renders onto ONE page grown to fit its content. Height is found with a two-pass render (measure into
// a tall throwaway page, then emit at the measured size).
const PAGE_W = 612
const MARGIN = 36
const CONTENT_W = PAGE_W - MARGIN * 2
const L = MARGIN
const R = PAGE_W - MARGIN
// Throwaway measuring page — taller than any report (PDF max is 14400 pt).
const MEASURE_H = 14400
// Swift's footer below the content: Spacer 16, rule 1, Spacer 8, 9 pt text, then the bottom margin.
const FOOTER_H = 16 + 1 + 8 + 9

/** Page height that fits `contentBottom` plus the footer below it. */
function pageHeightFor(contentBottom: number): number {
  return contentBottom + FOOTER_H + MARGIN
}

// ── Colors (RGB): the pdf.* roles, light — the report is always drawn light ──────
type RGB = [number, number, number]
const pdf = (role: Role): RGB => hexToRgb(pair(role).light)
const ACCENT: RGB = pdf('pdf.accent')
const SECONDARY: RGB = pdf('pdf.secondary')
const PRIMARY: RGB = pdf('pdf.text')
const DIVIDER: RGB = pdf('pdf.divider')
const BOX_BG: RGB = pdf('pdf.box')
const PILL_BG: RGB = pdf('pdf.pill')
const GORE_BG: RGB = pdf('pdf.goreBox')
const CHART_MATTE: RGB = pdf('pdf.chartMatte')

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

/** Parse a CSS color (`#hex` OR `rgb()/rgba()`) into RGB. jsPDF's setFillColor/setTextColor
 *  need numeric channels — comparison overlay colors arrive as `rgba(...)` strings. */
function cssToRgb(color: string): RGB {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : hexToRgb(color)
}


type Doc = jsPDF

/** The single mutable layout cursor threaded through every draw routine: `y` is the TOP of the next
 *  element, as in a SwiftUI VStack. */
interface Cur {
  doc: Doc
  y: number
}

// ── Layout primitives ─────────────────────────────────────────────────────────
// Swift lays out each Text by its line box: in Helvetica a line is exactly its font size tall, with
// the baseline 0.77 × the size below its top, and a wrapped line steps by the font size. Every drawer
// below places text by the TOP of its line box, and advances by the sizes and spacings of Swift's
// stacks, so the lines land where Swift's do.
const ASCENT = 0.77

const font = (doc: Doc, size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => {
  doc.setFont('helvetica', style)
  doc.setFontSize(size)
}
const setColor = (doc: Doc, c: RGB) => doc.setTextColor(c[0], c[1], c[2])

/** Draw text (one line or wrapped lines) whose first line box's top is at `top`, in the current font. */
function textAt(doc: Doc, text: string | string[], x: number, top: number, opts?: { align?: 'right' }) {
  doc.text(text, x, top + ASCENT * doc.getFontSize(), opts)
}

/** Wrap `text` to `width` in the current font as Swift's Text wraps: line by line, except that the
 *  last line never holds a single word when the line above can spare one — Apple's push-out
 *  line-break strategy, which avoids an orphan word. */
function wrapLines(doc: Doc, text: string, width: number): string[] {
  const lines = (doc.splitTextToSize(text, width) as string[]).map((l) => l.trim())
  const n = lines.length
  if (n > 1 && !/\s/.test(lines[n - 1]!)) {
    const prev = lines[n - 2]!
    const cut = prev.lastIndexOf(' ')
    const moved = cut > 0 ? `${prev.slice(cut + 1)} ${lines[n - 1]}` : ''
    if (moved && doc.getTextWidth(moved) <= width) {
      lines[n - 2] = prev.slice(0, cut)
      lines[n - 1] = moved
    }
  }
  return lines
}

/** Swift's sectionDivider: a 1 pt rule at `cur.y`. */
function divider(cur: Cur) {
  cur.doc.setFillColor(DIVIDER[0], DIVIDER[1], DIVIDER[2])
  cur.doc.rect(L, cur.y, CONTENT_W, 1, 'F')
}

type JsPdfCtor = typeof jsPDF

/** A document whose wrapped lines step by the font size, as Swift's do. */
function newDoc(JsPDF: JsPdfCtor, pageH: number): Doc {
  const doc = new JsPDF({ unit: 'pt', format: [PAGE_W, pageH] })
  doc.setLineHeightFactor(1)
  return doc
}

/** Dry-render `data` into a throwaway tall page to measure its natural content height, then return
 *  the page height that fits it (Swift's auto-height page, done as a two-pass in jsPDF). */
function measureHeight(JsPDF: JsPdfCtor, data: PdfReportData): number {
  const cur: Cur = { doc: newDoc(JsPDF, MEASURE_H), y: MARGIN }
  renderReportContent(cur, data)
  return pageHeightFor(cur.y)
}

/** Render the report to a PDF Blob — a single page grown to fit the content (mirrors Swift). */
export async function generatePdfReport(data: PdfReportData): Promise<Blob> {
  const pageH = measureHeight(jsPDF, data)
  const doc = newDoc(jsPDF, pageH)
  renderReportContent({ doc, y: MARGIN }, data)
  drawFooters(doc, [pageH])
  return doc.output('blob')
}

/** Render a multi-tap guitar report (Swift `generateMultiTapReport`): page 1 = the averaged
 *  single-measurement report, page 2 = the per-tap comparison. Each page is sized to its own content
 *  (Swift auto-height). Both pages reuse the same drawers as the single/comparison reports. */
export async function generateMultiTapPdfReport(averaged: PdfReportData, comparison: PdfReportData): Promise<Blob> {
  const h1 = measureHeight(jsPDF, averaged)
  const h2 = measureHeight(jsPDF, comparison)
  const doc = newDoc(jsPDF, h1)
  renderReportContent({ doc, y: MARGIN }, averaged) // page 1 — averaged result
  doc.addPage([PAGE_W, h2])
  renderReportContent({ doc, y: MARGIN }, comparison) // page 2 — per-tap comparison
  drawFooters(doc, [h1, h2])
  return doc.output('blob')
}

/** The footer on every page (rule + "Generated by …" + the time of generation), placed from each
 *  page's own height (pages can differ — multi-tap). */
function drawFooters(doc: Doc, pageHeights: number[]) {
  // The time the report is generated, as Swift's footer.
  const generatedAt = formatDisplayDate(new Date().toISOString())
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const ph = pageHeights[p - 1] ?? pageHeights[pageHeights.length - 1] ?? MEASURE_H
    const textTop = ph - MARGIN - 9
    doc.setFillColor(DIVIDER[0], DIVIDER[1], DIVIDER[2])
    doc.rect(L, textTop - 8 - 1, CONTENT_W, 1, 'F')
    font(doc, 9, 'normal')
    setColor(doc, SECONDARY)
    textAt(doc, `Generated by GuitarTap Web ${__APP_VERSION__} (${__APP_BUILD__})`, L, textTop)
    textAt(doc, generatedAt, R, textTop, { align: 'right' })
  }
}

/** Render one report's content (header → sections) onto the current page of `doc`. The footer is
 *  applied separately (drawFooters) so multi-page docs share one footer pass. */
function renderReportContent(cur: Cur, data: PdfReportData) {
  const { doc } = cur

  // ── Header ──────────────────────────────────────────────────────────────
  // Swift: HStack(top) { VStack(spacing 2) { title 22 bold, subtitle 13 }, date 11 } + 8 below.
  const isComparison = data.kind === 'comparison'
  font(doc, 22, 'bold')
  setColor(doc, ACCENT)
  textAt(doc, 'GuitarTap', L, cur.y)
  font(doc, 13, 'normal')
  setColor(doc, SECONDARY)
  textAt(doc, isComparison ? 'Comparison Report' : 'Tap Tone Analysis Report', L, cur.y + 22 + 2)
  font(doc, 11, 'normal')
  textAt(doc, data.timestamp, R, cur.y, { align: 'right' })
  cur.y += 22 + 2 + 13 + 8

  // Accent bar: 3 pt, 12 below.
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.rect(L, cur.y, CONTENT_W, 3, 'F')
  cur.y += 3 + 12

  // ── Metadata ──────────────────────────────────────────────────────────────
  // Swift: VStack(spacing 4) of HStack(top, spacing 6) { label 11 bold in a fixed-width frame, value
  // 11 }. The label frame is 120 pt on the measurement report and 100 pt on the comparison report.
  const labelW = isComparison ? 100 : 120
  let firstMeta = true
  const metaRow = (label: string, value: string) => {
    if (!firstMeta) cur.y += 4
    firstMeta = false
    font(doc, 11, 'bold')
    setColor(doc, SECONDARY)
    textAt(doc, label + ':', L, cur.y)
    font(doc, 11, 'normal')
    setColor(doc, PRIMARY)
    const lines = wrapLines(doc, value, CONTENT_W - labelW - 6)
    textAt(doc, lines, L + labelW + 6, cur.y)
    cur.y += Math.max(1, lines.length) * 11
  }
  if (isComparison) {
    if (data.measurementName?.trim()) metaRow('Comparison', data.measurementName.trim())
    if (data.notes?.trim()) metaRow('Notes', data.notes.trim())
    metaRow('Spectra', `${data.comparison?.spectraCount ?? 0} spectra compared`)
  } else {
    if (data.measurementName?.trim()) metaRow('Measurement Name', data.measurementName.trim())
    metaRow('Type', data.measurementTypeName)
    if (data.notes?.trim()) metaRow('Notes', data.notes.trim())
  }
  // Swift's PDF uses formattedAsFrequency here; the chart's "Range:" line uses a different formatter
  // (`fmt()` in spectrumExport.ts), as Swift's ExportableSpectrumChart does.
  metaRow('Frequency Range', `${formattedAsFrequency(data.freqRange.min)} – ${formattedAsFrequency(data.freqRange.max)}`)
  // No recorded microphone means it is unknown (a played file, say): say so, and keep the calibration.
  if (!isComparison) {
    const calSuffix = data.calibrationName ? ` · calibrated (${data.calibrationName})` : ' · uncalibrated'
    metaRow('Microphone', (data.microphoneName || 'unknown') + calSuffix)
  }
  cur.y += 14

  // ── Spectrum image ────────────────────────────────────────────────────────
  // Swift: VStack(spacing 6) { "Frequency Spectrum" 12 bold, the export image at the content width }.
  font(doc, 12, 'bold')
  setColor(doc, SECONDARY)
  textAt(doc, 'Frequency Spectrum', L, cur.y)
  cur.y += 12 + 6
  // The same image Export Spectrum makes, at the content width — its height follows the export's
  // proportions, as Swift's does.
  const canvas = renderSpectrumToCanvas(data.image)
  const frameH = (CONTENT_W * canvas.height) / canvas.width
  // Dark matte around the chart, mirroring Swift's `.background(Color(white: 0.05)).cornerRadius(6)`.
  // It marks where the captured spectrum ends and the report begins. On Swift the frame is not a
  // stroke at all — its chart PNG carries transparent padding and the near-black background shows
  // THROUGH it. The web's canvas is opaque white, so the same look is drawn deliberately: a #0D0D0D
  // rounded rect the size of Swift's image, with the chart inset into it.
  const MATTE = 5
  const innerH = frameH - MATTE * 2
  const innerW = (innerH * canvas.width) / canvas.height
  doc.setFillColor(CHART_MATTE[0], CHART_MATTE[1], CHART_MATTE[2])
  doc.roundedRect(L, cur.y, CONTENT_W, frameH, 6, 6, 'F')
  // ⚠ The trailing 'MEDIUM' is load-bearing. jsPDF's `compression` argument defaults to 'NONE',
  // which stores the chart as a RAW RGB bitmap — the PNG compression paid for in toDataURL is
  // decoded and thrown away (a plate report measured 3.50 MB against Swift's 0.61 MB and Python's
  // 0.62 MB). Flate is lossless (pixels are bit-identical); FAST gives 26.9×, MEDIUM 31.1×, SLOW
  // 31.7× — MEDIUM is the knee of the curve. The `undefined` is the optional `alias` slot;
  // compression is the 8th parameter.
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', L + (CONTENT_W - innerW) / 2, cur.y + MATTE, innerW, innerH, undefined, 'MEDIUM')
  cur.y += frameH + 14

  divider(cur)
  cur.y += 1 + 14

  if (isComparison && data.comparison) {
    // ── Peak Mode Comparison table (replaces peaks/analysis/tap) ─────────────
    drawComparisonTable(cur, data.comparison)
  } else {
    // ── Peaks table ─────────────────────────────────────────────────────────
    drawPeaks(cur, data)
    cur.y += 14

    // ── Analysis ────────────────────────────────────────────────────────────
    if (data.kind === 'guitar' && data.guitarAnalysis) {
      drawGuitarAnalysis(cur, data.guitarAnalysis)
    } else if (data.materialAnalysis) {
      drawMaterialAnalysis(cur, data.materialAnalysis)
    }

    // ── Tap instructions ────────────────────────────────────────────────────
    if (data.tapInstructions) drawTapInstructions(cur, data.tapInstructions)
  }
}

// ── Section drawers ───────────────────────────────────────────────────────────

/** Swift `peaksSection`: VStack(spacing 6) { "Detected Peaks" 13 bold, the header (10 bold, padded 3
 *  vertically and 6 horizontally, 2 below), then one row per peak (10, padded 2 / 6) }. */
function drawPeaks(cur: Cur, data: PdfReportData) {
  const { doc } = cur
  const isGuitar = data.kind === 'guitar'

  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  textAt(doc, 'Detected Peaks', L, cur.y)
  cur.y += 13 + 6

  if (!data.peaks.length) {
    font(doc, 11, 'normal')
    setColor(doc, SECONDARY)
    textAt(doc, 'No peaks detected in this measurement.', L, cur.y)
    cur.y += 11
    return
  }

  // Swift's column frames: 90 · 80 · 80, then Mode (guitar) or Q Factor 70 + Role, inside 6 pt padding.
  const cFreq = L + 6
  const cMag = cFreq + 90
  const cNote = cMag + 80
  const cMode = cNote + 80
  const cRole = cMode + 70

  // Header pill
  doc.setFillColor(PILL_BG[0], PILL_BG[1], PILL_BG[2])
  doc.roundedRect(L, cur.y, CONTENT_W, 3 + 10 + 3, 4, 4, 'F')
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  const headTop = cur.y + 3
  textAt(doc, 'Frequency', cFreq, headTop)
  textAt(doc, 'Magnitude', cMag, headTop)
  textAt(doc, 'Note', cNote, headTop)
  if (isGuitar) {
    textAt(doc, 'Mode', cMode, headTop)
  } else {
    textAt(doc, 'Q Factor', cMode, headTop)
    textAt(doc, 'Role', cRole, headTop)
  }
  cur.y += 16 + 2

  for (const p of data.peaks) {
    cur.y += 6
    const top = cur.y + 2
    font(doc, 10, 'normal')
    setColor(doc, PRIMARY)
    textAt(doc, `${FieldPrecision.string(p.frequency, FieldPrecision.peakFrequencyHz)} Hz`, cFreq, top)
    textAt(doc, `${FieldPrecision.string(p.magnitude, FieldPrecision.peakMagnitudeDB)} dB`, cMag, top)
    textAt(doc, p.note || '–', cNote, top)
    if (isGuitar) {
      font(doc, 10, p.isOverride ? 'italic' : 'normal')
      setColor(doc, p.modeColor ? hexToRgb(p.modeColor) : SECONDARY)
      // Overridden mode: italic + trailing " *" — the one convention used everywhere.
      textAt(doc, (p.modeLabel || '–') + (p.isOverride ? ' *' : ''), cMode, top)
    } else {
      font(doc, 10, 'normal')
      setColor(doc, PRIMARY)
      textAt(doc, FieldPrecision.string(p.quality, FieldPrecision.qFactor), cMode, top)
      setColor(doc, p.roleColor ? hexToRgb(p.roleColor) : SECONDARY)
      textAt(doc, p.role || '–', cRole, top)
    }
    cur.y += 2 + 10 + 2
  }
}

/** Swift `guitarAnalysisSection`: VStack(spacing 10) { "Analysis Results" 13 bold, HStack(top,
 *  spacing 16) of boxes }. Each box (`analysisBox`, padded 10) is HStack(top) { VStack(spacing 2)
 *  { title 10 bold, value 18 bold, subtitle 9 }, VStack(trailing, spacing 2) { detail 10,
 *  detailSubtitle 9, hint 9 italic } }. */
function drawGuitarAnalysis(cur: Cur, a: PdfGuitarAnalysis) {
  const { doc } = cur

  const boxes: { title: string; value: string; subtitle: string; detail: string; detailColor: RGB; detailSubtitle?: string; hint?: string }[] = []
  if (a.decayTime != null) {
    boxes.push({
      title: 'Ring-Out Time',
      value: `${FieldPrecision.string(a.decayTime, FieldPrecision.decayTimeS)} s`,
      subtitle: 'Time to decay 15 dB',
      detail: a.decayQuality ?? '',
      detailColor: a.decayColor ? hexToRgb(a.decayColor) : SECONDARY,
      detailSubtitle: 'Sustain quality',
    })
  }
  if (a.tapToneRatio != null) {
    boxes.push({
      title: 'Tap Tone Ratio',
      value: `${FieldPrecision.string(a.tapToneRatio, FieldPrecision.decayRatio)} : 1`,
      subtitle: 'Top / Air',
      detail: a.ratioQuality ?? '',
      detailColor: a.ratioColor ? hexToRgb(a.ratioColor) : SECONDARY,
      hint: 'Ideal: 1.9–2.1',
    })
  }

  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  textAt(doc, 'Analysis Results', L, cur.y)
  cur.y += 13 + 10

  // No ring-out time and no ratio: the heading alone, as Swift's empty HStack.
  if (!boxes.length) return

  const gap = 16
  const boxW = (CONTENT_W - (boxes.length - 1) * gap) / boxes.length
  const PAD = 10
  // The left column sets the height: title 10 + 2 + value 18 + 2 + subtitle 9.
  const boxH = PAD + 10 + 2 + 18 + 2 + 9 + PAD
  const c = cur.y + PAD
  boxes.forEach((b, i) => {
    const x = L + i * (boxW + gap)
    const right = x + boxW - PAD
    doc.setFillColor(BOX_BG[0], BOX_BG[1], BOX_BG[2])
    doc.roundedRect(x, cur.y, boxW, boxH, 6, 6, 'F')
    font(doc, 10, 'bold')
    setColor(doc, SECONDARY)
    textAt(doc, b.title, x + PAD, c)
    font(doc, 18, 'bold')
    setColor(doc, PRIMARY)
    textAt(doc, b.value, x + PAD, c + 10 + 2)
    font(doc, 9, 'normal')
    setColor(doc, SECONDARY)
    textAt(doc, b.subtitle, x + PAD, c + 10 + 2 + 18 + 2)
    font(doc, 10, 'normal')
    setColor(doc, b.detailColor)
    textAt(doc, b.detail, right, c, { align: 'right' })
    let rightTop = c + 10 + 2
    if (b.detailSubtitle) {
      font(doc, 9, 'normal')
      setColor(doc, SECONDARY)
      textAt(doc, b.detailSubtitle, right, rightTop, { align: 'right' })
      rightTop += 9 + 2
    }
    if (b.hint) {
      font(doc, 9, 'italic')
      setColor(doc, SECONDARY)
      textAt(doc, b.hint, right, rightTop, { align: 'right' })
    }
  })
  cur.y += boxH
}

/** Swift `analysisSection` for plate / brace: Sample Dimensions, then (plate) Body Dimensions and
 *  the Gore target, then the Plate / Brace Properties — each block separated by Spacer 14 · divider ·
 *  Spacer 14. */
function drawMaterialAnalysis(cur: Cur, a: PdfMaterialAnalysis) {
  const { doc } = cur
  const separator = () => {
    cur.y += 14
    divider(cur)
    cur.y += 1 + 14
  }

  threeColBox(cur, a.dimensions, 'Sample Dimensions')
  separator()

  // Plate only. Swift keeps the separator after the Gore target even when there is no target.
  if (a.body) {
    drawBodyDimensions(cur, a.body)
    separator()
    if (a.gore) drawGoreThickness(cur, a.gore.thickness)
    separator()
  }

  // Swift plateSection / braceSection: VStack(spacing 10) { title 13 bold, the two property columns,
  // [GLC row], [ratios], Overall Quality }.
  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  textAt(doc, a.title, L, cur.y)
  cur.y += 13 + 10

  // Property rows (two columns) — COLUMN-major, matching Swift's two side-by-side VStacks.
  // Plate (8): L | Speed of Sound (L), Speed of Sound (C), Young's Modulus (L), Young's Modulus (C)
  //            R | Specific Modulus (L), Specific Modulus (C), Radiation Ratio (L), Radiation Ratio (C)
  // Brace (4): L | Speed of Sound, Young's Modulus (E)   R | Specific Modulus, Radiation Ratio
  twoColRows(cur, a.props, 'column')

  // GLC (Shear Modulus) — a full-width row after the two columns (plate only).
  if (a.glc) {
    cur.y += 10
    propAt(cur, a.glc, L)
    cur.y += 10
  } else if (a.glcNote) {
    cur.y += 10
    font(doc, 10, 'italic')
    setColor(doc, SECONDARY)
    textAt(doc, a.glcNote, L, cur.y)
    cur.y += 10
  }

  // Ratios (plate) — two side-by-side VStack(spacing 2) { row, typical-range note }.
  if (a.ratios.length) {
    cur.y += 10
    twoColRows(cur, a.ratios, 'column')
  }

  // Overall Quality — HStack { label 10 bold, value 13 bold } padded 8, the label centred on the value.
  cur.y += 10
  const PAD = 8
  doc.setFillColor(BOX_BG[0], BOX_BG[1], BOX_BG[2])
  doc.roundedRect(L, cur.y, CONTENT_W, PAD + 13 + PAD, 4, 4, 'F')
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  textAt(doc, 'Overall Quality:', L + PAD, cur.y + PAD + (13 - 10) / 2)
  const labelW = doc.getTextWidth('Overall Quality:') + 8
  font(doc, 13, 'bold')
  setColor(doc, hexToRgb(a.overall.color))
  textAt(doc, a.overall.value, L + PAD + labelW, cur.y + PAD)
  cur.y += PAD + 13 + PAD
}

/** Swift `plateBodyDimensionsPDFSection`: VStack(spacing 4) { heading 10 bold, body a / b two-up,
 *  Panel Stiffness on its own line }, padded 6 in a grey box. */
function drawBodyDimensions(cur: Cur, body: { dims: PdfMaterialProp[]; stiffness: PdfMaterialProp }) {
  const { doc } = cur
  const PAD = 6
  const colW = (CONTENT_W - PAD * 2) / 2
  const boxH = PAD + 10 + 4 + 10 + 4 + 10 + PAD
  doc.setFillColor(BOX_BG[0], BOX_BG[1], BOX_BG[2])
  doc.roundedRect(L, cur.y, CONTENT_W, boxH, 4, 4, 'F')
  const top = cur.y
  cur.y += PAD
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  textAt(doc, 'Body Dimensions', L + PAD, cur.y)
  cur.y += 10 + 4
  body.dims.forEach((row, i) => propAt(cur, row, L + PAD + i * colW))
  cur.y += 10 + 4
  propAt(cur, body.stiffness, L + PAD) // Panel Stiffness — own line (the preset label is long)
  cur.y = top + boxH
}

/** Swift `goreThicknessPDFSection`: VStack(spacing 4) { heading 10 bold, the thickness 16 bold },
 *  padded 6 in an accent-tinted box. */
function drawGoreThickness(cur: Cur, thickness: string) {
  const { doc } = cur
  const PAD = 6
  const boxH = PAD + 10 + 4 + 16 + PAD
  doc.setFillColor(GORE_BG[0], GORE_BG[1], GORE_BG[2])
  doc.roundedRect(L, cur.y, CONTENT_W, boxH, 4, 4, 'F')
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  textAt(doc, 'Gore Target Thickness', L + PAD, cur.y + PAD)
  font(doc, 16, 'bold')
  setColor(doc, ACCENT)
  textAt(doc, thickness, L + PAD, cur.y + PAD + 10 + 4)
  cur.y += boxH
}

/** How a two-column block is filled.
 *
 *  - `'column'` — **down then across**: the first half of `rows` fills the LEFT column, the second
 *    half the RIGHT. This is Swift's layout, which it gets structurally from two side-by-side
 *    `VStack`s.
 *  - `'row'` — **across then down**: `rows[i]` left, `rows[i+1]` right.
 *
 *  Passed explicitly by every caller — no default. The callers genuinely need different fills, and a
 *  shared default is what let the material property block silently render row-major against Swift's
 *  column-major (see below).
 */
type ColFill = 'column' | 'row'

/** Draw one label/value row (10 pt) with its top at `cur.y` — Swift `platePropRow`: HStack(spacing 6)
 *  { label secondary, value bold }; `specificModulusRow` adds the 9 pt quality, centred on the row. */
function propAt(cur: Cur, row: PdfMaterialProp, x: number) {
  const { doc } = cur
  font(doc, 10, 'normal')
  setColor(doc, SECONDARY)
  textAt(doc, row.label + ':', x, cur.y)
  const labelW = doc.getTextWidth(row.label + ':') + 6
  font(doc, 10, 'bold')
  setColor(doc, row.color ? hexToRgb(row.color) : PRIMARY)
  textAt(doc, row.value, x + labelW, cur.y)
  if (row.hint) {
    const vW = doc.getTextWidth(row.value) + 6
    // 9pt, the ROW'S colour, UPRIGHT.
    font(doc, 9, 'normal')
    setColor(doc, row.color ? hexToRgb(row.color) : PRIMARY)
    textAt(doc, row.hint, x + labelW + vW, cur.y + (10 - 9) / 2)
  }
}

/** Swift `dimensionsSubsection`: VStack(spacing 4) { heading 10 bold, rows of three equal columns
 *  filled LEFT→RIGHT }, padded 6 in a grey box. */
function threeColBox(cur: Cur, rows: PdfMaterialProp[], heading: string) {
  const { doc } = cur
  const PAD = 6
  const colW = (CONTENT_W - PAD * 2) / 3
  const lines = Math.ceil(rows.length / 3)
  const boxH = PAD + 10 + lines * (4 + 10) + PAD
  doc.setFillColor(BOX_BG[0], BOX_BG[1], BOX_BG[2])
  doc.roundedRect(L, cur.y, CONTENT_W, boxH, 4, 4, 'F')
  const top = cur.y
  cur.y += PAD
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  textAt(doc, heading, L + PAD, cur.y)
  cur.y += 10
  for (let r = 0; r < lines; r++) {
    cur.y += 4
    for (let c = 0; c < 3; c++) {
      const row = rows[r * 3 + c]
      if (row) propAt(cur, row, L + PAD + c * colW)
    }
    cur.y += 10
  }
  cur.y = top + boxH
}

/** Render label/value props in two columns, advancing cur.y row by row (rows 10 pt, 6 apart, as
 *  Swift's VStack(spacing: 6)). A row whose props carry a `note` stacks it beneath, 2 pt below, in
 *  9 pt italic — Swift's ratios VStack(spacing: 2).
 *
 *  ⚠ The `fill` argument is load-bearing. Swift builds its two-column property blocks as two
 *  side-by-side VStacks, i.e. **column-major**; this function filled **row-major**, so the same
 *  correct values landed in the wrong cells:
 *
 *    Swift (column-major)              web, before (row-major)
 *    Speed of Sound (L)  Spec Mod (L)  Speed of Sound (L)  Speed of Sound (C)
 *    Speed of Sound (C)  Spec Mod (C)  Young's Mod (L)     Young's Mod (C)
 *    Young's Mod (L)     Rad Ratio (L) Spec Mod (L)        Spec Mod (C)
 *    Young's Mod (C)     Rad Ratio (C) Rad Ratio (L)       Rad Ratio (C)
 *
 *  On the PLATE this was camouflaged — row-major happens to put every (L) in the left column and
 *  every (C) in the right, which reads like a deliberate L/C split rather than a bug. On the BRACE
 *  (four unrelated properties) it was obvious. Same defect, different disguise.
 */
function twoColRows(cur: Cur, rows: PdfMaterialProp[], fill: ColFill) {
  const { doc } = cur
  const colW = CONTENT_W / 2
  // Column-major: left column takes the first `half`, right column the rest. An odd count leaves the
  // right column one short (the left column is the longer one), matching a VStack pair.
  const half = fill === 'column' ? Math.ceil(rows.length / 2) : 0
  const rowCount = fill === 'column' ? half : Math.ceil(rows.length / 2)
  for (let r = 0; r < rowCount; r++) {
    if (r) cur.y += 6
    const pair = [0, 1].map((c) => (fill === 'column' ? rows[r + c * half] : rows[r * 2 + c]))
    for (let c = 0; c < 2; c++) {
      const row = pair[c]
      if (row) propAt(cur, row, L + c * colW)
    }
    cur.y += 10
    if (pair.some((row) => row?.note)) {
      cur.y += 2
      for (let c = 0; c < 2; c++) {
        const note = pair[c]?.note
        if (!note) continue
        font(doc, 9, 'italic')
        setColor(doc, SECONDARY)
        textAt(doc, note, L + c * colW, cur.y)
      }
      cur.y += 9
    }
  }
}

/** Swift `tapInstructionsSection`: VStack(spacing 6) { divider, Spacer 6, heading 10 bold, one row
 *  per tap, foot 9 italic }, then Spacer 14. A row is HStack(top, spacing 6) { 7 pt dot 2 below the
 *  top, VStack(spacing 1) { title 10 bold, detail 9 (wrapping) } }. */
function drawTapInstructions(cur: Cur, ti: PdfTapInstructions) {
  const { doc } = cur
  divider(cur)
  cur.y += 1 + 6 + 6 + 6
  font(doc, 10, 'bold')
  setColor(doc, PRIMARY)
  textAt(doc, ti.heading, L, cur.y)
  cur.y += 10
  const textX = L + 7 + 6
  for (const s of ti.steps) {
    cur.y += 6
    const col = hexToRgb(s.color)
    doc.setFillColor(col[0], col[1], col[2])
    doc.circle(L + 3.5, cur.y + 2 + 3.5, 3.5, 'F')
    font(doc, 10, 'bold')
    setColor(doc, PRIMARY)
    textAt(doc, s.title, textX, cur.y)
    cur.y += 10 + 1
    font(doc, 9, 'normal')
    setColor(doc, SECONDARY)
    const lines = wrapLines(doc, s.detail, R - textX)
    textAt(doc, lines, textX, cur.y)
    cur.y += lines.length * 9
  }
  cur.y += 6
  font(doc, 9, 'italic')
  setColor(doc, SECONDARY)
  textAt(doc, ti.foot, L, cur.y)
  cur.y += 9 + 14
}

/** "Peak Mode Comparison" table — one row per overlaid spectrum (Spectrum · Air · Top · Back).
 *  Mirrors Swift ComparisonPDFReportContentView.peakModeTableSection: VStack(spacing 6) { title 13
 *  bold, header (10 bold, padded 4 vertically), rows (10, padded 4, top-aligned) }; each frequency
 *  column is 90 pt, right-aligned, with 6 pt after it; the spectrum column takes the rest, padded 6. */
function drawComparisonTable(cur: Cur, comp: PdfComparison) {
  const { doc } = cur
  const COL = 90 + 6
  const right = [R - 6 - COL * 2, R - 6 - COL, R - 6] // right edges of the Air / Top / Back text
  const labelX = L + 6 + 8 + 5 // padding, dot, spacing
  const labelMax = R - COL * 3 - 6 - labelX

  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  textAt(doc, 'Peak Mode Comparison', L, cur.y)
  cur.y += 13 + 6

  // Header pill
  doc.setFillColor(PILL_BG[0], PILL_BG[1], PILL_BG[2])
  doc.roundedRect(L, cur.y, CONTENT_W, 4 + 10 + 4, 4, 4, 'F')
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  textAt(doc, 'Spectrum', L + 6, cur.y + 4)
  ;['Air', 'Top', 'Back'].forEach((lbl, i) => textAt(doc, lbl, right[i]!, cur.y + 4, { align: 'right' }))
  cur.y += 4 + 10 + 4

  for (const row of comp.rows) {
    cur.y += 6
    const top = cur.y + 4
    const c = cssToRgb(row.color)
    doc.setFillColor(c[0], c[1], c[2])
    doc.circle(L + 6 + 4, top + 5, 4, 'F')
    font(doc, 10, 'normal')
    setColor(doc, PRIMARY)
    // A long name wraps rather than being cut; the dot and the values stay level with its first line.
    const label = wrapLines(doc, row.label, labelMax)
    textAt(doc, label, labelX, top)
    const freqs = [row.air, row.top, row.back]
    freqs.forEach((f, i) => {
      setColor(doc, f != null ? PRIMARY : SECONDARY)
      textAt(doc, f != null ? `${FieldPrecision.string(f, FieldPrecision.peakFrequencyHz)} Hz` : '—', right[i]!, top, { align: 'right' })
    })
    cur.y += 4 + 10 * label.length + 4
  }
}

/** Build the report and save it to a user-chosen location (PDF). */
export async function exportPdfReport(data: PdfReportData, filename: string): Promise<void> {
  const blob = await generatePdfReport(data)
  await saveFile(blob, filename, { description: 'PDF report', mime: 'application/pdf', ext: '.pdf' })
}

/** Build the two-page multi-tap report (averaged + per-tap comparison) and save it. */
export async function exportMultiTapPdfReport(
  pages: { averaged: PdfReportData; comparison: PdfReportData },
  filename: string,
): Promise<void> {
  const blob = await generateMultiTapPdfReport(pages.averaged, pages.comparison)
  await saveFile(blob, filename, { description: 'PDF report', mime: 'application/pdf', ext: '.pdf' })
}