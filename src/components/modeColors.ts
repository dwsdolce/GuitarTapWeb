import type { ResolvedMode } from '../dsp/classify'

// Per-mode colors and labels for peak annotations (loosely matching GuitarMode).
export const MODE_COLOR: Record<ResolvedMode, string> = {
  air: '#4ea1ff',
  top: '#5fd07a',
  back: '#f0a03a',
  dipole: '#b07ad8',
  ring: '#e0c84a',
  upper: '#9aa6b3',
  unknown: '#5a6573',
}

export const MODE_LABEL: Record<ResolvedMode, string> = {
  air: 'Air',
  top: 'Top',
  back: 'Back',
  dipole: 'Dipole',
  ring: 'Ring',
  upper: 'Upper',
  unknown: '—',
}

// Full display names (GuitarMode.displayName) — used as the card's mode label and
// the override quick-pick list.
export const MODE_DISPLAY_NAME: Record<ResolvedMode, string> = {
  air: 'Air (Helmholtz)',
  top: 'Top',
  back: 'Back',
  dipole: 'Dipole',
  ring: 'Ring Mode',
  upper: 'Upper Modes',
  unknown: 'Unknown',
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

/** Magnitude → color, mirroring CombinedPeakModeRowView.magnitudeColor. */
export function magnitudeColor(mag: number): string {
  if (mag >= -40) return '#5fd07a' // green
  if (mag >= -60) return '#4ea1ff' // blue
  if (mag >= -80) return '#f0a03a' // orange
  return '#e0584a' // red
}
