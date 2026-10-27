// @parity view/icons
import { MDI } from './mdiPaths'
import { CUSTOM } from './customIcons'
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

// A menu item's icon by its Material Design name, as the shared menu lists give it (savedMeasurementMenu).
const MDI_BY_NAME: Record<string, string> = {
  'file-download-outline': MDI.fileDownload,
  'eye-outline': MDI.eye,
  'pencil-outline': MDI.pencil,
  'file-export-outline': MDI.fileExport,
  'chart-line': MDI.chartLine,
  'file-pdf-box': MDI.filePdf,
  'trash-can-outline': MDI.trashCan,
  'check-circle-outline': MDI.checkCircle,
  'content-copy': MDI.contentCopy,
  'upload-outline': MDI.uploadOutline,
}
export const MenuItemIcon = ({ mdi }: { mdi: string }) => (MDI_BY_NAME[mdi] ? <Mdi d={MDI_BY_NAME[mdi]} /> : null)
export const DocumentIcon = () => <Mdi d={MDI.document} />
export const AutoDbOnIcon = () => <Mdi d={MDI.autoDbOn} />

// ── Tap-control glyphs ──────────────────────────────────────────────────────
export const TapIcon = () => <Mdi d={MDI.tap} />
export const PauseIcon = () => <Mdi d={MDI.pauseCircle} />
export const PlayIcon = () => <Mdi d={MDI.playCircle} />
export const CancelIcon = () => <Mdi d={MDI.closeCircle} />
export const CheckIcon = () => <Mdi d={MDI.checkCircle} />
export const UndoIcon = () => <Mdi d={MDI.restore} />
// The chart menu's resets: to Defaults (Swift arrow.counterclockwise.circle) and Reset Labels (arrow.uturn.backward).
export const BackupRestoreIcon = () => <Mdi d={MDI.backupRestore} />
export const UndoArrowIcon = () => <Mdi d={MDI.undo} />
// The chart's ⋯ (Swift ellipsis.circle).
export const MoreCircleIcon = () => <Mdi d={MDI.moreCircle} />
// A warning (Swift exclamationmark.triangle.fill).
export const AlertIcon = () => <Mdi d={MDI.alert} />
export const TrayIcon = ({ size }: { size?: number }) => <Mdi d={MDI.tray} size={size} />

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
// Settings section and action icons — the same Material Design shapes Python names, nearest to Swift's.
export const MicrophoneIcon = () => <Mdi d={MDI.microphone} /> // mic.fill
export const GuitarsIcon = () => <Mdi d={MDI.guitarAcoustic} /> // guitars
export const MaterialLayersIcon = () => <Mdi d={MDI.layersTriple} /> // square.3.layers.3d
export const CogsIcon = () => <Mdi d={MDI.cogs} /> // gearshape.2
export const PulseIcon = () => <Mdi d={MDI.pulse} /> // waveform.path.ecg
export const InfoIcon = () => <Mdi d={MDI.information} /> // info.circle
export const FilePlusIcon = () => <Mdi d={MDI.filePlus} /> // doc.badge.plus
export const TrashIcon = () => <Mdi d={MDI.trashCan} /> // trash
export const ChevronDownIcon = () => <Mdi d={MDI.chevronDown} />
export const FilterIcon = () => <Mdi d={MDI.filterVariant} />
export const ChevronUpIcon = () => <Mdi d={MDI.chevronUp} />
export const ChevronRightIcon = () => <Mdi d={MDI.chevronRight} />
export const OpenInNewIcon = () => <Mdi d={MDI.openInNew} />
export const UnfoldMoreIcon = () => <Mdi d={MDI.unfoldMore} />
export const PauseCircleFillIcon = () => <Mdi d={MDI.pauseCircleFill} />
export const FileChartIcon = () => <Mdi d={MDI.fileChart} />
export const UploadIcon = () => <Mdi d={MDI.uploadOutline} />
export const BookClosedIcon = () => <Mdi d={MDI.bookClosed} /> // text.book.closed
export const CheckCircleFillIcon = () => <Mdi d={MDI.checkCircleFill} /> // checkmark.circle.fill
export const CircleOutlineIcon = () => <Mdi d={MDI.circleOutline} /> // circle
/** Release Notes (Help menu) — a document with a folded corner and lines of text. */
export const FilePlayIcon = () => <Mdi d={MDI.waveform} />

// ── Quick Start Guide extras (section headers + controls without a toolbar glyph) ──
// What Guitar Tap Does (mdi.waveform)
// A peak's pitch (music.note) — filled, as Swift's symbol is.
export const MusicNoteIcon = () => <Mdi d={MDI.musicNote} size={10} />
export const WaveformIcon = ({ size }: { size?: number } = {}) => <Mdi d={MDI.waveform} size={size} />
// Peak Labels (a tag)
export const TagIcon = () => <Mdi d={MDI.tag} />
// Analysis Results (phone: opens the results bottom sheet) — matches the iOS `doc.text` Results
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
// Release Notes (Help menu, web only) and the phone's Results button (Swift doc.text).
export const NotesIcon = () => <Mdi d={MDI.document} />
export const ResultsIcon = () => <Mdi d={MDI.document} />
// Quick Start section headers, as Python's.
export const WrenchIcon = () => <Mdi d={MDI.wrench} />
export const BraceIcon = () => <Mdi d={MDI.minusBox} />
export const SlidersIcon = () => <Mdi d={MDI.tune} />
export const LightbulbIcon = () => <Mdi d={MDI.lightbulb} />
// The app's own icons (customIcons.ts, generated from the hub's SVGs), for the SF Symbols with no Material
// Design equivalent — the same drawings as Python's.
function Custom({ markup }: { markup: string }) {
  return <svg {...ICON_SVG} dangerouslySetInnerHTML={{ __html: markup }} />
}
export const CircleDashedIcon = () => <Custom markup={CUSTOM.ringMode} /> // circle.dashed
export const DotViewfinderIcon = () => <Custom markup={CUSTOM.dotViewfinder} /> // dot.viewfinder
export const PlusViewfinderIcon = () => <Custom markup={CUSTOM.plusViewfinder} /> // plus.viewfinder
