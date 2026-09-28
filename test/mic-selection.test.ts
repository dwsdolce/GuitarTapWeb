// @parity test/mic-selection
//
// Which input device the engine uses and which it saves: the rule acquireInputToUse (MS1–MS3), the
// engine driven through chooseInputDevice, setInputDevice and the hardware-change handler (MS6–MS10),
// a measurement load switching to its recorded microphone (MS14–MS17), and choosing a calibration for
// the selected input (MS18–MS20).
//
// The rule: the saved choice when it is present, otherwise the browser's default input (the system
// default). Only a choice — picked in Settings, or plugged in while the app runs — is saved; the
// startup selection and a fallback are not.
//
// The same list, ids and devices as Swift MicSelectionTests and Python test_mic_selection.py, except:
//   MS4, MS5 — the browser resolves the default input itself; there is no first-device step.
//   MS11     — covered by MS14: setInputDevice is the load's switch.
//   MS12, MS13 — Python only (which PortAudio default is the system default).
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
  switchToInputToUse(): Promise<void>
  refreshAvailableInputDevices(): Promise<void>
  handleDeviceChange(): Promise<void>
}

/** A running engine (a fake audio graph) on the input the rule selects, as at start, with `saved` as
 *  the saved choice (null: nothing saved). */
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
  await internals.switchToInputToUse()
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
  it('MS6: the startup selection is not saved', async () => {
    const engine = await makeSUT(null, [BLACK_HOLE, BUILT_IN], BUILT_IN)
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBeNull()
  })

  it('MS7: a device the user chooses is selected and saved', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, UMIK], BUILT_IN)
    await engine.chooseInputDevice(UMIK)
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })

  it('MS8: a device plugged in while running is switched to and saved', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN], BUILT_IN)
    await devicesChange(engine, [BUILT_IN, UMIK])
    expect(engine.inputDeviceId).toBe(UMIK)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })

  it('MS9: the saved device unplugged — the default for the session; it stays the saved choice', async () => {
    const engine = await makeSUT(UMIK, [BUILT_IN, UMIK], BUILT_IN)
    expect(engine.inputDeviceId).toBe(UMIK)
    await devicesChange(engine, [BUILT_IN])
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(UMIK)
  })

  it('MS10: a session-only device unplugged — back to the saved device, which is present', async () => {
    const engine = await makeSUT(BUILT_IN, [BUILT_IN, BLACK_HOLE, UMIK], BLACK_HOLE)
    await engine.setInputDevice(UMIK)
    await devicesChange(engine, [BUILT_IN, BLACK_HOLE])
    expect(engine.inputDeviceId).toBe(BUILT_IN)
    expect(getSavedInputDeviceId()).toBe(BUILT_IN)
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
    await engine.chooseInputDevice(UMIK)
    expect(engine.activeCalibration).toBeNull()
    await engine.chooseInputDevice(BUILT_IN)
    expect(engine.activeCalibration?.name).toBe('Room')
  })

  it("MS19: choosing no calibration removes the input's: switching away and back gives none", async () => {
    const { engine, room } = await engineWithStoredCalibration()
    engine.chooseCalibration(room)
    engine.chooseCalibration(null)
    expect(calibrationIdForDevice(BUILT_IN)).toBeNull()
    expect(getActiveCalibrationId()).toBeNull()
    await engine.chooseInputDevice(UMIK)
    await engine.chooseInputDevice(BUILT_IN)
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
