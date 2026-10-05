// @parity model/guitar-mode-classify tests=test/classify — MODE_LABEL, MODE_DISPLAY_NAME and the
// override-label resolution, pinned by test/classify, where Swift and Python file them. A mode's colour is
// its role in palette.ts.
import type { ResolvedMode } from '../dsp/classify'

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
 * It is what lets a measurement saved in Swift or Python with one of these overrides load here as
 * that mode rather than as a *freeform* user label — so it draws in the mode colour, not the
 * user-label teal, and takes part in every surface that asks "which peak is the Dipole", including
 * the tap-tone ratio and the definitive-peak resolution.
 *
 * `Quadrapole T(2,2)` resolves to `ring`, following Swift.
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
