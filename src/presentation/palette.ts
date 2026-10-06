// @parity view/palette tests=test/theme,test/analysis-quality,test/mode-colors,test/quality-colors
//
// Every colour the app draws itself, as a functional role: what the colour is for (secondary text, the fL curve,
// the Peak Min line), with one light value and one dark value; two roles may share a value without being linked.
// The values are pinned rather than taken from a platform palette, so every edition shows the same colours on every
// OS. The colour only tells values apart; the exact shade does not matter, but it must be the same everywhere.
// Exports are drawn on white, so they use the light values. The tap/phase progress bar's blue is `--system-blue` in
// index.css, the same pair as `quality.blue`. Mirrors Swift `Palette`.

import type { ResolvedMode } from '../dsp/classify'
import type { WoodQuality } from '../dsp/material'
import { resolvedScheme, type Appearance, type Scheme } from './appearance'

/** A colour's two values, as "#RRGGBB", or "#RRGGBBAA" when the role has an opacity. */
export interface ColorPair {
  light: string
  dark: string
}

/** Every role, by its name in the theme table. */
export const ROLES = {
  'background.window': { light: '#F2F2F7', dark: '#0B0E13' },
  'background.panel': { light: '#FFFFFF', dark: '#141A22' },
  'background.control': { light: '#FFFFFF', dark: '#11161D' },
  'background.subtle': { light: '#8E8E9314', dark: '#8E8E931A' },
  'separator': { light: '#D8DEE6', dark: '#222A33' },
  'text.primary': { light: '#1A2330', dark: '#E7EBF0' },
  'text.secondary': { light: '#6B7785', dark: '#8A96A5' },
  'text.onColor': { light: '#FFFFFF', dark: '#FFFFFF' },
  'accent': { light: '#007AFF', dark: '#0A84FF' },
  'accent.text': { light: '#007AFF', dark: '#409CFF' },
  'toolbar.inactive': { light: '#8E8E93', dark: '#8E8E93' },
  'scrim': { light: '#0000004D', dark: '#00000080' },
  'overlay.card': { light: '#3A3A3CCC', dark: '#3A3A3CCC' },
  'chart.background': { light: '#FFFFFF', dark: '#0E1116' },
  'chart.grid': { light: '#E3E8EE', dark: '#1C242E' },
  'chart.border': { light: '#C2CAD4', dark: '#2A3543' },
  'chart.axis': { light: '#6B7785', dark: '#8A97A6' },
  'chart.title': { light: '#1A2330', dark: '#DFE4EA' },
  'chart.spectrum': { light: '#FF3B30', dark: '#FF453A' },
  'chart.crosshair.line': { light: '#5A646E80', dark: '#96A0AA8C' },
  'chart.crosshair.frequency': { light: '#FF3B30', dark: '#FF453A' },
  'chart.readout.background': { light: '#FFFFFFF5', dark: '#141921EB' },
  'chart.peakMin': { light: '#34C759', dark: '#30D158' },
  'chart.highlightedPeak': { light: '#FF3B30', dark: '#FF453A' },
  'mode.air': { light: '#00B0DC', dark: '#64D2FF' },
  'mode.top': { light: '#269342', dark: '#30D158' },
  'mode.back': { light: '#BB6D00', dark: '#FF9F0A' },
  'mode.dipole': { light: '#FF3B30', dark: '#FF453A' },
  'mode.ring': { light: '#AF52DE', dark: '#BF5AF2' },
  'mode.upper': { light: '#A2845E', dark: '#AC8E68' },
  'mode.unknown': { light: '#8E8E93', dark: '#8E8E93' },
  'mode.userDefined': { light: '#5856D6', dark: '#7D7AFF' },
  'material.longitudinal': { light: '#007AFF', dark: '#0A84FF' },
  'material.cross': { light: '#FF9500', dark: '#FF9F0A' },
  'material.flc': { light: '#AF52DE', dark: '#BF5AF2' },
  'material.unselected': { light: '#6B7785', dark: '#8A96A5' },
  'material.phaseInactive': { light: '#8E8E9333', dark: '#8E8E9333' },
  'material.goreBox': { light: '#007AFF14', dark: '#0A84FF14' },
  'phase.notStarted': { light: '#8E8E93', dark: '#8E8E93' },
  'phase.complete': { light: '#34C759', dark: '#30D158' },
  'peak.magnitude.strong': { light: '#34C759', dark: '#30D158' },
  'peak.magnitude.moderate': { light: '#007AFF', dark: '#0A84FF' },
  'peak.magnitude.weak': { light: '#FF9500', dark: '#FF9F0A' },
  'peak.magnitude.faint': { light: '#FF3B30', dark: '#FF453A' },
  'peak.pitch': { light: '#AF52DE', dark: '#BF5AF2' },
  'peak.selectedStar': { light: '#007AFF', dark: '#0A84FF' },
  'peak.unselectedStar': { light: '#6B7785', dark: '#8A96A5' },
  'peak.inRange': { light: '#34C759', dark: '#30D158' },
  'peak.outOfRange': { light: '#FF9500', dark: '#FF9F0A' },
  'quality.gray': { light: '#8E8E93', dark: '#8E8E93' },
  'quality.orange': { light: '#FF9500', dark: '#FF9F0A' },
  'quality.yellow': { light: '#FFCC00', dark: '#FFD60A' },
  'quality.green': { light: '#34C759', dark: '#30D158' },
  'quality.blue': { light: '#007AFF', dark: '#0A84FF' },
  'quality.red': { light: '#FF3B30', dark: '#FF453A' },
  'wood.excellent': { light: '#34C759', dark: '#30D158' },
  'wood.veryGood': { light: '#00C7BE', dark: '#63E6E2' },
  'wood.good': { light: '#007AFF', dark: '#0A84FF' },
  'wood.fair': { light: '#FF9500', dark: '#FF9F0A' },
  'wood.poor': { light: '#FF3B30', dark: '#FF453A' },
  'badge.guitar': { light: '#007AFF33', dark: '#0A84FF33' },
  'badge.material': { light: '#FF950033', dark: '#FF9F0A33' },
  'badge.comparison': { light: '#AF52DE33', dark: '#BF5AF233' },
  'results.tapsActive': { light: '#FF9500', dark: '#FF9F0A' },
  'series.1': { light: '#007AFF', dark: '#0A84FF' },
  'series.2': { light: '#E07800', dark: '#FF9F0A' },
  'series.3': { light: '#269342', dark: '#30D158' },
  'series.4': { light: '#AF52DE', dark: '#BF5AF2' },
  'series.5': { light: '#0090B0', dark: '#64D2FF' },
  'series.6': { light: '#E0302A', dark: '#FF453A' },
  'series.7': { light: '#D6177A', dark: '#FF6FB5' },
  'series.8': { light: '#8B6A42', dark: '#C29A6B' },
  'series.9': { light: '#7A8A00', dark: '#B8D430' },
  'series.10': { light: '#5E6B7A', dark: '#A8B4C2' },
  'series.average': { light: '#EBC300', dark: '#FFD900' },
  'status.running': { light: '#34C759', dark: '#30D158' },
  'status.tapDetected': { light: '#34C759', dark: '#30D158' },
  'status.complete': { light: '#34C759', dark: '#30D158' },
  'status.stopped': { light: '#8E8E93', dark: '#8E8E93' },
  'status.idle': { light: '#8E8E93', dark: '#8E8E93' },
  'status.paused': { light: '#FF9500', dark: '#FF9F0A' },
  'status.frozen': { light: '#FF9500', dark: '#FF9F0A' },
  'status.warning': { light: '#FF9500', dark: '#FF9F0A' },
  'status.playingFile': { light: '#FF9500', dark: '#FF9F0A' },
  'status.info': { light: '#007AFF', dark: '#0A84FF' },
  'status.saved': { light: '#007AFF', dark: '#0A84FF' },
  'status.progress': { light: '#007AFF', dark: '#0A84FF' },
  'status.tapCount': { light: '#007AFF', dark: '#0A84FF' },
  'status.peakReadout': { light: '#007AFF', dark: '#0A84FF' },
  'status.error': { light: '#FF3B30', dark: '#FF453A' },
  'status.inactiveDot': { light: '#8E8E934D', dark: '#8E8E934D' },
  'meter.groove': { light: '#EBEBEB', dark: '#0A0D12' },
  'meter.grooveBorder': { light: '#8E8E9399', dark: '#8E8E9373' },
  'meter.levelTop': { light: '#66CCFF', dark: '#66CCFF' },
  'meter.levelMiddle': { light: '#0066CC', dark: '#0066CC' },
  'meter.levelBottom': { light: '#001E50', dark: '#001E50' },
  'meter.clip': { light: '#FF3B30D9', dark: '#FF453AD9' },
  'meter.ticks': { light: '#3D8C3DB3', dark: '#3D8C3DB3' },
  'meter.peakHold': { light: '#FFC700', dark: '#FFC700' },
  'meter.peakHoldBorder': { light: '#FFFFFFD9', dark: '#FFFFFFD9' },
  'meter.thresholdHandle': { light: '#FF3B30', dark: '#FF453A' },
  'meter.thresholdHandleBorder': { light: '#800000', dark: '#800000' },
  'metric.good': { light: '#34C759', dark: '#30D158' },
  'metric.fair': { light: '#FFCC00', dark: '#FFD60A' },
  'metric.high': { light: '#FF9500', dark: '#FF9F0A' },
  'metric.overload': { light: '#FF3B30', dark: '#FF453A' },
  'pdf.accent': { light: '#2659BF', dark: '#2659BF' },
  'pdf.text': { light: '#1C1C1E', dark: '#1C1C1E' },
  'pdf.secondary': { light: '#787880', dark: '#787880' },
  'pdf.divider': { light: '#D2D2D4', dark: '#D2D2D4' },
  'pdf.box': { light: '#F2F2F4', dark: '#F2F2F4' },
  'pdf.pill': { light: '#ECECEE', dark: '#ECECEE' },
  'pdf.goreBox': { light: '#F7F9FD', dark: '#F7F9FD' },
  'pdf.chartMatte': { light: '#0D0D0D', dark: '#0D0D0D' },
} as const satisfies Record<string, ColorPair>

