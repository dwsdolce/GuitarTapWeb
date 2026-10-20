// @parity test/import-persistence
//
// The saved-measurement library: importing through the app's import (`importAndLoadMeasurements`),
// editing an entry as the Edit sheet does (the analyzer's updateMeasurement), saving, and the message an import shows. The shared cases in
// import-persistence.json (IP1–IP17, IM1–IM3, IL1–IL3), the same as Swift and Python; IP7 is the natives' alone
// (they address entries by position, this library by row key). The library is the IndexedDB
// `measurements` store (store.ts); `fake-indexeddb/auto` provides IndexedDB in node.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { listMeasurements, clearMeasurements, importMeasurements, readLibrary, saveMeasurement } from '../src/measurement/store'
import { decodeLibrary } from '../src/measurement/decode'
import { serializeGuitarTapFile } from '../src/measurement'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Uuid } from '../src/measurement/newId'
import type { TapToneMeasurementModel } from '../src/measurement/types'

type Step = {
  libraryHolds?: string[]
  import?: string[]
  importFails?: string[]
  importFailsBare?: string
  file?: string
  message?: string
  edit?: { entry: number; name: string; notes: string | null }
  save?: string
  deleteAll?: boolean
  warning?: string
}
type LibraryCase = { id: string; only?: string; note: string; steps: Step[]; expect: Record<string, unknown> }
const DATA = JSON.parse(readFileSync('test/fixtures/import-persistence.json', 'utf8')) as {
  measurements: Record<string, { id: string }>
  cases: LibraryCase[]
}
const FILE_IDS = Object.fromEntries(Object.entries(DATA.measurements).map(([name, m]) => [name, m.id]))
// The cases for the web: all but those marked for the natives alone.
const CASES = DATA.cases.filter((c) => c.only !== 'natives')

// The store keeps records it cannot read under a localStorage key; the node test env has none, so install
// an in-memory one.
let local = new Map<string, string>()
beforeEach(async () => {
  local = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, String(v)),
    removeItem: (k: string) => void local.delete(k),
    clear: () => local.clear(),
    key: (i: number) => [...local.keys()][i] ?? null,
    get length() {
      return local.size
    },
  } as Storage
  await clearMeasurements()
})

/** The keys the records the library could not read were kept under. */
const keptKeys = () => [...local.keys()].filter((k) => k.startsWith('gt.measurements-unreadable-'))

/** Store a library holding these measurements, as it would be: each record that can be read as the app
 *  stores it, and each that cannot as it is in a file. */
async function storeLibrary(entries: unknown[]): Promise<void> {
  for (const entry of entries) {
    const [decoded] = decodeLibrary(JSON.stringify([entry])).measurements
    await saveMeasurement((decoded ?? entry) as TapToneMeasurementModel)
  }
}

