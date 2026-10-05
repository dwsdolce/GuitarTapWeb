/**
 * Multi-tap comparison table — mirrors Swift `MultiTapComparisonResultsView`.
 *
 * A grid of Air / Top / Back resonance frequencies with one row per individual
 * tap in a completed multi-tap guitar sequence, plus a final bold "Averaged" row
 * drawn from the analyzer's current (averaged) peaks. Each row shows a colored
 * indicator + label | Air | Top | Back.
 *
 * Rows:
 * - One per tap ("Tap 1", "Tap 2", …) with a colored dot from the comparison palette.
 * - A bold "Averaged" row using a filled square (instead of a dot) to distinguish it.
 *
 * Shown in the Analysis Results panel when a multi-tap comparison is active.
 *
 * @module
 */
// @parity view/multi-tap-results

import type { DefinitiveMode, DefinitiveModeInfo } from '../state/tapToneAnalyzer'
import { FieldPrecision } from '../precision'
import { color as roleColor, seriesRole } from '../presentation/palette'

/** Resolved Air / Top / Back peak frequencies (Hz) for one row; `null` when no peak was found. */
export interface TapModeFreqs {
  air: number | null
  top: number | null
  back: number | null
}

/** A single per-tap row: its resolved mode frequencies plus the 1-based tap number. */
export interface MultiTapRow extends TapModeFreqs {
  tapIndex: number
}


const hz = (n: number | null) => (n != null ? `${FieldPrecision.string(n, FieldPrecision.peakFrequencyHz)} Hz` : '—')

function FreqCells({ m }: { m: TapModeFreqs }) {
  return (
    <>
      <span className={`mt-cell${m.air == null ? ' mt-empty' : ''}`}>{hz(m.air)}</span>
      <span className={`mt-cell${m.top == null ? ' mt-empty' : ''}`}>{hz(m.top)}</span>
      <span className={`mt-cell${m.back == null ? ' mt-empty' : ''}`}>{hz(m.back)}</span>
    </>
  )
}

/** The Averaged row: each definitive value is the SELECTED + override-aware peak (not the strongest), and
 *  an overridden value is marked italic + trailing " *" — the app-wide override convention. */
function AvgFreqCells({ m }: { m: DefinitiveModeInfo }) {
  const cell = (v: DefinitiveMode | null) =>
    v == null ? (
      <span className="mt-cell mt-empty">—</span>
    ) : (
      <span className={`mt-cell${v.isOverride ? ' mt-override' : ''}`}>
        {FieldPrecision.string(v.frequency, FieldPrecision.peakFrequencyHz)} Hz{v.isOverride ? ' *' : ''}
      </span>
    )
  return (
    <>
      {cell(m.air)}
      {cell(m.top)}
      {cell(m.back)}
    </>
  )
}

/**
 * Renders the multi-tap comparison grid: one row per tap (`taps`, in sequence order — the
 * palette color is chosen by array index) plus a final bold "Averaged" row (`avg`, the
 * averaged mode frequencies).
 */
export function MultiTapComparisonResultsView({ taps, avg }: { taps: MultiTapRow[]; avg: DefinitiveModeInfo }) {
  return (
    <div className="multitap-table">
      <div className="mt-row mt-head">
        <span className="mt-label">Tap</span>
        <span className="mt-cell">Air</span>
        <span className="mt-cell">Top</span>
        <span className="mt-cell">Back</span>
      </div>
      {taps.map((t, i) => (
        <div className="mt-row" key={t.tapIndex}>
          <span className="mt-label">
            <span className="mt-dot" style={{ background: roleColor(seriesRole(i)) }} />
            Tap {t.tapIndex}
          </span>
          <FreqCells m={t} />
        </div>
      ))}
      <div className="mt-row mt-avg">
        <span className="mt-label">
          <span className="mt-square" style={{ background: roleColor('series.average') }} />
          Averaged
        </span>
        <AvgFreqCells m={avg} />
      </div>
    </div>
  )
}