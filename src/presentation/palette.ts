// @parity view/palette tests=test/analysis-quality
//
// The app's fixed colours: each has one light value and one dark value, chosen by the background. They
// are pinned rather than taken from a platform palette, so every edition shows the same colours on every
// OS. The colour only tells values apart; the exact shade does not matter, but it must be the same
// everywhere. The app's background is dark, so the screen takes `dark`; a PDF is printed on white, so it
// takes `light`. The tap/phase progress bar's blue is `--system-blue` in index.css, the same pair.
// Mirrors Swift `Palette`.

/** A colour's two values, as "#RRGGBB". */
export interface ColorPair {
  light: string
  dark: string
}

export const PALETTE = {
  gray: { light: '#8E8E93', dark: '#8E8E93' },
  orange: { light: '#FF9500', dark: '#FF9F0A' },
  yellow: { light: '#FFCC00', dark: '#FFD60A' },
  green: { light: '#34C759', dark: '#30D158' },
  blue: { light: '#007AFF', dark: '#0A84FF' },
  red: { light: '#FF3B30', dark: '#FF453A' },
} as const satisfies Record<string, ColorPair>
