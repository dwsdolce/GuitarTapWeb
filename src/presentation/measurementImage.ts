// Bridge: build the spectrum-image opts (styled markers + spectrum/overlays + view + metadata) for a
// SAVED measurement, so the Saved-Measurements row menu can Export Spectrum / Export PDF Report and
// the PDF can embed the same composite. The marker builders are shared with the live view (App.tsx)
// so the displayed graph and the exported image use identical peak styling.

import type { Peak } from '../dsp/peaks'
import { classifyAll, type ResolvedMode } from '../dsp/classify'
import { Pitch } from '../dsp/pitch'
import { MODE_COLOR, MODE_DISPLAY_NAME } from './modeColors'
import type { PeakMarker, SpectrumOverlay } from './chartTypes'
import type { SpectrumImageOpts } from './spectrumExport'
import {
  measurementToLive,
  measurementToLiveMaterial,
  measurementTypeName,
  comparisonAxisRange,
  comparisonEntryModeFreqs,
  colorComponentsToCss,
} from '../measurement/fromLive'
import {
  isGuitarType,
  MEASUREMENT_FULL_NAME,
  STIFFNESS_LABEL,
  effectiveStiffness,
  DEFAULT_SETTINGS,
  type Settings,
} from '../settings'
import { formatDisplayDate } from '../format/date'
import type { GuitarTypeName } from '../dsp/guitarModes'
import type { TapToneMeasurementModel } from '../measurement'
import type { MaterialPeak } from '../dsp/gatedCapture'
import { MODE_DISPLAY_NAME as MODE_FULL_NAME } from './modeColors'
import { decayQuality, decayQualityColor, tapToneRatio, tapToneRatioQuality, tapToneRatioQualityColor } from '../dsp/analysisQuality'
import {
  density,
  densityGPerCm3,
  plateYoungsLongGPa,
  plateYoungsLongPa,
  plateYoungsCrossGPa,
  plateYoungsCrossPa,
  braceYoungsLongGPa,
  braceYoungsLongPa,
  speedOfSound,
  specificModulus,
  goreShearPa,
  goreTargetThicknessMm,
  woodQuality,
  overallQuality,
  type WoodQuality,
  type Dimensions,
} from '../dsp/material'
import type {
  PdfReportData,
  PdfPeakRow,
  PdfMaterialAnalysis,
  PdfMaterialProp,
  PdfTapInstructions,
} from './pdfReport'

const pitch = new Pitch(440)
type AnnoMode = 'all' | 'selected' | 'none'

// Wood-quality → color, matching MaterialResults' QUALITY_COLOR (Swift WoodQuality.color).
const QUALITY_COLOR: Record<WoodQuality, string> = {
  Excellent: '#30d158',
  'Very Good': '#34c759',
  Good: '#ffd60a',
  Fair: '#ff9f0a',
  Poor: '#ff453a',
}
const ROLE_L = '#0a84ff'
const ROLE_C = '#ff9f0a'
const ROLE_FLC = '#bf5af2'

const f0 = (n: number) => Math.round(n).toString()
const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
const f3 = (n: number) => n.toFixed(3)

/** Styled guitar peak markers (dot color + mode label + pitch + override/annotation) — the SAME
 *  mapping the live view uses, so the on-screen chart and exported image agree. */
export function buildGuitarMarkers(
  peaks: Peak[],
  modeByPeak: Map<number, ResolvedMode>,
  selectedIds: Set<number>,
  overridesByFreq: Map<string, string>,
  annotationMode: AnnoMode,
  offsetsByFreq?: Map<string, [number, number]>,
): PeakMarker[] {
  return peaks.map((p) => {
    const key = p.frequency.toFixed(1)
    const mode = modeByPeak.get(p.id) ?? 'unknown'
    const override = overridesByFreq.get(key)
    const annotated = annotationMode === 'all' ? true : annotationMode === 'selected' ? selectedIds.has(p.id) : false
    const note = pitch.note(p.frequency)
    return {
      frequency: p.frequency,
      magnitude: p.magnitude,
      color: mode !== 'unknown' ? MODE_COLOR[mode] : undefined,
      label: override ?? MODE_DISPLAY_NAME[mode],
      note: note ?? undefined,
      cents: note ? pitch.cents(p.frequency) : undefined,
      isOverride: override !== undefined,
      annotated,
      annoKey: key,
      annoOffset: offsetsByFreq?.get(key),
    }
  })
}

