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

export interface StoredCalibration extends Calibration {
  /** Stable id (also used as the device-map value and the saved-measurement calibrationName key). */
  id: string
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
export function listCalibrations(): StoredCalibration[] {
  return readJSON<StoredCalibration[]>(K_LIST, [])
}

/** Persist a freshly-parsed calibration as a new profile and return the stored record. */
export function saveCalibration(cal: Calibration): StoredCalibration {
  const stored: StoredCalibration = { ...cal, id: crypto.randomUUID(), importDate: Date.now() }
  writeJSON(K_LIST, [...listCalibrations(), stored])
  return stored
}

/** Delete a profile and clear any references (global active + device map entries). */
export function deleteCalibration(id: string): void {
  writeJSON(
    K_LIST,
    listCalibrations().filter((c) => c.id !== id),
  )
  if (getActiveCalibrationId() === id) setActiveCalibrationId(null)
  const map = loadDeviceMap()
  let changed = false
  for (const [dev, calId] of Object.entries(map)) {
    if (calId === id) {
      delete map[dev]
      changed = true
    }
  }
  if (changed) writeJSON(K_DEVICE_MAP, map)
}

export function getCalibration(id: string | null): StoredCalibration | null {
  if (!id) return null
  return listCalibrations().find((c) => c.id === id) ?? null
}

// ── Global active calibration ───────────────────────────────────────────────
export function getActiveCalibrationId(): string | null {
  return localStorage.getItem(K_ACTIVE) || null
}
export function setActiveCalibrationId(id: string | null): void {
  if (id) localStorage.setItem(K_ACTIVE, id)
  else localStorage.removeItem(K_ACTIVE)
}

// ── Device → calibration mapping ────────────────────────────────────────────
function loadDeviceMap(): Record<string, string> {
  return readJSON<Record<string, string>>(K_DEVICE_MAP, {})
}
export function setCalibrationForDevice(deviceId: string, calibrationId: string | null): void {
  const map = loadDeviceMap()
  if (calibrationId) map[deviceId] = calibrationId
  else delete map[deviceId]
  writeJSON(K_DEVICE_MAP, map)
}
export function calibrationIdForDevice(deviceId: string): string | null {
  return loadDeviceMap()[deviceId] ?? null
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