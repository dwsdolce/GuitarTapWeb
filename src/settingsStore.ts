// @parity state/settings-store tests=test/settings-store
//
// The app's settings, held outside React so the model can read and write them — the web's counterpart of
// the natives' TapDisplaySettings. The storage is unchanged: the same localStorage key and JSON layout
// (`loadSettings` / `saveSettings`), so existing settings carry over as they are. The view reads the store
// and re-renders when it changes; the analyzer reads each setting from it where it uses it, as Swift's reads
// TapDisplaySettings, saves its own (Peak Min, the tap threshold, the annotation mode) to it, and a load
// writes the measurement's own settings here. In a test each file has its own instance, starting at the
// defaults and saving nothing (no localStorage) — as Swift's tests have their own settings per process.
import { loadSettings, saveSettings, type Settings } from './settings'

type Listener = () => void

export class SettingsStore {
  private current: Settings
  private readonly listeners = new Set<Listener>()

  constructor(initial: Settings = loadSettings()) {
    this.current = initial
  }

  /** The current settings. The same object until the next change, so React can compare it. */
  readonly get = (): Settings => this.current

  /** Merge a change in, save it, and tell every subscriber. A change that alters nothing is ignored. */
  update(change: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void {
    const patch = typeof change === 'function' ? change(this.current) : change
    const keys = Object.keys(patch) as (keyof Settings)[]
    if (keys.every((k) => Object.is(this.current[k], patch[k]))) return
    this.current = { ...this.current, ...patch }
    saveSettings(this.current)
    for (const l of [...this.listeners]) l()
  }

  /** Be told of every change. Returns the unsubscribe. */
  readonly subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
}

/** The app's one settings store. */
export const settingsStore = new SettingsStore()
