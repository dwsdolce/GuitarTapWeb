// @parity dsp/calibration
// Persistent storage for imported microphone calibrations — the web equivalent of Swift's
// CalibrationStorage (UserDefaults) / Python's calibration_storage. Mirrors its model exactly:
//   • a list of saved calibration profiles (each = a parsed `Calibration` + id + import date),
//   • a global "active" calibration id (last imported/selected; persisted for restart), and
//   • a per-device map (deviceId → calibrationId) — the source of truth for a given input.
// Resolution for the LIVE INPUT is device-specific: a mic's calibration must never be applied to a
// different mic. Switching to a device with no mapping clears to flat (no correction) — mirroring
// Swift RealtimeFFTAnalyzer.selectedInputDevice.didSet, which sets activeCalibration = nil for an
// unmapped device rather than falling back to the global active. The global id is only used when no
// input device is known yet (pre-start). Browser-local (localStorage), per-origin.

import type { Calibration } from '../dsp/calibration'
import { InvalidIdError, newId, parseUuid, type Uuid } from './newId'

export interface StoredCalibration extends Calibration {
  /** Stable id (also used as the device-map value and the saved-measurement calibrationName key). */
  id: Uuid
  /** Epoch ms the file was imported (provenance, mirrors Swift importDate). */
  importDate: number
}

const K_LIST = 'gt.calibrations'
const K_ACTIVE = 'gt.activeCalibrationId'
const K_DEVICE_MAP = 'gt.deviceCalibrationMap'
const K_INPUT_DEVICE = 'gt.inputDeviceId'

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

// ── Calibration profiles ────────────────────────────────────────────────────
/** Every stored profile. A stored list that cannot be read — not JSON, or an id that is not a UUID — is
 *  kept, not written over: it moves to a key of its own and the list starts empty. Mirrors Swift
 *  `CalibrationStorage.loadAll()`. */
export function listCalibrations(): StoredCalibration[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(K_LIST)
  } catch {
    return []
  }
  if (raw == null) return []
  try {
    const list = JSON.parse(raw) as StoredCalibration[]
    return list.map((c) => ({ ...c, id: parseUuid(c.id, 'calibration id') }))
  } catch {
    setAsideUnreadable(raw)
    return []
  }
}

/** The stored calibrations could not be read. They are moved to `<key>-unreadable-<date and time>`, so
 *  no later save writes over them, and the list starts empty; a calibration can be imported again.
 *  Mirrors Swift `setAsideUnreadableCalibrations(_:)`. */
function setAsideUnreadable(raw: string): void {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  const keptKey = `${K_LIST}-unreadable-${stamp}`
  try {
    localStorage.setItem(keptKey, raw)
    localStorage.removeItem(K_LIST)
    console.warn(`Stored calibrations could not be read — kept as ${keptKey}; the list starts empty`)
  } catch {
    /* storage unavailable — nothing is written either */
  }
}

/** A stored calibration id as a UUID — null when there is none or it is not one, as Swift's
 *  `UUID(uuidString:)` gives nil. */
function idOrNull(value: string | null | undefined): Uuid | null {
  try {
    return value ? parseUuid(value, 'calibration id') : null
  } catch (e) {
    if (e instanceof InvalidIdError) return null
    throw e
  }
}

/** Persist a freshly-parsed calibration as a new profile and return the stored record. */
export function saveCalibration(cal: Calibration): StoredCalibration {
  const stored: StoredCalibration = { ...cal, id: newId(), importDate: Date.now() }
  writeJSON(K_LIST, [...listCalibrations(), stored])
  return stored
}

/** Delete a profile and clear any references (global active + device map entries). */
export function deleteCalibration(id: Uuid): void {
  writeJSON(
    K_LIST,
    listCalibrations().filter((c) => c.id !== id),
  )
  if (getActiveCalibrationId() === id) setActiveCalibrationId(null)
  const map = loadDeviceMap()
  let changed = false
  for (const [dev, calId] of Object.entries(map)) {
    if (idOrNull(calId) === id) {
      delete map[dev]
      changed = true
    }
  }
  if (changed) writeJSON(K_DEVICE_MAP, map)
}

export function getCalibration(id: Uuid | null): StoredCalibration | null {
  if (!id) return null
  return listCalibrations().find((c) => c.id === id) ?? null
}

// ── Global active calibration ───────────────────────────────────────────────
export function getActiveCalibrationId(): Uuid | null {
  return idOrNull(localStorage.getItem(K_ACTIVE))
}
export function setActiveCalibrationId(id: Uuid | null): void {
  if (id) localStorage.setItem(K_ACTIVE, id)
  else localStorage.removeItem(K_ACTIVE)
}

// ── Device → calibration mapping ────────────────────────────────────────────
function loadDeviceMap(): Record<string, string> {
  return readJSON<Record<string, string>>(K_DEVICE_MAP, {})
}
export function setCalibrationForDevice(deviceId: string, calibrationId: Uuid | null): void {
  const map = loadDeviceMap()
  if (calibrationId) map[deviceId] = calibrationId
  else delete map[deviceId]
  writeJSON(K_DEVICE_MAP, map)
}
export function calibrationIdForDevice(deviceId: string): Uuid | null {
  return idOrNull(loadDeviceMap()[deviceId])
}

/**
 * The calibration to apply for the given input device. Device-specific only: a device with no
 * mapping resolves to NONE (flat) — we must not apply one mic's calibration to another (mirrors
 * Swift's clear-to-nil on switching to an unmapped device). The global active id is consulted only
 * when no device is known yet (pre-start).
 */
export function resolveActiveCalibration(deviceId?: string | null): StoredCalibration | null {
  if (deviceId) return getCalibration(calibrationIdForDevice(deviceId))
  return getCalibration(getActiveCalibrationId())
}

// ── Remembered input device (auto-select last used, mirrors native) ─────────
export function getSavedInputDeviceId(): string | null {
  return localStorage.getItem(K_INPUT_DEVICE) || null
}
export function setSavedInputDeviceId(id: string | null): void {
  if (id) localStorage.setItem(K_INPUT_DEVICE, id)
  else localStorage.removeItem(K_INPUT_DEVICE)
}