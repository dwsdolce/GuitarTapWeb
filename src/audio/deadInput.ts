// @parity dead-input-threshold — mirrors Swift RealtimeFFTAnalyzer.deadInputRMSThreshold
// and Python _DEAD_INPUT_RMS_THRESHOLD.
//
// The dead-input criterion lives here, apart from the engine, so it can be tested
// without an AudioContext. It is a field calibration, not a derivation — see
// hub docs/AUDIO-WATCHDOG-SILENT-STREAM.md for the incidents the numbers come from.

/**
 * RMS below which a chunk counts as carrying no signal: 1e-5 = -100 dBFS.
 *
 * A dead-but-present device was measured pinned at ~-100 dBFS (it does NOT deliver
 * digital zero), while a live room reads ~-70 dBFS and a UMIK-1's Air peak ~-63 dBFS.
 * Set at the BOTTOM of that range on purpose: the UMIK-1 is an unusually quiet
 * microphone and can sit near -90 dBFS in a silent room, so a mid-range threshold would
 * call a quiet workshop a dead input and re-acquire the stream mid-measurement. A missed
 * detection costs one more watchdog cycle; a false positive interrupts real work.
 */
export const DEAD_INPUT_RMS_THRESHOLD = 1e-5

/** True when a chunk carries enough level to prove the stream is alive. */
export function chunkCarriesSignal(rms: number): boolean {
  return rms > DEAD_INPUT_RMS_THRESHOLD
}
