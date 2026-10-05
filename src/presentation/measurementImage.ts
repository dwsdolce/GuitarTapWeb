// @parity view/pdf-report tests=test/pdf-report

import { classifyAll, type ResolvedMode } from '../dsp/classify'
import { Pitch } from '../dsp/pitch'
import { MODE_DISPLAY_NAME, MODE_BY_DISPLAY_NAME } from './modeColors'
import { color as roleColor, modeRole, qualityRole, type Role } from './palette'
import { FieldPrecision } from '../precision'
import type { PeakMarker, SpectrumOverlay } from './chartTypes'
import type { SpectrumImageOpts } from './spectrumExport'
import { measurementToLive, measurementToLiveMaterial, measurementTypeName, comparisonAxisRange, comparisonEntryModeFreqs, colorComponentsToCss, multiTapComparisonEntries, measurementTapToneRatio } from '../measurement/fromLive'
import { isGuitarType, MEASUREMENT_FULL_NAME, STIFFNESS_RAW_NAME, DEFAULT_SETTINGS } from '../settings'
import { materialDimensions, materialStiffness } from '../measurement/materialMeasurementInputs'
import { formatDisplayDate } from '../format/date'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { effectiveSelectedPeakIDs, type TapToneMeasurementModel } from '../measurement'
import { MODE_DISPLAY_NAME as MODE_FULL_NAME } from './modeColors'
import { decayQuality, decayQualityColor, tapToneRatioQuality, tapToneRatioQualityColor } from '../dsp/analysisQuality'
import { BraceProperties, MaterialDimensions, PlateProperties, type Dimensions, type WoodQuality } from '../dsp/material'
import type { PdfReportData, PdfPeakRow, PdfMaterialAnalysis, PdfMaterialProp, PdfTapInstructions } from './pdfReport'
import { generateMultiTapPdfReport, generatePdfReport } from './pdfReport'
import { exportStem } from '../measurement/exportFilename'
import type { ResonantPeak } from '../measurement/types'

const pitch = new Pitch(440)
type AnnoMode = 'all' | 'selected' | 'none'

/** A grade's colour in the report: its role's light value (the report is drawn on white). */
const qualityColor = (q: WoodQuality): string => roleColor(qualityRole(q), undefined, 'light')
/** The plate/brace phase colours in the report: their roles' light values. */
const ROLE_L = roleColor('material.longitudinal', undefined, 'light')
const ROLE_C = roleColor('material.cross', undefined, 'light')
const ROLE_FLC = roleColor('material.flc', undefined, 'light')


/** Styled guitar peak markers (dot color + mode label + pitch + override/annotation) — the SAME
 *  mapping the live view uses, so the on-screen chart and exported image agree. */
export function buildGuitarMarkers(
  peaks: ResonantPeak[],
  modeByPeak: Map<string, ResolvedMode>,
  selectedIds: Set<string>,
  overridesById: Map<string, string>,
  annotationMode: AnnoMode,
  offsetsById?: Map<string, [number, number]>,
): PeakMarker[] {
  return peaks.map((p) => {
    const key = p.id // the annotation-offset key is the peak id (analyzer-owned store)
    const mode = modeByPeak.get(p.id) ?? 'unknown'
    const override = overridesById.get(p.id) // overrides are id-keyed (analyzer-owned)
    // Override wins for color too (like the label): a predefined override uses that mode's color, a
    // freeform label is user-defined; else the auto-classified mode's color. Mirrors Swift peakColor /
    // Python peak_color — so the callout AND the Detected Peaks Summary chip match the override.
    const overrideMode = override != null ? MODE_BY_DISPLAY_NAME[override] : undefined
    const annotated = annotationMode === 'all' ? true : annotationMode === 'selected' ? selectedIds.has(p.id) : false
    const note = pitch.note(p.frequency)
    return {
      id: p.id,
      frequency: p.frequency,
      magnitude: p.magnitude,
      role: override != null ? (overrideMode ? modeRole(overrideMode) : 'mode.userDefined') : modeRole(mode),
      label: override ?? MODE_DISPLAY_NAME[mode],
      note: note ?? undefined,
      cents: note ? pitch.cents(p.frequency) : undefined,
      isOverride: override !== undefined,
      annotated,
      annoKey: key,
      annoOffset: offsetsById?.get(p.id),
    }
  })
}

