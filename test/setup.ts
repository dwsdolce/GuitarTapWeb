// @parity none — Vitest's per-test reset of the settings store; Swift's and Python's test sandboxes reset theirs.
//
// Every test starts from the default settings: the settings store is the app's one instance (the web's
// TapDisplaySettings), each test file has its own, and this puts it back before each test — as Swift's
// tests have their own settings and Python's run in a settings scope.
import { beforeEach } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/settings'
import { settingsStore } from '../src/settingsStore'

beforeEach(() => settingsStore.update({ ...DEFAULT_SETTINGS }))
