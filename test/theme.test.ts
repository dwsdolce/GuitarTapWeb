// @parity test/theme
//
// The palette against the shared case file `theme.json` — every colour role with its light and dark value, the
// opacities applied to other roles, and the Appearance setting with the scheme each setting resolves to — the same
// cases the Swift and Python suites run. Role names are Swift's. And what only this edition needs: subscribers hear
// exactly the changes of the resolved scheme, and the page's data-theme follows it.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { OPACITIES, ROLES, SERIES_ROLES, apply, color, cssVariable, pair, seriesRole, subscribe, type Opacity, type Role } from '../src/presentation/palette'
import { APPEARANCES, APPEARANCE_LABEL, resolvedScheme, type Appearance, type Scheme } from '../src/presentation/appearance'
import { DEFAULT_SETTINGS } from '../src/settings'

const DATA = JSON.parse(readFileSync('test/fixtures/theme.json', 'utf8')) as {
  roles: [Role, string, string][]
  opacities: [Opacity, number, number][]
  appearance: { default: Appearance; values: [Appearance, string][] }
  resolve: [Appearance, Scheme | 'unknown', Scheme][]
}

describe('theme — shared cases', () => {
  for (const [name, light, dark] of DATA.roles) {
    it(`${name}`, () => expect(pair(name)).toEqual({ light, dark }))
  }
  it('every role, in the file order', () => {
    expect(Object.keys(ROLES)).toEqual(DATA.roles.map(([name]) => name))
  })
  for (const [name, light, dark] of DATA.opacities) {
    it(`opacity ${name}`, () => expect(OPACITIES[name]).toEqual({ light, dark }))
  }
  it('every opacity, in the file order', () => {
    expect(Object.keys(OPACITIES)).toEqual(DATA.opacities.map(([name]) => name))
  })
})

describe('theme — the Appearance setting', () => {
  it('values, labels and default', () => {
    expect(APPEARANCES.map((a) => [a, APPEARANCE_LABEL[a]])).toEqual(DATA.appearance.values)
    expect(DEFAULT_SETTINGS.appearance).toBe(DATA.appearance.default)
  })
  for (const [appearance, os, expected] of DATA.resolve) {
    it(`${appearance} with the OS reporting ${os} draws ${expected}`, () =>
      expect(resolvedScheme(appearance, os === 'unknown' ? null : os)).toBe(expected))
  }
})

describe('theme — CSS custom properties (web)', () => {
  it('each role has its own property name', () => {
    expect(cssVariable('chart.readout.background')).toBe('--c-chart-readout-background')
    expect(cssVariable('mode.userDefined')).toBe('--c-mode-user-defined')
    expect(cssVariable('series.10')).toBe('--c-series-10')
    const names = (Object.keys(ROLES) as Role[]).map(cssVariable)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('theme — following a scheme change (web)', () => {
  it('subscribers hear exactly the changes of the resolved scheme', () => {
    let osDark = false
    let onOsChange = () => {}
    const props: Record<string, string> = {}
    const root = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => (props[k] = v) } }
    vi.stubGlobal('document', { documentElement: root })
    vi.stubGlobal('window', {
      matchMedia: () => ({
        get matches() {
          return osDark
        },
        addEventListener: (_: string, f: () => void) => {
          onOsChange = f
        },
      }),
    })
    try {
      apply('system')
      const seen: Scheme[] = []
      const unsubscribe = subscribe((s) => seen.push(s))
      osDark = true
      onOsChange() // System follows the OS: dark
      onOsChange() // the same again: nothing
      apply('dark') // forced dark, already dark: nothing
      expect(root.dataset.theme).toBe('dark')
      expect(props['--c-chart-readout-background']).toBe(color('chart.readout.background'))
      expect(props['--c-mode-air']).toBe('#64D2FF')
      expect(color('mode.air')).toBe('#64D2FF')
      osDark = false
      onOsChange() // forced: the OS does not matter
      apply('light') // forced light: light
      apply('system') // the OS is light too: nothing
      expect(seen).toEqual(['dark', 'light'])
      expect(root.dataset.theme).toBe('light')
      expect(color('mode.air')).toBe('#00B0DC')
      expect(color('mode.air', 'peak.rowTint')).toBe('rgba(0, 176, 220, 0.1)')
      unsubscribe()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('theme — the series slots', () => {
  it('series.1 … series.10 in slot order; slot 11 starts again at series.1', () => {
    expect(SERIES_ROLES).toEqual(Array.from({ length: 10 }, (_, i) => `series.${i + 1}`))
    expect(seriesRole(10)).toBe('series.1')
  })
})
