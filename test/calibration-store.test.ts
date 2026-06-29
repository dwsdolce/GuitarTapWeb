import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveCalibration,
  setCalibrationForDevice,
  setActiveCalibrationId,
  resolveActiveCalibration,
} from '../src/measurement/calibrationStore'
import type { Calibration } from '../src/dsp/calibration'

// The store is localStorage-backed; the node test env has none, so install an in-memory mock.
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
})

const cal = (name: string): Calibration => ({ name, sensitivityFactor: null, points: [{ frequency: 1000, correction: 0 }] })

describe('calibration resolution is device-specific (no cross-device global fallback)', () => {
  it('switching to a device with no mapping clears to NONE, even with a global active', () => {
    // Import a UMIK-1 calibration while the UMIK-1 is the active device: it gets a device mapping
    // AND becomes the global active (what onImportCalibration does).
    const umik = saveCalibration(cal('UMIK-1'))
    setCalibrationForDevice('umik-1-device', umik.id)
    setActiveCalibrationId(umik.id)

    // The UMIK-1 keeps its calibration…
    expect(resolveActiveCalibration('umik-1-device')?.id).toBe(umik.id)
    // …but switching to the built-in mic (no mapping) must NOT inherit the UMIK-1 cal — the bug.
    expect(resolveActiveCalibration('macbook-mic')).toBeNull()
  })

  it('selecting None for a device (removing its mapping) resolves to NONE', () => {
    const umik = saveCalibration(cal('UMIK-1'))
    setCalibrationForDevice('dev', umik.id)
    expect(resolveActiveCalibration('dev')?.id).toBe(umik.id)
    setCalibrationForDevice('dev', null) // "None (flat)"
    expect(resolveActiveCalibration('dev')).toBeNull()
  })

  it('falls back to the global active only when no device is known (pre-start)', () => {
    const umik = saveCalibration(cal('UMIK-1'))
    setActiveCalibrationId(umik.id)
    expect(resolveActiveCalibration(undefined)?.id).toBe(umik.id)
    expect(resolveActiveCalibration(null)?.id).toBe(umik.id)
  })
})