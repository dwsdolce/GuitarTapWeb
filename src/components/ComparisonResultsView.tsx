/**
 * Comparison results table — mirrors Swift/Python `ComparisonResultsView`.
 * One row per compared spectrum: a colored dot + label, then the resolved
 * Air / Top / Back mode frequencies. Reuses the multi-tap table styling.
 */
// @parity view/comparison-results

/** One compared spectrum's row: label + dot color + resolved Air/Top/Back frequencies (Hz). */
export interface ComparisonRow {
  label: string
  color: string
  air: number | null
  top: number | null
  back: number | null
}

const hz = (n: number | null) => (n != null ? `${n.toFixed(1)} Hz` : '—')

/** Renders the Air/Top/Back comparison grid, one row per {@link ComparisonRow}. */
export function ComparisonResultsView({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="multitap-table comparison-table">
      <div className="mt-row mt-head">
        <span className="mt-label">Spectrum</span>
        <span className="mt-cell">Air</span>
        <span className="mt-cell">Top</span>
        <span className="mt-cell">Back</span>
      </div>
      {rows.map((r, i) => (
        <div className="mt-row" key={i}>
          <span className="mt-label">
            <span className="mt-dot" style={{ background: r.color }} />
            <span className="mt-label-text">{r.label}</span>
          </span>
          <span className={`mt-cell${r.air == null ? ' mt-empty' : ''}`}>{hz(r.air)}</span>
          <span className={`mt-cell${r.top == null ? ' mt-empty' : ''}`}>{hz(r.top)}</span>
          <span className={`mt-cell${r.back == null ? ' mt-empty' : ''}`}>{hz(r.back)}</span>
        </div>
      ))}
    </div>
  )
}