/** Material phase markers (L=blue, C=orange, FLC=purple), matching the live view + native colors.
 *  Each marker carries an `annoKey` (frequency.toFixed(1)) + its dragged `annoOffset`, exactly like
 *  guitar markers — material reuses the single shared offset store (Swift/Python peakAnnotationOffsets). */
export function buildMaterialMarkers(
  matPeaks: {
    longitudinal: ResonantPeak | null
    cross: ResonantPeak | null
    flc: ResonantPeak | null
  },
  mode: AnnoMode,
  offsetsById?: Map<string, [number, number]>,
): PeakMarker[] {
  // Material (plate/brace) has no per-peak selection, so All and Selected both annotate every
  // identified peak; None hides all badges (dots remain). Mirrors Swift/Python visiblePeaks.
  const annotated = mode !== 'none'
  const out: PeakMarker[] = []
  const push = (mp: ResonantPeak, role: Role, label: string) => {
    const key = mp.id // material offsets are id-keyed in the shared analyzer store
    out.push({ ...mp, role, label, annotated, annoKey: key, annoOffset: offsetsById?.get(mp.id) })
  }
  if (matPeaks.longitudinal) push(matPeaks.longitudinal, 'material.longitudinal', 'Longitudinal')
  if (matPeaks.cross) push(matPeaks.cross, 'material.cross', 'Cross-grain')
  if (matPeaks.flc) push(matPeaks.flc, 'material.flc', 'Diagonal')
  return out
}

/** Build the spectrum-image opts for a saved measurement (guitar / material / comparison). */
export function measurementToImageOpts(m: TapToneMeasurementModel): SpectrumImageOpts {
  const date = formatDisplayDate(m.timestamp)
  const title = `FFT Peaks — ${m.measurementName?.trim() || measurementTypeName(m)}`

  // Comparison
  if (m.comparisonEntries && m.comparisonEntries.length) {
    const entries = m.comparisonEntries
    const overlays: SpectrumOverlay[] = entries.map((e) => ({
      magnitudesDb: e.snapshot.magnitudes,
      frequencies: e.snapshot.frequencies,
      color: colorComponentsToCss(e.colorComponents),
      label: e.label,
    }))
    const view = comparisonAxisRange(entries) ?? { minHz: 30, maxHz: 2000, minDb: -100, maxDb: 0 }
    return { title, spectrum: null, overlays, markers: [], view, measurementTypeName: 'Comparison', date }
  }

  // Material (plate / brace)
  if (m.longitudinalSnapshot) {
    const r = measurementToLiveMaterial(m)
    const overlays: SpectrumOverlay[] = []
    if (r.matSpectra.longitudinal) overlays.push({ ...r.matSpectra.longitudinal, role: 'material.longitudinal', label: 'Longitudinal (fL)' })
    if (r.matSpectra.cross) overlays.push({ ...r.matSpectra.cross, role: 'material.cross', label: 'Cross-grain (fC)' })
    if (r.matSpectra.flc) overlays.push({ ...r.matSpectra.flc, role: 'material.flc', label: 'Diagonal (fLC)' })
    const s = m.longitudinalSnapshot
    return {
      title,
      spectrum: null,
      overlays,
      markers: buildMaterialMarkers(
        { longitudinal: r.selectedLongitudinalPeak, cross: r.selectedCrossPeak, flc: r.selectedFlcPeak },
        (m.annotationVisibilityMode as AnnoMode) ?? 'all',
        r.annotationOffsetsById,
      ),
      view: { minHz: s.minFreq, maxHz: s.maxFreq, minDb: s.minDB, maxDb: s.maxDB },
      measurementTypeName: MEASUREMENT_FULL_NAME[r.measurementType],
      date,
    }
  }

  // Guitar
  const r = measurementToLive(m)
  const guitarType: GuitarTypeName = isGuitarType(r.measurementType) ? r.measurementType : 'generic'
  const modeByPeak = classifyAll(r.loadedPeaks, guitarType)
  const markers = buildGuitarMarkers(
    r.loadedPeaks,
    modeByPeak,
    r.selectedIds,
    r.overridesById,
    (m.annotationVisibilityMode as AnnoMode) ?? 'all',
    r.annotationOffsetsById,
  )
  return {
    title,
    spectrum: r.captured,
    markers,
    view: r.view,
    guitarType,
    measurementTypeName: MEASUREMENT_FULL_NAME[r.measurementType],
    date,
  }
}

