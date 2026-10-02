// @parity none — browser-edition only: Swift's ImageRenderer and Python's QImage state a PNG's pixels per
// inch themselves; the web adds it to the browser-encoded file (pngPixelsPerInch.ts).
import { describe, it, expect } from 'vitest'
import { crc32, inflateSync } from 'node:zlib'
import { withPixelsPerInch } from '../src/presentation/pngPixelsPerInch'

// A 1×1 PNG as a browser encodes it: no pHYs.
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
)

/** The file's chunks, in order: type and data. */
function chunks(png: Uint8Array): { type: string; data: Buffer }[] {
  const b = Buffer.from(png)
  const out: { type: string; data: Buffer }[] = []
  for (let at = 8; at < b.length; ) {
    const length = b.readUInt32BE(at)
    out.push({ type: b.toString('latin1', at + 4, at + 8), data: b.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return out
}

describe('PNG pixels per inch', () => {
  it('states 144 pixels per inch as Swift writes it (5669 per metre), right after the header', () => {
    const out = chunks(withPixelsPerInch(PNG, 144))
    expect(out.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
    const phys = out[1]!.data
    expect([phys.readUInt32BE(0), phys.readUInt32BE(4), phys[8]]).toEqual([5669, 5669, 1])
  })

  it('replaces a stated figure rather than adding a second, and keeps the image data', () => {
    const twice = withPixelsPerInch(withPixelsPerInch(PNG, 72), 144)
    const out = chunks(twice)
    expect(out.filter((c) => c.type === 'pHYs')).toHaveLength(1)
    expect(out[1]!.data.readUInt32BE(0)).toBe(5669)
    expect(inflateSync(out.find((c) => c.type === 'IDAT')!.data)).toEqual(inflateSync(chunks(PNG).find((c) => c.type === 'IDAT')!.data))
  })

  it('writes a chunk checksum a PNG reader accepts', () => {
    const b = Buffer.from(withPixelsPerInch(PNG, 144))
    const at = 8 + 25 // after the signature and IHDR
    const crc = b.readUInt32BE(at + 8 + 9)
    // zlib's crc32 over the chunk type and data, as the PNG format defines it.
    expect(crc).toBe(crc32(b.subarray(at + 4, at + 8 + 9)))
  })
})