/** A colour's purpose. */
export type Role = keyof typeof ROLES

/** Opacities applied to another role's colour (the peak-row tint over its mode colour). */
export const OPACITIES = {
  'peak.rowTint': { light: 0.1, dark: 0.2 },
  'status.messageBackground': { light: 0.12, dark: 0.12 },
} as const satisfies Record<string, { light: number; dark: number }>

export type Opacity = keyof typeof OPACITIES

/** The light and dark values of `role`. */
export function pair(role: Role): ColorPair {
  return ROLES[role]
}

// The resolved scheme. Swift's palette colours resolve themselves when drawn, and CSS follows the custom properties
// set per `data-theme`; what this edition draws in script (the canvas chart) does not, so it subscribes and redraws.

let appearance: Appearance = 'system'
let current: Scheme = 'light'
let followingOs = false
const listeners = new Set<(scheme: Scheme) => void>()

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

/** The scheme the app is drawn in. */
export function scheme(): Scheme {
  return current
}

/** The scheme the operating system reports, or `null` when it reports none. */
export function osScheme(): Scheme | null {
  const q = darkQuery()
  return q ? (q.matches ? 'dark' : 'light') : null
}

/**
 * Draw the app — its controls and the palette's colours — in the scheme `appearance` resolves to: the operating
 * system's own for System. Mirrors Swift `Palette.apply`.
 */
