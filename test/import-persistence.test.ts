// @parity test/import-persistence
//
// Port of ImportPersistenceTests.swift / test_import_persistence.py (IP1–IP3): importing a measurement
// persists it to the library and successive imports APPEND rather than overwrite. The web's library is the
// IndexedDB `measurement` store (store.ts) — the browser equivalent of the native `saved_measurements.json`
// file — so `fake-indexeddb/auto` provides IndexedDB in the node test env.
//
// The extra cases below the IP set pin this edition's DATASET-IDENTITY rules, which the natives get for
// free from an ordered array and this one has to arrange deliberately (SLUG-SWEEP.md F19a):
//
//   `id`     — the measurement's dataset identity. Travels in the file, survives import unchanged, is
//              re-minted whenever the data changes (including a name or notes edit). Duplicate imports
//              SHARE it, exactly as they do in Swift and Python.
//   `rowKey` — library-local row handle, minted per insert, never written to a file. Rows are addressed
//              by this, which is why an edit that changes `id` still replaces its row instead of adding one.
//
// Until the #17 sweep import overwrote `id` with a fresh value, which is what made a re-import append. That
// destroyed the dataset identity of every file imported here — and, because export writes `id`, of every
// file exported from here too.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveMeasurement,
  listMeasurements,
  clearMeasurements,
  importMeasurements,
} from '../src/measurement/store'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'
import { newMeasurementId } from '../src/measurement/fromLive'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

function minimal(name = 'Test'): TapToneMeasurementModel {
  return { id: newMeasurementId(), timestamp: '2026-01-01T00:00:00.000Z', peaks: [], measurementName: name }
}

beforeEach(async () => {
  await clearMeasurements()
})

