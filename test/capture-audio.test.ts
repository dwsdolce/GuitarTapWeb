// @parity none
// Dump Capture Audio on the web: a download, not a folder. Whether the recording is saved is read from the
// setting when a sequence starts, and again when it changes before the first tap (the shared cases in
// session-pre-roll.json); a loaded measurement or comparison ends the sequence and its recording (as Swift and
// Python). The page is
// not told whether the browser saved the download, so the analyzer names the file it handed over and the page
// shows it.
import { afterEach, describe, it, expect, vi } from 'vitest'

const dumped: string[] = []
vi.mock('../src/measurement/dumpWav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/measurement/dumpWav')>()),
  dumpCaptureWav: (_samples: Float32Array, _rate: number, label: string) => {
    dumped.push(label)
    return `web_${label}.wav`
  },
  // The capture probe's file, when a diagnostic build has the probe switched on: not a session WAV.
  dumpCaptureProbe: () => {},
}))
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { settingsStore } from '../src/settingsStore'

function recordingAnalyzer(dumpCaptureAudio: boolean): TapToneAnalyzer {
  dumped.length = 0
  const analyzer = new TapToneAnalyzer()
  settingsStore.update({ dumpCaptureAudio })
  analyzer.startSessionRecording()
  analyzer['maintainSessionRecording'](new Float32Array(1024).fill(0.1))
  return analyzer
}

const held = (a: TapToneAnalyzer): number => (a['sessionSamples'] as { length: number }).length

const firstTap = (a: TapToneAnalyzer): void => {
  a['gatedCaptureActive'] = true
  a['maintainSessionRecording'](new Float32Array(1024).fill(0.1))
}

describe('Dump Capture Audio — recording is decided when the sequence starts', () => {
  it('saving off records nothing', () => {
    const analyzer = recordingAnalyzer(false)
    firstTap(analyzer)
    expect(held(analyzer)).toBe(0)
  })

  it('saving turned on after the first tap takes effect from the next sequence', () => {
    const analyzer = recordingAnalyzer(false)
    firstTap(analyzer)
    settingsStore.update({ dumpCaptureAudio: true })
    // A pause and resume does not start it either.
    analyzer['suspendSessionRecording']()
    analyzer['resumeSessionRecording']()
    analyzer['maintainSessionRecording'](new Float32Array(1024).fill(0.1))
    expect(held(analyzer)).toBe(0)
    analyzer.finishSessionRecording('Guitar_1tap')
    expect(dumped).toEqual([])
    // The next sequence records.
    analyzer['gatedCaptureActive'] = false
    analyzer.startSessionRecording()
    analyzer['maintainSessionRecording'](new Float32Array(1024).fill(0.1))
    expect(held(analyzer)).toBe(1024)
    expect(analyzer['sessionActive']).toBe(true)
  })

  it('saving turned off after the sequence started saves nothing', () => {
    const analyzer = recordingAnalyzer(true)
    settingsStore.update({ dumpCaptureAudio: false })
    analyzer.finishSessionRecording('Guitar_1tap')
    expect(dumped).toEqual([])
  })

  it('a loaded measurement ends the recording', () => {
    const analyzer = recordingAnalyzer(true)
    expect(held(analyzer)).toBe(1024)
    analyzer.enterFrozen()
    expect(held(analyzer)).toBe(0)
    // Audio after the load is not kept.
    analyzer['maintainSessionRecording'](new Float32Array(1024).fill(0.1))
    expect(held(analyzer)).toBe(0)
  })
})

describe('Dump Capture Audio — the page is told what was handed to the browser', () => {
  it('names the downloaded file; a dismiss or a new sequence clears it', () => {
    const analyzer = recordingAnalyzer(true)
    analyzer.finishSessionRecording('Guitar_1tap')
    expect(analyzer.getSnapshot().captureAudioSaved).toBe('web_session_Guitar_1tap.wav')
    analyzer.dismissCaptureAudioSaved()
    expect(analyzer.getSnapshot().captureAudioSaved).toBeNull()

    analyzer.startSessionRecording()
    analyzer['maintainSessionRecording'](new Float32Array(1024).fill(0.1))
    analyzer.finishSessionRecording('Guitar_1tap')
    expect(analyzer.getSnapshot().captureAudioSaved).not.toBeNull()
    analyzer.startTapSequence()
    expect(analyzer.getSnapshot().captureAudioSaved).toBeNull()
  })
})

describe('Dump Capture Audio — the download is not cut off', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the file URL alive after the click, then releases it', async () => {
    const { dumpCaptureWav } = await vi.importActual<typeof import('../src/measurement/dumpWav')>(
      '../src/measurement/dumpWav',
    )
    vi.useFakeTimers()
    const revoked: string[] = []
    const clicked: string[] = []
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:capture', revokeObjectURL: (u: string) => revoked.push(u) })
    vi.stubGlobal('document', {
      createElement: () => {
        const a = { href: '', download: '', click: () => clicked.push(a.download) }
        return a
      },
    })
    const name = dumpCaptureWav(new Float32Array(8), 48000, 'session_Guitar_1tap')
    expect(name).toMatch(/^web_session_Guitar_1tap_.*\.wav$/)
    expect(clicked).toEqual([name])
    expect(revoked, 'not released at the click').toEqual([])
    vi.runAllTimers()
    expect(revoked).toEqual(['blob:capture'])
  })
})
