// Minimal RIFF/WAVE decoder. Returns mono (channel 0 only) float samples plus
// the embedded sample rate — matching how the Swift/Python app feeds audio
// (mono, channelData[0], the file's native rate). Phase 2 file-playback parity
// requires decoding at the embedded rate with NO resampling (see PLAN.md risk #1).
//
// Supports the formats the app writes/reads: IEEE float32 (fmt 3) and PCM int16
// (fmt 1); also WAVE_FORMAT_EXTENSIBLE (0xFFFE) by reading its sub-format tag.

export interface DecodedWav {
  /** Mono samples (channel 0), as float32 in roughly [-1, 1]. */
  samples: Float32Array
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** Effective format tag: 1 = PCM integer, 3 = IEEE float. */
  format: number
}

function readTag(dv: DataView, offset: number): string {
  return String.fromCharCode(
    dv.getUint8(offset),
    dv.getUint8(offset + 1),
    dv.getUint8(offset + 2),
    dv.getUint8(offset + 3),
  )
}

export interface DecodeOptions {
  /** Average all channels into mono (matches the app's stereo→mono down-mix).
   *  Default false → channel 0 only (matches the mono live-mic / capture path). */
  downmix?: boolean
}

export function decodeWav(bytes: Uint8Array, options: DecodeOptions = {}): DecodedWav {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.byteLength < 12 || readTag(dv, 0) !== 'RIFF' || readTag(dv, 8) !== 'WAVE') {
    throw new Error('decodeWav: not a RIFF/WAVE file')
  }

  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let dataOffset = -1
  let dataSize = 0

  let offset = 12
  while (offset + 8 <= dv.byteLength) {
    const id = readTag(dv, offset)
    const size = dv.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = dv.getUint16(body, true)
      channels = dv.getUint16(body + 2, true)
      sampleRate = dv.getUint32(body + 4, true)
      bits = dv.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 40) {
        // WAVE_FORMAT_EXTENSIBLE: real tag is the first 2 bytes of the sub-format GUID.
        format = dv.getUint16(body + 24, true)
      }
    } else if (id === 'data') {
      dataOffset = body
      dataSize = Math.min(size, dv.byteLength - body)
    }
    offset = body + size + (size & 1) // chunks are word-aligned
  }

  if (channels === 0 || dataOffset < 0) {
    throw new Error('decodeWav: missing fmt or data chunk')
  }

  const bytesPerSample = bits >> 3
  const frameBytes = bytesPerSample * channels
  const frameCount = Math.floor(dataSize / frameBytes)
  const samples = new Float32Array(frameCount)

  const readSampleAt = (p: number): number => {
    if (format === 3 && bits === 32) return dv.getFloat32(p, true)
    if (format === 3 && bits === 64) return dv.getFloat64(p, true)
    if (format === 1 && bits === 16) return dv.getInt16(p, true) / 32768
    if (format === 1 && bits === 32) return dv.getInt32(p, true) / 2147483648
    if (format === 1 && bits === 24) {
      let v = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16)
      if (v & 0x800000) v |= ~0xffffff // sign-extend
      return v / 8388608
    }
    throw new Error(`decodeWav: unsupported format ${format} / ${bits}-bit`)
  }

  for (let i = 0; i < frameCount; i++) {
    const frameStart = dataOffset + i * frameBytes
    if (options.downmix && channels > 1) {
      let sum = 0
      for (let c = 0; c < channels; c++) sum += readSampleAt(frameStart + c * bytesPerSample)
      samples[i] = sum / channels
    } else {
      samples[i] = readSampleAt(frameStart) // channel 0
    }
  }

  return { samples, sampleRate, channels, bitsPerSample: bits, format }
}
