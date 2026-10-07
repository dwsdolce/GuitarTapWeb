// @parity view/peak-card
import { useRef, useEffect } from 'react'
import type { ResolvedMode } from '../dsp/classify'
import { MODE_DISPLAY_NAME, MODE_BY_DISPLAY_NAME, QUICK_PICK_MODES, ADDITIONAL_MODE_LABELS } from '../presentation/modeColors'
import { color as roleColor, magnitudeRole, modeRole } from '../presentation/palette'
import { hexA } from '../presentation/spectrumRender'
import { useScheme } from '../hooks/useScheme'
import { WindIcon, ArrowUpDownIcon, SquareFilledIcon, DipoleIcon, CircleDashedIcon, WaveformIcon, HelpIcon, TagIcon, MusicNoteIcon } from './icons'
import type { ResonantPeak } from '../measurement/types'
import { FieldPrecision } from '../precision'

/** A highlighted row's fill under its tint — mirrors Swift TapAnalysisResultsView. */
const HIGHLIGHT_OPACITY = 0.12

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
  peak: ResonantPeak
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
  /** This peak is the highlighted one (dot ↔ row cross-highlight) → the card gets a ring + scrolls
   *  into view. Distinct from `selected` (the star). */
  highlighted?: boolean
  /** Clicking the card body toggles the highlight (the reverse of clicking the chart dot). Omitted on
   *  touch, where the feature is off — so the card is inert. */
  onHighlight?: () => void
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
  highlighted = false,
  onHighlight,
}: PeakCardProps) {
  // Scroll the card into view when it becomes the highlighted one (mirrors Swift's
  // scrollTo on highlightedPeakID change). `nearest` avoids re-scrolling an already-visible row.
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [highlighted])
  const autoName = MODE_DISPLAY_NAME[mode]
  // Glyph + colour follow the EFFECTIVE (possibly overridden) label, like Swift — a manual override
  // swaps both. A custom label that isn't a known mode gets the tag glyph in teal.
  const effMode = MODE_BY_DISPLAY_NAME[effectiveLabel]
  useScheme() // the colours below are the current scheme's
  const role = effMode ? modeRole(effMode) : 'mode.userDefined'
  const color = roleColor(role)
  const tint = roleColor(role, 'peak.rowTint')
  const ModeIcon = effMode ? MODE_ICON[effMode] : TagIcon

  // Build the option list, ensuring the current value is present. Two groups, as in Swift's
  // CombinedPeakModeRowView menu and Python's peak_card_widget: the standard tap-tone modes,
  // then the extended T(m,n) labels for users who prefer the academic designations.
  const options = [...QUICK_PICK_MODES]
  const extended = [...ADDITIONAL_MODE_LABELS]
  const isKnownOption = options.includes(effectiveLabel) || extended.includes(effectiveLabel)
  if (!isKnownOption) options.unshift(effectiveLabel)

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
    <div
      ref={cardRef}
      className={`peak-card${highlighted ? ' highlighted' : ''}`}
      style={{
        // The row's tint, over the highlight's fill when highlighted; the highlight's border (Swift).
        background: highlighted ? `linear-gradient(${tint}, ${tint}), ${hexA(color, HIGHLIGHT_OPACITY)}` : tint,
        borderColor: highlighted ? color : 'transparent',
      }}
      onClick={onHighlight}
    >
      <button
        className="star"
        style={{ color: roleColor(selected ? 'peak.selectedStar' : 'peak.unselectedStar') }}
        onClick={(e) => {
          e.stopPropagation() // the star toggles selection, not the highlight
          onToggle()
        }}
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
            onClick={(e) => e.stopPropagation()} // opening the mode dropdown must not toggle the highlight
            onChange={(e) => onPick(e.target.value)}
            title={isManualOverride ? 'Manually assigned — click to change or reset' : 'Click to assign a mode label'}
          >
            {/* Reset to Auto is the FIRST item (like Swift/Python's menu), not the last. */}
            {isManualOverride && <option value={RESET}>Reset to Auto ({autoName})</option>}
            {options.map((l) => (
              <option key={l} value={l}>
                {l}
                {isManualOverride && l === effectiveLabel ? ' *' : ''}
              </option>
            ))}
            <optgroup label="Extended modes">
              {extended.map((l) => (
                <option key={l} value={l}>
                  {l}
                  {isManualOverride && l === effectiveLabel ? ' *' : ''}
                </option>
              ))}
            </optgroup>
            <option value={CUSTOM}>Custom…</option>
          </select>
          <span className="freq">{FieldPrecision.string(peak.frequency, FieldPrecision.peakFrequencyHz)} Hz</span>
        </div>

        {note && (
          <div className="pitch">
            <span className="note-icon">
              <MusicNoteIcon />
            </span>
            {/* Swift's ResonantPeak.formattedPitch: "G2 (-10 ¢)". */}
            {note}{cents !== null && ` (${cents >= 0 ? '+' : ''}${cents.toFixed(0)} ¢)`}
          </div>
        )}

        <div className="row details">
          <span className="kv">
            Q: <b>{FieldPrecision.string(peak.quality, FieldPrecision.qFactor)}</b>
          </span>
          <span className="kv">
            BW: <b>{FieldPrecision.string(peak.bandwidth, FieldPrecision.bandwidthHz)} Hz</b>
          </span>
          <span className="mag" style={{ color: roleColor(magnitudeRole(peak.magnitude)) }}>
            {FieldPrecision.string(peak.magnitude, FieldPrecision.peakMagnitudeDB)} dB
          </span>
        </div>
      </div>
    </div>
  )
}
