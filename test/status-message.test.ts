// @parity test/status-message
// Pins the web's statusMessage(state) — the functional mirror of Swift TapToneAnalyzer.statusMessage /
// Python tap_tone_analyzer.status_message — to the canonical strings, and guards that the old web-only
// inventions ("Requesting microphone…", "Playing…", "Comparing…", "Microphone unavailable") are gone.
import { describe, it, expect } from 'vitest'
import { statusMessage, detectLabel, type StatusInputs, type MatBarPeaks } from '../src/state/statusMessage'

const NO_PEAKS: MatBarPeaks = { longitudinal: null, cross: null, flc: null }

// A running, armed, single-tap guitar sequence waiting for the first tap.
function base(over: Partial<StatusInputs> = {}): StatusInputs {
  return {
    clipping: false,
    deviceChanging: false,
    running: true,
    playingFile: false,
    engineState: 'listening',
    loadedName: null,
    material: false,
    brace: false,
    measureFlc: false,
    matPhase: 'capturingL',
    progress: { collected: 0, total: 1 },
    matPeaks: NO_PEAKS,
    guitarPeakCount: 0,
    hasCapture: false,
    ...over,
  }
}

describe('detectLabel', () => {
  it('is "Tap Detected!" when complete, "Waiting for tap..." otherwise', () => {
    expect(detectLabel(true)).toBe('Tap Detected!')
    expect(detectLabel(false)).toBe('Waiting for tap...')
  })
})

describe('statusMessage — overrides (priority order)', () => {
  it('clipping wins over everything', () => {
    expect(statusMessage(base({ clipping: true, deviceChanging: true }))).toBe('⚠ Input clipping — reduce mic gain')
  })
  it('device-change beats the rest', () => {
    expect(statusMessage(base({ deviceChanging: true }))).toBe('Audio device changed - reinitializing...')
  })
  it('pre-running shows the canonical initial message (NOT "Requesting microphone…")', () => {
    expect(statusMessage(base({ running: false }))).toBe('Tap the guitar to begin')
  })
  it('paused', () => {
    expect(statusMessage(base({ engineState: 'paused' }))).toBe('Detection paused – tap freely, then resume')
  })
  it('loaded + idle', () => {
    expect(statusMessage(base({ loadedName: 'My Guitar', engineState: 'idle' }))).toBe(
      'Loaded measurement (frozen). Press ‘New Tap’ to start a new measurement.',
    )
  })
})

describe('statusMessage — guitar bar status', () => {
  it('single-tap waiting', () => {
    expect(statusMessage(base())).toBe('Tap the guitar...')
  })
  it('multi-tap waiting uses the count', () => {
    expect(statusMessage(base({ progress: { collected: 0, total: 3 } }))).toBe('Tap the guitar 3 times...')
  })
  it('multi-tap mid-sequence', () => {
    expect(statusMessage(base({ progress: { collected: 1, total: 3 } }))).toBe('Tap 1/3 captured. Tap again...')
  })
  it('complete → analysis summary', () => {
    expect(
      statusMessage(base({ engineState: 'idle', hasCapture: true, guitarPeakCount: 5, progress: { collected: 3, total: 3 } })),
    ).toBe('Analysis complete! 5 peaks identified (from 3 averaged taps).')
  })
})

describe('statusMessage — material bar status', () => {
  const mat = (over: Partial<StatusInputs>) => statusMessage(base({ material: true, ...over }))

  it('brace waiting rests at the tap prompt (NOT "Ready for fL tap")', () => {
    expect(mat({ brace: true, matPhase: 'capturingL' })).toBe('Tap the guitar...')
  })
  it('L captured, tap again (multi)', () => {
    expect(mat({ matPhase: 'capturingL', progress: { collected: 1, total: 3 } })).toBe('L tap 1/3 captured. Tap again...')
  })
  it('reviewing L', () => {
    expect(mat({ matPhase: 'reviewingL', matPeaks: { ...NO_PEAKS, longitudinal: { frequency: 123.4 } } })).toBe(
      'fL: 123.4 Hz — Accept to continue or Redo to re-tap',
    )
  })
  it('capturing C waits at the tap prompt when not playing a file', () => {
    expect(mat({ matPhase: 'capturingC' })).toBe('Tap the guitar...')
  })
  it('FLC reposition cooldown keeps its specific prompt', () => {
    expect(mat({ matPhase: 'waitingForFlcTap' })).toBe('Set up for FLC tap, then tap')
  })
  it('plate (L,C only) complete lists fL/fC', () => {
    expect(
      mat({ matPhase: 'complete', matPeaks: { longitudinal: { frequency: 100 }, cross: { frequency: 200 }, flc: null } }),
    ).toBe('Complete — fL: 100.0 Hz, fC: 200.0 Hz')
  })
  it('brace complete → check Results', () => {
    expect(mat({ brace: true, matPhase: 'complete' })).toBe('Complete - check Results')
  })
})

describe('statusMessage — file playback (material File: transitions)', () => {
  it('playing into C shows "File: L complete, capturing C..."', () => {
    expect(statusMessage(base({ material: true, playingFile: true, matPhase: 'capturingC' }))).toBe(
      'File: L complete, capturing C...',
    )
  })
  it('playing into FLC shows "File: C complete, capturing FLC..."', () => {
    expect(statusMessage(base({ material: true, playingFile: true, matPhase: 'capturingFlc' }))).toBe(
      'File: C complete, capturing FLC...',
    )
  })
  it('guitar playback shows the normal bar status, never a "Playing…" string', () => {
    const s = statusMessage(base({ playingFile: true, progress: { collected: 0, total: 1 } }))
    expect(s).toBe('Tap the guitar...')
    expect(s).not.toMatch(/Playing/)
  })
})

describe('statusMessage — removed web-only inventions are never produced', () => {
  it('no "Requesting microphone", "Comparing", or "Microphone unavailable" strings', () => {
    // Sweep the states that used to yield those strings.
    const states: StatusInputs[] = [
      base({ running: false }),
      base({ engineState: 'idle', hasCapture: true, guitarPeakCount: 2, progress: { collected: 1, total: 1 } }),
      base({ material: true, matPhase: 'complete', brace: true }),
      base({ playingFile: true }),
    ]
    for (const s of states) {
      const out = statusMessage(s)
      expect(out).not.toMatch(/Requesting microphone/)
      expect(out).not.toMatch(/Comparing/)
      expect(out).not.toMatch(/Tap comparison/)
      expect(out).not.toMatch(/Microphone unavailable/)
      expect(out).not.toMatch(/Playing/)
      expect(out).not.toMatch(/Cancelled/)
    }
  })
})