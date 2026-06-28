import type { Peak } from '../dsp/peaks'
import type { ResolvedMode } from '../dsp/classify'
import { MODE_COLOR, MODE_DISPLAY_NAME, QUICK_PICK_MODES, magnitudeColor } from '../presentation/modeColors'

// One resonant-peak card, mirroring Swift CombinedPeakModeRowView:
//   [star] [mode dot + in-range check] [mode label · freq / pitch / Q · BW · mag]

export interface PeakCardProps {
  peak: Peak
  mode: ResolvedMode
  effectiveLabel: string
  isManualOverride: boolean
  /** true = in mode's ideal range, false = out, null = no indicator (unknown/upper). */
  inRange: boolean | null
  note: string | null
  cents: number | null
  selected: boolean
  onToggle: () => void
  onSetLabel: (label: string) => void
  onResetLabel: () => void
}

const RESET = '__reset__'
const CUSTOM = '__custom__'

export function PeakCard({
  peak,
  mode,
  effectiveLabel,
  isManualOverride,
  inRange,
  note,
  cents,
  selected,
  onToggle,
  onSetLabel,
  onResetLabel,
}: PeakCardProps) {
  const color = MODE_COLOR[mode]
  const autoName = MODE_DISPLAY_NAME[mode]

  // Build the option list, ensuring the current value is present.
  const options = [...QUICK_PICK_MODES]
  if (!options.includes(effectiveLabel)) options.unshift(effectiveLabel)

  const onPick = (val: string) => {
    if (val === RESET) return onResetLabel()
    if (val === CUSTOM) {
      const t = window.prompt('Mode label', effectiveLabel)
      if (t && t.trim()) onSetLabel(t.trim())
      return
    }
    if (val === autoName) onResetLabel()
    else onSetLabel(val)
  }

  return (
    <div className="peak-card" style={{ background: `${color}14`, borderLeftColor: color }}>
      <button
        className="star"
        onClick={onToggle}
        aria-label={selected ? 'Deselect peak' : 'Select peak'}
        title={selected ? 'Deselect peak' : 'Select peak'}
      >
        {selected ? '★' : '☆'}
      </button>

      <div className="mode-icon">
        <span className="mode-dot" style={{ background: color }} />
        {inRange !== null && (
          <span className={`range-flag ${inRange ? 'ok' : 'warn'}`} title={inRange ? 'In ideal range' : 'Outside ideal range'}>
            {inRange ? '✓' : '!'}
          </span>
        )}
      </div>

      <div className="peak-info">
        <div className="row">
          <select
            className="mode-select"
            style={{ color }}
            value={effectiveLabel}
            onChange={(e) => onPick(e.target.value)}
          >
            {options.map((l) => (
              <option key={l} value={l}>
                {l}
                {isManualOverride && l === effectiveLabel ? ' ✎' : ''}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
            {isManualOverride && <option value={RESET}>Reset to Auto ({autoName})</option>}
          </select>
          <span className="freq">{peak.frequency.toFixed(1)} Hz</span>
        </div>

        {note && (
          <div className="pitch">
            <span className="note-icon">♪</span>
            {note} {cents !== null && `${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`}
          </div>
        )}

        <div className="row details">
          <span className="kv">
            Q <b>{peak.quality.toFixed(1)}</b>
          </span>
          <span className="kv">
            BW <b>{peak.bandwidth.toFixed(1)} Hz</b>
          </span>
          <span className="mag" style={{ color: magnitudeColor(peak.magnitude) }}>
            {peak.magnitude.toFixed(1)} dB
          </span>
        </div>
      </div>
    </div>
  )
}
