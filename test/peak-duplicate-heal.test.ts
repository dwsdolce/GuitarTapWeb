// @parity test/peak-heal
//
// D8 of Development/PEAK-FINDING-DUPLICATE-PEAKS.md, section 7b.
//
// Port of PeakDuplicateHealTests.swift.
//
// Fixing findPeaks stops NEW corruption. Every .guitartap file already written still
// carries the duplicate peak, and loaded peaks are authoritative — they are never
// re-derived — so old files would keep rendering an extra Analysis Results row forever.
// The repair therefore happens at DECODE time, in decodeMeasurement(), so it covers both
// reading a .guitartap file and reading the saved-measurements store, and no future read
// path can bypass it.
//
// Rule: collapse peaks closer than the 2 Hz proximity window, keeping (1) the peak whose
// id is in selectedPeakIDs, else (2) the higher magnitude, else (3) the first. findPeaks'
// own dedup guarantees legitimately saved peaks are >= 2 Hz apart, so any closer pair is
// by definition corruption.
//
// Authored against the UNFIXED code. Two kinds of test live here:
//
//   RED NOW — fail until the heal exists:
//     decoded measurement has no duplicate peaks
//     heal keeps the selected twin
//     heal is reported so the store can force a save
//
//   GUARDS — pass now and must keep passing; they constrain what the heal may do rather
//   than demanding it exist:
//     heal leaves no dangling ids   (must not orphan selection/offset/override ids)
//     heal flag is not serialised   (transient flag must never reach the format)
//
// A guard passing today is not evidence of anything; its value is entirely in step 8.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseGuitarTapFile, serializeGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'

// The Swift-captured fixture also used by the findPeaks regression: 50 saved peaks, one
// of which is a bit-identical twin at 240.10170 Hz.
const FIXTURE = 'dws-2024-umik-1-swift-mac-1784225155.guitartap'
const PEAK_PROXIMITY_HZ = 2

function decode(): TapToneMeasurementModel {
  const text = readFileSync(join(__dirname, 'fixtures', FIXTURE), 'utf8')
  const all = parseGuitarTapFile(text)
  expect(all.length, 'fixture decoded to no measurements').toBeGreaterThan(0)
  return all[0]!
}

describe('D8 — duplicate-peak heal on decode', () => {
  it('decoded measurement has no duplicate peaks', () => {
    const m = decode()

    const offenders: string[] = []
    for (let i = 0; i < m.peaks.length; i++) {
      for (let j = i + 1; j < m.peaks.length; j++) {
        const delta = Math.abs(m.peaks[i]!.frequency - m.peaks[j]!.frequency)
        if (delta < PEAK_PROXIMITY_HZ) {
          offenders.push(
            `${m.peaks[i]!.frequency.toFixed(5)} Hz / ${m.peaks[j]!.frequency.toFixed(5)} Hz ` +
              `(${delta.toFixed(5)} apart)`,
          )
        }
      }
    }
    expect(offenders, 'decode must collapse duplicate peaks').toEqual([])
    expect(m.peaks.length, 'expected 49 peaks after healing 50').toBe(49)
  })

  it('heal keeps the selected twin', () => {
    const m = decode()

    // The surviving 240.1 Hz peak must be the one that was claimed as a mode winner,
    // otherwise the selection silently points at a peak that no longer exists.
    const survivors = m.peaks.filter((p) => Math.abs(p.frequency - 240.1017) < 0.01)
    expect(survivors.length, 'expected exactly one 240.1 Hz peak').toBe(1)

    const selected = new Set(m.selectedPeakIDs ?? [])
    expect(
      selected.has(survivors[0]!.id),
      'the heal kept the unselected twin — selection now dangles',
    ).toBe(true)
  })

  it('GUARD — heal leaves no dangling ids', () => {
    const m = decode()
    const ids = new Set(m.peaks.map((p) => p.id))

    for (const id of m.selectedPeakIDs ?? []) {
      expect(ids.has(id), `selectedPeakIDs references a removed peak: ${id}`).toBe(true)
    }
    for (const id of Object.keys(m.peakAnnotationOffsets ?? {})) {
      expect(ids.has(id), `peakAnnotationOffsets references a removed peak: ${id}`).toBe(true)
    }
    for (const id of Object.keys(m.peakModeOverrides ?? {})) {
      expect(ids.has(id), `peakModeOverrides references a removed peak: ${id}`).toBe(true)
    }
  })

  it('heal is reported so the store can force a save', () => {
    const m = decode()

    // Read through an index signature on purpose: the field does not exist yet, and a
    // direct m.wasHealed reference would fail typecheck rather than fail the test.
    // Replace once the API lands in step 5.
    const healFlag = (m as unknown as Record<string, unknown>)['wasHealed']

    expect(
      healFlag,
      'decode healed a duplicate but did not report it; the saved-measurements store ' +
        'cannot know to force a save',
    ).toBe(true)
  })

  it('GUARD — heal flag is not serialised', () => {
    const m = decode()
    const encoded = serializeGuitarTapFile([m])

    expect(encoded.includes('wasHealed'), 'the heal marker must not round-trip into the format').toBe(
      false,
    )

    // And the corrected form is what gets written — the twin must not come back.
    const roundTripped = parseGuitarTapFile(encoded)[0]!
    expect(
      roundTripped.peaks.length,
      're-encoding a healed measurement must persist the corrected peak list',
    ).toBe(m.peaks.length)
  })
})