describe('import-persistence — IndexedDB library (IP1–IP3)', () => {
  it('IP1: importing a measurement adds it to the library', async () => {
    await importMeasurements(serializeGuitarTapFile([minimal()]))
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

  it('IP3: a second import of the same file APPENDS, not overwrite', async () => {
    const text = serializeGuitarTapFile([minimal()])
    await importMeasurements(text)
    const afterFirst = (await listMeasurements()).length
    await importMeasurements(text)
    const afterSecond = (await listMeasurements()).length
    expect(afterSecond).toBe(afterFirst + 1)
  })
})

describe('import-persistence — dataset identity vs row handle', () => {
  it('import preserves the file’s dataset id', async () => {
    const original = minimal('Kept')
    await importMeasurements(serializeGuitarTapFile([original]))
    const [loaded] = await listMeasurements()
    expect(loaded!.id).toBe(original.id)
  })

  it('a duplicate import gives two rows that SHARE the id and differ by rowKey', async () => {
    const original = minimal('Twin')
    const text = serializeGuitarTapFile([original])
    await importMeasurements(text)
    await importMeasurements(text)
    const list = await listMeasurements()
    expect(list).toHaveLength(2)
    // Same dataset, imported twice — exactly what Swift and Python produce by appending.
    expect(list[0]!.id).toBe(original.id)
    expect(list[1]!.id).toBe(original.id)
    // ...but two independent rows, which is why `id` cannot address one.
    expect(list[0]!.rowKey).not.toBe(list[1]!.rowKey)
  })

  it('an edit mints a NEW dataset id and still replaces its row', async () => {
    const original = minimal('Before')
    await importMeasurements(serializeGuitarTapFile([original]))
    const stored = (await listMeasurements())[0]!
    // Mirrors MeasurementsPanel.commitEdit: new `id` (amended data is a different dataset),
    // same `rowKey` (it is still that row).
    await saveMeasurement({ ...stored, id: newMeasurementId(), measurementName: 'After' })
    const list = await listMeasurements()
    expect(list).toHaveLength(1)
    expect(list[0]!.measurementName).toBe('After')
    expect(list[0]!.rowKey).toBe(stored.rowKey)
    expect(list[0]!.id).not.toBe(original.id)
  })

  it('editing one of two duplicates leaves the other alone and ends the shared id', async () => {
    const original = minimal('Twin')
    const text = serializeGuitarTapFile([original])
    await importMeasurements(text)
    await importMeasurements(text)
    const [first, second] = await listMeasurements()
    await saveMeasurement({ ...second!, id: newMeasurementId(), measurementName: 'Edited' })
    const list = await listMeasurements()
    expect(list.map((m) => m.measurementName)).toEqual(['Twin', 'Edited'])
    expect(list[0]!.id).toBe(first!.id)
    expect(list[0]!.id).not.toBe(list[1]!.id)
  })

  it('rowKey is library-local and never reaches the exported file', async () => {
    await saveMeasurement(minimal('Exported'))
    const stored = (await listMeasurements())[0]!
    expect(stored.rowKey).toBeTypeOf('string')
    const text = serializeGuitarTapFile([stored])
    expect(text).not.toContain('rowKey')
    expect(JSON.parse(text)[0].rowKey).toBeUndefined()
  })

  it('export after import round-trips the dataset id unchanged', async () => {
    const original = minimal('Round Trip')
    await importMeasurements(serializeGuitarTapFile([original]))
    const stored = (await listMeasurements())[0]!
    const reparsed = parseGuitarTapFile(serializeGuitarTapFile([stored]))
    expect(reparsed[0]!.id).toBe(original.id)
  })
})

describe('import-persistence — library save semantics', () => {
  it('distinct measurements append in insertion order (last saved last)', async () => {
    await saveMeasurement(minimal('A'))
    await saveMeasurement(minimal('B'))
    await saveMeasurement(minimal('C'))
    expect((await listMeasurements()).map((m) => m.measurementName)).toEqual(['A', 'B', 'C'])
  })

  it('re-saving the same rowKey REPLACES (an edit), does not duplicate or jump to the end', async () => {
    await saveMeasurement(minimal('A'))
    await saveMeasurement(minimal('B'))
    // Edit A the way the app does — load it back (carries its rowKey and insertion stamp) then re-save.
    const loadedA = (await listMeasurements()).find((m) => m.measurementName === 'A')!
    await saveMeasurement({ ...loadedA, id: newMeasurementId(), measurementName: 'A-edited' })
    const list = await listMeasurements()
    expect(list).toHaveLength(2)
    // A stays in its original position (edit keeps its insertion stamp), with the new name.
    expect(list.map((m) => m.measurementName)).toEqual(['A-edited', 'B'])
  })

  it('a round-tripped import preserves the measurement fields', async () => {
    const original = minimal('Round Trip')
    await importMeasurements(serializeGuitarTapFile([original]))
    const [loaded] = await listMeasurements()
    expect(loaded!.measurementName).toBe('Round Trip')
    expect(loaded!.timestamp).toBe(original.timestamp)
    expect(loaded!.peaks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The import message: what the user is told
// ---------------------------------------------------------------------------
//
// An import is a library operation and says nothing about microphones; a LOAD shows the user data,
// so a load warns. A single-file import also loads, so its ONE message carries the load's warning.
// These pin the OUTCOME — the message — not any edition's mechanism for clearing an acknowledged
// warning, so they hold however that mechanism changes (#17 F41).
// Port of Swift ImportMessageTests / Python TestImportMessage.
describe('the import message', () => {
  // A microphone no machine running the tests will have.
  const ABSENT_MIC = 'No Such Microphone (test)'

  const withMic = (mic?: string): TapToneMeasurementModel => ({
    ...minimal(),
    microphoneName: mic,
    spectrumSnapshot: {
      magnitudes: [-60, -60], frequencies: [100, 200],
      minFreq: 50, maxFreq: 500, minDB: -100, maxDB: 0, isLogarithmic: false,
    },
  })

  const file = (...mics: (string | undefined)[]) => serializeGuitarTapFile(mics.map(withMic))

  it('a library import says nothing about microphones, even ones that are not connected', async () => {
    const a = new TapToneAnalyzer()
    a.microphoneWarning = 'a warning from an earlier load' // nothing loads here, so nothing clears it
    const message = await a.importAndLoadMeasurements(file(ABSENT_MIC, ABSENT_MIC), importMeasurements)
    expect(message).toBe('Successfully imported 2 measurements')
    expect(a.microphoneWarning).toBeNull()
  })

  it("a single-file import carries the LOAD's warning, in one message", async () => {
    const a = new TapToneAnalyzer()
    const message = await a.importAndLoadMeasurements(file(ABSENT_MIC), importMeasurements)
    expect(message).toContain('Successfully imported and loaded 1 measurement')
    expect(message).toContain(`⚠️ Recorded with '${ABSENT_MIC}'`)
    expect(a.microphoneWarning).toBeNull() // folded into the message, so no second dialog
  })

  it('an earlier, acknowledged warning never rides along on a later import', async () => {
    const a = new TapToneAnalyzer()
    a.microphoneWarning = 'a warning from an earlier load'
    const message = await a.importAndLoadMeasurements(file(undefined), importMeasurements)
    expect(message).toBe('Successfully imported and loaded 1 measurement')
  })
})
