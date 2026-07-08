// Single-page PDF tap-tone report — a web port of Swift's PDFReportGenerator /
// PDFReportContentView (GuitarTap/Views/Utilities/PDFReportGenerator.swift). The page is
// US Letter (612×792 pt, 36 pt margins). Sections stack top-down exactly as in Swift:
// header · accent bar · metadata · embedded spectrum image · peaks table · analysis
// (guitar boxes / plate · brace properties) · tap instructions · footer.
//
// The embedded chart is the SAME white composite the PNG export produces
// (renderSpectrumToCanvas), so the PDF and the standalone PNG never drift. The caller
// assembles a fully-resolved PdfReportData (peak rows, analysis numbers, quality
// labels/colors) — this module is pure layout, mirroring how Swift's PDFReportData is
// built before the view renders it.
//
// LAYOUT NOTE: every draw routine threads a single mutable `Cur` cursor ({doc, y}); all
// helpers advance `cur.y` directly. There is no second copy of the y-position, so sections
// can never overdraw each other. `ensure(cur, h)` paginates when `h` more points won't fit
// ABOVE the reserved footer band, so content never collides with the footer.

import type { SpectrumImageOpts } from './spectrumExport'
import { renderSpectrumToCanvas } from './spectrumExport'
import { saveFile } from '../saveFile'

export interface PdfPeakRow {
  frequency: number
  magnitude: number
  note: string
  quality: number
  /** Guitar: classified/overridden mode label + its color; isOverride italicises it. */
  modeLabel?: string
  modeColor?: string
  isOverride?: boolean
  /** Material: phase role ("Longitudinal (L)" / "Cross-grain (C)" / "FLC (Diagonal)" / "–"). */
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
  hint?: string
}

