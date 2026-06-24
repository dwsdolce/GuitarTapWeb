import {
  density,
  densityGPerCm3,
  plateYoungsLongGPa,
  plateYoungsLongPa,
  plateYoungsCrossGPa,
  braceYoungsLongGPa,
  braceYoungsLongPa,
  speedOfSound,
  specificModulus,
  goreShearPa,
  goreTargetThicknessMm,
  woodQuality,
  overallQuality,
  type Dimensions,
} from '../dsp/material'
import type { MaterialPeak } from '../dsp/gatedCapture'
import { effectiveStiffness, type Settings } from '../settings'

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

function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="mat-row">
      <span className="mat-label">{label}</span>
      <span className="mat-value">
        {value}
        {unit && <em> {unit}</em>}
      </span>
    </div>
  )
}

const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
const f3 = (n: number) => n.toFixed(3)

export function MaterialResults({ type, settings: s, peaks }: MaterialResultsProps) {
  const dims: Dimensions =
    type === 'plate'
      ? { lengthMm: s.plateLength, widthMm: s.plateWidth, thicknessMm: s.plateThickness, massG: s.plateMass }
      : { lengthMm: s.braceLength, widthMm: s.braceWidth, thicknessMm: s.braceThickness, massG: s.braceMass }

  const rhoGcm3 = densityGPerCm3(dims)
  const rho = density(dims)
  const fL = peaks.longitudinal?.frequency ?? null
  const fC = peaks.cross?.frequency ?? null
  const fLC = peaks.flc?.frequency ?? null

  return (
    <div className="material-results">
      <h3>Frequencies</h3>
      <Row label="f_L (longitudinal)" value={fL != null ? f1(fL) : '—'} unit="Hz" />
      {type === 'plate' && <Row label="f_C (cross-grain)" value={fC != null ? f1(fC) : '—'} unit="Hz" />}
      {type === 'plate' && s.measureFlc && <Row label="f_LC (shear)" value={fLC != null ? f1(fLC) : '—'} unit="Hz" />}

      <h3>Material</h3>
      <Row label="Density" value={f3(rhoGcm3)} unit="g/cm³" />

      {type === 'plate' && fL != null && (
        <>
          {(() => {
            const eL = plateYoungsLongGPa(dims, fL)
            const smL = specificModulus(eL, rhoGcm3)
            const cL = speedOfSound(plateYoungsLongPa(dims, fL), rho)
            const eC = fC != null ? plateYoungsCrossGPa(dims, fC) : null
            const smC = eC != null ? specificModulus(eC, rhoGcm3) : null
            const shearPa = goreShearPa(dims, fLC)
            const target =
              fC != null
                ? goreTargetThicknessMm(dims, fL, fC, fLC, s.guitarBodyLength, s.guitarBodyWidth, effectiveStiffness(s))
                : null
            return (
              <>
                <Row label="E_L (Young's, long)" value={f2(eL)} unit="GPa" />
                {eC != null && <Row label="E_C (Young's, cross)" value={f2(eC)} unit="GPa" />}
                <Row label="Specific modulus (L)" value={f1(smL)} unit="GPa·cm³/g" />
                {smC != null && <Row label="Specific modulus (C)" value={f2(smC)} unit="GPa·cm³/g" />}
                <Row label="Speed of sound (L)" value={f0(cL)} unit="m/s" />
                <Row label="Quality (L)" value={woodQuality(smL, 'longitudinal')} />
                {smC != null && <Row label="Quality (C)" value={woodQuality(smC, 'cross')} />}
                {smC != null && <Row label="Overall quality" value={overallQuality(smL, smC)} />}

                {(target != null || shearPa != null) && <h3>Gore</h3>}
                {shearPa != null && <Row label="Shear modulus G_LC" value={f2(shearPa / 1e9)} unit="GPa" />}
                {target != null && <Row label="Target thickness" value={f2(target)} unit="mm" />}
              </>
            )
          })()}
        </>
      )}

      {type === 'brace' && fL != null && (
        <>
          {(() => {
            const eL = braceYoungsLongGPa(dims, fL)
            const smL = specificModulus(eL, rhoGcm3)
            const cL = speedOfSound(braceYoungsLongPa(dims, fL), rho)
            return (
              <>
                <Row label="E_L (Young's, long)" value={f2(eL)} unit="GPa" />
                <Row label="Specific modulus (L)" value={f1(smL)} unit="GPa·cm³/g" />
                <Row label="Speed of sound (L)" value={f0(cL)} unit="m/s" />
                <Row label="Quality (L)" value={woodQuality(smL, 'longitudinal')} />
              </>
            )
          })()}
        </>
      )}
    </div>
  )
}

const f0 = (n: number) => Math.round(n).toString()