export function apply(next: Appearance): void {
  appearance = next
  const q = darkQuery()
  if (q && !followingOs) {
    q.addEventListener('change', () => {
      if (appearance === 'system') update()
    })
    followingOs = true
  }
  update()
}

/** Call `listener` on every change of the resolved scheme; returns the unsubscribe. */
export function subscribe(listener: (scheme: Scheme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function update(): void {
  const resolved = resolvedScheme(appearance, appearance === 'system' ? osScheme() : null)
  const changed = resolved !== current
  current = resolved
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.dataset.theme = resolved
    for (const role of Object.keys(ROLES) as Role[]) root.style?.setProperty(cssVariable(role), color(role))
  }
  if (changed) for (const listener of listeners) listener(resolved)
}

/** The CSS custom property that carries `role` in the current scheme: `chart.readout.background` →
 *  `--c-chart-readout-background`. Set on the root by `apply`, so CSS follows the scheme. */
export function cssVariable(role: Role): string {
  return `--c-${role.replace(/\./g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
}

/** `"#RRGGBB"` or `"#RRGGBBAA"` as a CSS colour. */
function css(hex: string, alpha = 1): string {
  const a = (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1) * alpha
  if (a === 1) return hex
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
}

/**
 * The colour of `role` in the scheme the app is drawn in (or `inScheme` — an export passes light), at that scheme's
 * `opacity` when given, as CSS.
 */
export function color(role: Role, opacity?: Opacity, inScheme?: Scheme): string {
  const s = inScheme ?? current
  return css(ROLES[role][s], opacity ? OPACITIES[opacity][s] : 1)
}

/** The multi-tap and comparison series, by slot; a slot past the last starts again at the first. */
export const SERIES_ROLES: Role[] = [
  'series.1', 'series.2', 'series.3', 'series.4', 'series.5',
  'series.6', 'series.7', 'series.8', 'series.9', 'series.10',
]

/** The role of series slot `index` (0-based). Mirrors Swift `Palette.series`. */
export function seriesRole(index: number): Role {
  return SERIES_ROLES[index % SERIES_ROLES.length]!
}

/** The role a saved comparison's entry `index` is drawn in: its series slot, or the average for the
 *  "Averaged" entry — never the colour stored with it. Mirrors Swift
 *  `Palette.comparisonColor(index:label:)`. */
export function comparisonRole(index: number, label: string): Role {
  return label === 'Averaged' ? 'series.average' : seriesRole(index)
}

/** The role whose values `p` holds (an analysis-quality colour). */
export function roleOf(p: ColorPair): Role {
  return (Object.keys(ROLES) as Role[]).find((r) => ROLES[r] === p)!
}

/** The role of a guitar mode's colour. Mirrors Swift `Palette.role(_: GuitarMode)`. */
export function modeRole(mode: ResolvedMode): Role {
  return `mode.${mode}`
}

/**
 * The role of a peak's magnitude (dB) in a peak list: strong from −40 dB, moderate from −60, weak from −80, faint
 * below. Mirrors Swift `Palette.role(magnitude:)`.
 */
export function magnitudeRole(magnitude: number): Role {
  if (magnitude >= -40) return 'peak.magnitude.strong'
  if (magnitude >= -60) return 'peak.magnitude.moderate'
  if (magnitude >= -80) return 'peak.magnitude.weak'
  return 'peak.magnitude.faint'
}

const QUALITY_ROLE: Record<WoodQuality, Role> = {
  Excellent: 'wood.excellent',
  'Very Good': 'wood.veryGood',
  Good: 'wood.good',
  Fair: 'wood.fair',
  Poor: 'wood.poor',
}

/** The role of a wood-quality grade's colour. Mirrors Swift `Palette.role(_: WoodQuality)`. */
export function qualityRole(quality: WoodQuality): Role {
  return QUALITY_ROLE[quality]
}

export const PALETTE = {
  gray: ROLES['quality.gray'],
  orange: ROLES['quality.orange'],
  yellow: ROLES['quality.yellow'],
  green: ROLES['quality.green'],
  blue: ROLES['quality.blue'],
  red: ROLES['quality.red'],
} as const satisfies Record<string, ColorPair>
