// @parity view/material-results
import { BraceProperties, MaterialDimensions, PlateProperties, type WoodQuality } from '../dsp/material'
import { color as roleColor, qualityRole } from '../presentation/palette'
import { STIFFNESS_LABEL, type StiffnessPreset } from '../settings'
import { materialDimensions, materialStiffness, type MaterialMeasurementInputs } from '../measurement/materialMeasurementInputs'
import { NumberField } from './NumberField'
import { FieldPrecision } from '../precision'
import type { ResonantPeak } from '../measurement/types'

export interface MaterialPeaks {
  longitudinal: ResonantPeak | null
  cross: ResonantPeak | null
  flc: ResonantPeak | null
}

export interface MaterialResultsProps {
  type: 'plate' | 'brace'
  /** Store B — the measurement's OWN dimensions (seeded at complete / restored on load). `null` until
   *  the measurement completes; the property sections (which need it) are gated on `complete`. */
  matInputs: MaterialMeasurementInputs | null
  /** Commit an edit to Store B — the Results-panel dimension editors write the measurement's own
   *  values live (recompute), never the Settings defaults. */
  onInputsChange: (next: MaterialMeasurementInputs) => void
  /** Capture setting (not part of Store B) — gates the FLC slot/process display. */
  measureFlc: boolean
  peaks: MaterialPeaks
  /** All phases captured — gates the properties sections (hidden during live capture). */
  complete: boolean
}

const STIFFNESS_PRESETS = Object.keys(STIFFNESS_LABEL) as StiffnessPreset[]

/** Editable Sample Dimensions (L/W/T/M + read-only Calculated Density), writing Store B live.
 *  Mirrors Swift MaterialDimensionsEditor. */
function SampleDimensionsEditor({ inputs, onChange }: { inputs: MaterialMeasurementInputs; onChange: (n: MaterialMeasurementInputs) => void }) {
  const set = (patch: Partial<MaterialMeasurementInputs>) => onChange({ ...inputs, ...patch })
  const P = FieldPrecision
  return (
    <div className="mat-section">
      <h3>Sample Dimensions</h3>
      <div className="mat-box">
        <NumberField label="Length:" unit="mm" value={inputs.lengthMm} decimals={P.linearDimensionMM} onChange={(v) => set({ lengthMm: v })} />
        <NumberField label="Width:" unit="mm" value={inputs.widthMm} decimals={P.linearDimensionMM} onChange={(v) => set({ widthMm: v })} />
        <NumberField label="Thickness:" unit="mm" value={inputs.thicknessMm} decimals={P.linearDimensionMM} onChange={(v) => set({ thicknessMm: v })} />
        <NumberField label="Mass:" unit="g" value={inputs.massG} decimals={P.massG} onChange={(v) => set({ massG: v })} />
        <Row label="Calculated Density:" secondary value={`${FieldPrecision.string(new MaterialDimensions(materialDimensions(inputs)).densityGPerCm3, FieldPrecision.densityGPerCm3)} g/cm³`} />
      </div>
    </div>
  )
}

/** Editable plate Body Dimensions (body a/b + Panel Stiffness f_vs preset/custom), writing Store B.
 *  These feed only the Gore target. Mirrors Swift PlateBodyDimensionsEditor. */
function BodyDimensionsEditor({ inputs, onChange }: { inputs: MaterialMeasurementInputs; onChange: (n: MaterialMeasurementInputs) => void }) {
  const set = (patch: Partial<MaterialMeasurementInputs>) => onChange({ ...inputs, ...patch })
  const P = FieldPrecision
  return (
    <div className="mat-section">
      <h3>Body Dimensions</h3>
      <div className="mat-box">
        <NumberField label="Body Length (a):" unit="mm" value={inputs.bodyLengthMm} decimals={P.bodyDimensionMM} onChange={(v) => set({ bodyLengthMm: v })} />
        <NumberField label="Lower Bout Width (b):" unit="mm" value={inputs.bodyWidthMm} decimals={P.bodyDimensionMM} onChange={(v) => set({ bodyWidthMm: v })} />
        <label className="set-field">
          <span>Panel Stiffness (f_vs):</span>
          <span className="set-input">
            <select value={inputs.stiffnessPreset} onChange={(e) => set({ stiffnessPreset: e.target.value as StiffnessPreset })}>
              {STIFFNESS_PRESETS.map((p) => (
                <option key={p} value={p}>{STIFFNESS_LABEL[p]}</option>
              ))}
            </select>
          </span>
        </label>
        {inputs.stiffnessPreset === 'custom' && (
          <NumberField label="Custom f_vs:" unit="" value={inputs.customStiffness} decimals={P.stiffness} onChange={(v) => set({ customStiffness: v })} />
        )}
      </div>
    </div>
  )
}


