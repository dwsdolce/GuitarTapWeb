// @parity model/quality-colors
import type { WoodQuality } from '../dsp/material'

/**
 * Wood-quality display colours, qualified by colour scheme.
 *
 * ## Why this file exists (and why it is in `presentation/`)
 *
 * Swift and Python both hang the colour off the **model** enum — `WoodQuality.color`
 * (`MaterialProperties.swift:537`, `material_properties.py:177`). That is a layer violation: a hex
 * is a presentation concern, and the model should not know how it is drawn. **They are wrong and
 * will be fixed later** — tracked in THEME-SPEC.md / STATUS item 3; not worth churning the natives
 * for now.
 *
 * The web already does this correctly for the analogous case: Swift keeps `GuitarMode.color` on the
 * enum, and the web extracted it to `presentation/modeColors.ts` under its own `model/mode-colors`
 * slug. This file mirrors that exactly, as `model/quality-colors`.
 *
 * ## Scheme
 *
 * **Hue is fixed by Swift; only the shade varies by scheme.** That is the web's established rule —
 * see modeColors.ts: *"brightened for the dark chart background — so shades differ from
 * Swift/Python's RGB, but the hue per mode matches."*
 *
 * - `light` — a **white** surface. The PDF/PNG report is always light, whatever the app is set to.
 * - `dark` — the app's dark chrome.
 *
 * ## Forward path (STATUS item 3 — Theme Light/Dark/System)
 *
 * The theme work owns *scheme selection*, not this table. When it lands:
 *   - the app's call site swaps its literal `'dark'` for the active scheme from the theme context;
 *   - **the PDF stays pinned to `'light'` forever** — a printed report is not themed;
 *   - this table does not move, and Swift/Python grow the same two-scheme shape when their colours
 *     are relocated out of the model layer.
 */
export type ColorScheme = 'light' | 'dark'

/**
 * `WoodQuality` → hex, per scheme. Mirrors Swift `WoodQuality.color` /
 * Python `WoodQuality.color()`.
 *
 * `light` is **verified** against Python, which documents itself as the single source of truth and
 * names each SwiftUI system colour: `.green (#34C759)`, `.mint (#00C7BE)`, `.blue (#007AFF)`,
 * `.orange (#FF9500)`, `.red (#FF3B30)`.
 *
 * `dark` uses Apple's dark variants — the same hexes the web already standardises on elsewhere
 * (`--system-blue: #0a84ff` in index.css, and the comparison palettes
 * `['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#40c8e0']`).
 *
 * ⚠ **Regression this fixes:** the web previously had `Good: '#ffd60a'` (**yellow** — Swift is
 * `.blue`) and `'Very Good': '#34c759'` (which is *Excellent's* canonical green, not `.mint`), so
 * Overall Quality rendered yellow where Swift and Python show blue, and Very Good was
 * indistinguishable from Excellent. Both were **hue** errors, not shade choices. The table was also
 * duplicated verbatim in two files that had already drifted from Swift — this is now the only copy.
 */
export const WOOD_QUALITY_COLOR: Record<ColorScheme, Record<WoodQuality, string>> = {
  light: {
    Excellent: '#34C759', // .green
    'Very Good': '#00C7BE', // .mint
    Good: '#007AFF', // .blue
    Fair: '#FF9500', // .orange
    Poor: '#FF3B30', // .red
  },
  dark: {
    Excellent: '#30D158', // .green (dark)
    // .mint (dark). ⚠ SHADE UNVERIFIED: there is no mint anywhere in the three repos to copy, so
    // this is Apple's published systemMint dark rather than something established here. The HUE is
    // what parity requires (mint, distinct from Excellent's green) and that is correct; the exact
    // token is the theme project's to confirm.
    'Very Good': '#66D4CF',
    Good: '#0A84FF', // .blue (dark) — matches --system-blue
    Fair: '#FF9F0A', // .orange (dark)
    Poor: '#FF453A', // .red (dark)
  },
}

/** The colour for `q` in `scheme`. Callers name their scheme explicitly: the report passes
 *  `'light'` (a white page), the app passes its active scheme. */
export function woodQualityColor(q: WoodQuality, scheme: ColorScheme): string {
  return WOOD_QUALITY_COLOR[scheme][q]
}