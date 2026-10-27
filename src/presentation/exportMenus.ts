// @parity view/export-menus tests=test/export-menus
/**
 * The two menus besides a saved measurement's own that export: Saved Measurements' library menu and Analysis
 * Results'. Each is one button, Export, whose items write a file through a save dialog — the same in every edition
 * and in the shared export-menus.json. Swift's also have Share items (the share sheet, which this edition does not
 * have), and on iOS and iPadOS its button is Share. Mirrors Swift `ExportMenus` (Views/Utilities/ExportMenus.swift)
 * and Python `export_menus`.
 */

/** One item of an export menu; `mdi` as a saved measurement's menu names its icons. */
export interface ExportMenuEntry<Action extends string> {
  action: Action
  title: string
  mdi: string
}

/** A menu behind one button: the button's word and icon, and its items' groups. */
export interface ExportMenu<Action extends string> {
  button: string
  mdi: string
  groups: ExportMenuEntry<Action>[][]
}

/** Saved Measurements' library menu: all the measurements, or the ones ticked first (as Delete's Selected…), as one
 *  .guitartap file. Its items have icons as the Delete menu's do. */
export const PANEL_EXPORT_MENU: ExportMenu<'exportAll' | 'exportSelected'> = {
  button: 'Export',
  mdi: 'upload-outline',
  groups: [
    [
      { action: 'exportAll', title: 'Export All…', mdi: 'file-export-outline' },
      { action: 'exportSelected', title: 'Export Selected…', mdi: 'check-circle-outline' },
    ],
  ],
}

/** Analysis Results' menu: a saved measurement's menu's items for the spectrum image and the PDF report. */
export const ANALYSIS_RESULTS_EXPORT_MENU: ExportMenu<'exportSpectrum' | 'exportPDF'> = {
  button: 'Export',
  mdi: 'upload-outline',
  groups: [
    [
      { action: 'exportSpectrum', title: 'Export Spectrum…', mdi: 'chart-line' },
      { action: 'exportPDF', title: 'Export PDF Report…', mdi: 'file-pdf-box' },
    ],
  ],
}
