# Theme Spec — Light / Dark / System (all three platforms)

Status: **PROPOSED** (spec only — not yet implemented). Cross-platform feature, strict
lock-step parity: designed once here, implemented on Swift + Python + web together and
shipped together (per the standing "improvements go to all three" rule).

## 1. Goal

Add a user-selectable color scheme — **Light / Dark / System** — to all three apps, backed
by a single source-of-truth color spec so the three render the *same* colors in each theme.

### Why now
A review of the mode-color parity work surfaced that the platforms were never on the same
scheme: **Swift** follows the macOS system appearance (adaptive), **Python (Qt)** is
effectively light-only (chart hardcoded `setBackground("w")`, fixed light-tuned mode RGB,
~150 `setStyleSheet` literal-color sites), and **web** is hardcoded dark (`:root` vars) but
already has a themeable chart (`LIGHT_CHART`/`DARK_CHART`). A two-variant palette already
exists *de facto* — light ≈ the Swift/Python mode RGB, dark ≈ the web's brightened hexes —
but was never unified or switchable. This spec unifies it.

## 2. The setting

- **Values:** `system` (default) · `light` · `dark`.
- **`system`** resolves to the OS appearance and updates live when the OS flips:
  - Swift: `preferredColorScheme(nil)` — SwiftUI follows the system.
  - Python: follow `QGuiApplication.styleHints().colorScheme()` (Qt 6.5+) and react to its
    `colorSchemeChanged` signal; fall back to the app palette on older Qt.
  - Web: `@media (prefers-color-scheme)` when no explicit override is set.
- **Storage:** each app's existing settings store (Swift `TapDisplaySettings`, Python
  settings, web `localStorage`). Key: `colorScheme` = `system|light|dark`.
- **Placement:** the Settings screen, near the other display options — same wording and order
  on all three ("Appearance: System / Light / Dark").
- **Resolved theme** = `system ? os_appearance : setting`. Everything below keys off the
  *resolved* theme (`light` or `dark`).

## 3. Color role spec (single source of truth)

All three platforms encode **these exact hex values** — Swift via an asset catalog color set
(Any/Dark appearances), Python via a `THEME[scheme]` dict, web via CSS custom properties +
the existing `ChartTheme`. No platform may rely on its own system-named colors for these
roles (that's what caused the drift); the values here are canonical.

### 3.1 App chrome
| Role | Light | Dark | Source |
|---|---|---|---|
| Window background | `#f7f9fb` | `#0b0e13` | web `--bg` (dark); light derived |
| Panel / card background | `#ffffff` | `#141a22` | web `--panel` |
| Divider / line | `#d8dee6` | `#222a33` | web `--line` |
| Text — primary | `#1a2330` | `#e7ebf0` | web `--text` |
| Text — muted / secondary | `#6b7785` | `#8a96a5` | web `--muted` |
| Accent | `#2f6fd0` | `#4ea1ff` | web `--accent` (light darkened for contrast on white) |

### 3.2 Chart (matches existing web `LIGHT_CHART` / `DARK_CHART`)
| Role | Light | Dark |
|---|---|---|
| Chart background | `#ffffff` | `#0e1116` |
| Grid | `#e3e8ee` | `#1c242e` |
| Border | `#c2cad4` | `#2a3543` |
| Axis labels / titles | `#6b7785` | `#8a97a6` |
| Plot title | `#1a2330` | `#dfe4ea` |
| Spectrum curve (default) | `#e0584a` | `#4ea1ff` |
| Crosshair line | `rgba(90,100,110,.5)` | `rgba(150,160,170,.55)` |
| Crosshair freq readout | `#cc3232` | `#dc6464` |
| Crosshair dB readout | `#6b7785` | `#8a97a6` |
| Readout box fill | `rgba(255,255,255,.96)` | `rgba(20,25,33,.92)` |
| Pitch guide line | `#9b51c2` | `#c389e8` |

### 3.3 Mode colors — **identical hex on all three platforms**
Light column = today's Swift/Python canonical RGB; Dark column = the web palette (post the
dipole/ring hue fix). These replace Swift's system `.cyan/.red/…` (which must become explicit
color-set values) and Python's single fixed RGB (which becomes theme-selected).
| Mode | Light | Dark |
|---|---|---|
| Air | `#00b7eb` | `#4ea1ff` |
| Top | `#28a028` | `#5fd07a` |
| Back | `#dc7828` | `#f0a03a` |
| Dipole | `#d23232` | `#e0584a` |
| Ring | `#823cc8` | `#b07ad8` |
| Upper | `#828282` | `#9aa6b3` |
| Unknown | `#828282` | `#5a6573` |
| User-defined (freeform label) | `#008080` | `#1a9a9a` |