// Reverse of MODE_DISPLAY_NAME so a predefined override label can be coloured like its mode.
const MODE_BY_DISPLAY = new Map<string, ResolvedMode>(
  (Object.entries(MODE_FULL_NAME) as [ResolvedMode, string][]).map(([mode, name]) => [name, mode]),
)
/** Color for a peak's effective mode label (override-aware), mirroring Swift's PDF peakRow color: its role's light
 *  value (the report is drawn on white). */
function modeLabelColor(mode: ResolvedMode, override: string | undefined): string {
  if (override == null) return roleColor(modeRole(mode), undefined, 'light')
  const m = MODE_BY_DISPLAY.get(override)
  return roleColor(m ? modeRole(m) : 'mode.userDefined', undefined, 'light')
}

/**
 * Build the full single-page PDF report data for a saved measurement (guitar / plate /
 * brace / comparison). Reuses `measurementToImageOpts` for the embedded chart, then adds
 * the metadata, peaks table and analysis the Swift PDFReportData carries. The live footer
 * passes a transient measurement built by the same builders Save uses, so the live and
 * saved reports are identical for the same data.
 */
export function measurementToPdfData(m: TapToneMeasurementModel): PdfReportData {
  const image = measurementToImageOpts(m)
  const base = {
    image,
    timestamp: formatDisplayDate(m.timestamp),
    measurementName: m.measurementName,
    notes: m.notes,
    microphoneName: m.microphoneName,
    calibrationName: m.calibrationName,
    measurementTypeName: image.measurementTypeName ?? measurementTypeName(m),
    freqRange: { min: image.view.minHz, max: image.view.maxHz },
  }

  // Comparison — a "Peak Mode Comparison" table (Spectrum · Air · Top · Back per overlay)
  // replaces the peaks/analysis sections (Swift ComparisonPDFReportContentView).
  if (m.comparisonEntries && m.comparisonEntries.length) {
    const entries = m.comparisonEntries
    return {
      ...base,
      kind: 'comparison',
      peaks: [],
      comparison: {
        spectraCount: entries.length,
        rows: entries.map((e) => ({
          label: e.label,
          color: colorComponentsToCss(e.colorComponents),
          ...comparisonEntryModeFreqs(e),
        })),
      },
    }
  }

  // Material (plate / brace)
  if (m.longitudinalSnapshot) return materialPdfData(m, base)

  // Guitar
  return guitarPdfData(m, base)
}

/** Two-page PDF data for a multi-tap guitar measurement (Swift `generateMultiTapReport`): page 1 is
 *  the averaged single-measurement report, page 2 the per-tap comparison. Page 2 reuses the comparison
 *  PDF path by synthesizing comparison entries from the measurement's `tapEntries` + an "Averaged"
 *  entry — so it stays identical to a saved-comparison report. Callers use it for a measurement with tap entries. */
export function multiTapPdfData(m: TapToneMeasurementModel): { averaged: PdfReportData; comparison: PdfReportData } {
  return {
    averaged: measurementToPdfData(m),
    comparison: measurementToPdfData({ ...m, comparisonEntries: multiTapComparisonEntries(m) }),
  }
}

/** A saved measurement's PDF report and its file name (without extension): a multi-tap measurement's two
 *  pages (the averaged result, then the per-tap comparison), a comparison's report, or the single report.
 *  What the measurement list exports. Mirrors Swift `PDFReportGenerator.report(for:)`. */
export async function reportForMeasurement(m: TapToneMeasurementModel): Promise<{ blob: Blob; basename: string }> {
  const basename = exportStem(m.measurementName, Math.floor((Date.parse(m.timestamp) || 0) / 1000), 'report')
  if (m.tapEntries && m.tapEntries.length > 0) {
    const pages = multiTapPdfData(m)
    return { blob: await generateMultiTapPdfReport(pages.averaged, pages.comparison), basename }
  }
  return { blob: await generatePdfReport(measurementToPdfData(m)), basename }
}

type PdfBase = Pick<
  PdfReportData,
  'image' | 'timestamp' | 'measurementName' | 'notes' | 'microphoneName' | 'calibrationName' | 'measurementTypeName' | 'freqRange'
>