/** A grade's colour in the current scheme. */
const qualityColor = (q: WoodQuality): string => roleColor(qualityRole(q))

type Role = 'L' | 'C' | 'FLC'

// Badge display uses the frequency notation (fL/fC/fLC), matching Swift MaterialPeakRowView.
const ROLE_LABEL: Record<Role, string> = { L: 'fL', C: 'fC', FLC: 'fLC' }

/** One row of the sorted peak list: star, frequency, magnitude, phase badges.
 *  Mirrors Swift MaterialPeakRowView (display-only in plate/brace mode). */
function PeakRow({ peak, role, showCross, showFlc }: { peak: ResonantPeak | null; role: Role; showCross: boolean; showFlc: boolean }) {
  // Dashes + an unselected bubble until this phase's peak is captured.
  const found = peak != null
  const badge = (r: Role, color: string) => (
    <span className="mat-badge" style={role === r && found ? { background: color, color: 'var(--c-text-on-color)' } : undefined}>
      {ROLE_LABEL[r]}
    </span>
  )
  return (
    <div className={`mat-peak-row${found ? '' : ' pending'}`}>
      <span className="mat-peak-star">{found ? '★' : '☆'}</span>
      <span className="mat-peak-info">
        <span className="mat-peak-freq">{peak ? `${FieldPrecision.string(peak.frequency, FieldPrecision.peakFrequencyHz)} Hz` : '—'}</span>
        <span className="mat-peak-mag">{peak ? `${FieldPrecision.string(peak.magnitude, FieldPrecision.peakMagnitudeDB)} dB` : '—'}</span>
      </span>
      <span className="mat-badges">
        {badge('L', 'var(--c-material-longitudinal)')}
        {showCross && badge('C', 'var(--c-material-cross)')}
        {showFlc && badge('FLC', 'var(--c-material-flc)')}
      </span>
    </div>
  )
}

function Row({ label, value, secondary = false }: { label: string; value: string; secondary?: boolean }) {
  return (
    <div className="mat-row">
      <span className={`mat-label${secondary ? ' secondary' : ''}`}>{label}</span>
      <span className="mat-value">{value}</span>
    </div>
  )
}

/** "Measurement Process" section — mirrors Swift plate/braceMeasurementInstructions. */
function ProcessSection({ type, measureFlc }: { type: 'plate' | 'brace'; measureFlc: boolean }) {
  const step = (color: string, title: string, body: string) => (
    <div className="mat-step">
      <span className="mat-step-dot" style={{ background: color }} />
      <div>
        <div className="mat-step-title">{title}</div>
        <div className="mat-step-body">{body}</div>
      </div>
    </div>
  )
  return (
    <div className="mat-section mat-process">
      <h3>Measurement Process</h3>
      <div className="mat-box">
        {type === 'plate' ? (
          <>
            <div className="mat-process-head">{measureFlc ? 'Three-Tap Measurement Process:' : 'Two-Tap Measurement Process:'}</div>
            {step('var(--c-material-longitudinal)', '1. Longitudinal (fL) Tap', 'Hold plate at 22% from one end along the length, near one long edge (not at the width node). Tap center.')}
            {step('var(--c-material-cross)', '2. Cross-grain (fC) Tap', 'Rotate 90°. Hold plate at 22% from one end along the width, near one short edge (not at the length node). Tap center.')}
            {measureFlc &&
              step('var(--c-material-flc)', '3. Diagonal (fLC) Tap', 'Hold plate at the midpoint of one long edge. Tap near the opposite corner (~22% from both the end and the side). Measures shear stiffness.')}
            <p className="mat-process-foot">The strongest peak from each tap is auto-selected. Redo if needed.</p>
          </>
        ) : (
          <>
            <div className="mat-process-head">Single-Tap Measurement (fL only):</div>
            {step('var(--c-material-longitudinal)', '1. Longitudinal (fL) Tap', 'Hold brace at 22% from one end along the length. Tap center.')}
            <p className="mat-process-foot">The strongest peak is auto-selected. Redo if needed.</p>
          </>
        )}
      </div>
    </div>
  )
}