/** Material phase markers (L=blue, C=orange, FLC=purple), matching the live view + native colors. */
export function buildMaterialMarkers(matPeaks: {
  longitudinal: MaterialPeak | null
  cross: MaterialPeak | null
  flc: MaterialPeak | null
}): PeakMarker[] {
  const out: PeakMarker[] = []
  if (matPeaks.longitudinal) out.push({ ...matPeaks.longitudinal, color: '#4ea1ff', label: 'Longitudinal', annotated: true })
  if (matPeaks.cross) out.push({ ...matPeaks.cross, color: '#f0a03a', label: 'Cross-grain', annotated: true })
  if (matPeaks.flc) out.push({ ...matPeaks.flc, color: '#b07ad8', label: 'FLC', annotated: true })
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
    if (r.matSpectra.longitudinal) overlays.push({ ...r.matSpectra.longitudinal, color: '#4ea1ff', label: 'Longitudinal (L)' })
    if (r.matSpectra.cross) overlays.push({ ...r.matSpectra.cross, color: '#f0a03a', label: 'Cross-grain (C)' })
    if (r.matSpectra.flc) overlays.push({ ...r.matSpectra.flc, color: '#b07ad8', label: 'FLC' })
    const s = m.longitudinalSnapshot
    return {
      title,
      spectrum: null,
      overlays,
      markers: buildMaterialMarkers(r.matPeaks),
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
    r.selectedIndices,
    r.overridesByFreq,
    (m.annotationVisibilityMode as AnnoMode) ?? 'all',
    r.annotationOffsetsByFreq,
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
const USER_DEFINED_COLOR = '#3bb6a6' // teal, matching Swift GuitarMode.userDefinedColor

/** Color for a peak's effective mode label (override-aware), mirroring Swift's PDF peakRow color. */
function modeLabelColor(mode: ResolvedMode, override: string | undefined): string {
  if (override == null) return MODE_COLOR[mode]
  const m = MODE_BY_DISPLAY.get(override)
  return m ? MODE_COLOR[m] : USER_DEFINED_COLOR
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

type PdfBase = Pick<
  PdfReportData,
  'image' | 'timestamp' | 'measurementName' | 'notes' | 'microphoneName' | 'calibrationName' | 'measurementTypeName' | 'freqRange'
>

function guitarPdfData(m: TapToneMeasurementModel, base: PdfBase): PdfReportData {
  const r = measurementToLive(m)
  const guitarType: GuitarTypeName = isGuitarType(r.measurementType) ? r.measurementType : 'generic'
  const modeByPeak = classifyAll(r.loadedPeaks, guitarType)

  // Swift's visibleSortedPeaks: selected peaks only, low → high.
  const visible = r.loadedPeaks.filter((p) => r.selectedIndices.has(p.id)).sort((a, b) => a.frequency - b.frequency)
  const peaks: PdfPeakRow[] = visible.map((p) => {
    const mode = modeByPeak.get(p.id) ?? 'unknown'
    const override = r.overridesByFreq.get(p.frequency.toFixed(1))
    return {
      frequency: p.frequency,
      magnitude: p.magnitude,
      note: pitch.note(p.frequency) ?? '–',
      quality: p.quality,
      modeLabel: override ?? MODE_FULL_NAME[mode],
      modeColor: modeLabelColor(mode, override),
      isOverride: override != null,
    }
  })

  const ratio = tapToneRatio(r.loadedPeaks, guitarType)
  const decay = m.decayTime ?? null
  return {
    ...base,
    kind: 'guitar',
    peaks,
    guitarAnalysis: {
      decayTime: decay,
      decayQuality: decay != null ? decayQuality(decay, guitarType) : undefined,
      decayColor: decay != null ? decayQualityColor(decay, guitarType) : undefined,
      tapToneRatio: ratio,
      ratioQuality: ratio != null ? tapToneRatioQuality(ratio) : undefined,
      ratioColor: ratio != null ? tapToneRatioQualityColor(ratio) : undefined,
    },
  }
}

function materialPdfData(m: TapToneMeasurementModel, base: PdfBase): PdfReportData {
  const r = measurementToLiveMaterial(m)
  const plate = r.measurementType === 'plate'
  const s: Settings = { ...DEFAULT_SETTINGS, ...r.settingsPatch }
  const dims: Dimensions = plate
    ? { lengthMm: s.plateLength, widthMm: s.plateWidth, thicknessMm: s.plateThickness, massG: s.plateMass }
    : { lengthMm: s.braceLength, widthMm: s.braceWidth, thicknessMm: s.braceThickness, massG: s.braceMass }
  const rho = density(dims)
  const rhoGcm3 = densityGPerCm3(dims)
  const fL = r.matPeaks.longitudinal?.frequency ?? null
  const fC = r.matPeaks.cross?.frequency ?? null
  const fLC = r.matPeaks.flc?.frequency ?? null
  const showFlc = plate && s.measureFlc

  // Peaks table — selected L/C/FLC, sorted low → high (Swift visibleSortedPeaks + role cell).
  const roleRows: { peak: MaterialPeak; role: string; color: string }[] = []
  if (r.matPeaks.longitudinal)
    roleRows.push({ peak: r.matPeaks.longitudinal, role: plate ? 'Longitudinal (L)' : 'fL (Longitudinal)', color: ROLE_L })
  if (plate && r.matPeaks.cross) roleRows.push({ peak: r.matPeaks.cross, role: 'Cross-grain (C)', color: ROLE_C })
  if (showFlc && r.matPeaks.flc) roleRows.push({ peak: r.matPeaks.flc, role: 'FLC (Diagonal)', color: ROLE_FLC })
  roleRows.sort((a, b) => a.peak.frequency - b.peak.frequency)
  const peaks: PdfPeakRow[] = roleRows.map((rr) => ({
    frequency: rr.peak.frequency,
    magnitude: rr.peak.magnitude,
    note: pitch.note(rr.peak.frequency) ?? '–',
    quality: rr.peak.quality,
    role: rr.role,
    roleColor: rr.color,
  }))

  const dimensions: PdfMaterialProp[] = [
    { label: 'Length', value: `${f1(dims.lengthMm)} mm` },
    { label: 'Width', value: `${f1(dims.widthMm)} mm` },
    { label: 'Thickness', value: `${f2(dims.thicknessMm)} mm` },
    { label: 'Mass', value: `${f1(dims.massG)} g` },
    { label: 'Density', value: `${f3(rhoGcm3)} g/cm³` },
  ]

  let analysis: PdfMaterialAnalysis
  if (!plate) {
    // Brace
    const eL = fL != null ? braceYoungsLongGPa(dims, fL) : 0
    const smL = specificModulus(eL, rhoGcm3)
    const cL = fL != null ? speedOfSound(braceYoungsLongPa(dims, fL), rho) : 0
    const rL = cL / rho
    const qL = woodQuality(smL, 'longitudinal')
    analysis = {
      title: 'Brace Properties',
      gore: null,
      freqs: fL != null ? [`fL: ${f1(fL)} Hz`] : [],
      dimensions,
      props: [
        { label: 'Speed of Sound', value: `${f0(cL)} m/s` },
        { label: "Young's Modulus (E)", value: `${f2(eL)} GPa` },
        { label: 'Specific Modulus', value: f1(smL), color: QUALITY_COLOR[qL], hint: `(${qL})` },
        { label: 'Radiation Ratio', value: f1(rL) },
      ],
      ratios: [],
      overall: { value: qL, color: QUALITY_COLOR[qL] },
    }
  } else {
    const eL = fL != null ? plateYoungsLongGPa(dims, fL) : 0
    const eC = fC != null ? plateYoungsCrossGPa(dims, fC) : 0
    const smL = specificModulus(eL, rhoGcm3)
    const smC = specificModulus(eC, rhoGcm3)
    const cL = fL != null ? speedOfSound(plateYoungsLongPa(dims, fL), rho) : 0
    const cC = fC != null ? speedOfSound(plateYoungsCrossPa(dims, fC), rho) : 0
    const rL = cL / rho
    const rC = cC / rho
    const qL = woodQuality(smL, 'longitudinal')
    const qC = woodQuality(smC, 'cross')
    const overall = overallQuality(smL, smC)
    const shearPa = goreShearPa(dims, fLC)
    const target =
      fL != null && fC != null
        ? goreTargetThicknessMm(dims, fL, fC, fLC, s.guitarBodyLength, s.guitarBodyWidth, effectiveStiffness(s))
        : null
    const crossLong = eL > 0 ? eC / eL : 0
    const longCross = eC > 0 ? eL / eC : 0
    const fvs = effectiveStiffness(s)
    const presetName = STIFFNESS_LABEL[s.plateStiffnessPreset].replace(/\s*\(\d+\)$/, '')
    const fvsLine = s.plateStiffnessPreset === 'custom' ? `f_vs = ${f0(fvs)} (custom)` : `f_vs = ${f0(fvs)} (${presetName})`

    const freqs = [`fL: ${f1(fL ?? 0)} Hz`, `fC: ${f1(fC ?? 0)} Hz`]
    if (fLC != null) freqs.push(`fLC: ${f1(fLC)} Hz`)

    analysis = {
      title: 'Plate Properties',
      gore:
        target != null
          ? {
              thickness: `${f2(target)} mm`,
              glc: shearPa != null ? `GLC (Shear Modulus): ${f3(shearPa / 1e9)} GPa` : 'GLC assumed 0 — FLC tap not performed',
              goreItalic: shearPa == null,
              body: `Body: ${f0(s.guitarBodyLength)} × ${f0(s.guitarBodyWidth)} mm`,
              fvs: fvsLine,
            }
          : null,
      freqs,
      dimensions,
      props: [
        { label: 'Speed of Sound (L)', value: `${f0(cL)} m/s` },
        { label: 'Speed of Sound (C)', value: `${f0(cC)} m/s` },
        { label: "Young's Modulus (L)", value: `${f2(eL)} GPa` },
        { label: "Young's Modulus (C)", value: `${f2(eC)} GPa` },
        { label: 'Specific Modulus (L)', value: f1(smL), color: QUALITY_COLOR[qL], hint: `(${qL})` },
        { label: 'Specific Modulus (C)', value: f1(smC), color: QUALITY_COLOR[qC], hint: `(${qC})` },
        { label: 'Radiation Ratio (L)', value: f1(rL) },
        { label: 'Radiation Ratio (C)', value: f1(rC) },
      ],
      ratios: [
        { label: 'Cross/Long Ratio', value: f3(crossLong), hint: '(typical: 0.04–0.08)' },
        { label: 'Long/Cross Ratio', value: f1(longCross), hint: '(typical: 12–25)' },
      ],
      overall: { value: overall, color: QUALITY_COLOR[overall] },
    }
  }

  return {
    ...base,
    kind: plate ? 'plate' : 'brace',
    peaks,
    materialAnalysis: analysis,
    tapInstructions: materialTapInstructions(plate, showFlc),
  }
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
      title: '1. Longitudinal (L) Tap',
      detail: 'Hold plate at 22% from one end along the length, near one long edge (not at the width node). Tap center.',
    },
    {
      color: ROLE_C,
      title: '2. Cross-grain (C) Tap',
      detail: 'Rotate 90°. Hold plate at 22% from one end along the width, near one short edge (not at the length node). Tap center.',
    },
  ]
  if (hasFlc) {
    steps.push({
      color: ROLE_FLC,
      title: '3. FLC (Diagonal) Tap',
      detail:
        'Hold plate at the midpoint of one long edge. Tap near the opposite corner (~22% from both the end and the side). Measures shear stiffness.',
    })
  }
  return { heading: hasFlc ? 'Three-Tap Measurement Process:' : 'Two-Tap Measurement Process:', steps, foot: 'The strongest peak from each tap is auto-selected.' }
}