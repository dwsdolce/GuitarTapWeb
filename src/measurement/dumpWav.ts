// @parity none
//
// Browser-only: the "Dump Capture Audio" diagnostic writes a captured buffer to a 32-bit-float WAV.
// Swift and Python write to a folder the user picks; a browser can only offer a download, so this
// is the platform's stand-in for Swift's `dumpCaptureWAV` — the analyzer calls it at exactly the
// same point (finishSessionRecording), which is what matters for parity.
import { encodeWavFloat32 } from '../dsp/wav'

/** How long the downloaded file's object URL is kept. Released at once, a browser can cancel the
 *  download it has only just started. */
const DOWNLOAD_URL_LIFETIME_MS = 60_000

/** Encode and download one capture; returns the file name. Filename mirrors Swift's
 *  `web_<label>_<ISO8601-dashes>.wav`; no save dialog, since it fires per measurement. A page is not
 *  told whether the browser saved it (it may block an automatic download), so the caller shows the
 *  name — a missing file is then noticed rather than assumed saved. */
export function dumpCaptureWav(samples: Float32Array, sampleRate: number, label: string): string {
  // Integer-second ISO, ":" → "-", matching Swift/Python (drop the milliseconds toISOString adds).
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
  const blob = new Blob([encodeWavFloat32(samples, sampleRate).buffer as ArrayBuffer], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const name = `web_${label}_${ts}.wav`
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS)
  return name
}
