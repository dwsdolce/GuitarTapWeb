// @parity none — browser-edition only: Swift's ImageRenderer and Python's QImage state a PNG's pixels per
// inch when they encode it; the browser's PNG encoder cannot, so the web adds it to the encoded file.

const SIGNATURE_LENGTH = 8
const INCHES_PER_METRE = 1 / 0.0254

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A PNG `pHYs` chunk stating `ppi` pixels per inch (PNG gives it per metre). */
function physChunk(ppi: number): Uint8Array {
  const perMetre = Math.round(ppi * INCHES_PER_METRE)
  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // "pHYs"
  view.setUint32(8, perMetre)
  view.setUint32(12, perMetre)
  chunk[16] = 1 // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)))
  return chunk
}

/** `png` stating `ppi` pixels per inch: a `pHYs` chunk placed after the header, replacing any there was. */
export function withPixelsPerInch(png: Uint8Array, ppi: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const parts: Uint8Array[] = [png.subarray(0, SIGNATURE_LENGTH)]
  let at = SIGNATURE_LENGTH
  while (at + 8 <= png.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const end = at + 12 + length
    if (type !== 'pHYs') parts.push(png.subarray(at, end))
    if (type === 'IHDR') parts.push(physChunk(ppi))
    at = end
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
