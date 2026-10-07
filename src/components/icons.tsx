import { MDI } from './mdiPaths'
// Shared monochrome line icons (Lucide-style, `currentColor` so they inherit text colour and
// disabled opacity). These mirror the native control glyphs (Swift SF Symbols / Python qtawesome)
// and are used both on the toolbars (App.tsx) and in the Quick Start Guide, so the help icons
// match exactly what the user sees on the controls.

const ICON_SVG = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

// An icon the Python edition also draws: its Material Design glyph (mdiPaths.ts), filled in the current
// colour, so the two editions show the same shapes — each the nearest to Swift's SF Symbol.
function Mdi({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={d} />
    </svg>
  )
}
export const ChartLineIcon = () => <Mdi d={MDI.chartLine} />
export const DocumentIcon = () => <Mdi d={MDI.document} />
export const AutoDbOnIcon = () => <Mdi d={MDI.autoDbOn} />

// ── Tap-control glyphs ──────────────────────────────────────────────────────
export const TapIcon = () => <Mdi d={MDI.tap} />
export const PauseIcon = () => <Mdi d={MDI.pauseCircle} />
export const PlayIcon = () => <Mdi d={MDI.playCircle} />
export const CancelIcon = () => <Mdi d={MDI.closeCircle} />
export const CheckIcon = () => <Mdi d={MDI.checkCircle} />
export const UndoIcon = () => <Mdi d={MDI.restore} />

// ── App control-bar glyphs ──────────────────────────────────────────────────
export const AutoDbIcon = () => <Mdi d={MDI.autoDb} />
export const EyeIcon = () => <Mdi d={MDI.eye} />
export const StarIcon = () => <Mdi d={MDI.star} />
export const EyeOffIcon = () => <Mdi d={MDI.eyeOff} />
export const SaveIcon = () => <Mdi d={MDI.save} />
export const ClipboardIcon = () => <Mdi d={MDI.clipboard} />
export const BarChartIcon = () => <Mdi d={MDI.chartBar} />
export const GearIcon = () => <Mdi d={MDI.cog} />
export const HelpIcon = () => <Mdi d={MDI.help} />
export const BookIcon = () => <Mdi d={MDI.bookOpen} />
/** Release Notes (Help menu) — a document with a folded corner and lines of text. */
export const NotesIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="14" y2="17" />
  </svg>
)
export const FilePlayIcon = () => <Mdi d={MDI.waveform} />

// ── Quick Start Guide extras (section headers + controls without a toolbar glyph) ──
// What Guitar Tap Does (mdi.waveform)
// A peak's pitch (music.note) — filled, as Swift's symbol is.
export const MusicNoteIcon = () => <Mdi d={MDI.musicNote} size={10} />
export const WaveformIcon = () => <Mdi d={MDI.waveform} />
// First-Time Setup (mdi.wrench)
export const WrenchIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.7 2.7-2.5-2.5 2.7-2.7Z" />
  </svg>
)
// Guitar Mode (mdi.music)
export const MusicIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
)
// Plate Mode / Compare (mdi.layers)
export const LayersIcon = () => (
  <svg {...ICON_SVG}>
    <path d="m12 2 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 17 9 5 9-5" />
  </svg>
)
// Brace Mode (mdi.minus-box-outline) — a brace strip
export const BraceIcon = () => (
  <svg {...ICON_SVG}>
    <rect x="3" y="9" width="18" height="6" rx="1" />
  </svg>
)
// Tap Controls (mdi.tune) — sliders
export const SlidersIcon = () => (
  <svg {...ICON_SVG}>
    <line x1="4" x2="4" y1="21" y2="14" />
    <line x1="4" x2="4" y1="10" y2="3" />
    <line x1="12" x2="12" y1="21" y2="12" />
    <line x1="12" x2="12" y1="8" y2="3" />
    <line x1="20" x2="20" y1="21" y2="16" />
    <line x1="20" x2="20" y1="12" y2="3" />
    <line x1="2" x2="6" y1="14" y2="14" />
    <line x1="10" x2="14" y1="8" y2="8" />
    <line x1="18" x2="22" y1="16" y2="16" />
  </svg>
)
// Tips & Technique (mdi.lightbulb-outline)
export const LightbulbIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" />
  </svg>
)
// Glossary (mdi.book-open-outline)
export const BookOpenIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z" />
  </svg>
)
// Crosshair (chart cursor)
export const CrosshairIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" x2="12" y1="2" y2="6" />
    <line x1="12" x2="12" y1="18" y2="22" />
    <line x1="2" x2="6" y1="12" y2="12" />
    <line x1="18" x2="22" y1="12" y2="12" />
  </svg>
)
// Crosshair toggle — mirrors the iOS SF Symbols: viewfinder frame with a dot (mode OFF) or a
// plus (mode ON). Same dot.viewfinder / plus.viewfinder pair the Swift app toggles between.
const VIEWFINDER_FRAME = (
  <>
    <path d="M3 8V5a2 2 0 0 1 2-2h3" />
    <path d="M16 3h3a2 2 0 0 1 2 2v3" />
    <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
    <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
  </>
)
export const DotViewfinderIcon = () => (
  <svg {...ICON_SVG}>
    {VIEWFINDER_FRAME}
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)
export const PlusViewfinderIcon = () => (
  <svg {...ICON_SVG}>
    {VIEWFINDER_FRAME}
    <line x1="12" x2="12" y1="9" y2="15" />
    <line x1="9" x2="15" y1="12" y2="12" />
  </svg>
)
// Peak Labels (a tag)
export const TagIcon = () => <Mdi d={MDI.tag} />
// Chart Options (⋯)
export const EllipsisIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />
  </svg>
)
// Zoom & Pan (magnifier)
export const SearchIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" x2="16.65" y1="21" y2="16.65" />
  </svg>
)
// Analysis Results (phone: opens the results bottom sheet) — matches the iOS `doc.text` Results
// toolbar button: a page with a folded top-right corner and text lines.
export const ResultsIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
    <line x1="8" y1="9" x2="10" y2="9" />
  </svg>
)
// Re-analyze peaks — re-run detection on the loaded/frozen spectrum with the current settings.
// Mirrors the Swift `arrow.trianglehead.2.counterclockwise` / Python `fa5s.sync-alt`.
export const RefreshIcon = () => <Mdi d={MDI.refresh} />
// Reset-to-auto peak selection — mirrors the iOS SF Symbol `wand.and.stars`.
export const WandIcon = () => <Mdi d={MDI.autoFix} />
// ── Per-mode peak glyphs — match the Swift SF Symbols (GuitarMode.icon) / Python qtawesome:
//    air=wind, top=arrow.up.and.down, back=square.fill, dipole=circle.lefthalf.filled,
//    ring=circle.dashed, upper=waveform (reuse WaveformIcon), unknown=questionmark.circle (HelpIcon).
export const WindIcon = () => <Mdi d={MDI.wind} />
export const ArrowUpDownIcon = () => <Mdi d={MDI.arrowUpDown} />
export const SquareFilledIcon = () => <Mdi d={MDI.square} />
export const DipoleIcon = () => <Mdi d={MDI.circleHalf} />
export const CircleDashedIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 3.2" />
  </svg>
)
// Threshold / Peak Min (a level/gauge)
export const GaugeIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M12 14 8 9" />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </svg>
)