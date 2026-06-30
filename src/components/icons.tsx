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

// ── Tap-control glyphs ──────────────────────────────────────────────────────
export const TapIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M22 14a8 8 0 0 1-8 8" />
    <path d="M18 11v-1a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
    <path d="M14 10V9a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1" />
    <path d="M10 9.5V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v10" />
    <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
)
export const PauseIcon = () => (
  <svg {...ICON_SVG}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
)
export const PlayIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M6 4 20 12 6 20 Z" />
  </svg>
)
export const CancelIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </svg>
)
export const CheckIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
export const UndoIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 8.97 8.97 0 0 0-6.4 2.6L3 13" />
  </svg>
)

// ── App control-bar glyphs ──────────────────────────────────────────────────
export const AutoDbIcon = () => (
  <svg {...ICON_SVG}>
    <path d="m21 16-4 4-4-4" />
    <path d="M17 20V4" />
    <path d="m3 8 4-4 4 4" />
    <path d="M7 4v16" />
  </svg>
)
export const EyeIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
export const StarIcon = () => (
  <svg {...ICON_SVG}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
  </svg>
)
export const EyeOffIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
)
export const SaveIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </svg>
)
export const ClipboardIcon = () => (
  <svg {...ICON_SVG}>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" />
    <path d="M12 16h4" />
    <path d="M8 11h.01" />
    <path d="M8 16h.01" />
  </svg>
)
export const BarChartIcon = () => (
  <svg {...ICON_SVG}>
    <line x1="6" x2="6" y1="20" y2="14" />
    <line x1="12" x2="12" y1="20" y2="8" />
    <line x1="18" x2="18" y1="20" y2="4" />
  </svg>
)
export const GearIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
export const HelpIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)
export const BookIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)
export const FilePlayIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="10 8 16 12 10 16 10 8" />
  </svg>
)

// ── Quick Start Guide extras (section headers + controls without a toolbar glyph) ──
// What Guitar Tap Does (mdi.waveform)
export const WaveformIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M2 12h3l2-7 4 18 3-14 2 6 2-3h4" />
  </svg>
)
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
export const TagIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M3 11.5V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 .7.3l8.5 8.5a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-8.5-8.5a1 1 0 0 1-.3-.7Z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </svg>
)
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
// Reset-to-auto peak selection — mirrors the iOS SF Symbol `wand.and.stars`.
export const WandIcon = () => (
  <svg {...ICON_SVG}>
    <path d="m21.64 3.64-1.28-1.28a1.2 1.2 0 0 0-1.72 0L2.36 18.64a1.2 1.2 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
    <path d="m14 7 3 3" />
    <path d="M5 6v4" />
    <path d="M19 14v4" />
    <path d="M10 2v2" />
    <path d="M7 8H3" />
    <path d="M21 16h-4" />
    <path d="M11 3H9" />
  </svg>
)
// ── Per-mode peak glyphs — match the Swift SF Symbols (GuitarMode.icon) / Python qtawesome:
//    air=wind, top=arrow.up.and.down, back=square.fill, dipole=circle.lefthalf.filled,
//    ring=circle.dashed, upper=waveform (reuse WaveformIcon), unknown=questionmark.circle (HelpIcon).
export const WindIcon = () => (
  <svg {...ICON_SVG}>
    <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
    <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
    <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
  </svg>
)
export const ArrowUpDownIcon = () => (
  <svg {...ICON_SVG}>
    <path d="m8 6 4-4 4 4" />
    <path d="M12 2v20" />
    <path d="m8 18 4 4 4-4" />
  </svg>
)
export const SquareFilledIcon = () => (
  <svg {...ICON_SVG}>
    <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke="none" />
  </svg>
)
export const DipoleIcon = () => (
  <svg {...ICON_SVG}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
  </svg>
)
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