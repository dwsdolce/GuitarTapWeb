// @parity model/mode-colors
import type { ResolvedMode } from '../dsp/classify'

/**
 * Per-mode annotation colors. Canonical GuitarMode hues (air cyan, top green, back
 * orange, dipole red, ring purple, upper gray), brightened for the dark chart
 * background — so shades differ from Swift/Python's RGB, but the hue per mode matches.
 */
export const MODE_COLOR: Record<ResolvedMode, string> = {
  air: '#4ea1ff',
  top: '#5fd07a',
  back: '#f0a03a',
  dipole: '#e0584a',
  ring: '#b07ad8',
  upper: '#9aa6b3',
  unknown: '#5a6573',
}

/** Short mode labels for compact chart annotations (`DP`, `?`, …). */
export const MODE_LABEL: Record<ResolvedMode, string> = {
  air: 'Air',
  top: 'Top',
  back: 'Back',
  dipole: 'DP',
  ring: 'Ring',
  upper: 'Upper',
  unknown: '?',
}

/**
 * Full display names (`GuitarMode.displayName`) — used as the card's mode label and
 * the override quick-pick list.
 */
export const MODE_DISPLAY_NAME: Record<ResolvedMode, string> = {
  air: 'Air (Helmholtz)',
  top: 'Top',
  back: 'Back',
  dipole: 'Dipole',
  ring: 'Ring Mode',
  upper: 'Upper Modes',
  unknown: 'Unknown',
}

/**
 * Reverse of {@link MODE_DISPLAY_NAME}: a displayed label → its `ResolvedMode` (used to derive
 * the glyph + colour from the EFFECTIVE label, so a manual override swaps both, like Swift
 * `GuitarMode.icon`/`color`).
 */
export const MODE_BY_DISPLAY_NAME: Record<string, ResolvedMode> = Object.fromEntries(
  (Object.entries(MODE_DISPLAY_NAME) as [ResolvedMode, string][]).map(([m, name]) => [name, m]),
) as Record<string, ResolvedMode>

/**
 * Color for a user-defined / custom override label (not a known mode) — the tag glyph in teal.
 * Mirrors Swift's `tag.fill` + RGB(0,128,128) for UserAssignedMode freeform labels.
 */
export const USER_MODE_COLOR = '#1a9a9a'

/** Quick-pick mode labels for the override menu (GuitarMode.currentCases order). */
export const QUICK_PICK_MODES = [
  'Air (Helmholtz)',
  'Top',
  'Back',
  'Dipole',
  'Ring Mode',
  'Upper Modes',
  'Unknown',
]

/** Magnitude → color, mirroring CombinedPeakModeRowView.magnitudeColor. */
export function magnitudeColor(mag: number): string {
  if (mag >= -40) return '#5fd07a' // green
  if (mag >= -60) return '#4ea1ff' // blue
  if (mag >= -80) return '#f0a03a' // orange
  return '#e0584a' // red
}
