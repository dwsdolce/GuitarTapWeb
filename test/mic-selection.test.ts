// @parity test/mic-selection
//
// Which input device the engine uses and what it saves: the start-up rule acquireInputToUse (MS1–MS3, the
// shared cases in mic-selection.json), the engine driven through setInputDevice and the hardware-change
// handler (MS6–MS11), a measurement load switching to its recorded microphone (MS14–MS17), and
// choosing a calibration for the selected
// input (MS18–MS20), the thresholds a load restores and the analyzer's thresholds, saved as settings
// (MS21–MS22), and a device that cannot be opened (MS23–MS25).
//
// The rules: at start, the saved device when it is present, otherwise the browser's default input (the
// system default); a device connected while running is selected; the input in use disappearing selects
// the default. Every selection is saved, so what Settings shows is what the next start uses.
//
// The same list, ids and devices as Swift MicSelectionTests and Python test_mic_selection.py, except:
//   MS4, MS5 — the browser resolves the default input itself; there is no first-device step (marked
//              in mic-selection.json).
//   MS12, MS13 — Python only (which PortAudio default is the system default).
//
// The browser's media devices are replaced by a fake: a set of connected inputs and a default.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer, failedOpenMessage } from '../src/audio/realtimeFFTAnalyzer'
import { settingsStore } from '../src/settingsStore'
import {
  calibrationIdForDevice,
  getActiveCalibrationId,
  getSavedInputDeviceId,
  saveCalibration,
  setCalibrationForDevice,
  setSavedInputDeviceId,
} from '../src/measurement/calibrationStore'
import { TapToneAnalyzer, microphoneNotFoundMessage } from '../src/state/tapToneAnalyzer'
import type { TapToneMeasurementModel } from '../src/measurement'
import { testId } from './testIds'

const BUILT_IN = 'macbook-mic'
const BLACK_HOLE = 'blackhole-2ch'
const UMIK = 'umik-1'
const USB2 = 'usb-mic-2'

interface RuleRow { id: string; note: string; devices: string[]; saved: string | null; default: string | null; expect: string | null; editions?: string[] }
const RULE = (JSON.parse(readFileSync('test/fixtures/mic-selection.json', 'utf8')) as { inputDeviceToUse: RuleRow[] }).inputDeviceToUse

/** This file's device id for a case file's device key. */
const deviceId = (key: string | null): string | null =>
  key === null ? null : ({ builtIn: BUILT_IN, blackHole: BLACK_HOLE, umik: UMIK, usb2: USB2 } as Record<string, string>)[key]!

/** The fake browser: which inputs are connected, and which is the default. */
const media = { connected: [] as string[], defaultId: null as string | null, failing: [] as string[] }

function fakeStream(deviceId: string): MediaStream {
  const track = {
    label: deviceId,
    getSettings: () => ({ deviceId }),
    applyConstraints: async () => {},
    stop: () => {},
    onended: null,
    onmute: null,
    onunmute: null,
  }
  return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
}

async function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const exact = ((constraints.audio as MediaTrackConstraints).deviceId as { exact?: string } | undefined)?.exact
  if (exact) {
    if (media.failing.includes(exact)) throw Object.assign(new Error('cannot open'), { name: 'NotReadableError' })
    if (!media.connected.includes(exact)) throw Object.assign(new Error('not connected'), { name: 'OverconstrainedError' })
    return fakeStream(exact)
  }
  if (!media.defaultId) throw Object.assign(new Error('no input'), { name: 'NotFoundError' })
  return fakeStream(media.defaultId)
}

async function enumerateDevices(): Promise<MediaDeviceInfo[]> {
  return media.connected.map((deviceId) => ({ deviceId, kind: 'audioinput', label: deviceId }) as MediaDeviceInfo)
}

/** The engine's private members these tests drive. */
interface EngineInternals {
  acquireInputToUse(): Promise<MediaStream>
  applyStream(stream: MediaStream): Promise<string | null>
  selectInput(deviceId: string | null): void
  refreshAvailableInputDevices(): Promise<void>
  handleDeviceChange(): Promise<void>
}

/** A running engine (a fake audio graph) on the input start() selects, with `saved` as the saved device
 *  (null: nothing saved). */
