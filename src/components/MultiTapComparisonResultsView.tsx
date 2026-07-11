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

/**
 * Per-tap palette cycled by row index (blue / orange / green / purple / teal).
 *
 * Mirrors Swift `TapToneAnalyzer.multiTapPalette` (`[.blue, .orange, .green, .purple, .teal]`).
 * These are the dark-appearance variants of those system colors, brightened for the
 * chart's dark background — the same convention as the mode colors.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared palette constant (used by App's multi-tap overlays); kept alongside the view rather than in its own module
export const MULTITAP_PALETTE = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#40c8e0']

/** Averaged-row indicator color — gold; mirrors Swift `TapToneAnalyzer.multiTapAvgColor` = `Color(1.0, 0.85, 0.0)`. */
export const MULTITAP_AVG_COLOR = '#ffd900'

const hz = (n: number | null) => (n != null ? `${n.toFixed(1)} Hz` : '—')

function FreqCells({ m }: { m: TapModeFreqs }) {
  return (
    <>
      <span className={`mt-cell${m.air == null ? ' mt-empty' : ''}`}>{hz(m.air)}</span>
      <span className={`mt-cell${m.top == null ? ' mt-empty' : ''}`}>{hz(m.top)}</span>
      <span className={`mt-cell${m.back == null ? ' mt-empty' : ''}`}>{hz(m.back)}</span>
    </>
  )
}

/**
 * Renders the multi-tap comparison grid: one row per tap (`taps`, in sequence order — the
 * palette color is chosen by array index) plus a final bold "Averaged" row (`avg`, the
 * averaged mode frequencies).
 */
export function MultiTapComparisonResultsView({ taps, avg }: { taps: MultiTapRow[]; avg: TapModeFreqs }) {
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
            <span className="mt-dot" style={{ background: MULTITAP_PALETTE[i % MULTITAP_PALETTE.length] }} />
            Tap {t.tapIndex}
          </span>
          <FreqCells m={t} />
        </div>
      ))}
      <div className="mt-row mt-avg">
        <span className="mt-label">
          <span className="mt-square" style={{ background: MULTITAP_AVG_COLOR }} />
          Averaged
        </span>
        <FreqCells m={avg} />
      </div>
    </div>
  )
}