// @parity test/import-persistence
//
// The saved-measurement library: importing through the app's import (`importAndLoadMeasurements`),
// editing an entry as the Edit sheet does (the analyzer's updateMeasurement), saving, and the message an import shows. The shared cases in
// import-persistence.json (IP1–IP9, IM1–IM3), the same as Swift and Python; IP7 is the natives' alone
// (they address entries by position, this library by row key). The library is the IndexedDB
// `measurements` store (store.ts); `fake-indexeddb/auto` provides IndexedDB in node.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { listMeasurements, clearMeasurements, importMeasurements, readLibrary, deleteUnreadable, saveMeasurement } from '../src/measurement/store'
import { serializeGuitarTapFile } from '../src/measurement'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Uuid } from '../src/measurement/newId'
import type { TapToneMeasurementModel } from '../src/measurement/types'

type Step = {
  import?: string[]
  importFails?: string[]
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

beforeEach(async () => {
  await clearMeasurements()
})

describe('import-persistence — the shared cases (import-persistence.json)', () => {
  it.each(CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const a = new TapToneAnalyzer()
    let message: string | null = null
    for (const step of c.steps) {
      if (step.import) {
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
  // The web's form of the natives' rule for a library that cannot be read: records are stored one by
  // one, so a record with an id that is not a UUID, or with no spectrum, is skipped, kept in storage
  // untouched and reported; the user may delete it, and nothing else does.
  it('the analyzer holds the library and the unreadable records, as Swift holds savedMeasurements', async () => {
    const [good] = await importMeasurements(JSON.stringify([Object.values(DATA.measurements)[0]]))
    await saveMeasurement({ ...good!, rowKey: undefined, id: 'not-a-uuid' as Uuid })

    const a = new TapToneAnalyzer()
    await a.loadPersistedMeasurements()
    expect(a.getSnapshot().savedMeasurements.map((m) => m.id)).toEqual([good!.id])
    expect(a.getSnapshot().unreadableMeasurements).toHaveLength(1)

    a.keepUnreadableMeasurements() // Keep: the alert goes, the record stays
    expect(a.getSnapshot().unreadableMeasurements).toEqual([])
    await a.loadPersistedMeasurements()
    expect(a.getSnapshot().unreadableMeasurements).toHaveLength(1)

    await a.deleteUnreadableMeasurements() // Delete: the record goes
    await a.loadPersistedMeasurements()
    expect(a.getSnapshot().unreadableMeasurements).toEqual([])
    expect(a.getSnapshot().savedMeasurements).toHaveLength(1)
  })

  // What makes a stored record unreadable, made from a good one.
  const DAMAGE: Record<string, (m: TapToneMeasurementModel) => TapToneMeasurementModel> = {
    'bad id': (m) => ({ ...m, id: 'not-a-uuid' as Uuid }),
    'no spectrum': (m) => ({ ...m, spectrumSnapshot: undefined }),
    'empty spectrum': (m) => ({ ...m, spectrumSnapshot: { ...m.spectrumSnapshot!, frequencies: [], magnitudes: [] } }),
  }

  it.each(Object.keys(DAMAGE))('%s: is skipped, kept and reported, and removed only when the user deletes it', async (kind) => {
    const [good] = await importMeasurements(JSON.stringify([Object.values(DATA.measurements)[0]]))
    await saveMeasurement({ ...DAMAGE[kind]!(good!), rowKey: undefined })

    const first = await readLibrary()
    expect(first.measurements.map((m) => m.id)).toEqual([good!.id])
    expect(first.unreadable).toHaveLength(1)

    await saveMeasurement({ ...good!, rowKey: undefined }) // another save leaves it as it was
    const second = await readLibrary()
    expect(second.unreadable).toEqual(first.unreadable)
    expect(await listMeasurements()).toHaveLength(2)

    await deleteUnreadable(second.unreadable)
    expect((await readLibrary()).unreadable).toEqual([])
  })
})

