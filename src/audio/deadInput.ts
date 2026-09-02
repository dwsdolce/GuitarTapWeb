// @parity dead-input — mirrors Swift GuitarTap/Models/DeadInput.swift and Python
// models/dead_input.py.
//
// The audio-liveness DECISIONS live here, apart from the engine, so they can be tested
// without an AudioContext. The behaviour is otherwise gated on a timer and a live
// MediaStream, so every rule below would only be verifiable by making real hardware
// fail. The defect found on 2026-09-01 — a watchdog that stopped watching after giving
// up, leaving the app deaf until reload even after the user fixed the microphone — is a
// single row of the truth table here.
//
// The threshold is a field calibration, not a derivation — see hub
// docs/AUDIO-WATCHDOG-SILENT-STREAM.md for the incidents the numbers come from.

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

/** Seconds (ms) with NO chunks arriving before the I/O counts as wedged. */
export const BUFFER_DELIVERY_TIMEOUT_MS = 2500

/**
 * Milliseconds with chunks but NO signal before the input counts as dead.
 *
 * Much longer than the delivery timeout: this one infers from content, a recorded
 * incident persisted for minutes, and there is real cost in fighting a user who has
 * legitimately muted their input.
 */
export const DEAD_INPUT_DWELL_MS = 15000

/** What a single watchdog tick concludes about the input. */
export type WatchdogDecision =
  /** Signal is flowing: clear any warning, reset the attempt streak and the latch. */
  | 'healthy'
  /** Chunks stopped arriving at all — recover. */
  | 'starved'
  /** Chunks arriving but carrying nothing — warn and recover. */
  | 'deadInput'
  /** Still dead and out of attempts: keep warning, attempt nothing. The tick must keep
   *  running so the warning clears the moment signal returns. */
  | 'deadInputExhausted'

/**
 * Decide what a watchdog tick should do.
 *
 * @param now                Monotonic now (performance.now()).
 * @param lastChunkTime      Stamp of the last chunk to ARRIVE, whatever it held.
 * @param lastSignalTime     Stamp of the last chunk to carry SIGNAL.
 * @param recoveryExhausted  Whether re-acquire attempts have been used up.
 * @param silenceMs          Ms with no chunks before the I/O counts as wedged.
 * @param deadInputMs        Ms with no signal before the input counts as dead.
 */
export function watchdogDecision(
  now: number,
  lastChunkTime: number,
  lastSignalTime: number,
  recoveryExhausted: boolean,
  silenceMs: number = BUFFER_DELIVERY_TIMEOUT_MS,
  deadInputMs: number = DEAD_INPUT_DWELL_MS,
): WatchdogDecision {
  const dead = now - lastSignalTime > deadInputMs

  // Out of attempts: never re-acquire, but still report the state so the warning holds
  // while it is true and clears the instant signal returns.
  if (recoveryExhausted) return dead ? 'deadInputExhausted' : 'healthy'

  // Starvation first: no chunks at all is the more fundamental failure, and a starved
  // stream is trivially also signal-less.
  if (now - lastChunkTime > silenceMs) return 'starved'
  return dead ? 'deadInput' : 'healthy'
}
