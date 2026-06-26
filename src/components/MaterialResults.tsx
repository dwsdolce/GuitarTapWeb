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
import type { MaterialPeak } from '../dsp/gatedCapture'
import { effectiveStiffness, STIFFNESS_LABEL, type Settings } from '../settings'

export interface MaterialPeaks {
  longitudinal: MaterialPeak | null
  cross: MaterialPeak | null
  flc: MaterialPeak | null
}

export interface MaterialResultsProps {
  type: 'plate' | 'brace'
  settings: Settings
  peaks: MaterialPeaks
}

const f0 = (n: number) => Math.round(n).toString()
const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
const f3 = (n: number) => n.toFixed(3)

// Mirrors Swift WoodQuality.color (green → red across the five tiers).
const QUALITY_COLOR: Record<WoodQuality, string> = {
  Excellent: '#30d158',
  'Very Good': '#34c759',
  Good: '#ffd60a',
  Fair: '#ff9f0a',
  Poor: '#ff453a',
}

type Role = 'L' | 'C' | 'FLC'

/** One row of the sorted peak list: star, frequency, magnitude, phase badges.
 *  Mirrors Swift MaterialPeakRowView (display-only in plate/brace mode). */
function PeakRow({ peak, role, showCross, showFlc }: { peak: MaterialPeak; role: Role; showCross: boolean; showFlc: boolean }) {
  const badge = (label: Role, color: string) => (
    <span className="mat-badge" style={role === label ? { background: color, color: '#fff' } : undefined}>
      {label}
    </span>
  )
  return (
    <div className="mat-peak-row">
      <span className="mat-peak-star">★</span>
      <span className="mat-peak-info">
        <span className="mat-peak-freq">{f1(peak.frequency)} Hz</span>
        <span className="mat-peak-mag">{f1(peak.magnitude)} dB</span>
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
          <p className="mat-process-foot">The strongest peak from each tap is auto-selected. Adjust selections above if needed.</p>
        </>
      ) : (
        <>
          <div className="mat-process-head">Single-Tap Measurement (fL only):</div>
          {step('#0a84ff', '1. Longitudinal (fL) Tap', 'Hold brace at 22% from one end along the length. Tap center.')}
          <p className="mat-process-foot">The strongest peak is auto-selected. Adjust if needed.</p>
        </>
      )}
    </div>
  )
}

export function MaterialResults({ type, settings: s, peaks }: MaterialResultsProps) {
  const plate = type === 'plate'
  const dims: Dimensions = plate
    ? { lengthMm: s.plateLength, widthMm: s.plateWidth, thicknessMm: s.plateThickness, massG: s.plateMass }
    : { lengthMm: s.braceLength, widthMm: s.braceWidth, thicknessMm: s.braceThickness, massG: s.braceMass }

  const rhoGcm3 = densityGPerCm3(dims)
  const rho = density(dims)
  const fL = peaks.longitudinal?.frequency ?? null
  const fC = peaks.cross?.frequency ?? null
  const fLC = peaks.flc?.frequency ?? null
  const showFlc = plate && s.measureFlc

  // Sorted peak list (low → high), mirroring Swift's sortedPeaksWithModes.
  const rows: { peak: MaterialPeak; role: Role }[] = []
  if (peaks.longitudinal) rows.push({ peak: peaks.longitudinal, role: 'L' })
  if (plate && peaks.cross) rows.push({ peak: peaks.cross, role: 'C' })
  if (showFlc && peaks.flc) rows.push({ peak: peaks.flc, role: 'FLC' })
  rows.sort((a, b) => a.peak.frequency - b.peak.frequency)

  const peakList = (
    <div className="mat-peaks">
      {rows.map((r) => (
        <PeakRow key={r.role} peak={r.peak} role={r.role} showCross={plate} showFlc={showFlc} />
      ))}
    </div>
  )

  const process = <ProcessSection type={type} measureFlc={s.measureFlc} />

  if (!plate) {
    // ── Brace Properties ────────────────────────────────────────────────────
    if (fL == null)
      return (
        <div className="material-results">
          {peakList}
          {process}
        </div>
      )
    const eL = braceYoungsLongGPa(dims, fL)
    const smL = specificModulus(eL, rhoGcm3)
    const cL = speedOfSound(braceYoungsLongPa(dims, fL), rho)
    const rL = cL / rho
    const qL = woodQuality(smL, 'longitudinal')
    return (
      <div className="material-results">
        {peakList}
        <div className="mat-section">
          <h3>Brace Properties</h3>
          <Row label="Longitudinal (fL)" value={`${f1(fL)} Hz`} />
          <hr className="mat-divider" />
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
  if (fL == null || fC == null)
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
  const target = goreTargetThicknessMm(dims, fL, fC, fLC, s.guitarBodyLength, s.guitarBodyWidth, effectiveStiffness(s))
  const crossLong = eL > 0 ? eC / eL : 0
  const longCross = eC > 0 ? eL / eC : 0

  const fvs = effectiveStiffness(s)
  const presetName = STIFFNESS_LABEL[s.plateStiffnessPreset].replace(/\s*\(\d+\)$/, '')
  const fvsLine = s.plateStiffnessPreset === 'custom' ? `f_vs = ${f0(fvs)} (custom)` : `f_vs = ${f0(fvs)} (${presetName})`

  return (
    <div className="material-results">
      {peakList}

      {target != null && (
        <div className="mat-section mat-gore">
          <h3>Gore Target Thickness</h3>
          <div className="mat-gore-thickness">
            {f2(target)} <em>mm</em>
          </div>
          {shearPa != null ? (
            <Row label="Shear Modulus (GLC)" value={`${f3(shearPa / 1e9)} GPa`} />
          ) : (
            <p className="mat-info">ⓘ GLC assumed 0 — enable FLC tap for a more accurate result</p>
          )}
          <p className="mat-params">Body: {f0(s.guitarBodyLength)} × {f0(s.guitarBodyWidth)} mm</p>
          <p className="mat-params">{fvsLine}</p>
        </div>
      )}

      <div className="mat-section">
        <h3>Plate Properties</h3>
        <div className="mat-freqs">
          <div>fL (Longitudinal): {f1(fL)} Hz</div>
          <div>fC (Cross-grain): {f1(fC)} Hz</div>
          {fLC != null && <div>fLC (Diagonal): {f1(fLC)} Hz</div>}
        </div>
        <hr className="mat-divider" />

        <div className="mat-prop">
          <span className="mat-label">Speed of Sound</span>
          <span className="mat-lc">
            <span>L: {f0(cL)} m/s</span>
            <span>C: {f0(cC)} m/s</span>
          </span>
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

        <div className="mat-prop">
          <span className="mat-label">Radiation Ratio (R)</span>
          <span className="mat-lc">
            <span>L: {f1(rL)}</span>
            <span>C: {f1(rC)}</span>
          </span>
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