export function MaterialResults({ type, matInputs, onInputsChange, measureFlc, peaks, complete }: MaterialResultsProps) {
  const plate = type === 'plate'
  const fL = peaks.longitudinal?.frequency ?? null
  const fC = peaks.cross?.frequency ?? null
  const fLC = peaks.flc?.frequency ?? null
  const showFlc = plate && measureFlc

  // Fixed per-phase slot rows (L, C, [FLC] for plate; fL for brace). The layout matches the
  // final display, but each row shows a dash + unselected bubble until its phase is captured.
  const slots: { role: Role; peak: ResonantPeak | null }[] = plate
    ? [
        { role: 'L', peak: peaks.longitudinal },
        { role: 'C', peak: peaks.cross },
        ...(showFlc ? [{ role: 'FLC' as Role, peak: peaks.flc }] : []),
      ]
    : [{ role: 'L', peak: peaks.longitudinal }]

  // Swift materialPeakRows: the fixed slot rows during capture; once complete, the identified peaks in
  // frequency order.
  const rows = complete
    ? slots.filter((sl) => sl.peak != null).sort((a, b) => a.peak!.frequency - b.peak!.frequency)
    : slots

  const peakList = (
    <div className="mat-peaks">
      {rows.map((sl) => (
        <PeakRow key={sl.role} peak={sl.peak} role={sl.role} showCross={plate} showFlc={showFlc} />
      ))}
    </div>
  )

  const process = <ProcessSection type={type} measureFlc={measureFlc} />

  // Properties are hidden until all phases are complete — during live capture only the fixed slot
  // rows + Measurement Process show. matInputs (Store B) is set at completion / on load, so a complete
  // measurement always has it; the null-guard also narrows the type for the calc below.
  if (!complete || fL == null || matInputs == null) {
    return (
      <div className="material-results">
        {peakList}
        {process}
      </div>
    )
  }

  // Dimensions come from Store B (the measurement's own values), never the live Settings.
  const dims = new MaterialDimensions(materialDimensions(matInputs))

  if (!plate) {
    // ── Brace Properties ────────────────────────────────────────────────────
    const props = new BraceProperties(dims, fL)
    const eL = props.youngsModulusLongGPa
    const smL = props.specificModulusLong
    const cL = props.speedOfSoundLong
    const rL = props.radiationRatioLong
    const qL = props.spruceQuality
    return (
      <div className="material-results">
        {peakList}
        <SampleDimensionsEditor inputs={matInputs} onChange={onInputsChange} />
        <div className="mat-section">
          <h3>Brace Properties</h3>
          <div className="mat-box">
            <Row label="Speed of Sound:" value={`${FieldPrecision.string(cL, FieldPrecision.speedOfSoundMS)} m/s`} />
            <Row label="Young's Modulus (E):" value={`${FieldPrecision.string(eL, FieldPrecision.youngsModulusGPa)} GPa`} />
            <div className="mat-specmod">
              <div className="mat-specmod-title">Specific Modulus (E/ρ)</div>
              <div className="mat-specmod-value" style={{ color: qualityColor(qL) }}>
                {FieldPrecision.string(smL, FieldPrecision.specificModulus)} <em>GPa/(g/cm³)</em>
              </div>
              <div className="mat-specmod-quality" style={{ color: qualityColor(qL) }}>
                {qL}
              </div>
          </div>
          <Row label="Radiation Ratio (R):" value={FieldPrecision.string(rL, FieldPrecision.radiationRatio)} />
          </div>
        </div>
        {process}
      </div>
    )
  }

  // ── Plate Properties ──────────────────────────────────────────────────────
  if (fC == null)
    return (
      <div className="material-results">
        {peakList}
        {process}
      </div>
    )

  const props = new PlateProperties(dims, fL, fC, fLC)
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
  const target = props.goreTargetThickness(matInputs.bodyLengthMm, matInputs.bodyWidthMm, materialStiffness(matInputs))
  const crossLong = props.crossLongRatio
  const longCross = props.longCrossRatio

  return (
    <div className="material-results">
      {peakList}
      <SampleDimensionsEditor inputs={matInputs} onChange={onInputsChange} />
      <BodyDimensionsEditor inputs={matInputs} onChange={onInputsChange} />

      {target != null && (
        <div className="mat-section mat-gore">
          <h3>Gore Target Thickness</h3>
          <div className="mat-gore-thickness">
            {FieldPrecision.string(target, FieldPrecision.goreThicknessMM)} <em>mm</em>
          </div>
        </div>
      )}

      <div className="mat-section">
        <h3>Plate Properties</h3>
        <div className="mat-box">

          <div className="mat-prop-block">
            <div className="mat-prop-title">Speed of Sound</div>
            <div className="mat-lc">
              <span>L: {FieldPrecision.string(cL, FieldPrecision.speedOfSoundMS)} m/s</span>
              <span>C: {FieldPrecision.string(cC, FieldPrecision.speedOfSoundMS)} m/s</span>
            </div>
        </div>

        <div className="mat-prop-block">
          <div className="mat-prop-title">Young's Modulus (E)</div>
          <div className="mat-lc">
            <span>L: {FieldPrecision.string(eL, FieldPrecision.youngsModulusGPa)} GPa</span>
            <span>C: {FieldPrecision.string(eC, FieldPrecision.youngsModulusGPa)} GPa</span>
          </div>
          {shearPa != null && <div className="mat-lc-sub">GLC (Shear): {FieldPrecision.string(shearPa / 1e9, FieldPrecision.shearModulusGPa)} GPa</div>}
        </div>

        <div className="mat-specmod">
          <div className="mat-specmod-title">Specific Modulus (E/ρ)</div>
          <div className="mat-specmod-cols">
            <div>
              <div className="mat-specmod-label">Longitudinal:</div>
              <div className="mat-specmod-value" style={{ color: qualityColor(qL) }}>
                {FieldPrecision.string(smL, FieldPrecision.specificModulus)} <em>GPa/(g/cm³)</em>
              </div>
              <div className="mat-specmod-quality" style={{ color: qualityColor(qL) }}>
                {qL}
              </div>
            </div>
            <div className="mat-specmod-right">
              <div className="mat-specmod-label">Cross-grain:</div>
              <div className="mat-specmod-value" style={{ color: qualityColor(qC) }}>
                {FieldPrecision.string(smC, FieldPrecision.specificModulus)} <em>GPa/(g/cm³)</em>
              </div>
              <div className="mat-specmod-quality" style={{ color: qualityColor(qC) }}>
                {qC}
              </div>
            </div>
          </div>
        </div>

        <div className="mat-prop-block">
          <div className="mat-prop-title">Radiation Ratio (R)</div>
          <div className="mat-lc">
            <span>L: {FieldPrecision.string(rL, FieldPrecision.radiationRatio)}</span>
            <span>C: {FieldPrecision.string(rC, FieldPrecision.radiationRatio)}</span>
          </div>
        </div>

        <div className="mat-row">
          <span className="mat-label">Cross/Long Ratio:</span>
          <span className="mat-value">
            {FieldPrecision.string(crossLong, FieldPrecision.crossLongRatio)} <em className="mat-hint">(typical: 0.04–0.08)</em>
          </span>
        </div>
        <div className="mat-row">
          <span className="mat-label">Long/Cross Ratio:</span>
          <span className="mat-value">
            {FieldPrecision.string(longCross, FieldPrecision.longCrossRatio)} <em className="mat-hint">(typical: 12–25)</em>
          </span>
        </div>

        <div className="mat-row mat-overall">
          <span className="mat-label">Overall Quality:</span>
          <span className="mat-value" style={{ color: qualityColor(overall) }}>
            {overall}
          </span>
        </div>
        </div>
      </div>
      {process}
    </div>
  )
}