### 3.4 Magnitude gradient (peak card / row background)
Bands are green / blue / orange / red. Dark = today's web `magnitudeColor` hexes. Swift
`CombinedPeakModeRowView.magnitudeColor` uses **system** `.green/.blue/.orange/.red` (adaptive,
no fixed hex), so there is no exact light source to copy — the light values below are a **design
proposal** (saturated for a white background; matches the light-chart red `#cc3232`). Confirm
visually before locking.
| Band | Light | Dark |
|---|---|---|
| ≥ −40 dB | `#2e9e4e` | `#5fd07a` |
| ≥ −60 dB | `#2f6fd0` | `#4ea1ff` |
| ≥ −80 dB | `#d07a1e` | `#f0a03a` |
| < −80 dB | `#cc3232` | `#e0584a` |

### 3.5 Multi-tap comparison palette (`MultiTapComparisonResultsView`)
The per-tap dot palette is another **appearance-adaptive system-color set** with the same
drift as §3.3: Swift uses `TapToneAnalyzer.multiTapPalette = [.blue, .orange, .green, .purple,
.teal]` (system colors, adaptive — and on macOS also accent-dependent), Python froze a
light-family constant set, and web froze the dark/brightened iOS variants. Unify to explicit
hex like the mode colors. Light column = today's Python constants; Dark column = today's web
hexes — confirm the light values visually (they inherit the same "no exact canonical RGB"
caveat as §3.4, since Swift's source is adaptive).
| Slot | Light (Python today) | Dark (web today) |
|---|---|---|
| 1 · blue | `#007aff` | `#0a84ff` |
| 2 · orange | `#ff9500` | `#ff9f0a` |
| 3 · green | `#34c759` | `#30d158` |
| 4 · purple | `#af52de` | `#bf5af2` |
| 5 · teal | `#5ac8fa` | `#40c8e0` |
| Averaged row | `#ffd900` | `#ffd900` | <!-- gold, fixed in both themes (Swift Color(1.0,0.85,0.0)) -->

### 3.6 Analysis-quality labels (guitar-summary Ring-Out / Tap-Ratio)
The Ring-Out (`decayQuality`) and Tap-Ratio (`tapToneRatioQuality`) quality labels are tinted by
a third divergent color set: **Swift** uses **system colors** (`.gray/.orange/.yellow/.green/.blue`
for decay; `.red/.orange/.green` for ratio — adaptive, no fixed hex), **Python** uses **Material**
hexes (`#9E9E9E/#FF9800/#FFC107/#4CAF50` decay; `#F44336/#FF9800/#4CAF50` ratio), and **web** uses
its **own tuned** hexes (`#8a8a8e/…` decay; `#d83a30/#e08a00/#2c9c3c` ratio). Same appearance-adaptive
situation as §3.3–§3.5 — unify to explicit per-theme hex. (The quality **thresholds/labels** already
match across platforms — this is colors only; the acoustic decay threshold drift found during the
guitar-summary review was a separate value bug, fixed there.)

## 4. Per-platform implementation

### Swift — Small
- Add `colorScheme: AppColorScheme` (`system/light/dark`) to `TapDisplaySettings`.
- Apply `.preferredColorScheme(resolved)` at the app root (`nil` for system).
- Move the six mode colors + user-defined + magnitude gradient into **asset-catalog color
  sets** with Any/Dark appearances set to the §3.3/§3.4 values, so `GuitarMode.color`
  resolves the right variant automatically. (Replaces the current `.cyan/.green/…`.)
- Adaptive chrome (`.systemBackground`, `.regularMaterial`, `.secondary`) already flips; audit
  the handful of hardcoded `Color.white/.black` (mostly the export path) so on-screen honors
  the theme and export stays white (§5).

### Python (Qt / pyqtgraph) — Large (the long pole)
- Add the setting + persistence + Settings control.
- Build a `THEME[scheme]` dict from §3 and a small **QSS stylesheet** per scheme; set
  `QApplication.setPalette(...)` + `setStyleSheet(...)` on change.
- Refactor the ~150+ `setStyleSheet` literal-color sites (115 in `tap_tone_analysis_view.py`
  alone) to read palette roles / the `THEME` dict instead of hardcoded colors.
- pyqtgraph: replace `setBackground("w")` (live `FftCanvas` + export) with theme bg; re-pen
  axes / grid / crosshair from `THEME`.
- Mode colors: `GuitarMode.color` takes the resolved scheme and returns the §3.3 variant.
- React to OS changes via `styleHints().colorSchemeChanged` when set to `system`.

### Web (React / CSS) — Medium
- Split `:root` into light + dark variable sets keyed by `:root[data-theme="light|dark"]`,
  plus an `@media (prefers-color-scheme)` default for `system`. Drop the hardcoded
  `color-scheme: dark`.
- Add an Appearance control in Settings; persist to `localStorage`; stamp `data-theme` on the
  root (and set `<meta name="color-scheme">` accordingly).
- Wire the on-screen chart to pick `LIGHT_CHART`/`DARK_CHART` (already built) from the resolved
  theme; today it's pinned to `DARK_CHART`.
- Mode colors: add a light map alongside the current (dark) `MODE_COLOR` and select by theme;
  same for `USER_MODE_COLOR` and `magnitudeColor`.

## 5. Exports (decision: keep always-light)
PNG/PDF exports stay **light** regardless of the app theme (print-friendly, matches current
behavior on all three: Swift `Color.white`, web `LIGHT_CHART`, Python `setBackground("w")`).
Revisit only if users ask for dark exports.

## 6. Parity & testing
- **Source of truth = this doc.** There is no shared code across the three, so each encodes the
  same hex. Recommend a tiny per-repo check (unit test / lint) asserting the mode-color and
  chart values match §3, so drift is caught (colors are **not** in the numeric oracle).
- **Visual QA matrix:** 2 themes × 3 platforms × {live spectrum, peak cards, mode annotations,
  Settings, measurements list, export}. Sign off before shipping.
- Ship all three together (lock-step). No behavioral/DSP impact — this is presentation only.

## 7. Work breakdown (lock-step)
1. **Lock the spec** (this doc): confirm the §3.4 light gradient vs Swift, and the light chrome
   values (§3.1). — *shared, Small*
2. **Encode the palette** on each platform (asset catalog / `THEME` dict / CSS vars). — Swift S,
   Python M, Web S
3. **Wire the setting** (persistence + Settings control + `system` resolution + live OS react). —
   S each
4. **Retheme surfaces**: Python stylesheet/pyqtgraph retrofit (the bulk), web chart+chrome wiring,
   Swift hardcoded-white audit. — Python **L**, Web M, Swift S
5. **Integrated visual QA** across the matrix, then ship together.

Dominant cost: Python step 4. Everything else is small-to-medium.

## 8. Open decisions (confirm before implementing)
1. §3.4 light magnitude-gradient hexes — a **design proposal** (Swift uses adaptive system
   colors, so nothing to copy); confirm the four light values visually.
2. §3.1 light chrome exact values (window/panel/accent) — proposed here; confirm.
3. Settings label + option order — proposed "Appearance: System / Light / Dark".
4. Exports stay light (§5) — confirm.
5. Optional: add the per-repo "colors match spec" guard test (§6) — yes/no.
6. §3.5 multi-tap palette light values — the frozen Python constants (same adaptive-source
   caveat as §3.4); confirm visually.