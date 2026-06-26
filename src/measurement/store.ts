// IndexedDB-backed measurement library — the web's private `saved_measurements.json`
// equivalent (PHASE4-PERSISTENCE "Storage model"). Browser-sandboxed and NOT shared
// with the Swift/Python apps; cross-app sharing is via `.guitartap` import/export (4c).
// One object store keyed by measurement `id`; values are TapToneMeasurementModel objects
// (plain, structured-clonable).

import type { TapToneMeasurementModel } from './types'

const DB_NAME = 'guitartap'
const STORE = 'measurements'
const VERSION = 1

// Library records carry a `savedAt` insertion stamp (NOT part of the .guitartap format —
// the encoder only writes known fields, so it never leaks into exported files). The list is
// ordered by it so the last saved/imported measurement is always last, matching Swift/Python
// which simply `append` to `savedMeasurements`. (The measurement's own `timestamp` can't be
// used: an imported file keeps its original creation date, so it wouldn't sort to the end.)
type StoredMeasurement = TapToneMeasurementModel & { savedAt?: number }

// Strictly-monotonic insertion stamp. Seeded from wall-clock so it keeps increasing across
// reloads; the `+1` fallback breaks ties within a batch import (same-millisecond saves).
let lastSeq = 0
function nextSeq(): number {
  const now = Date.now()
  lastSeq = now > lastSeq ? now : lastSeq + 1
  return lastSeq
}
const orderOf = (m: StoredMeasurement): number => m.savedAt ?? (Date.parse(m.timestamp) || 0)

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

/** Insert or replace a measurement (keyed by `id`). A new record gets the next insertion
 *  stamp; an existing one keeps its stamp (so an edit doesn't jump to the end of the list). */
export function saveMeasurement(m: TapToneMeasurementModel): Promise<void> {
  const stored: StoredMeasurement = { ...m, savedAt: (m as StoredMeasurement).savedAt ?? nextSeq() }
  return tx('readwrite', (s) => s.put(stored)).then(() => undefined)
}

/** All saved measurements in insertion order (last saved/imported last), mirroring the
 *  Swift/Python `savedMeasurements` array. */
export function listMeasurements(): Promise<TapToneMeasurementModel[]> {
  return tx<StoredMeasurement[]>('readonly', (s) => s.getAll()).then((all) =>
    all.sort((a, b) => orderOf(a) - orderOf(b)),
  )
}

export function getMeasurement(id: string): Promise<TapToneMeasurementModel | undefined> {
  return tx<TapToneMeasurementModel | undefined>('readonly', (s) => s.get(id))
}

export function deleteMeasurement(id: string): Promise<void> {
  return tx('readwrite', (s) => s.delete(id)).then(() => undefined)
}

/** Remove every saved measurement (the "Delete All" action). */
export function clearMeasurements(): Promise<void> {
  return tx('readwrite', (s) => s.clear()).then(() => undefined)
}