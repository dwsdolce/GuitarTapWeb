// IndexedDB-backed measurement library — the web's private `saved_measurements.json`
// equivalent (PHASE4-PERSISTENCE "Storage model"). Browser-sandboxed and NOT shared
// with the Swift/Python apps; cross-app sharing is via `.guitartap` import/export (4c).
// One object store keyed by measurement `id`; values are TapToneMeasurementModel objects
// (plain, structured-clonable).

import type { TapToneMeasurementModel } from './types'
import { healMeasurement, parseGuitarTapFile } from './decode'

const DB_NAME = 'guitartap'
const STORE = 'measurements'
// v2 re-keyed the store from `id` to `rowKey`. See migrateToRowKey.
const VERSION = 2

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

/** A fresh library-local row handle. Never written to a `.guitartap` file — see types.ts. */
const newRowKey = (): string => crypto.randomUUID()

/**
 * v1 -> v2: the store was keyed by `id`, which conflated the measurement's DATASET identity with
 * its row handle — and forced import to overwrite `id` so that re-importing a file would add a row
 * instead of replacing one. That overwrite destroyed the dataset identity of every file brought
 * into this edition, and of every file exported from it (SLUG-SWEEP.md F19a).
 *
 * Read every record, drop the store, recreate it keyed by `rowKey`, write the records back with
 * `rowKey` set to their old `id`. The key VALUES are unchanged — only the field carrying them — so
 * nothing is re-ordered and no record can collide. For migrated records `id` and `rowKey` are
 * equal, which is the honest result: their original dataset id was destroyed at import long ago,
 * so the minted value is the only identity they have.
 *
 * `getAll` holds the whole library in memory for the duration — a one-time spike on records whose
 * spectra run to several MB each. The alternative, a cursor copy into a second store, would leave
 * the store permanently renamed. An IndexedDB upgrade is transactional: if any step fails the
 * whole thing aborts and the database stays at v1, so there is no half-migrated state to recover.
 */
function migrateToRowKey(db: IDBDatabase, tx: IDBTransaction): void {
  const all = tx.objectStore(STORE).getAll() as IDBRequest<StoredMeasurement[]>
  all.onsuccess = () => {
    const records = all.result
    db.deleteObjectStore(STORE)
    const store = db.createObjectStore(STORE, { keyPath: 'rowKey' })
    for (const r of records) store.put({ ...r, rowKey: r.rowKey ?? r.id })
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = (e) => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'rowKey' })
        return
      }
      if (e.oldVersion < 2) migrateToRowKey(db, req.transaction!)
    }
    // Fires when another tab still holds the database at the older version: the upgrade cannot
    // proceed and `onsuccess` never arrives. Without this the panel would hang with no error.
    req.onblocked = () =>
      reject(
        new Error(
          'Another Guitar Tap tab has the measurement library open. Close the other tabs, then reload.',
        ),
      )
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

/**
 * Insert or replace a measurement, keyed by `rowKey`.
 *
 * A measurement that has no `rowKey` yet has never been stored — freshly captured, or just parsed
 * out of a `.guitartap` — so it gets a new one and lands as a new row. One that has a `rowKey`
 * replaces that row in place. That single rule gives all three behaviours the library needs:
 * importing the same file twice adds two rows (both keeping the file's `id`), editing a row
 * replaces it even though the edit mints a new `id`, and a heal-on-read writes back in place.
 *
 * `savedAt` works the same way: a new record gets the next insertion stamp, an existing one keeps
 * its stamp, so an edit doesn't jump to the end of the list.
 */
export function saveMeasurement(m: TapToneMeasurementModel): Promise<TapToneMeasurementModel> {
  const stored: StoredMeasurement = {
    ...m,
    rowKey: m.rowKey ?? newRowKey(),
    savedAt: (m as StoredMeasurement).savedAt ?? nextSeq(),
  }
  return tx('readwrite', (s) => s.put(stored)).then(() => stored)
}

/**
 * Import a `.guitartap` file's contents into the library — the whole of what the Import button
 * does to storage, so the behaviour is testable without driving the panel.
 *
 * Each measurement is saved AS PARSED. Its `id` is the dataset identity and must survive the round
 * trip, exactly as it does in Swift and Python; what makes a re-import append a new row rather than
 * overwrite is that a parsed measurement has no `rowKey` yet, so `saveMeasurement` mints one. Two
 * imports of one file therefore give two rows sharing an `id` — the same state the natives reach by
 * appending to their array.
 *
 * Returns the stored measurements, each carrying the `rowKey` it was given.
 */
export async function importMeasurements(text: string): Promise<TapToneMeasurementModel[]> {
  const imported: TapToneMeasurementModel[] = []
  for (const m of parseGuitarTapFile(text)) imported.push(await saveMeasurement(m))
  return imported
}

/** All saved measurements in insertion order (last saved/imported last), mirroring the
 *  Swift/Python `savedMeasurements` array. */
export function listMeasurements(): Promise<TapToneMeasurementModel[]> {
  return tx<StoredMeasurement[]>('readonly', (s) => s.getAll()).then((all) => {
    const sorted = all.sort((a, b) => orderOf(a) - orderOf(b))
    // Unlike Swift/Python — whose library is a JSON file and therefore passes through the
    // per-measurement decoder — this store holds already-decoded objects, so nothing here
    // reaches decodeMeasurement(). Measurements written by the web before the findPeaks
    // duplicate fix must be healed on read, or they stay corrupt forever.
    const healed = sorted.filter((m) => healMeasurement(m))
    if (healed.length > 0) {
      // The library is ours: write the corrected form straight back, once.
      void Promise.all(healed.map((m) => saveMeasurement(m)))
    }
    return sorted
  })
}

/** Fetch one stored row by its library-local `rowKey` (NOT the dataset `id`). */
export function getMeasurement(rowKey: string): Promise<TapToneMeasurementModel | undefined> {
  return tx<TapToneMeasurementModel | undefined>('readonly', (s) => s.get(rowKey)).then((m) => {
    if (m && healMeasurement(m)) void saveMeasurement(m)
    return m
  })
}

/** Delete one stored row by its library-local `rowKey` (NOT the dataset `id`, which duplicate
 *  imports share — deleting by that would remove every copy). */
export function deleteMeasurement(rowKey: string): Promise<void> {
  return tx('readwrite', (s) => s.delete(rowKey)).then(() => undefined)
}

/** Remove every saved measurement (the "Delete All" action). */
export function clearMeasurements(): Promise<void> {
  return tx('readwrite', (s) => s.clear()).then(() => undefined)
}