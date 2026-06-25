// IndexedDB-backed measurement library — the web's private `saved_measurements.json`
// equivalent (PHASE4-PERSISTENCE "Storage model"). Browser-sandboxed and NOT shared
// with the Swift/Python apps; cross-app sharing is via `.guitartap` import/export (4c).
// One object store keyed by measurement `id`; values are TapToneMeasurementModel objects
// (plain, structured-clonable).

import type { TapToneMeasurementModel } from './types'

const DB_NAME = 'guitartap'
const STORE = 'measurements'
const VERSION = 1

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

/** Insert or replace a measurement (keyed by `id`). */
export function saveMeasurement(m: TapToneMeasurementModel): Promise<void> {
  return tx('readwrite', (s) => s.put(m)).then(() => undefined)
}

/** All saved measurements, newest first (by ISO `timestamp`). */
export function listMeasurements(): Promise<TapToneMeasurementModel[]> {
  return tx<TapToneMeasurementModel[]>('readonly', (s) => s.getAll()).then((all) =>
    all.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0)),
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