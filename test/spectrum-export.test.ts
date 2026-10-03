// @parity test/spectrum-export
//
// The exported spectrum image's size: every Export Spectrum PNG is 2928 pixels wide — 2376 high with the
// peak summary, 2138 without — and states 144 pixels per inch, so a viewer that honours the figure shows
// it at 1464 points wide. Mirrors Swift SpectrumExportTests and Python test_spectrum_export.py (the same
// cases). Under Node the browser's PNG encoder is a stand-in, so the pixels are read from the canvas the
// image is drawn on, and the figure from the file.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile } from '../src/measurement'
import { measurementToImageOpts } from '../src/presentation/measurementImage'
import { renderSpectrumToCanvas, spectrumPng } from '../src/presentation/spectrumExport'
import { installCanvasStandIn } from './support/canvasStandIn'

/** The shared cases: each fixture and the image it exports — pixels wide and high, and pixels per inch. */
const CASES = (JSON.parse(readFileSync('test/fixtures/spectrum-export.json', 'utf8')) as { cases: [string, number, number, number][] }).cases

/** The pixels per inch a PNG states (its pHYs chunk, per metre), or null. */
function pixelsPerInch(png: Uint8Array): number | null {
  const b = Buffer.from(png)
  for (let at = 8; at < b.length; ) {
    const length = b.readUInt32BE(at)
    if (b.toString('latin1', at + 4, at + 8) === 'pHYs' && b[at + 16] === 1) return Math.round(b.readUInt32BE(at + 8) * 0.0254)
    at += 12 + length
  }
  return null
}

describe('spectrum export', () => {
  beforeAll(() => installCanvasStandIn())

  for (const [fixture, width, height, ppi] of CASES) {
    it(`${fixture} exports ${width} × ${height} at ${ppi} pixels per inch`, async () => {
      const opts = measurementToImageOpts(parseGuitarTapFile(readFileSync(`test/fixtures/${fixture}.guitartap`, 'utf8'))[0]!)
      const canvas = renderSpectrumToCanvas(opts)
      expect([canvas.width, canvas.height]).toEqual([width, height])
      expect(pixelsPerInch((await spectrumPng(opts))!)).toBe(ppi)
    })
  }
})