describe('import-persistence — the shared cases (import-persistence.json)', () => {
  it.each(CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    // A library at launch is stored before the analyzer is made, and loaded as it loads one.
    const held = c.steps[0]?.libraryHolds?.map((n) => DATA.measurements[n])
    if (held) await storeLibrary(held)
    const a = new TapToneAnalyzer()
    await a.libraryLoaded
    let message: string | null = null
    for (const step of c.steps) {
      if (step.libraryHolds) {
        // Stored and loaded above.
      } else if (step.import) {
        const text = JSON.stringify(step.import.map((n) => DATA.measurements[n]))
        message = await a.importAndLoadMeasurements(text, importMeasurements)
      } else if (step.importFails) {
        const text = JSON.stringify(step.importFails.map((n) => DATA.measurements[n]))
        const failure = await a.importAndLoadMeasurements(text, importMeasurements).then(
          () => null,
          (err: unknown) => err,
        )
        expect(failure, `${c.id}: the import fails`).not.toBeNull()
        if (step.message !== undefined) expect(TapToneAnalyzer.importErrorMessage(failure, step.file!), `${c.id}: message`).toBe(step.message)
      } else if (step.importFailsBare !== undefined) {
        const text = JSON.stringify(DATA.measurements[step.importFailsBare])
        const failure = await a.importAndLoadMeasurements(text, importMeasurements).then(
          () => null,
          (err: unknown) => err,
        )
        expect(failure, `${c.id}: the import fails`).not.toBeNull()
        if (step.message !== undefined) expect(TapToneAnalyzer.importErrorMessage(failure, step.file!), `${c.id}: message`).toBe(step.message)
      } else if (step.edit) {
        // As the Edit sheet commits: the model's updateMeasurement on the listed entry.
        const row = (await listMeasurements())[step.edit.entry]!
        await a.updateMeasurement(row, step.edit.name, step.edit.notes ?? undefined)
      } else if (step.save !== undefined) {
        await a.saveMeasurement(step.save, '', { minHz: 50, maxHz: 500, minDb: -100, maxDb: 0 })
      } else if (step.deleteAll) {
        await a.deleteAllMeasurements()
      } else if (step.warning !== undefined) {
        a.microphoneWarning = step.warning
      } else throw new Error(`${c.id}: unknown step ${JSON.stringify(step)}`)
    }

    const library = await listMeasurements()
    for (const [field, want] of Object.entries(c.expect)) {
      switch (field) {
        case 'library':
          expect(library.map((m) => m.measurementName ?? ''), field).toEqual(want)
          break
        case 'notes':
          expect(library.map((m) => m.notes ?? null), field).toEqual(want)
          break
        case 'persisted':
          // listMeasurements opens a fresh IndexedDB connection, so this reads what was committed.
          expect((await listMeasurements()).map((m) => m.measurementName ?? ''), field).toEqual(want)
          break
        case 'ids': {
          const wantIds = want as string[]
          expect(library.length, `${field}: count`).toBe(wantIds.length)
          library.forEach((entry, i) => {
            if (wantIds[i] === 'new') expect(Object.values(FILE_IDS), `${field}: a new id`).not.toContain(entry.id)
            else expect(entry.id, `${field}: ${wantIds[i]}'s own id`).toBe(FILE_IDS[wantIds[i]!])
          })
          break
        }
        case 'message': expect(message, field).toBe(want); break
        case 'messageStartsWith': expect(message?.startsWith(want as string), `${field}: ${message}`).toBe(true); break
        case 'microphoneWarning': expect(a.microphoneWarning != null, field).toBe(want); break
        case 'libraryMessage': expect(a.libraryLoadFailure, field).toBe(want); break
        case 'libraryMessageStartsWith':
          expect(a.libraryLoadFailure?.startsWith(want as string), `${field}: ${a.libraryLoadFailure}`).toBe(true)
          break
        case 'keptCopy': {
          const kept = keptKeys()
          if (want) {
            expect(kept, `${field}: one copy`).toHaveLength(1)
            const unreadable = held!.filter((m) => decodeLibrary(JSON.stringify([m])).unreadable.length > 0)
            const records = JSON.parse(local.get(kept[0]!)!) as { measurementName?: string }[]
            expect(records.map((r) => r.measurementName), `${field}: the records as they were`).toEqual(
              unreadable.map((m) => (m as { measurementName?: string }).measurementName))
          } else expect(kept, `${field}: no copy`).toEqual([])
          break
        }
        case 'exportHasRowKey': {
          expect(library[0]!.rowKey, 'precondition: the library row has a row key').toBeTypeOf('string')
          const text = serializeGuitarTapFile(library)
          expect(text.includes('rowKey'), field).toBe(want)
          break
        }
        default: throw new Error(`unknown field ${field}`)
      }
    }
  })
})

describe('a saved measurement that cannot be read', () => {
  // What makes a stored record unreadable, made from a good one.
  const DAMAGE: Record<string, (m: TapToneMeasurementModel) => TapToneMeasurementModel> = {
    'bad id': (m) => ({ ...m, id: 'not-a-uuid' as Uuid }),
    'no spectrum': (m) => ({ ...m, spectrumSnapshot: undefined }),
    'empty spectrum': (m) => ({ ...m, spectrumSnapshot: { ...m.spectrumSnapshot!, frequencies: [], magnitudes: [] } }),
  }

  it.each(Object.keys(DAMAGE))('%s: is kept aside and out of the library, and the user is told once', async (kind) => {
    const { imported: [good] } = await importMeasurements(JSON.stringify([Object.values(DATA.measurements)[0]]))
    await saveMeasurement({ ...DAMAGE[kind]!(good!), rowKey: undefined })

    const a = new TapToneAnalyzer()
    await a.libraryLoaded
    expect(a.getSnapshot().savedMeasurements.map((m) => m.id)).toEqual([good!.id])
    expect(a.getSnapshot().libraryLoadFailure).toBe('1 saved measurement could not be read and was removed from the list.')
    expect(keptKeys()).toHaveLength(1)
    expect((await readLibrary()).unreadable, 'out of the library').toEqual([])

    a.clearLibraryLoadFailure()
    await a.saveMeasurement('Another', '', { minHz: 50, maxHz: 500, minDb: -100, maxDb: 0 })
    expect(a.getSnapshot().libraryLoadFailure, 'told once, not again on a later change').toBeNull()
  })

  it.each(Object.keys(DAMAGE))('%s: if it cannot be kept aside, it stays where it is, out of the list', async (kind) => {
    const { imported: [good] } = await importMeasurements(JSON.stringify([Object.values(DATA.measurements)[0]]))
    await saveMeasurement({ ...DAMAGE[kind]!(good!), rowKey: undefined })
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }

    const a = new TapToneAnalyzer()
    await a.libraryLoaded
    expect(a.getSnapshot().savedMeasurements.map((m) => m.id)).toEqual([good!.id])
    expect(a.getSnapshot().libraryLoadFailure).toBe('1 saved measurement could not be read and was left out of the list.')
    expect((await readLibrary()).unreadable, 'left where it is').toHaveLength(1)
  })
})