function guitarPdfData(m: TapToneMeasurementModel, base: PdfBase): PdfReportData {
  const r = measurementToLive(m)
  const guitarType: GuitarTypeName = isGuitarType(r.measurementType) ? r.measurementType : 'generic'
  const modeByPeak = classifyAll(r.loadedPeaks, guitarType)

  // Swift's PDF table = rangeFilteredPeaks ∩ selectedPeakIDs, low → high: only SELECTED peaks that
  // fall within the displayed frequency range (Swift PDFReportGenerator.rangeFilteredPeaks +
  // visibleSortedPeaks). Peaks outside [minFreq, maxFreq] are excluded.
  const visible = r.loadedPeaks
    .filter((p) => r.selectedIds.has(p.id) && p.frequency >= base.freqRange.min && p.frequency <= base.freqRange.max)
    .sort((a, b) => a.frequency - b.frequency)
  const peaks: PdfPeakRow[] = visible.map((p) => {
    const mode = modeByPeak.get(p.id) ?? 'unknown'
    const override = r.overridesById.get(p.id) // id-keyed overrides
    return {
      frequency: p.frequency,
      magnitude: p.magnitude,
      note: p.pitchNote ?? '–', // the peak's stored note, as Swift's peak table (peak.pitchNote ?? "–")
      quality: p.quality,
      modeLabel: override ?? MODE_FULL_NAME[mode],
      modeColor: modeLabelColor(mode, override),
      isOverride: override != null,
    }
  })

  const ratio = measurementTapToneRatio(m) // the DEFINITIVE ratio — agrees with screen + saved-list
  const decay = m.decayTime ?? null
  return {
    ...base,
    kind: 'guitar',
    peaks,
    guitarAnalysis: {
      decayTime: decay,
      decayQuality: decay != null ? decayQuality(decay, guitarType) : undefined,
      decayColor: decay != null ? decayQualityColor(decay, guitarType).light : undefined,
      tapToneRatio: ratio,
      ratioQuality: ratio != null ? tapToneRatioQuality(ratio) : undefined,
      ratioColor: ratio != null ? tapToneRatioQualityColor(ratio).light : undefined,
    },
  }
}

