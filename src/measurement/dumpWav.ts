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
  const name = `web_${label}_${ts}.wav`
  download(new Blob([encodeWavFloat32(samples, sampleRate).buffer as ArrayBuffer], { type: 'audio/wav' }), name)
  return name
}

/** How long after a recording's download the probe's file is offered. Two downloads started together
 *  leave only the second: the browser drops the first. */
const PROBE_DOWNLOAD_DELAY_MS = 1_000

/** Download the capture probe's records for one measurement, a moment after its recording.
 *  Diagnostic: the analyzer has a file to pass only in a build made with the probe's developer
 *  switch on. */
export function dumpCaptureProbe(file: { name: string; text: string }): void {
  setTimeout(() => download(new Blob([file.text], { type: 'application/json' }), file.name), PROBE_DOWNLOAD_DELAY_MS)
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS)
}
