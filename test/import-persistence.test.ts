// @parity test/import-persistence
//
// Port of ImportPersistenceTests.swift / test_import_persistence.py (IP1–IP3): importing a measurement
// persists it to the library and successive imports APPEND rather than overwrite. The web's library is the
// IndexedDB `measurement` store (store.ts) — the browser equivalent of the native `saved_measurements.json`
// file — so `fake-indexeddb/auto` provides IndexedDB in the node test env. The import path mirrors
// MeasurementsPanel.onImportFile: parseGuitarTapFile → re-id each measurement (so a re-import appends,
// matching Swift `importMeasurements`) → saveMeasurement.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { saveMeasurement, listMeasurements, clearMeasurements } from '../src/measurement/store'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'
import { newMeasurementId } from '../src/measurement/fromLive'

function minimal(name = 'Test'): TapToneMeasurementModel {
  return { id: newMeasurementId(), timestamp: '2026-01-01T00:00:00.000Z', peaks: [], measurementName: name }
}

/** The web's "import a .guitartap file into the library" — parse, RE-ID (append, not overwrite by id,
 *  mirroring Swift `importMeasurements`), and save each. Mirrors MeasurementsPanel.onImportFile. */
async function importFile(text: string): Promise<void> {
  for (const m of parseGuitarTapFile(text)) await saveMeasurement({ ...m, id: newMeasurementId() })
}

beforeEach(async () => {
  await clearMeasurements()
})

describe('import-persistence — IndexedDB library (IP1–IP3)', () => {
  it('IP1: importing a measurement adds it to the library', async () => {
    await importFile(serializeGuitarTapFile([minimal()]))
    const list = await listMeasurements()
    expect(list).toHaveLength(1)
    expect(list[0]!.measurementName).toBe('Test')
  })

  it('IP2: a saved measurement persists (survives re-opening the store)', async () => {
    await saveMeasurement(minimal('Persisted'))
    // listMeasurements opens a FRESH IndexedDB connection each call (openDB → getAll → close),
    // so reading it back proves the write was committed — the browser-storage analog of "on disk".
    const list = await listMeasurements()
    expect(list.map((m) => m.measurementName)).toContain('Persisted')
  })

  it('IP3: a second import of the same file APPENDS (re-ided), not overwrite', async () => {
    const text = serializeGuitarTapFile([minimal()])
    await importFile(text)
    const afterFirst = (await listMeasurements()).length
    await importFile(text)
    const afterSecond = (await listMeasurements()).length
    expect(afterSecond).toBe(afterFirst + 1)
  })
})

describe('import-persistence — library save semantics', () => {
  it('distinct measurements append in insertion order (last saved last)', async () => {
    await saveMeasurement(minimal('A'))
    await saveMeasurement(minimal('B'))
    await saveMeasurement(minimal('C'))
    expect((await listMeasurements()).map((m) => m.measurementName)).toEqual(['A', 'B', 'C'])
  })

  it('re-saving the same id REPLACES (an edit), does not duplicate or jump to the end', async () => {
    await saveMeasurement(minimal('A'))
    await saveMeasurement(minimal('B'))
    // Edit A the way the app does — load it back (carries its insertion stamp) then re-save.
    const loadedA = (await listMeasurements()).find((m) => m.measurementName === 'A')!
    await saveMeasurement({ ...loadedA, measurementName: 'A-edited' })
    const list = await listMeasurements()
    expect(list).toHaveLength(2)
    // A stays in its original position (edit keeps its insertion stamp), with the new name.
    expect(list.map((m) => m.measurementName)).toEqual(['A-edited', 'B'])
  })

  it('a round-tripped import preserves the measurement fields', async () => {
    const original = minimal('Round Trip')
    await importFile(serializeGuitarTapFile([original]))
    const [loaded] = await listMeasurements()
    expect(loaded!.measurementName).toBe('Round Trip')
    expect(loaded!.timestamp).toBe(original.timestamp)
    expect(loaded!.peaks).toEqual([])
  })
})