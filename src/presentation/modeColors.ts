// @parity model/mode-colors tests=test/mode-colors
import type { ResolvedMode } from '../dsp/classify'

/**
 * Per-mode annotation colours, for this edition's **dark** chart.
 *
 * The rule, set by the owner during the #17 sweep: where a value differs from Swift because the
 * background differs, the web keeps its own; where it differs for no reason, it follows Swift.
 *
 * Measuring the hues showed the table was a mix of the two. `top`, `back` and `dipole` are Swift's
 * hues brightened for a dark surface — 1°, 5° and 7° away — and those stay. `air` and `ring` were
 * not adaptations at all but different colours: `air` was #4ea1ff, a **blue** 22° from Swift's
 * cyan, and `ring` was #b07ad8, 18° from Swift's purple. Those now carry Swift's values.
 *
 * `upper` and `unknown` are near-neutral greys, where hue is meaningless and only lightness
 * matters, so these keep the web's — the natives' #8E8E93 and #808080 would be muddy on dark, and
 * the pair has to stay tellable apart. Python could not tell them apart at all until this sweep:
 * both were the same grey.
 *
 * See SLUG-SWEEP.md F9. When the theme work lands it adds a light table here, which will be
 * Swift's values outright, exactly as `qualityColors.ts` already does.
 */
export const MODE_COLOR: Record<ResolvedMode, string> = {
  air: '#00C0E8', // Swift's cyan — was #4ea1ff, a different hue, not a dark variant
  top: '#5fd07a', // Swift's green, brightened for dark
  back: '#f0a03a', // Swift's orange, brightened for dark
  dipole: '#e0584a', // Swift's red, brightened for dark
  ring: '#CB30E0', // Swift's purple — was #b07ad8, a different hue
  upper: '#9aa6b3', // near-neutral; lightness tuned for dark
  unknown: '#5a6573', // near-neutral; must stay distinct from `upper`
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
 * Extended mode labels in the acoustical-physics T(m,n) notation, offered as secondary choices
 * in the override picker for users who prefer the academic designations. Mirrors Swift
 * `GuitarMode.additionalModeLabels` and Python `GuitarMode.additional_mode_labels`, in the same
 * order.
 */
export const ADDITIONAL_MODE_LABELS: string[] = [
  'Helmholtz T(1,1)_1',
  'Top T(1,1)_2',
  'Back T(1,1)_3',
  'Cross Dipole T(2,1)',
  'Long Dipole T(1,2)',
  'Quadrapole T(2,2)',
  'Cross Tripole T(3,1)',
]

/**
 * Which mode each academic label resolves to. Mirrors Swift `GuitarMode.fromDisplayName`'s
 * `additionalMap` and Python's `_PYTHON_STR_TO_MODE`.
 *
 * This table was missing here entirely until the #17 sweep, and its absence was not cosmetic: a
 * measurement saved in Swift or Python with one of these overrides loaded here as a *freeform*
 * user label, so it drew in the user-label teal instead of the mode colour and dropped out of
 * every surface that asks "which peak is the Dipole" — including the tap-tone ratio and the
 * definitive-peak resolution. See SLUG-SWEEP.md F11.
 *
 * `Quadrapole T(2,2)` resolves to `ring`, following Swift. Python mapped it to Upper Modes until
 * the same sweep (F12).
 */
export const MODE_BY_ADDITIONAL_LABEL: Record<string, ResolvedMode> = {
  'Helmholtz T(1,1)_1': 'air',
  'Top T(1,1)_2': 'top',
  'Back T(1,1)_3': 'back',
  'Cross Dipole T(2,1)': 'dipole',
  'Long Dipole T(1,2)': 'dipole',
  'Quadrapole T(2,2)': 'ring',
  'Cross Tripole T(3,1)': 'ring',
}

/**
 * Reverse of {@link MODE_DISPLAY_NAME}: a displayed label → its `ResolvedMode` (used to derive
 * the glyph + colour from the EFFECTIVE label, so a manual override swaps both, like Swift
 * `GuitarMode.icon`/`color`).
 *
 * Includes the academic labels, so a file written by any edition resolves the same way here.
 */
export const MODE_BY_DISPLAY_NAME: Record<string, ResolvedMode> = Object.fromEntries([
  ...Object.entries(MODE_BY_ADDITIONAL_LABEL),
  ...(Object.entries(MODE_DISPLAY_NAME) as [ResolvedMode, string][]).map(([m, name]) => [name, m]),
]) as Record<string, ResolvedMode>

/**
 * The one override-aware mode resolver, mirroring Swift `GuitarMode.effectiveMode(override:auto:)`:
 * a present override label wins — a predefined mode name resolves to its mode, a FREEFORM label to
 * `'unknown'` (it does NOT fall through to the auto mode) — otherwise the auto classification. Every
 * "which mode is this peak, really" surface (the selection invariant, the definitive-peak resolver, the
 * ratio) resolves through this, so they cannot disagree.
 */
export function effectiveMode(overrideLabel: string | undefined | null, auto: ResolvedMode): ResolvedMode {
  if (overrideLabel != null) return MODE_BY_DISPLAY_NAME[overrideLabel] ?? 'unknown'
  return auto
}

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