export interface PdfMaterialAnalysis {
  title: string // "Plate Properties" / "Brace Properties"
  gore?: { thickness: string; glc: string; goreItalic: boolean; body: string; fvs: string } | null
  freqs: string[] // ["fL: 123.4 Hz", "fC: …", "fLC: …"]
  dimensions: PdfMaterialProp[] // sample dimension rows (label/value)
  props: PdfMaterialProp[] // speed/young/specmod/radiation rows (color = quality where relevant)
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
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 36
const CONTENT_W = PAGE_W - MARGIN * 2
const L = MARGIN
const R = PAGE_W - MARGIN
const FOOTER_RESERVE = 30 // band at the page bottom kept clear for the footer
// Plot height (px) for the embedded spectrum image — shorter than the standalone PNG's 660 so the
// embedded image is ~280pt tall (vs ~360), freeing ~70pt and keeping the analysis on page 1.
const PDF_CHART_HEIGHT = 460

// ── Colors (RGB) ──────────────────────────────────────────────────────────────
type RGB = [number, number, number]
const ACCENT: RGB = [38, 89, 191] // Swift Color(0.15, 0.35, 0.75)
const SECONDARY: RGB = [120, 120, 128]
const PRIMARY: RGB = [28, 28, 30]
const DIVIDER: RGB = [210, 210, 212]
const BOX_BG: RGB = [242, 242, 244]
const PILL_BG: RGB = [236, 236, 238]
const GORE_BG: RGB = [247, 249, 253]

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

function fmtFreq(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`
}

type Doc = import('jspdf').jsPDF

/** The single mutable layout cursor threaded through every draw routine. */
interface Cur {
  doc: Doc
  y: number
}

// ── Layout primitives (all advance cur.y) ─────────────────────────────────────
const font = (doc: Doc, size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => {
  doc.setFont('helvetica', style)
  doc.setFontSize(size)
}
const setColor = (doc: Doc, c: RGB) => doc.setTextColor(c[0], c[1], c[2])

/** Paginate if `h` more points won't fit above the footer band; returns true on a page break. */
function ensure(cur: Cur, h: number): boolean {
  if (cur.y + h > PAGE_H - MARGIN - FOOTER_RESERVE) {
    cur.doc.addPage()
    cur.y = MARGIN
    return true
  }
  return false
}

function divider(cur: Cur) {
  cur.doc.setDrawColor(DIVIDER[0], DIVIDER[1], DIVIDER[2])
  cur.doc.setLineWidth(0.75)
  cur.doc.line(L, cur.y, R, cur.y)
}

/** Render the report to a PDF Blob. */
export async function generatePdfReport(data: PdfReportData): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  renderReportContent({ doc, y: MARGIN }, data)
  drawFooters(doc, data.timestamp)
  return doc.output('blob')
}

/** Render a multi-tap guitar report (Swift `generateMultiTapReport`): page 1 = the averaged
 *  single-measurement report, page 2 = the per-tap comparison. Both pages reuse the same drawers
 *  as the single/comparison reports, so the multi-tap PDF never drifts from them. */
export async function generateMultiTapPdfReport(averaged: PdfReportData, comparison: PdfReportData): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  renderReportContent({ doc, y: MARGIN }, averaged) // page 1 — averaged result
  doc.addPage()
  renderReportContent({ doc, y: MARGIN }, comparison) // page 2 — per-tap comparison
  drawFooters(doc, averaged.timestamp)
  return doc.output('blob')
}

/** The footer band on every page (divider + "Generated by …" + timestamp). */
function drawFooters(doc: Doc, timestamp: string) {
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const fy = PAGE_H - MARGIN + 6
    doc.setDrawColor(DIVIDER[0], DIVIDER[1], DIVIDER[2])
    doc.setLineWidth(0.75)
    doc.line(L, fy - 12, R, fy - 12)
    font(doc, 9, 'normal')
    setColor(doc, SECONDARY)
    doc.text(`Generated by GuitarTap Web ${__APP_VERSION__} (${__APP_BUILD__})`, L, fy)
    doc.text(timestamp, R, fy, { align: 'right' })
  }
}

/** Render one report's content (header → sections) onto the current page of `doc`, paginating as
 *  needed. The footer is applied separately (drawFooters) so multi-page / multi-report docs share
 *  one consistent footer pass. */
function renderReportContent(cur: Cur, data: PdfReportData) {
  const { doc } = cur

  // ── Header ──────────────────────────────────────────────────────────────
  font(doc, 22, 'bold')
  setColor(doc, ACCENT)
  doc.text('GuitarTap', L, cur.y + 16)
  font(doc, 13, 'normal')
  setColor(doc, SECONDARY)
  doc.text('Tap Tone Analysis Report', L, cur.y + 32)
  font(doc, 11, 'normal')
  doc.text(data.timestamp, R, cur.y + 14, { align: 'right' })
  cur.y += 44

  // accent bar
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
  doc.rect(L, cur.y, CONTENT_W, 3, 'F')
  cur.y += 15

  // ── Metadata ──────────────────────────────────────────────────────────────
  const metaRow = (label: string, value: string) => {
    font(doc, 11, 'bold')
    setColor(doc, SECONDARY)
    doc.text(label + ':', L, cur.y)
    font(doc, 11, 'normal')
    setColor(doc, PRIMARY)
    const lines = doc.splitTextToSize(value, CONTENT_W - 124) as string[]
    doc.text(lines, L + 124, cur.y)
    cur.y += Math.max(1, lines.length) * 14
  }
  const isComparison = data.kind === 'comparison'
  if (data.measurementName?.trim()) metaRow('Measurement Name', data.measurementName.trim())
  if (isComparison) {
    metaRow('Spectra', `${data.comparison?.spectraCount ?? 0} spectra compared`)
  } else {
    metaRow('Type', data.measurementTypeName)
  }
  if (data.notes?.trim()) metaRow('Notes', data.notes.trim())
  metaRow('Frequency Range', `${fmtFreq(data.freqRange.min)} – ${fmtFreq(data.freqRange.max)}`)
  if (!isComparison && data.microphoneName) {
    const calSuffix = data.calibrationName ? ` · calibrated (${data.calibrationName})` : ' · uncalibrated'
    metaRow('Microphone', data.microphoneName + calSuffix)
  }
  cur.y += 8

  // ── Spectrum image ────────────────────────────────────────────────────────
  font(doc, 12, 'bold')
  setColor(doc, SECONDARY)
  doc.text('Frequency Spectrum', L, cur.y)
  cur.y += 8
  // Compact plot height for the embedded image: the standalone PNG uses the full 660px, but a fixed
  // Letter page has far less vertical room than Swift's auto-grown page, so a shorter image keeps the
  // averaged report (peaks + Analysis Results) on a single page instead of spilling to a second.
  const canvas = renderSpectrumToCanvas({ ...data.image, chartHeight: PDF_CHART_HEIGHT })
  const imgH = (CONTENT_W * canvas.height) / canvas.width
  ensure(cur, imgH + 8)
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', L, cur.y, CONTENT_W, imgH)
  cur.y += imgH + 14

  // divider
  ensure(cur, 20)
  divider(cur)
  cur.y += 14

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

function drawPeaks(cur: Cur, data: PdfReportData) {
  const { doc } = cur
  const isGuitar = data.kind === 'guitar'

  ensure(cur, 40)
  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  doc.text('Detected Peaks', L, cur.y)
  cur.y += 16

  if (!data.peaks.length) {
    font(doc, 11, 'normal')
    setColor(doc, SECONDARY)
    doc.text('No peaks detected in this measurement.', L, cur.y)
    cur.y += 12
    return
  }

  const cFreq = L
  const cMag = L + 90
  const cNote = L + 170
  const cMode = L + 250

  // Header pill
  doc.setFillColor(PILL_BG[0], PILL_BG[1], PILL_BG[2])
  doc.roundedRect(L, cur.y - 10, CONTENT_W, 16, 3, 3, 'F')
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  doc.text('Frequency', cFreq + 4, cur.y)
  doc.text('Magnitude', cMag, cur.y)
  doc.text('Note', cNote, cur.y)
  if (isGuitar) {
    doc.text('Mode', cMode, cur.y)
  } else {
    doc.text('Q Factor', cMode, cur.y)
    doc.text('Role', cMode + 70, cur.y)
  }
  cur.y += 16

  for (const p of data.peaks) {
    ensure(cur, 14)
    font(doc, 10, 'normal')
    setColor(doc, PRIMARY)
    doc.text(`${p.frequency.toFixed(1)} Hz`, cFreq + 4, cur.y)
    doc.text(`${p.magnitude.toFixed(1)} dB`, cMag, cur.y)
    doc.text(p.note || '–', cNote, cur.y)
    if (isGuitar) {
      font(doc, 10, p.isOverride ? 'italic' : 'normal')
      setColor(doc, p.modeColor ? hexToRgb(p.modeColor) : SECONDARY)
      doc.text(p.modeLabel || '–', cMode, cur.y)
    } else {
      font(doc, 10, 'normal')
      setColor(doc, PRIMARY)
      doc.text(p.quality.toFixed(1), cMode, cur.y)
      setColor(doc, p.roleColor ? hexToRgb(p.roleColor) : SECONDARY)
      doc.text(p.role || '–', cMode + 70, cur.y)
    }
    cur.y += 14
  }
}

function drawGuitarAnalysis(cur: Cur, a: PdfGuitarAnalysis) {
  const { doc } = cur

  const boxes: { title: string; value: string; subtitle: string; detail: string; detailColor: RGB; hint?: string }[] = []
  if (a.decayTime != null) {
    boxes.push({
      title: 'Ring-Out Time',
      value: `${a.decayTime.toFixed(2)} s`,
      subtitle: 'Time to decay 15 dB',
      detail: a.decayQuality ?? '',
      detailColor: a.decayColor ? hexToRgb(a.decayColor) : SECONDARY,
    })
  }
  if (a.tapToneRatio != null) {
    boxes.push({
      title: 'Tap Tone Ratio',
      value: `${a.tapToneRatio.toFixed(2)} : 1`,
      subtitle: 'Top / Air',
      detail: a.ratioQuality ?? '',
      detailColor: a.ratioColor ? hexToRgb(a.ratioColor) : SECONDARY,
      hint: 'Ideal: 1.9–2.1',
    })
  }

  ensure(cur, 80)
  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  doc.text('Analysis Results', L, cur.y)
  cur.y += 14

  if (!boxes.length) {
    font(doc, 10, 'italic')
    setColor(doc, SECONDARY)
    doc.text('No analysis values available.', L, cur.y)
    cur.y += 12
    return
  }

  const gap = 16
  const boxW = (CONTENT_W - (boxes.length - 1) * gap) / boxes.length
  const boxH = 54
  const top = cur.y
  boxes.forEach((b, i) => {
    const x = L + i * (boxW + gap)
    doc.setFillColor(BOX_BG[0], BOX_BG[1], BOX_BG[2])
    doc.roundedRect(x, top, boxW, boxH, 5, 5, 'F')
    font(doc, 10, 'bold')
    setColor(doc, SECONDARY)
    doc.text(b.title, x + 10, top + 16)
    font(doc, 18, 'bold')
    setColor(doc, PRIMARY)
    doc.text(b.value, x + 10, top + 34)
    font(doc, 9, 'normal')
    setColor(doc, SECONDARY)
    doc.text(b.subtitle, x + 10, top + 47)
    font(doc, 10, 'bold')
    setColor(doc, b.detailColor)
    doc.text(b.detail, x + boxW - 10, top + 16, { align: 'right' })
    if (b.hint) {
      font(doc, 9, 'italic')
      setColor(doc, SECONDARY)
      doc.text(b.hint, x + boxW - 10, top + 30, { align: 'right' })
    }
  })
  cur.y = top + boxH
}

function drawMaterialAnalysis(cur: Cur, a: PdfMaterialAnalysis) {
  const { doc } = cur

  // Gore target thickness (plate only)
  if (a.gore) {
    const goreH = 56
    ensure(cur, goreH + 14)
    const g = a.gore
    doc.setFillColor(GORE_BG[0], GORE_BG[1], GORE_BG[2])
    doc.roundedRect(L, cur.y, CONTENT_W, goreH, 4, 4, 'F')
    font(doc, 10, 'bold')
    setColor(doc, SECONDARY)
    doc.text('Gore Target Thickness', L + 8, cur.y + 14)
    font(doc, 16, 'bold')
    setColor(doc, ACCENT)
    doc.text(g.thickness, L + 8, cur.y + 32)
    font(doc, 9, g.goreItalic ? 'italic' : 'normal')
    setColor(doc, SECONDARY)
    doc.text(g.glc, L + 8, cur.y + 44)
    font(doc, 9, 'normal')
    setColor(doc, SECONDARY)
    doc.text(`${g.body} · ${g.fvs}`, L + 8, cur.y + 53)
    cur.y += goreH + 14
    divider(cur)
    cur.y += 14
  }

  ensure(cur, 30)
  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  doc.text(a.title, L, cur.y)
  cur.y += 18

  // Sample dimensions
  if (a.dimensions.length) {
    ensure(cur, 14)
    font(doc, 10, 'bold')
    setColor(doc, SECONDARY)
    doc.text('Sample Dimensions', L, cur.y)
    cur.y += 14
    twoColRows(cur, a.dimensions)
    cur.y += 8
  }

  // Frequencies row
  if (a.freqs.length) {
    ensure(cur, 16)
    font(doc, 10, 'normal')
    setColor(doc, PRIMARY)
    doc.text(a.freqs.join('       '), L, cur.y)
    cur.y += 18
  }

  // Property rows (two columns)
  twoColRows(cur, a.props)

  // Ratios (plate)
  if (a.ratios.length) {
    cur.y += 4
    twoColRows(cur, a.ratios)
  }

  // Overall quality pill
  cur.y += 10
  ensure(cur, 24)
  doc.setFillColor(BOX_BG[0], BOX_BG[1], BOX_BG[2])
  doc.roundedRect(L, cur.y - 12, CONTENT_W, 20, 4, 4, 'F')
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  doc.text('Overall Quality:', L + 8, cur.y + 1)
  font(doc, 13, 'bold')
  setColor(doc, hexToRgb(a.overall.color))
  doc.text(a.overall.value, L + 110, cur.y + 1)
  cur.y += 16
}

/** Render label/value props in two columns, advancing cur.y row by row. */
function twoColRows(cur: Cur, rows: PdfMaterialProp[]) {
  const { doc } = cur
  const colW = CONTENT_W / 2
  for (let i = 0; i < rows.length; i += 2) {
    ensure(cur, 14)
    for (let c = 0; c < 2; c++) {
      const row = rows[i + c]
      if (!row) continue
      const x = L + c * colW
      font(doc, 10, 'normal')
      setColor(doc, SECONDARY)
      doc.text(row.label + ':', x, cur.y)
      const labelW = doc.getTextWidth(row.label + ': ')
      font(doc, 10, 'bold')
      setColor(doc, row.color ? hexToRgb(row.color) : PRIMARY)
      doc.text(row.value, x + labelW, cur.y)
      if (row.hint) {
        const vW = doc.getTextWidth(row.value + ' ')
        font(doc, 9, 'italic')
        setColor(doc, SECONDARY)
        doc.text(row.hint, x + labelW + vW, cur.y)
      }
    }
    cur.y += 14
  }
}

function drawTapInstructions(cur: Cur, ti: PdfTapInstructions) {
  const { doc } = cur
  cur.y += 14
  ensure(cur, 30)
  divider(cur)
  cur.y += 14
  font(doc, 10, 'bold')
  setColor(doc, PRIMARY)
  doc.text(ti.heading, L, cur.y)
  cur.y += 14
  for (const s of ti.steps) {
    ensure(cur, 34)
    const col = hexToRgb(s.color)
    doc.setFillColor(col[0], col[1], col[2])
    doc.circle(L + 4, cur.y - 3, 3, 'F')
    font(doc, 10, 'bold')
    setColor(doc, PRIMARY)
    doc.text(s.title, L + 14, cur.y)
    cur.y += 12
    font(doc, 9, 'normal')
    setColor(doc, SECONDARY)
    const lines = doc.splitTextToSize(s.detail, CONTENT_W - 14) as string[]
    doc.text(lines, L + 14, cur.y)
    cur.y += lines.length * 11 + 4
  }
  ensure(cur, 14)
  font(doc, 9, 'italic')
  setColor(doc, SECONDARY)
  doc.text(ti.foot, L, cur.y)
  cur.y += 14
}

/** "Peak Mode Comparison" table — one row per overlaid spectrum (Spectrum · Air · Top · Back).
 *  Mirrors Swift ComparisonPDFReportContentView.peakModeTableSection. */
function drawComparisonTable(cur: Cur, comp: PdfComparison) {
  const { doc } = cur
  const COL_W = 90
  const modeX = [R - COL_W * 3, R - COL_W * 2, R - COL_W] // right edges of Spectrum / Air / Top blocks
  const labelMax = modeX[0]! - L - 18 // dot + gap before the first mode column

  ensure(cur, 40)
  font(doc, 13, 'bold')
  setColor(doc, PRIMARY)
  doc.text('Peak Mode Comparison', L, cur.y)
  cur.y += 16

  // Header pill
  doc.setFillColor(PILL_BG[0], PILL_BG[1], PILL_BG[2])
  doc.roundedRect(L, cur.y - 10, CONTENT_W, 16, 3, 3, 'F')
  font(doc, 10, 'bold')
  setColor(doc, SECONDARY)
  doc.text('Spectrum', L + 6, cur.y)
  ;['Air', 'Top', 'Back'].forEach((lbl, i) => doc.text(lbl, modeX[i]! + COL_W - 6, cur.y, { align: 'right' }))
  cur.y += 16

  for (const row of comp.rows) {
    ensure(cur, 14)
    const c = cssToRgb(row.color)
    doc.setFillColor(c[0], c[1], c[2])
    doc.circle(L + 5, cur.y - 3, 4, 'F')
    font(doc, 10, 'normal')
    setColor(doc, PRIMARY)
    const label = (doc.splitTextToSize(row.label, labelMax) as string[])[0] ?? row.label
    doc.text(label, L + 14, cur.y)
    const freqs = [row.air, row.top, row.back]
    freqs.forEach((f, i) => {
      setColor(doc, f != null ? PRIMARY : SECONDARY)
      doc.text(f != null ? `${f.toFixed(1)} Hz` : '—', modeX[i]! + COL_W - 6, cur.y, { align: 'right' })
    })
    cur.y += 14
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