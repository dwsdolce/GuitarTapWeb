// @parity view/saved-measurement-menu tests=test/saved-measurement-menu
/**
 * A saved measurement's menu — from its ⋯ or a right-click in Saved Measurements: what each item does, says and
 * shows. The list builds the menu from these groups; the same groups are in every edition and in the shared
 * saved-measurement-menu.json. Mirrors Swift `SavedMeasurementMenu` (Views/Measurements/SavedMeasurementMenu.swift)
 * and Python `saved_measurement_menu`.
 */

/** What an item does. */
export type SavedMeasurementMenuAction =
  | 'load'
  | 'details'
  | 'edit'
  | 'exportMeasurement'
  | 'exportSpectrum'
  | 'exportPDF'
  | 'delete'

/** One item of a saved measurement's menu. `mdi` is the Material Design icon, as Python names it without "mdi." —
 *  Swift's SF Symbol's nearest. Mirrors Swift `SavedMeasurementMenuEntry`. */
export interface SavedMeasurementMenuEntry {
  action: SavedMeasurementMenuAction
  title: string
  mdi: string
}

/** A saved measurement's menu, in the groups a separator divides. Export writes the file through a save dialog
 *  (saveFile). Swift also has Share, in a group of its own after Export's: the share sheet, which this edition does
 *  not have. "…" as style guide S9. */
export const SAVED_MEASUREMENT_MENU_GROUPS: SavedMeasurementMenuEntry[][] = [
  [{ action: 'load', title: 'Load into View', mdi: 'file-download-outline' }],
  [
    { action: 'details', title: 'View Details', mdi: 'eye-outline' },
    { action: 'edit', title: 'Edit Name & Notes', mdi: 'pencil-outline' },
  ],
  [
    { action: 'exportMeasurement', title: 'Export Measurement…', mdi: 'file-export-outline' },
    { action: 'exportSpectrum', title: 'Export Spectrum…', mdi: 'chart-line' },
    { action: 'exportPDF', title: 'Export PDF Report…', mdi: 'file-pdf-box' },
  ],
  [{ action: 'delete', title: 'Delete', mdi: 'trash-can-outline' }],
]
