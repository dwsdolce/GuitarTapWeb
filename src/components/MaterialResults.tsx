// @parity view/material-results
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
} from '../dsp/material'
import type { MaterialPeak } from '../dsp/gatedCapture'
import { WOOD_QUALITY_COLOR } from '../presentation/qualityColors'
import { STIFFNESS_LABEL, type StiffnessPreset } from '../settings'
import {
  materialDimensions,
  materialStiffness,
  type MaterialMeasurementInputs,
} from '../measurement/materialMeasurementInputs'
import { NumberField } from './NumberField'
import { FieldPrecision } from '../precision'

export interface MaterialPeaks {
  longitudinal: MaterialPeak | null
  cross: MaterialPeak | null
  flc: MaterialPeak | null
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
      <NumberField label="Length" unit="mm" value={inputs.lengthMm} decimals={P.linearDimensionMM} onChange={(v) => set({ lengthMm: v })} />
      <NumberField label="Width" unit="mm" value={inputs.widthMm} decimals={P.linearDimensionMM} onChange={(v) => set({ widthMm: v })} />
      <NumberField label="Thickness" unit="mm" value={inputs.thicknessMm} decimals={P.linearDimensionMM} onChange={(v) => set({ thicknessMm: v })} />
      <NumberField label="Mass" unit="g" value={inputs.massG} decimals={P.massG} onChange={(v) => set({ massG: v })} />
      <Row label="Calculated Density" value={`${f3(densityGPerCm3(materialDimensions(inputs)))} g/cm³`} />
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
      <NumberField label="Body Length (a)" unit="mm" value={inputs.bodyLengthMm} decimals={P.bodyDimensionMM} onChange={(v) => set({ bodyLengthMm: v })} />
      <NumberField label="Lower Bout Width (b)" unit="mm" value={inputs.bodyWidthMm} decimals={P.bodyDimensionMM} onChange={(v) => set({ bodyWidthMm: v })} />
      <label className="set-field">
        <span>Panel Stiffness (f_vs)</span>
        <span className="set-input">
          <select value={inputs.stiffnessPreset} onChange={(e) => set({ stiffnessPreset: e.target.value as StiffnessPreset })}>
            {STIFFNESS_PRESETS.map((p) => (
              <option key={p} value={p}>{STIFFNESS_LABEL[p]}</option>
            ))}
          </select>
        </span>
      </label>
      {inputs.stiffnessPreset === 'custom' && (
        <NumberField label="Custom f_vs" unit="" value={inputs.customStiffness} decimals={P.stiffness} onChange={(v) => set({ customStiffness: v })} />
      )}
    </div>
  )
}

const f0 = (n: number) => Math.round(n).toString()
const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
const f3 = (n: number) => n.toFixed(3)

// Wood-quality → colour comes from the single scheme-qualified table in presentation/qualityColors.
// The app chrome is dark today, so this names 'dark' explicitly. When the theme work lands (STATUS
// item 3) this literal becomes the active scheme from the theme context — the table itself doesn't
// move, and the PDF stays pinned to 'light'.
const QUALITY_COLOR = WOOD_QUALITY_COLOR.dark

type Role = 'L' | 'C' | 'FLC'

/** One row of the sorted peak list: star, frequency, magnitude, phase badges.
 *  Mirrors Swift MaterialPeakRowView (display-only in plate/brace mode). */
