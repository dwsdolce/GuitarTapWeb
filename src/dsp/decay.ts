// Ring-out (decay) time — a port of Swift TapToneAnalyzer+DecayTracking / Python
// tap_tone_analyzer_decay_tracking. After a tap, the broadband level (dBFS) is sampled per audio
// chunk; the ring-out time is the elapsed seconds from the post-tap PEAK down to peak − 15 dB.
//
// Cadence/metric match the native apps: Swift feeds `inputLevelDB` (= 20·log10(rms) per 1024-sample
// buffer, ~43 Hz) into trackDecayFast; the web feeds the same 20·log10(rms) per 1024-sample chunk
// (~47 Hz @ 48 kHz). The web's clock is AUDIO time (sample-count / rate) — deterministic, correct
// under file playback, and unit-testable; under live mic it equals wall-clock. The PEAK reference
// (the value passed to `start`) is the engine's peak-HELD recent level (Swift recentPeakLevelDB,
// 2.0 s hold), NOT the instantaneous tap-confirm level — tap detection lags the strike by ~2 chunks,
// so the true peak would otherwise be missed and the −15 dB target under-stated. Guitar only (native
// skips material). decayTime is stored on the measurement and read at save (Swift currentDecayTime).
// @parity dsp/decay tests=test/decay-tracking

/** dB drop that defines "decayed" — Swift/Python `decayThreshold` (15 dB). */
export const DECAY_THRESHOLD_DB = 15.0
const TRACK_SECONDS = 3.0 // stop appending 3 s after the tap (Swift's 3 s timer)
const WINDOW_SECONDS = 5.0 // trim history older than this
const MIN_SAMPLES = 10 // don't measure until enough points (Swift minimumDecayHistoryCount)

export interface DecaySample {
  /** Audio time, seconds. */
  t: number
  /** Broadband level, dBFS. */
  db: number
}

/**
 * Ring-out time = post-tap PEAK → first later sample below (peak − threshold), in seconds.
 * Returns null if the level never drops by `threshold` within `history`. Pure function — mirrors
 * Swift measureDecayTime / Python measure_decay_time.
 */
export function measureDecayTime(history: DecaySample[], tapTime: number, threshold = DECAY_THRESHOLD_DB): number | null {
  let peak: DecaySample | null = null
  for (const e of history) {
    if (e.t >= tapTime && (peak === null || e.db > peak.db)) peak = e
  }
  if (peak === null) return null
  const target = peak.db - threshold
  for (const e of history) {
    if (e.t >= tapTime && e.t > peak.t && e.db < target) return e.t - peak.t
  }
  return null
}

/** Stateful tracker fed per audio chunk. The engine owns the audio clock + supplies the level. */
export class DecayTracker {
  private history: DecaySample[] = []
  private tracking = false
  private tapTime = 0
  /** Latest measured ring-out time (s), or null until the level has crossed peak − threshold. */
  decayTime: number | null = null

  /** A tap was detected at audio time `t` (s) with level `peakDb` — begin a fresh decay window. */
  start(t: number, peakDb: number): void {
    this.history = [{ t, db: peakDb }]
    this.tapTime = t
    this.decayTime = null
    this.tracking = true
  }

  /** Feed the current audio time + broadband level. No-op unless tracking; auto-stops after 3 s. */
  track(t: number, db: number): void {
    if (!this.tracking) return
    if (t - this.tapTime >= TRACK_SECONDS) {
      this.tracking = false
      return
    }
    this.history.push({ t, db })
    this.history = this.history.filter((e) => t - e.t < WINDOW_SECONDS)
    if (this.history.length > MIN_SAMPLES) this.decayTime = measureDecayTime(this.history, this.tapTime)
  }

  /** Clear all state (New Tap / disarm) so a stale ring-out isn't carried into a fresh measurement. */
  reset(): void {
    this.history = []
    this.tracking = false
    this.decayTime = null
  }
}