// @parity model/saved-measurements-order tests=test/saved-measurements-order
/**
 * The order Saved Measurements shows the library in: its sort, direction and type filter. The library keeps the
 * order measurements were added, and sorting or filtering never changes it — they decide only which measurements
 * the list shows and in what order, so As Added is always there to return to. And which of the library's entries
 * are duplicates, for Delete Duplicates. Mirrors Swift
 * `SavedMeasurementsOrder.swift` and Python `saved_measurements_order.py`.
 */
import { MEASUREMENT_SHORT_NAME, MEASUREMENT_TYPES } from '../settings'
import { measurementTypeName, type TapToneMeasurementModel } from './types'

/** How Saved Measurements is sorted. Mirrors Swift `SavedMeasurementsSort`. */
export type SavedMeasurementsSort = 'asAdded' | 'date' | 'name' | 'type'

export const SAVED_MEASUREMENTS_SORTS: SavedMeasurementsSort[] = ['asAdded', 'date', 'name', 'type']

/** The menu's word for each sort. */
export const SAVED_MEASUREMENTS_SORT_TITLE: Record<SavedMeasurementsSort, string> = {
  asAdded: 'As Added',
  date: 'Date',
  name: 'Name',
  type: 'Type',
}

/** What the order needs of one measurement: its name, the date it was made (ms), and the type the list shows
 *  ({@link measurementTypeName}). */
export interface OrderKey {
  name: string
  date: number
  type: string
}

/** The types the filter offers: the type menu's, in its order, then Comparison. */
export const FILTER_TYPES: string[] = [...MEASUREMENT_TYPES.map((t) => MEASUREMENT_SHORT_NAME[t]), 'Comparison']

export const orderKeys = (measurements: TapToneMeasurementModel[]): OrderKey[] =>
  measurements.map((m) => ({ name: m.measurementName ?? '', date: Date.parse(m.timestamp), type: measurementTypeName(m) }))

const compare = <T>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0)

/** The positions of the library's duplicates: each entry whose id an earlier entry already has (ids compare
 *  case-insensitively). The first copy of each stays. Same id means same content — an edited measurement gets a new
 *  id — so a duplicate is an exact copy, such as a second import of the same file. Mirrors Swift
 *  `SavedMeasurementsOrder.duplicates`. */
export function duplicates(ids: string[]): number[] {
  const seen = new Set<string>()
  const out: number[] = []
  ids.forEach((id, i) => {
    const key = id.toLowerCase()
    if (seen.has(key)) out.push(i)
    seen.add(key)
  })
  return out
}

/** The positions in the library to show, in order: those of the `filter` type (all when null), sorted by `sort`
 *  in the given direction. Ties go by date, oldest first, then by position. Names compare case-insensitively; type
 *  order is the filter's, then a type it does not name ("—"). Mirrors Swift `SavedMeasurementsOrder.shown`. */
export function shownOrder(
  keys: OrderKey[],
  sort: SavedMeasurementsSort,
  ascending: boolean,
  filter: string | null,
): number[] {
  const rank = (t: string) => {
    const i = FILTER_TYPES.indexOf(t)
    return i < 0 ? FILTER_TYPES.length : i
  }
  const primary = (a: number, b: number): number => {
    switch (sort) {
      case 'asAdded':
        return compare(a, b)
      case 'date':
        return compare(keys[a]!.date, keys[b]!.date)
      case 'name':
        return compare(keys[a]!.name.toLowerCase(), keys[b]!.name.toLowerCase())
      case 'type':
        return compare(rank(keys[a]!.type), rank(keys[b]!.type))
    }
  }
  return keys
    .map((_, i) => i)
    .filter((i) => filter == null || keys[i]!.type === filter)
    .sort((a, b) => primary(a, b) * (ascending ? 1 : -1) || compare(keys[a]!.date, keys[b]!.date) || compare(a, b))
}
