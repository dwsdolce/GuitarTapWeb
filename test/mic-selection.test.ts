// @parity test/mic-selection
//
// Which input device the engine uses and what it saves: the start-up rule acquireInputToUse (MS1–MS3),
// the engine driven through setInputDevice and the hardware-change handler (MS6–MS11), a measurement
// load switching to its recorded microphone (MS14–MS17), and choosing a calibration for the selected
// input (MS18–MS20), and the thresholds a load restores (MS21).
//
// The rules: at start, the saved device when it is present, otherwise the browser's default input (the
// system default); a device connected while running is selected; the input in use disappearing selects
// the default. Every selection is saved, so what Settings shows is what the next start uses.
//
// The same list, ids and devices as Swift MicSelectionTests and Python test_mic_selection.py, except:
//   MS4, MS5 — the browser resolves the default input itself; there is no first-device step.
//   MS12, MS13 — Python only (which PortAudio default is the system default).
//   MS21     — the web's settings are App's store: the analyzer hands App the loaded settings
//              (`loadedSettings`) and App saves them, so the test checks what the load hands over.
//   MS22     — no counterpart: the analyzer holds no threshold setting of its own.
//
// The browser's media devices are replaced by a fake: a set of connected inputs and a default.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import {
  calibrationIdForDevice,
  getActiveCalibrationId,
  getSavedInputDeviceId,
  saveCalibration,
  setCalibrationForDevice,
  setSavedInputDeviceId,
} from '../src/measurement/calibrationStore'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { TapToneMeasurementModel } from '../src/measurement'

const BUILT_IN = 'macbook-mic'
const BLACK_HOLE = 'blackhole-2ch'
const UMIK = 'umik-1'
const USB2 = 'usb-mic-2'

/** The fake browser: which inputs are connected, and which is the default. */
const media = { connected: [] as string[], defaultId: null as string | null }

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
async function makeSUT(saved: string | null, connected: string[], defaultId: string): Promise<RealtimeFFTAnalyzer> {
  setSavedInputDeviceId(saved)
  media.connected = connected
  media.defaultId = defaultId
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

describe('the rule', () => {
  it('MS1: the saved device wins when it is present — over the default and any other device', async () => {
    const engine = await makeSUT(BUILT_IN, [BLACK_HOLE, BUILT_IN, UMIK], UMIK)
    expect(engine.inputDeviceId).toBe(BUILT_IN)
  })

  it('MS2: the saved device is not connected — the default input', async () => {
    const engine = await makeSUT(UMIK, [BLACK_HOLE, BUILT_IN], BUILT_IN)
    expect(engine.inputDeviceId).toBe(BUILT_IN)
  })

  it('MS3: nothing saved — the default input, not a device listed ahead of it (BlackHole)', async () => {
    const engine = await makeSUT(null, [BLACK_HOLE, BUILT_IN], BUILT_IN)
    expect(engine.inputDeviceId).toBe(BUILT_IN)
  })
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
    id: 'M1',
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
    expect(sut.microphoneWarning).toContain("Recorded with 'Absent Mic'. No connected microphone matches that name")
  })

  it('MS17: the recorded microphone is the current one but its calibration differs — the warning', async () => {
    const { sut } = await analyzerOnBuiltIn()
    sut.loadMeasurement(measurement({ microphoneName: BUILT_IN, microphoneUID: BUILT_IN, calibrationName: 'Other' }))
    expect(sut.microphoneWarning).toBe(
      'This measurement was recorded with a different calibration. A newly captured tap may not match the saved result.',
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
  it('MS21: a load hands App the thresholds it restores, to save as the settings', () => {
    const sut = new TapToneAnalyzer()
    sut.loadMeasurement({
      id: 'M1',
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
    expect(sut.loadedSettings?.tapDetectionThreshold).toBe(-30)
    expect(sut.loadedSettings?.peakMinThreshold).toBe(-50)
  })
})

