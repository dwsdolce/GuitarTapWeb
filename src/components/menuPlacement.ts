import type { CSSProperties } from 'react'

// Placement math for the Saved Measurements row "⋯" menu. It lives in its own module so both
// MeasurementsPanel and its test can import it: a component file that also exports a plain helper
// trips react-refresh/only-export-components (Fast Refresh needs component-only exports).

/** Gap between the ⋯ button and the menu, and the minimum breathing room kept against the
 *  window edge. */
const MENU_GAP = 4
const MENU_EDGE_MARGIN = 8
/** Floor for the clamped menu height, so a pathologically short window yields a small
 *  scrollable menu rather than an invisible one. */
const MENU_MIN_HEIGHT = 96

/** Vertical placement for the row ⋯ menu, given the button's rect and the menu's OWN measured
 *  height (`null` before the first measurement — see `menuHeight`).
 *
 *  Opens downward by default and flips up only when the menu genuinely doesn't fit below AND
 *  there is more room above; then clamps `maxHeight` to the space actually available so the menu
 *  can never run off the window. When it fits, `maxHeight` exceeds the content and no scrollbar
 *  appears, so the clamp costs nothing in the common case.
 *
 *  This replaced `openUp = menuRect.bottom > window.innerHeight - 170`, where 170 was a hardcoded
 *  guess at the menu's height. The menu is ~262px tall (7 items + 2 separators + padding), so any
 *  row 170–262px from the window bottom opened downward and was clipped — "Delete" became
 *  unreachable. It surfaced once the library grew enough to put rows down there. Measuring
 *  removes the constant entirely: adding a menu item can never re-introduce it.
 *
 *  Pure: all inputs are arguments — hence directly testable.
 */
export function menuPlacement(
  rect: { top: number; bottom: number },
  menuHeight: number | null,
  viewportHeight: number = window.innerHeight,
): CSSProperties {
  const spaceBelow = viewportHeight - rect.bottom - MENU_GAP - MENU_EDGE_MARGIN
  const spaceAbove = rect.top - MENU_GAP - MENU_EDGE_MARGIN

  // Before the menu has been measured, place it downward; useLayoutEffect measures and
  // repositions before the browser paints, so this never reaches the screen.
  if (menuHeight == null) return { top: rect.bottom + MENU_GAP }

  const openUp = menuHeight > spaceBelow && spaceAbove > spaceBelow
  const available = openUp ? spaceAbove : spaceBelow
  return {
    ...(openUp
      ? { bottom: viewportHeight - rect.top + MENU_GAP }
      : { top: rect.bottom + MENU_GAP }),
    maxHeight: Math.max(MENU_MIN_HEIGHT, available),
    overflowY: 'auto',
  }
}
