// @parity model/wall-clock tests=test/audio-clock-timers
/**
 * The wall clock the analyzer reads the time from and schedules on. The app uses the system's; a test
 * passes one it moves by hand.
 *
 * The analyzer's timers mostly run on the AUDIO clock, which advances with the audio processed. The
 * capture's safety timeout cannot: it exists for when the audio stops, and the audio clock stops with
 * it. It runs on this clock instead. Mirrors Swift `WallClock` (Models/WallClock.swift) and Python
 * `WallClock` (models/wall_clock.py).
 */
export interface WallClock {
  /** The current time, in seconds since an arbitrary fixed point. */
  now(): number
  /** Runs `action` `seconds` from now. */
  after(seconds: number, action: () => void): void
}

/** The system's wall clock: `performance.now()`, scheduled with `setTimeout`. */
export class SystemWallClock implements WallClock {
  now(): number {
    return performance.now() / 1000
  }

  after(seconds: number, action: () => void): void {
    setTimeout(action, seconds * 1000)
  }
}
