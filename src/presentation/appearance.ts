// @parity model/appearance tests=test/theme
//
// The Appearance setting — follow the operating system, or always Light, or always Dark — and the scheme it
// resolves to. Every colour the app draws is chosen by the resolved scheme. Mirrors Swift `Appearance`.

/** The colour scheme the app is drawn in. */
export type Scheme = 'light' | 'dark'

/** The user's Appearance setting, in picker order. */
export const APPEARANCES = ['system', 'light', 'dark'] as const
export type Appearance = (typeof APPEARANCES)[number]

/** The label shown in Settings. */
export const APPEARANCE_LABEL: Record<Appearance, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/**
 * The scheme drawn when the operating system reports `os` (`null` when it reports none): the setting when Light or
 * Dark, else the operating system's, with none taken as Light.
 */
export function resolvedScheme(appearance: Appearance, os: Scheme | null): Scheme {
  if (appearance === 'light' || appearance === 'dark') return appearance
  return os ?? 'light'
}