async function makeSUT(
  saved: string | null,
  connected: string[],
  defaultId: string,
): Promise<RealtimeFFTAnalyzer> {
  setSavedInputDeviceId(saved)
  media.connected = connected
  media.defaultId = defaultId
  media.failing = []
  const engine = new RealtimeFFTAnalyzer()
  const sourceNode = { connect: () => {}, disconnect: () => {} }
  Object.assign(engine as unknown as Record<string, unknown>, {
    context: { createMediaStreamSource: () => sourceNode },
    node: {},
  })
  const internals = engine as unknown as EngineInternals
  internals.selectInput(await internals.applyStream(await internals.acquireInputToUse()))
  await internals.refreshAvailableInputDevices()
  return engine
}

/** The browser reports a hardware change: `connected` are now the inputs. */
async function devicesChange(engine: RealtimeFFTAnalyzer, connected: string[]): Promise<void> {
  media.connected = connected
  await (engine as unknown as EngineInternals).handleDeviceChange()
}

beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the rule — the shared cases in mic-selection.json (MS1–MS3)', () => {
  for (const row of RULE.filter((r) => (r.editions ?? ['web']).includes('web'))) {
    it(`${row.id}: ${row.note}`, async () => {
      const engine = await makeSUT(deviceId(row.saved), row.devices.map((k) => deviceId(k)!), deviceId(row.default)!)
      expect(engine.inputDeviceId).toBe(deviceId(row.expect))
    })
  }
})

describe('the engine: what is selected, and what is saved', () => {
  it('MS6: the start-up selection is saved: nothing saved, the default is selected and saved', async () => {
    const engine = await makeSUT(null, [BLACK_HOLE, BUILT_IN], BUILT_IN)
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(BUILT_IN)
  })

  it('MS7: a device selected in Settings is selected and saved', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, UMIK], BUILT_IN)
    await engine.setInputDevice(UMIK)
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })

  it('MS8: a device plugged in while running is selected and saved', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN], BUILT_IN)
    await devicesChange(engine, [BUILT_IN, UMIK])
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })

  it('MS9: the input in use unplugged (or dropping out) — the default, selected and saved', async () => {
    const engine = await makeSUT(UMIK, [BUILT_IN, UMIK], BUILT_IN)
    expect(engine.inputDeviceId).toBe(UMIK)
    await devicesChange(engine, [BUILT_IN])
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(BUILT_IN)
  })

  it('MS26 (web): the only input gone and back — the list was empty, so the saved input is opened again, as Swift selects the input to use for a first list', async () => {
    const engine = await makeSUT(UMIK, [UMIK], UMIK)
    media.defaultId = ''
    await devicesChange(engine, [])
    const opened: string[] = []
    const real = navigator.mediaDevices.getUserMedia
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices,
        getUserMedia: async (c: MediaStreamConstraints) => {
          const stream = await real(c)
          opened.push(stream.getAudioTracks()[0]!.getSettings().deviceId!)
          return stream
        },
      },
    })
    media.defaultId = UMIK
    await devicesChange(engine, [UMIK])
    expect(opened).toEqual([UMIK])
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })

  it('MS10: the input in use unplugged falls to the default, not to another connected USB mic', async () => {
    const engine = await makeSUT(USB2, [BUILT_IN, UMIK, USB2], BUILT_IN)
    expect(engine.inputDeviceId).toBe(USB2)
    await devicesChange(engine, [BUILT_IN, UMIK])
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(BUILT_IN)
  })

  it("MS11: a measurement load's switch to its recorded microphone (setInputDevice) is saved", async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, UMIK], BUILT_IN)
    void engine.setInputDevice(UMIK)
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })
})

