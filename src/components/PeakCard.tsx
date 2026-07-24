// @parity view/peak-card
import type { Peak } from '../dsp/peaks'
import type { ResolvedMode } from '../dsp/classify'
import {
  MODE_COLOR,
  MODE_DISPLAY_NAME,
  MODE_BY_DISPLAY_NAME,
  USER_MODE_COLOR,
  QUICK_PICK_MODES,
  magnitudeColor,
} from '../presentation/modeColors'
import {
  WindIcon,
  ArrowUpDownIcon,
  SquareFilledIcon,
  DipoleIcon,
  CircleDashedIcon,
  WaveformIcon,
  HelpIcon,
  TagIcon,
} from './icons'

// One resonant-peak card, mirroring Swift CombinedPeakModeRowView:
//   [star] [mode glyph + in-range check] [mode label · freq / pitch / Q · BW · mag]

// Per-mode glyph — the web equivalent of the Swift SF Symbols (GuitarMode.icon).
const MODE_ICON: Record<ResolvedMode, () => JSX.Element> = {
  air: WindIcon, // wind
  top: ArrowUpDownIcon, // arrow.up.and.down
  back: SquareFilledIcon, // square.fill
  dipole: DipoleIcon, // circle.lefthalf.filled
  ring: CircleDashedIcon, // circle.dashed
  upper: WaveformIcon, // waveform
  unknown: HelpIcon, // questionmark.circle
}

/** Props for {@link PeakCard}. */
export interface PeakCardProps {
  /** The resonant peak to display (frequency, magnitude, Q, bandwidth). */
  peak: Peak
  /** Auto-classified mode — drives the range badge (mirrors Swift `analyzer.peakMode(for:)`). */
  mode: ResolvedMode
  /** The displayed label: the auto mode's name, or a manual override. */
  effectiveLabel: string
  /** Whether {@link effectiveLabel} is a manual override (shows italic + trailing " *"). */
  isManualOverride: boolean
  /** true = in mode's ideal range, false = out, null = no indicator (unknown/upper). */
  inRange: boolean | null
  /** Pitch note name (e.g. "A2"), or null to hide the pitch row (non-guitar). */
  note: string | null
  /** Cents deviation from the note, or null. */
  cents: number | null
  /** Whether this card's peak is the selected one. */
  selected: boolean
  /** Toggle the peak's annotation on the chart (the star). */
  onToggle: () => void
  /** Assign a mode label (a quick-pick name or custom text). */
  onSetLabel: (label: string) => void
  /** Clear the override and revert to the auto-classified mode. */
  onResetLabel: () => void
}

const RESET = '__reset__'
const CUSTOM = '__custom__'

/**
 * One resonant-peak card, mirroring Swift `CombinedPeakModeRowView`:
 * `[star] [mode glyph + in-range badge] [mode label · freq / pitch / Q · BW · mag]`.
 * The star toggles the chart annotation; the label is a dropdown that assigns a mode
 * override (a manual override renders italic + trailing " *" and offers "Reset to Auto").
 */
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
  const autoName = MODE_DISPLAY_NAME[mode]
  // Glyph + colour follow the EFFECTIVE (possibly overridden) label, like Swift — a manual override
  // swaps both. A custom label that isn't a known mode gets the tag glyph in teal.
  const effMode = MODE_BY_DISPLAY_NAME[effectiveLabel]
  const color = effMode ? MODE_COLOR[effMode] : USER_MODE_COLOR
  const ModeIcon = effMode ? MODE_ICON[effMode] : TagIcon

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
        <span className="mode-glyph" style={{ color }}>
          <ModeIcon />
        </span>
        {inRange !== null && (
          <span className={`range-flag ${inRange ? 'ok' : 'warn'}`} title={inRange ? 'In ideal range' : 'Outside ideal range'}>
            {inRange ? '✓' : '⚠'}
          </span>
        )}
      </div>

      <div className="peak-info">
        <div className="row">
          <select
            className={`mode-select${isManualOverride ? ' override' : ''}`}
            style={{ color }}
            value={effectiveLabel}
            onChange={(e) => onPick(e.target.value)}
            title={isManualOverride ? 'Manually assigned — click to change or reset' : 'Click to assign a mode label'}
          >
            {options.map((l) => (
              <option key={l} value={l}>
                {l}
                {isManualOverride && l === effectiveLabel ? ' *' : ''}
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
            Q: <b>{peak.quality.toFixed(1)}</b>
          </span>
          <span className="kv">
            BW: <b>{peak.bandwidth.toFixed(1)} Hz</b>
          </span>
          <span className="mag" style={{ color: magnitudeColor(peak.magnitude) }}>
            {peak.magnitude.toFixed(1)} dB
          </span>
        </div>
      </div>
    </div>
  )
}