function PeakRow({ peak, role, showCross, showFlc }: { peak: MaterialPeak | null; role: Role; showCross: boolean; showFlc: boolean }) {
  // Dashes + an unselected bubble until this phase's peak is captured.
  const found = peak != null
  const badge = (label: Role, color: string) => (
    <span className="mat-badge" style={role === label && found ? { background: color, color: '#fff' } : undefined}>
      {label}
    </span>
  )
  return (
    <div className={`mat-peak-row${found ? '' : ' pending'}`}>
      <span className="mat-peak-star">{found ? '★' : '☆'}</span>
      <span className="mat-peak-info">
        <span className="mat-peak-freq">{peak ? `${f1(peak.frequency)} Hz` : '—'}</span>
        <span className="mat-peak-mag">{peak ? `${f1(peak.magnitude)} dB` : '—'}</span>
      </span>
      <span className="mat-badges">
        {badge('L', '#0a84ff')}
        {showCross && badge('C', '#ff9f0a')}
        {showFlc && badge('FLC', '#bf5af2')}
      </span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mat-row">
      <span className="mat-label">{label}</span>
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
      {type === 'plate' ? (
        <>
          <div className="mat-process-head">{measureFlc ? 'Three-Tap Measurement Process:' : 'Two-Tap Measurement Process:'}</div>
          {step('#0a84ff', '1. Longitudinal (L) Tap', 'Hold plate at 22% from one end along the length, near one long edge (not at the width node). Tap center.')}
          {step('#ff9f0a', '2. Cross-grain (C) Tap', 'Rotate 90°. Hold plate at 22% from one end along the width, near one short edge (not at the length node). Tap center.')}
          {measureFlc &&
            step('#bf5af2', '3. FLC (Diagonal) Tap', 'Hold plate at the midpoint of one long edge. Tap near the opposite corner (~22% from both the end and the side). Measures shear stiffness.')}
          <p className="mat-process-foot">The strongest peak from each tap is auto-selected. Redo if needed.</p>
        </>
      ) : (
        <>
          <div className="mat-process-head">Single-Tap Measurement (fL only):</div>
          {step('#0a84ff', '1. Longitudinal (fL) Tap', 'Hold brace at 22% from one end along the length. Tap center.')}
          <p className="mat-process-foot">The strongest peak is auto-selected. Redo if needed.</p>
        </>
      )}
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
  // See Development/MATERIAL-RESULTS-PHASED-DISPLAY.md.
  const slots: { role: Role; peak: MaterialPeak | null }[] = plate
    ? [
        { role: 'L', peak: peaks.longitudinal },
        { role: 'C', peak: peaks.cross },
        ...(showFlc ? [{ role: 'FLC' as Role, peak: peaks.flc }] : []),
      ]
    : [{ role: 'L', peak: peaks.longitudinal }]

  const peakList = (
    <div className="mat-peaks">
      {slots.map((sl) => (
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
  const dims = materialDimensions(matInputs)
  const rhoGcm3 = densityGPerCm3(dims)
  const rho = density(dims)

  if (!plate) {
    // ── Brace Properties ────────────────────────────────────────────────────
    const eL = braceYoungsLongGPa(dims, fL)
    const smL = specificModulus(eL, rhoGcm3)
    const cL = speedOfSound(braceYoungsLongPa(dims, fL), rho)
    const rL = cL / rho
    const qL = woodQuality(smL, 'longitudinal')
    return (
      <div className="material-results">
        {peakList}
        <SampleDimensionsEditor inputs={matInputs} onChange={onInputsChange} />
        <div className="mat-section">
          <h3>Brace Properties</h3>
          <Row label="Speed of Sound" value={`${f0(cL)} m/s`} />
          <Row label="Young's Modulus (E)" value={`${f2(eL)} GPa`} />
          <div className="mat-specmod">
            <div className="mat-specmod-title">Specific Modulus (E/ρ)</div>
            <div className="mat-specmod-value" style={{ color: QUALITY_COLOR[qL] }}>
              {f1(smL)} <em>GPa/(g/cm³)</em>
            </div>
            <div className="mat-specmod-quality" style={{ color: QUALITY_COLOR[qL] }}>
              {qL}
            </div>
          </div>
          <Row label="Radiation Ratio (R)" value={f1(rL)} />
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

  const eL = plateYoungsLongGPa(dims, fL)
  const eC = plateYoungsCrossGPa(dims, fC)
  const smL = specificModulus(eL, rhoGcm3)
  const smC = specificModulus(eC, rhoGcm3)
  const cL = speedOfSound(plateYoungsLongPa(dims, fL), rho)
  const cC = speedOfSound(plateYoungsCrossPa(dims, fC), rho)
  const rL = cL / rho
  const rC = cC / rho
  const qL = woodQuality(smL, 'longitudinal')
  const qC = woodQuality(smC, 'cross')
  const overall = overallQuality(smL, smC)
  const shearPa = goreShearPa(dims, fLC)
  const target = goreTargetThicknessMm(dims, fL, fC, fLC, matInputs.bodyLengthMm, matInputs.bodyWidthMm, materialStiffness(matInputs))
  const crossLong = eL > 0 ? eC / eL : 0
  const longCross = eC > 0 ? eL / eC : 0

  return (
    <div className="material-results">
      {peakList}
      <SampleDimensionsEditor inputs={matInputs} onChange={onInputsChange} />
      <BodyDimensionsEditor inputs={matInputs} onChange={onInputsChange} />

      {target != null && (
        <div className="mat-section mat-gore">
          <h3>Gore Target Thickness</h3>
          <div className="mat-gore-thickness">
            {f2(target)} <em>mm</em>
          </div>
        </div>
      )}

      <div className="mat-section">
        <h3>Plate Properties</h3>

        <div className="mat-prop-block">
          <div className="mat-prop-title">Speed of Sound</div>
          <div className="mat-lc">
            <span>L: {f0(cL)} m/s</span>
            <span>C: {f0(cC)} m/s</span>
          </div>
        </div>

        <div className="mat-prop-block">
          <div className="mat-prop-title">Young's Modulus (E)</div>
          <div className="mat-lc">
            <span>L: {f2(eL)} GPa</span>
            <span>C: {f2(eC)} GPa</span>
          </div>
          {shearPa != null && <div className="mat-lc-sub">GLC (Shear): {f3(shearPa / 1e9)} GPa</div>}
        </div>

        <div className="mat-specmod">
          <div className="mat-specmod-title">Specific Modulus (E/ρ)</div>
          <div className="mat-specmod-cols">
            <div>
              <div className="mat-specmod-label">Longitudinal:</div>
              <div className="mat-specmod-value" style={{ color: QUALITY_COLOR[qL] }}>
                {f1(smL)} <em>GPa/(g/cm³)</em>
              </div>
              <div className="mat-specmod-quality" style={{ color: QUALITY_COLOR[qL] }}>
                {qL}
              </div>
            </div>
            <div className="mat-specmod-right">
              <div className="mat-specmod-label">Cross-grain:</div>
              <div className="mat-specmod-value" style={{ color: QUALITY_COLOR[qC] }}>
                {f1(smC)} <em>GPa/(g/cm³)</em>
              </div>
              <div className="mat-specmod-quality" style={{ color: QUALITY_COLOR[qC] }}>
                {qC}
              </div>
            </div>
          </div>
        </div>

        <div className="mat-prop-block">
          <div className="mat-prop-title">Radiation Ratio (R)</div>
          <div className="mat-lc">
            <span>L: {f1(rL)}</span>
            <span>C: {f1(rC)}</span>
          </div>
        </div>

        <div className="mat-row">
          <span className="mat-label">Cross/Long Ratio</span>
          <span className="mat-value">
            {f3(crossLong)} <em className="mat-hint">(typical: 0.04–0.08)</em>
          </span>
        </div>
        <div className="mat-row">
          <span className="mat-label">Long/Cross Ratio</span>
          <span className="mat-value">
            {f1(longCross)} <em className="mat-hint">(typical: 12–25)</em>
          </span>
        </div>

        <hr className="mat-divider" />
        <div className="mat-row mat-overall">
          <span className="mat-label">Overall Quality</span>
          <span className="mat-value" style={{ color: QUALITY_COLOR[overall] }}>
            {overall}
          </span>
        </div>
      </div>
      {process}
    </div>
  )
}