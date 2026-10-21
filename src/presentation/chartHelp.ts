// @parity view/chart-help tests=test/chart-help
/**
 * The chart's help (its ⓘ): its lines, and which of them the device in use can do. The chart shows these; the same
 * lines are in every edition and in the shared chart-help.json. Mirrors Swift `ChartHelp` (Views/ChartHelp.swift)
 * and Python `chart_help`.
 */

export const CHART_HELP_TITLE = 'Zoom & Pan Controls'

/** What a line needs of the device: a pointer (a mouse or trackpad), a keyboard, or pinch (a trackpad or touch). */
export type ChartHelpNeed = 'pointer' | 'keyboard' | 'pinch'

/** One line of the chart's help: a gesture (with Apple's key symbols), its words on a system that is not Apple's
 *  where they differ, what it does, and what it needs. Mirrors Swift `ChartHelpLine`. */
export interface ChartHelpLine {
  gesture: string
  otherKeys?: string
  effect: string
  needs: ChartHelpNeed[]
}

/** The help's lines, in the groups a separator divides. */
export const CHART_HELP_GROUPS: ChartHelpLine[][] = [
  [
    { gesture: 'Scroll over plot', effect: 'Zoom both axes around cursor', needs: ['pointer'] },
    { gesture: 'Scroll over freq axis', effect: 'Zoom frequency only', needs: ['pointer'] },
    { gesture: 'Scroll over mag axis', effect: 'Zoom magnitude only', needs: ['pointer'] },
    { gesture: '⇧ + Scroll', otherKeys: 'Shift + Scroll', effect: 'Pan frequency axis', needs: ['pointer', 'keyboard'] },
    { gesture: '⌥ + Scroll', otherKeys: 'Alt + Scroll', effect: 'Pan magnitude axis', needs: ['pointer', 'keyboard'] },
    { gesture: '⌘/⌃ + Scroll', otherKeys: 'Ctrl + Scroll', effect: 'Zoom both axes', needs: ['pointer', 'keyboard'] },
  ],
  [
    { gesture: 'Pinch over plot', effect: 'Zoom both axes', needs: ['pinch'] },
    { gesture: 'Pinch over freq axis', effect: 'Zoom frequency only', needs: ['pinch'] },
    { gesture: 'Pinch over mag axis', effect: 'Zoom magnitude only', needs: ['pinch'] },
  ],
  [
    { gesture: 'Drag over plot', effect: 'Pan both axes', needs: [] },
    { gesture: 'Drag over freq axis', effect: 'Pan frequency only', needs: [] },
    { gesture: 'Drag over mag axis', effect: 'Pan magnitude only', needs: [] },
    { gesture: 'Right-click', effect: 'Chart menu', needs: ['pointer'] },
  ],
]

/** What a device has, for its help. Mirrors Swift `ChartHelp.Device`. */
export interface HelpDevice {
  pointer: boolean
  keyboard: boolean
  pinch: boolean
  appleKeys: boolean
}

/** The lines a device's help shows — [gesture, effect] — by group, empty groups left out. Mirrors Swift
 *  `ChartHelp.shown(on:)`. */
export function shownHelp(device: HelpDevice): [string, string][][] {
  const has: Record<ChartHelpNeed, boolean> = { pointer: device.pointer, keyboard: device.keyboard, pinch: device.pinch }
  return CHART_HELP_GROUPS.map((group) =>
    group
      .filter((line) => line.needs.every((n) => has[n]))
      .map((line): [string, string] => [device.appleKeys ? line.gesture : (line.otherKeys ?? line.gesture), line.effect]),
  ).filter((group) => group.length > 0)
}

/** Whether a mouse or trackpad has moved over the page: iOS Safari answers `any-hover: hover` and
 *  `any-pointer: fine` with nothing but a finger, so on a touch device only a mouse's own pointer events show one. */
let mouseSeen = false
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'mouse') mouseSeen = true
    },
    { passive: true },
  )
}

/** The device in use. It has a pointer where its main input is a mouse or trackpad (`hover: hover` and
 *  `pointer: fine` — every desktop), or once a mouse or trackpad has moved over the page (an iPad with one). A
 *  browser cannot tell whether a keyboard is attached: a pointer stands for one. A touch screen pinches; so does a
 *  Mac's trackpad, whose pinch the chart takes; on Windows and Linux a trackpad's pinch arrives as Ctrl + Scroll,
 *  which the help already lists. */
export function currentHelpDevice(): HelpDevice {
  const media = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const apple = /Mac|iPhone|iPad|iPod/.test(nav?.platform || nav?.userAgent || '')
  const touch = (nav?.maxTouchPoints ?? 0) > 0
  const pointer = media('(hover: hover) and (pointer: fine)') || mouseSeen
  return { pointer, keyboard: pointer, pinch: touch || (apple && pointer), appleKeys: apple }
}