describe('loading a measurement recorded with another connected microphone', () => {
  const measurement = (over: Partial<TapToneMeasurementModel>): TapToneMeasurementModel => ({
    id: testId(1),
    timestamp: '2026-01-01T00:00:00Z',
    peaks: [],
    measurementName: 'USB',
    spectrumSnapshot: {
      frequencies: [100, 200],
      magnitudes: [-50, -40],
      minFreq: 75,
      maxFreq: 350,
      minDB: -100,
      maxDB: 0,
      isLogarithmic: false,
      measurementType: 'Classical Guitar',
      guitarType: 'Classical',
    },
    ...over,
  })

  /** An analyzer on the built-in mic (saved) with its calibration, the USB mic connected. */
  async function analyzerOnBuiltIn(): Promise<{ sut: TapToneAnalyzer; engine: RealtimeFFTAnalyzer }> {
    const room = saveCalibration({ name: 'Built-in room', sensitivityFactor: null, referenceLevel: null, points: [{ frequency: 1000, correction: 0 }] })
    setCalibrationForDevice(BUILT_IN, room.id)
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, UMIK], BUILT_IN)
    const sut = new TapToneAnalyzer()
    sut.setDevice(engine)
    return { sut, engine }
  }

  it('MS14: the load has switched to the recorded microphone by the time it returns', async () => {
    const { sut, engine } = await analyzerOnBuiltIn()
    expect(engine.activeCalibration?.name).toBe('Built-in room')
    sut.loadMeasurement(measurement({ microphoneName: UMIK, microphoneUID: UMIK }))
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })

  it("MS15: the calibration check reads the recorded microphone's calibration (none) — no warning", async () => {
    const { sut, engine } = await analyzerOnBuiltIn()
    sut.loadMeasurement(measurement({ microphoneName: UMIK, microphoneUID: UMIK }))
    expect(engine.activeCalibration).toBeNull()
    expect(sut.microphoneWarning).toBeNull()
  })

  it('MS16: no connected microphone matches — the not-found warning; the input is unchanged', async () => {
    const { sut, engine } = await analyzerOnBuiltIn()
    sut.loadMeasurement(measurement({ microphoneName: 'Absent Mic', microphoneUID: 'absent-mic' }))
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(sut.microphoneWarningTitle).toBe('Microphone Not Found')
    expect(sut.microphoneWarning).toBe(microphoneNotFoundMessage('Absent Mic', BUILT_IN))
    expect(sut.microphoneWarning).toContain(`you are still using '${BUILT_IN}'`)
  })

  it('MS17: the recorded microphone is the current one but its calibration differs — the warning', async () => {
    const { sut } = await analyzerOnBuiltIn()
    sut.loadMeasurement(measurement({ microphoneName: BUILT_IN, microphoneUID: BUILT_IN, calibrationName: 'Other' }))
    expect(sut.microphoneWarningTitle).toBe('Recording Setup Differs')
    expect(sut.microphoneWarning).toBe(
      "This measurement was made with a different setup from the current one:\n• Calibration: recorded with 'Other'; the current microphone uses 'Built-in room'.\n\n" +
        'A tap captured now may not match the saved result. In a browser, the sample rate follows your output device: set the output and input to the same rate in Audio MIDI Setup (Mac) or Sound settings (Windows).',
    )
  })
})

describe('choosing a calibration', () => {
  /** An engine on the built-in mic with the USB mic connected, and "Room" in the (empty) store. */
  async function engineWithStoredCalibration() {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, UMIK], BUILT_IN)
    const room = saveCalibration({ name: 'Room', sensitivityFactor: null, referenceLevel: null, points: [{ frequency: 1000, correction: 0 }] })
    return { engine, room }
  }

  it('MS18: a calibration chosen for the selected input is saved for it; switching away and back restores it', async () => {
    const { engine, room } = await engineWithStoredCalibration()
    engine.chooseCalibration(room)
    expect(calibrationIdForDevice(BUILT_IN)).toBe(room.id)
    expect(getActiveCalibrationId()).toBe(room.id)
    await engine.setInputDevice(UMIK)
    expect(engine.activeCalibration).toBeNull()
    await engine.setInputDevice(BUILT_IN)
    expect(engine.activeCalibration?.name).toBe('Room')
  })

  it("MS19: choosing no calibration removes the input's: switching away and back gives none", async () => {
    const { engine, room } = await engineWithStoredCalibration()
    engine.chooseCalibration(room)
    engine.chooseCalibration(null)
    expect(calibrationIdForDevice(BUILT_IN)).toBeNull()
    expect(getActiveCalibrationId()).toBeNull()
    await engine.setInputDevice(UMIK)
    await engine.setInputDevice(BUILT_IN)
    expect(engine.activeCalibration).toBeNull()
  })

  it("MS20: a file playback's calibration (temporary) is applied but saves nothing", async () => {
    const { engine, room } = await engineWithStoredCalibration()
    engine.setCalibration(room)
    expect(engine.activeCalibration?.name).toBe('Room')
    expect(calibrationIdForDevice(BUILT_IN)).toBeNull()
    expect(getActiveCalibrationId()).toBeNull()
  })
})