function materialPdfData(m: TapToneMeasurementModel, base: PdfBase): PdfReportData {
  const r = measurementToLiveMaterial(m)
  const plate = r.measurementType === 'plate'
  // Dimensions, body size, and stiffness ALL come from the measurement's own Store B (materialInputs),
  // never the live/default Settings — mirrors buildMaterialMeasurement + Swift's PDFReportData.from,
  // which read materialInputs. (Sourcing these from DEFAULT_SETTINGS made every export compute density,
  // moduli, and Gore thickness from template dims.) `measureFlc` is a capture flag, so it stays from the
  // restored settings patch.
  const mi = r.materialInputs
  const dims: Dimensions = materialDimensions(mi)
  const fvs = materialStiffness(mi)
  const rhoGcm3 = new MaterialDimensions(dims).densityGPerCm3
  const fL = r.selectedLongitudinalPeak?.frequency ?? null
  const fC = r.selectedCrossPeak?.frequency ?? null
  const fLC = r.selectedFlcPeak?.frequency ?? null
  const measureFlc = r.settingsPatch.measureFlc ?? DEFAULT_SETTINGS.measureFlc
  const showFlc = plate && measureFlc

  // Peaks table — as Swift's report: the measurement's peaks within the frequency range, by the effective
  // selection (a plate or brace shows all its peaks), sorted low → high; each peak's role by its id — fL,
  // fC, fLC for a plate, fL for a brace — or "–".
  const effective = effectiveSelectedPeakIDs(m)
  const rolePeaks = m.peaks
    .filter((p) => effective.has(p.id) && p.frequency >= base.freqRange.min && p.frequency <= base.freqRange.max)
    .sort((a, b) => a.frequency - b.frequency)
  const roleOf = (p: ResonantPeak): { role?: string; roleColor?: string } => {
    if (p.id === m.selectedLongitudinalPeakID) return { role: 'Longitudinal (fL)', roleColor: ROLE_L }
    if (plate && p.id === m.selectedCrossPeakID) return { role: 'Cross-grain (fC)', roleColor: ROLE_C }
    if (plate && p.id === m.selectedFlcPeakID) return { role: 'Diagonal (fLC)', roleColor: ROLE_FLC }
    return {}
  }
  const peaks: PdfPeakRow[] = rolePeaks.map((p) => ({
    frequency: p.frequency,
    magnitude: p.magnitude,
    note: p.pitchNote ?? '–',
    quality: p.quality,
    ...roleOf(p),
  }))

  const dimensions: PdfMaterialProp[] = [
    { label: 'Length', value: `${FieldPrecision.string(dims.lengthMm, FieldPrecision.linearDimensionMM)} mm` },
    { label: 'Width', value: `${FieldPrecision.string(dims.widthMm, FieldPrecision.linearDimensionMM)} mm` },
    { label: 'Thickness', value: `${FieldPrecision.string(dims.thicknessMm, FieldPrecision.linearDimensionMM)} mm` },
    { label: 'Mass', value: `${FieldPrecision.string(dims.massG, FieldPrecision.massG)} g` },
    { label: 'Density', value: `${FieldPrecision.string(rhoGcm3, FieldPrecision.densityGPerCm3)} g/cm³` },
  ]

  // Swift builds the properties only from the identified peaks (fL, and fC for a plate) and a sample with
  // length and mass; without them the report has no material section.
  const hasSample = dims.lengthMm > 0 && dims.massG > 0
  const materialReport = (materialAnalysis: PdfMaterialAnalysis | undefined): PdfReportData => ({
    ...base,
    kind: plate ? 'plate' : 'brace',
    peaks,
    materialAnalysis,
    tapInstructions: materialTapInstructions(plate, showFlc),
  })
  let analysis: PdfMaterialAnalysis
  if (!plate) {
    if (fL == null || !hasSample) return materialReport(undefined)
    const props = new BraceProperties(new MaterialDimensions(dims), fL)
    const eL = props.youngsModulusLongGPa
    const smL = props.specificModulusLong
    const cL = props.speedOfSoundLong
    const rL = props.radiationRatioLong
    const qL = props.spruceQuality
    analysis = {
      title: 'Brace Properties',
      gore: null,
      body: null,
      dimensions,
      props: [
        { label: 'Speed of Sound', value: `${FieldPrecision.string(cL, FieldPrecision.speedOfSoundMS)} m/s` },
        { label: "Young's Modulus (E)", value: `${FieldPrecision.string(eL, FieldPrecision.youngsModulusGPa)} GPa` },
        { label: 'Specific Modulus', value: FieldPrecision.string(smL, FieldPrecision.specificModulus), color: qualityColor(qL), hint: `(${qL})` },
        { label: 'Radiation Ratio', value: FieldPrecision.string(rL, FieldPrecision.radiationRatio) },
      ],
      ratios: [],
      overall: { value: qL, color: qualityColor(qL) },
    }
  } else {
    if (fL == null || fC == null || !hasSample) return materialReport(undefined)
    const props = new PlateProperties(new MaterialDimensions(dims), fL, fC, fLC)
    const eL = props.youngsModulusLongGPa
    const eC = props.youngsModulusCrossGPa
    const smL = props.specificModulusLong
    const smC = props.specificModulusCross
    const cL = props.speedOfSoundLong
    const cC = props.speedOfSoundCross
    const rL = props.radiationRatioLong
    const rC = props.radiationRatioCross
    const qL = props.spruceQualityLong
    const qC = props.spruceQualityCross
    const overall = props.overallQuality
    const shearPa = props.goreShearModulus
    const target = props.goreTargetThickness(mi.bodyLengthMm, mi.bodyWidthMm, fvs)
    const crossLong = props.crossLongRatio
    const longCross = props.longCrossRatio
    const presetName = STIFFNESS_RAW_NAME[mi.stiffnessPreset]
    const fvsLine = mi.stiffnessPreset === 'custom' ? `f_vs = ${FieldPrecision.string(fvs, FieldPrecision.stiffness)} (custom)` : `f_vs = ${FieldPrecision.string(fvs, FieldPrecision.stiffness)} (${presetName})`

    analysis = {
      title: 'Plate Properties',
      // Gore Target Thickness = just the number now (Swift goreThicknessPDFSection). Body inputs + f_vs
      // move to the Body Dimensions block; GLC moves among the Plate Properties moduli.
      gore: target != null ? { thickness: `${FieldPrecision.string(target, FieldPrecision.goreThicknessMM)} mm` } : null,
      body: {
        dims: [
          { label: 'Body Length (a)', value: `${FieldPrecision.string(mi.bodyLengthMm, FieldPrecision.bodyDimensionMM)} mm` },
          { label: 'Lower Bout Width (b)', value: `${FieldPrecision.string(mi.bodyWidthMm, FieldPrecision.bodyDimensionMM)} mm` },
        ],
        stiffness: { label: 'Panel Stiffness', value: fvsLine },
      },
      dimensions,
      props: [
        { label: 'Speed of Sound (L)', value: `${FieldPrecision.string(cL, FieldPrecision.speedOfSoundMS)} m/s` },
        { label: 'Speed of Sound (C)', value: `${FieldPrecision.string(cC, FieldPrecision.speedOfSoundMS)} m/s` },
        { label: "Young's Modulus (L)", value: `${FieldPrecision.string(eL, FieldPrecision.youngsModulusGPa)} GPa` },
        { label: "Young's Modulus (C)", value: `${FieldPrecision.string(eC, FieldPrecision.youngsModulusGPa)} GPa` },
        { label: 'Specific Modulus (L)', value: FieldPrecision.string(smL, FieldPrecision.specificModulus), color: qualityColor(qL), hint: `(${qL})` },
        { label: 'Specific Modulus (C)', value: FieldPrecision.string(smC, FieldPrecision.specificModulus), color: qualityColor(qC), hint: `(${qC})` },
        { label: 'Radiation Ratio (L)', value: FieldPrecision.string(rL, FieldPrecision.radiationRatio) },
        { label: 'Radiation Ratio (C)', value: FieldPrecision.string(rC, FieldPrecision.radiationRatio) },
      ],
      // Full-width GLC row after the two-column block — Swift PDFReportGenerator.swift:822-831:
      //   if let glc = props.goreShearModulus { platePropRow("GLC (Shear Modulus)", …) }
      //   else { Text("GLC assumed 0 — fLC tap not performed").italic() }
      glc: shearPa != null ? { label: 'GLC (Shear Modulus)', value: `${FieldPrecision.string(shearPa / 1e9, FieldPrecision.shearModulusGPa)} GPa` } : null,
      glcNote: shearPa == null ? 'GLC assumed 0 — fLC tap not performed' : null,
      // `note`, not `hint`: Swift puts the typical range on its OWN line beneath the ratio, italic
      // and WITHOUT parentheses (PDFReportGenerator.swift:837-856) — not inline after the value.
      ratios: [
        { label: 'Cross/Long Ratio', value: FieldPrecision.string(crossLong, FieldPrecision.crossLongRatio), note: 'typical: 0.04–0.08' },
        { label: 'Long/Cross Ratio', value: FieldPrecision.string(longCross, FieldPrecision.longCrossRatio), note: 'typical: 12–25' },
      ],
      overall: { value: overall, color: qualityColor(overall) },
    }
  }

  return materialReport(analysis)
}

