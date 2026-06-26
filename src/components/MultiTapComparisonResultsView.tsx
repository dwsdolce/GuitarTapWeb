// Multi-tap comparison table — mirrors Swift MultiTapComparisonResultsView.
// One row per tap (colored dot + "Tap N") plus a bold gold "Averaged" row,
// each showing the Air / Top / Back resolved mode frequencies.

export interface TapModeFreqs {
  air: number | null
  top: number | null
  back: number | null
}

export interface MultiTapRow extends TapModeFreqs {
  tapIndex: number
}

// Per-tap palette (blue/orange/green/purple/teal) cycled by index; avg = gold (1,0.85,0).
export const MULTITAP_PALETTE = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#40c8e0']
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