describe('a load restores settings as the user setting them would', () => {
  it('MS21: a load saves the thresholds it restores, so they are the settings at the next start', () => {
    settingsStore.update({ tapDetectionThreshold: -40, peakMinThreshold: -60 })
    const sut = new TapToneAnalyzer()
    sut.loadMeasurement({
      id: testId(1),
      timestamp: '2026-01-01T00:00:00Z',
      peaks: [],
      measurementName: 'Loaded',
      tapDetectionThreshold: -30,
      peakMinThreshold: -50,
      spectrumSnapshot: {
        frequencies: [100, 200],
        magnitudes: [-50, -40],
        minFreq: 75,
        maxFreq: 350,
        minDB: -100,
        maxDB: 0,
        isLogarithmic: false,
        measurementType: 'Classical Guitar',
        guitarType: 'Classical',
      },
    })
    expect(settingsStore.get().tapDetectionThreshold).toBe(-30)
    expect(settingsStore.get().peakMinThreshold).toBe(-50)
  })

  it('MS22: setting a threshold on the analyzer saves it', () => {
    const sut = new TapToneAnalyzer()
    sut.tapDetectionThreshold = -35
    sut.peakMinThreshold = -45
    expect(settingsStore.get().tapDetectionThreshold).toBe(-35)
    expect(settingsStore.get().peakMinThreshold).toBe(-45)
  })
})

describe('a device change while the watchdog restart is pending', () => {
  // The pending restart opens the input selected when it runs, so a change meanwhile only selects — the
  // twin of Python's SR5 (test_stream_restart_coordination) and Swift's MS31 (restartsOnSelectionChange).
  const pending = (engine: RealtimeFFTAnalyzer) => {
    const opened: (string | null)[] = []
    const real = navigator.mediaDevices.getUserMedia
    navigator.mediaDevices.getUserMedia = async (c: MediaStreamConstraints) => {
      opened.push(((c.audio as MediaTrackConstraints).deviceId as { exact?: string } | undefined)?.exact ?? null)
      return real(c)
    }
    ;(engine as unknown as { isRecovering: boolean }).isRecovering = true
    return opened
  }

  it('a device connected is selected, nothing is opened, and the restart opens it', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN], BUILT_IN)
    const opened = pending(engine)
    await devicesChange(engine, [BUILT_IN, UMIK])
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(opened).toEqual([])
    await (engine as unknown as { reacquireInput(): Promise<void> }).reacquireInput()
    expect(opened).toEqual([UMIK])
  })

  it('the device in use disconnected: the default is selected, and nothing is opened', async () => {
    const engine = await makeSUT(UMIK, [BUILT_IN, UMIK], BUILT_IN)
    const opened = pending(engine)
    await devicesChange(engine, [BUILT_IN])
    expect(engine.inputDeviceId).toBeNull()
    expect(opened).toEqual([])
  })
})

describe('a device that cannot be opened', () => {
  it('MS23: a switch whose device cannot be opened leaves the previous device selected and saved', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, UMIK], BUILT_IN)
    media.failing = [UMIK]
    await expect(engine.setInputDevice(UMIK)).rejects.toThrow()
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(BUILT_IN)
  })

  it('MS24: a device plugged in that cannot be opened keeps the previous input and is reported', async () => {
    const reported: string[] = []
    const engine = await makeSUT(BUILT_IN, [BUILT_IN], BUILT_IN)
    engine.onInputOpenFailed((m) => reported.push(m))
    media.failing = [UMIK]
    await devicesChange(engine, [BUILT_IN, UMIK])
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(BUILT_IN)
    expect(reported).toEqual([failedOpenMessage(UMIK)])
  })

  it('MS25: a load whose recorded microphone cannot be opened keeps the input and says so', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, UMIK], BUILT_IN)
    const sut = new TapToneAnalyzer()
    sut.setDevice(engine)
    media.failing = [UMIK]
    sut.loadMeasurement({
      id: testId(1),
      timestamp: '2026-01-01T00:00:00Z',
      peaks: [],
      measurementName: 'Loaded',
      microphoneName: UMIK,
      microphoneUID: UMIK,
      spectrumSnapshot: {
        frequencies: [100, 200],
        magnitudes: [-50, -40],
        minFreq: 75,
        maxFreq: 350,
        minDB: -100,
        maxDB: 0,
        isLogarithmic: false,
        measurementType: 'Classical Guitar',
        guitarType: 'Classical',
      },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(BUILT_IN)
    expect(sut.microphoneWarning).toBe(failedOpenMessage(UMIK))
  })
})