function materialTapInstructions(plate: boolean, hasFlc: boolean): PdfTapInstructions {
  if (!plate) {
    return {
      heading: 'Single-Tap Measurement (fL only):',
      steps: [
        {
          color: ROLE_L,
          title: '1. Longitudinal (fL) Tap',
          detail: 'Hold brace at 22% from one end along the length. Tap center.',
        },
      ],
      foot: 'The strongest peak is auto-selected.',
    }
  }
  const steps = [
    {
      color: ROLE_L,
      title: '1. Longitudinal (fL) Tap',
      detail: 'Hold plate at 22% from one end along the length, near one long edge (not at the width node). Tap center.',
    },
    {
      color: ROLE_C,
      title: '2. Cross-grain (fC) Tap',
      detail: 'Rotate 90°. Hold plate at 22% from one end along the width, near one short edge (not at the length node). Tap center.',
    },
  ]
  if (hasFlc) {
    steps.push({
      color: ROLE_FLC,
      title: '3. Diagonal (fLC) Tap',
      detail:
        'Hold plate at the midpoint of one long edge. Tap near the opposite corner (~22% from both the end and the side). Measures shear stiffness.',
    })
  }
  return { heading: hasFlc ? 'Three-Tap Measurement Process:' : 'Two-Tap Measurement Process:', steps, foot: 'The strongest peak from each tap is auto-selected.' }
}