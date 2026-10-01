// @parity none
// Dump Capture Audio on the web: a download, not a folder. Every sequence is recorded and the setting
// is read when the session finishes, so turning it on mid-sequence saves that sequence (as Swift and
// Python). The page is not told whether the browser saved the download, so the analyzer names the
// file it handed over and the page shows it.
import { afterEach, describe, it, expect, vi } from 'vitest'

const dumped: string[] = []
vi.mock('../src/measurement/dumpWav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/measurement/dumpWav')>()),
  dumpCaptureWav: (_samples: Float32Array, _rate: number, label: string) => {
    dumped.push(label)
    return `web_${label}.wav`
  },
}))
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { DEFAULT_SETTINGS } from '../src/settings'

function recordingAnalyzer(dumpCaptureAudio: boolean): TapToneAnalyzer {
  dumped.length = 0
  const analyzer = new TapToneAnalyzer()
  analyzer.setSettings({ ...DEFAULT_SETTINGS, dumpCaptureAudio })
  analyzer.startSessionRecording()
  analyzer['maintainSessionRecording'](new Float32Array(1024).fill(0.1))
  return analyzer
}

describe('Dump Capture Audio — the setting is read when the session finishes', () => {
  it('saving turned on after the sequence started saves that sequence', () => {
    const analyzer = recordingAnalyzer(false)
    analyzer.setSettings({ ...DEFAULT_SETTINGS, dumpCaptureAudio: true })
    analyzer.finishSessionRecording('Guitar_1tap')
    expect(dumped).toEqual(['session_Guitar_1tap'])
  })

  it('saving turned off after the sequence started saves nothing', () => {
    const analyzer = recordingAnalyzer(true)
    analyzer.setSettings({ ...DEFAULT_SETTINGS, dumpCaptureAudio: false })
    analyzer.finishSessionRecording('Guitar_1tap')
    expect(dumped).toEqual([])
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
    analyzer.startTapSequence({ arm: false })
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
