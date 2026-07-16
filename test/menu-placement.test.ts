// @parity none — browser-edition only. Swift and Python raise NATIVE menus, which the OS places
// and keeps on-screen itself; neither app has to compute a flip-up or a viewport clamp, so there
// is no canonical behaviour to mirror and no counterpart test to pair with. Viewport clipping is
// a browser concern the native editions structurally cannot have. (User decision, 2026-07-16:
// "This is web only.") Sibling precedent: GuitarTapTests/SpectrumViewGestureTests.swift is
// likewise a platform-specific test with no counterparts.
//
// REGRESSION (found in 1.0.2 testing): the Measurements row ⋯ menu was cut off by the bottom of
// the browser window once the library grew large enough to put rows near the bottom. The menu
// already portaled to <body> with fixed positioning AND already had a flip-up — but it was driven
// by a hardcoded guess at its own height:
//
//     const openUp = menuRect.bottom > window.innerHeight - 170
//
// The menu is ~262px tall (7 items + 2 separators + padding), so rows 170–262px from the bottom
// opened DOWNWARD and were clipped — "Delete" became unreachable. The constant had gone stale as
// menu items were added, and being inline in JSX it was untestable. `menuPlacement` is now pure
// and measured, so adding a menu item cannot re-introduce the bug.

import { describe, it, expect } from 'vitest'
import { menuPlacement } from '../src/components/MeasurementsPanel'

const VIEWPORT = 800
/** The real menu height: 7 items + 2 separators + padding/borders. */
const MENU_H = 262
/** A ⋯ button is ~28px tall. */
const btn = (top: number) => ({ top, bottom: top + 28 })
/** A button positioned so that exactly `space` px remain below it in the viewport. */
const btnWithSpaceBelow = (space: number) => btn(VIEWPORT - space - 28)

/** The OLD, buggy rule, kept verbatim so the tests below prove they actually catch it.
 *  Without this the "regression" cases can pass vacuously — a case where the old rule ALSO
 *  opened up proves nothing. (One of my first attempts did exactly that.) */
const oldRuleOpensUp = (rect: { bottom: number }) => rect.bottom > VIEWPORT - 170

describe('menuPlacement — the regression: the dead zone that clipped the menu', () => {
  // The old rule flipped up only when <170px remained below the button, but the menu is ~262px
  // tall. So rows with 170–262px of space below opened DOWNWARD and were clipped: the dead zone.
  it.each([175, 200, 240, 260])(
    'opens UP for a row with %ipx below it — the old rule opened DOWN and clipped',
    (spaceBelow) => {
      const rect = btnWithSpaceBelow(spaceBelow)

      // Guard: this case must actually be in the dead zone, or it proves nothing.
      expect(oldRuleOpensUp(rect)).toBe(false)
      expect(spaceBelow).toBeLessThan(MENU_H)

      const p = menuPlacement(rect, MENU_H, VIEWPORT)
      expect(p.bottom).toBeDefined()
      expect(p.top).toBeUndefined()
    },
  )

  it('never lets the menu extend past the bottom of the window', () => {
    // Walk a row down the whole viewport; the menu must always fit within it.
    for (let top = 0; top <= VIEWPORT - 28; top += 10) {
      const p = menuPlacement(btn(top), MENU_H, VIEWPORT)
      const maxH = Math.min(MENU_H, p.maxHeight as number)
      if (p.top !== undefined) {
        expect((p.top as number) + maxH).toBeLessThanOrEqual(VIEWPORT)
      } else {
        // Anchored to the bottom edge: its top must stay on-screen.
        const topEdge = VIEWPORT - (p.bottom as number) - maxH
        expect(topEdge).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('menuPlacement — direction', () => {
  it('opens DOWN when there is room below (the common case)', () => {
    const p = menuPlacement(btn(100), MENU_H, VIEWPORT)
    expect(p.top).toBe(132) // rect.bottom + gap
    expect(p.bottom).toBeUndefined()
  })

  it('opens DOWN when it fits below exactly', () => {
    // Choose a top where spaceBelow == menu height exactly.
    const top = VIEWPORT - 28 - MENU_H - 4 - 8
    expect(menuPlacement(btn(top), MENU_H, VIEWPORT).top).toBeDefined()
  })

  it('stays DOWN near the bottom if there is even less room above', () => {
    // A short viewport where neither side fits, but below has more room than above.
    const p = menuPlacement({ top: 10, bottom: 38 }, MENU_H, 200)
    expect(p.top).toBeDefined()
    expect(p.bottom).toBeUndefined()
  })

  it('opens UP for the last row of a long list', () => {
    const p = menuPlacement(btn(VIEWPORT - 40), MENU_H, VIEWPORT)
    expect(p.bottom).toBe(VIEWPORT - (VIEWPORT - 40) + 4)
    expect(p.top).toBeUndefined()
  })
})

describe('menuPlacement — clamping', () => {
  it('clamps maxHeight to the space available when the menu cannot fit either way', () => {
    const p = menuPlacement({ top: 150, bottom: 178 }, MENU_H, 300)
    expect(p.overflowY).toBe('auto')
    expect(p.maxHeight as number).toBeLessThan(MENU_H)
  })

  it('leaves headroom (no scrollbar) when the menu fits', () => {
    const p = menuPlacement(btn(100), MENU_H, VIEWPORT)
    expect(p.maxHeight as number).toBeGreaterThanOrEqual(MENU_H)
  })

  it('never clamps below the minimum, so the menu is never invisible', () => {
    const p = menuPlacement({ top: 0, bottom: 28 }, MENU_H, 40)
    expect(p.maxHeight as number).toBeGreaterThanOrEqual(96)
  })
})

describe('menuPlacement — before measurement', () => {
  it('places downward with no clamp until the height is known', () => {
    // First render only: useLayoutEffect measures and re-places before paint, so this
    // never reaches the screen.
    const p = menuPlacement(btn(700), null, VIEWPORT)
    expect(p.top).toBe(732)
    expect(p.maxHeight).toBeUndefined()
  })
})

describe('menuPlacement — is independent of the menu item count', () => {
  it('adding menu items cannot re-introduce the stale-constant bug', () => {
    // The whole point: placement follows the MEASURED height, so a taller menu simply flips
    // sooner. A hardcoded threshold could not do this.
    const shortMenu = menuPlacement(btn(600), 100, VIEWPORT)
    const tallMenu = menuPlacement(btn(600), 400, VIEWPORT)
    expect(shortMenu.top).toBeDefined() // 100px fits below
    expect(tallMenu.bottom).toBeDefined() // 400px does not — flips up automatically
  })
})