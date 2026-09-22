// @parity none
//
// Browser-only: the "Dump Capture Audio" diagnostic writes a captured buffer to a 32-bit-float WAV.
// Swift and Python write to a folder the user picks; a browser can only offer a download, so this
// is the platform's stand-in for Swift's `dumpCaptureWAV` — the analyzer calls it at exactly the
// same point (finishSessionRecording), which is what matters for parity.
import { encodeWavFloat32 } from '../dsp/wav'

/** Encode and silently download one capture. Filename mirrors Swift's
 *  `web_<label>_<ISO8601-dashes>.wav`; no save dialog, since it fires per measurement. */
export function dumpCaptureWav(samples: Float32Array, sampleRate: number, label: string): void {
  // Integer-second ISO, ":" → "-", matching Swift/Python (drop the milliseconds toISOString adds).
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
  const blob = new Blob([encodeWavFloat32(samples, sampleRate).buffer as ArrayBuffer], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `web_${label}_${ts}.wav`
  a.click()
  URL.revokeObjectURL(url)
}
