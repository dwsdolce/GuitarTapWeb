// @parity view/chart-menu tests=test/chart-menu
/**
 * The chart's menu — from its ⋯ and from a right-click — and a peak label's own menu: what each item does, says and
 * shows. The chart builds its menus from these lists; the same lists are in every edition and in the shared
 * chart-menu.json. Mirrors Swift `ChartMenu` (Views/ChartMenu.swift) and Python `chart_menu`.
 */
import type { ResetAxis, ResetTarget } from './chartTypes'

/** What an item does. */
export type ChartMenuAction =
  | 'resetBothToSaved'
  | 'resetFrequencyToSaved'
  | 'resetMagnitudeToSaved'
  | 'resetBothToDefaults'
  | 'resetFrequencyToDefaults'
  | 'resetMagnitudeToDefaults'
  | 'resetLabels'
  | 'resetPosition'

/** One item of the chart's menu, or of a peak label's. `mdi` is the Material Design icon, as Python names it
 *  without "mdi." — Swift's SF Symbol's nearest. Mirrors Swift `ChartMenuEntry`. */
export interface ChartMenuEntry {
  action: ChartMenuAction
  title: string
  mdi: string
}

/** The chart's menu, in the groups a separator divides. "Reset Labels" can act only while a label has been moved. */
export const CHART_MENU_GROUPS: ChartMenuEntry[][] = [
  [
    { action: 'resetBothToSaved', title: 'Reset Both Axes to Saved', mdi: 'restore' },
    { action: 'resetFrequencyToSaved', title: 'Reset Frequency Axis to Saved', mdi: 'restore' },
    { action: 'resetMagnitudeToSaved', title: 'Reset Magnitude Axis to Saved', mdi: 'restore' },
  ],
  [
    { action: 'resetBothToDefaults', title: 'Reset Both Axes to Defaults', mdi: 'backup-restore' },
    { action: 'resetFrequencyToDefaults', title: 'Reset Frequency Axis to Defaults', mdi: 'backup-restore' },
    { action: 'resetMagnitudeToDefaults', title: 'Reset Magnitude Axis to Defaults', mdi: 'backup-restore' },
  ],
  [{ action: 'resetLabels', title: 'Reset Labels', mdi: 'undo' }],
]

/** A peak label's menu: it can act only while the label has been moved. */
export const LABEL_MENU: ChartMenuEntry[] = [{ action: 'resetPosition', title: 'Reset Position', mdi: 'restore' }]

/** The axis reset an action asks for, or null for one that is not an axis reset. */
export function axisReset(action: ChartMenuAction): { target: ResetTarget; axis: ResetAxis } | null {
  const map: Partial<Record<ChartMenuAction, { target: ResetTarget; axis: ResetAxis }>> = {
    resetBothToSaved: { target: 'saved', axis: 'both' },
    resetFrequencyToSaved: { target: 'saved', axis: 'freq' },
    resetMagnitudeToSaved: { target: 'saved', axis: 'mag' },
    resetBothToDefaults: { target: 'defaults', axis: 'both' },
    resetFrequencyToDefaults: { target: 'defaults', axis: 'freq' },
    resetMagnitudeToDefaults: { target: 'defaults', axis: 'mag' },
  }
  return map[action] ?? null
}
