// @parity models/capture-probe
/**
 * Diagnostic for where the editions' captured tap buffers diverge.
 *
 * Places a cross-edition difference in what reaches the FFT in one of three places by
 * fingerprinting the two buffers on either side of the alignment step:
 *
 *     buffer differs                -> the editions are not capturing the same samples
 *     buffer same, window differs   -> the alignment picks a different onset
 *     both same, spectrum differs   -> the arithmetic differs, not the input
 *
 * Inert unless `enabled` is set. The probe tool switches it on for a replay. The app switches it on
 * only when built with `LIVE_PROBE` set, and then only while Dump Capture Audio is on: each
 * measurement's records are downloaded with its session recording, where the first samples of each
 * capture buffer place it in that recording.
 *
 * Mirrors Swift `CaptureProbe.swift` and Python `capture_probe.py`.
 */

/** Whether the app itself records captures — a developer switch, `false` in every released build
 *  (`npm run build` refuses with it on). Set it to `true` for a diagnostic run under `npm run dev`;
 *  the probe then runs for each measurement made with Dump Capture Audio on. Mirrors Swift
 *  `CaptureProbe.liveProbe`. */
export const LIVE_PROBE: boolean = false

/** A file of records: one edition's captures for one replayed case or one live measurement. */
export interface CaptureProbeDocument {
  edition: string
  os: string
  arch: string
  /** The replayed case, or the name of the live measurement's session recording. */
  caseName: string
  records: CaptureProbeRecord[]
}

/** The fingerprints of one capture, recorded while `enabled`. */
export interface CaptureProbeRecord {
  /** Samples handed to the capture, before onset alignment. */
  bufferCount: number
  bufferHash: string
  /** The window handed to the FFT, after alignment and padding. */
  windowCount: number
  windowHash: string
  /** First 1024 samples of the buffer, as hex bit patterns. Enough to locate the buffer's start
   *  offset inside the source file by search, which is what says whether the editions begin
   *  accumulating at the same sample. */
  bufferHead: string[]
}

/** The samples as 32-bit floats — the precision the editions capture at, so the bits compare. */
function float32(samples: ArrayLike<number>): Float32Array {
  return samples instanceof Float32Array ? samples : Float32Array.from(samples)
}

export const captureProbe = {
  enabled: false,
  /** Whether a measurement in the app is recording captures (beginLiveSession). Separate from
   *  `enabled`, which a test or tool owns: a session that begins must not switch that off. */
  liveSession: false,
  records: [] as CaptureProbeRecord[],

  reset(): void {
    this.records = []
  },

  /**
   * A measurement begins in the app: start a fresh set of records, when the app is recording them
   * at all. Does nothing unless `LIVE_PROBE`. Mirrors Swift `CaptureProbe.beginLiveSession(recording:)`.
   *
   * @param recording Whether this measurement's audio is being recorded (Dump Capture Audio).
   */
  beginLiveSession(recording: boolean): void {
    if (!LIVE_PROBE) return
    this.liveSession = recording
    if (recording) this.reset()
  },

  /**
   * A measurement's session recording was saved: the records to save with it, as
   * `<recording name>-capture-probe.json`. Mirrors Swift `CaptureProbe.writeLiveRecords(beside:)`,
   * but returns the file for the caller to download — a page cannot write beside another file.
   *
   * @param wavName The session recording's file name.
   * @returns The file's name and JSON text, or null unless `LIVE_PROBE` and a session is on.
   */
  liveRecordsFile(wavName: string): { name: string; text: string } | null {
    if (!LIVE_PROBE || !this.liveSession) return null
    const stem = wavName.replace(/\.wav$/, '')
    // A page is not told its platform or processor in a form worth recording.
    return { name: `${stem}-capture-probe.json`, text: this.encoded({ os: 'browser', arch: 'unknown' }, stem, this.records) }
  },

  /**
   * The records as a document for this edition, in the form every edition writes. Mirrors Swift
   * `CaptureProbe.encoded(caseName:records:)`.
   *
   * @param platform The platform and processor the records were made on.
   * @param caseName The replayed case, or the name of the live measurement's recording.
   * @param records The capture records.
   * @returns The JSON text.
   */
  encoded(platform: { os: string; arch: string }, caseName: string, records: CaptureProbeRecord[]): string {
    const document: CaptureProbeDocument = { arch: platform.arch, caseName, edition: 'web', os: platform.os, records }
    return JSON.stringify(document, null, 2) + '\n'
  },

  /**
   * FNV-1a over the little-endian IEEE-754 bit patterns of the samples.
   *
   * Deliberately not a checksum of the decimal text: the editions must be comparing the same bits,
   * and any formatting step would hide a difference in the low bits — which is the size of
   * difference this is chasing. The Swift and Python probes implement the same function, so the
   * hex strings are directly comparable.
   *
   * @param samples The samples to fingerprint; values are taken as 32-bit floats.
   * @returns The 64-bit hash as 16 lowercase hex digits.
   */
  fingerprint(samples: ArrayLike<number>): string {
    const data = float32(samples)
    const bytes = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let hash = 0xcbf29ce484222325n
    for (let i = 0; i < data.length; i++) {
      const bits = bytes.getUint32(i * 4, true)
      for (let shift = 0; shift < 32; shift += 8) {
        hash ^= BigInt((bits >>> shift) & 0xff)
        hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
      }
    }
    return hash.toString(16).padStart(16, '0')
  },

  /**
   * Record one capture's fingerprints. Does nothing unless `enabled`.
   *
   * @param buffer The samples handed to the capture, before onset alignment.
   * @param window The window handed to the FFT.
   */
  record(buffer: ArrayLike<number>, window: ArrayLike<number>): void {
    if (!this.enabled && !this.liveSession) return
    const head = float32(buffer).subarray(0, 1024)
    const headBytes = new DataView(head.buffer, head.byteOffset, head.byteLength)
    this.records.push({
      bufferCount: buffer.length,
      bufferHash: this.fingerprint(buffer),
      windowCount: window.length,
      windowHash: this.fingerprint(window),
      bufferHead: Array.from(head, (_, i) => headBytes.getUint32(i * 4, true).toString(16).padStart(8, '0')),
    })
  },
}
