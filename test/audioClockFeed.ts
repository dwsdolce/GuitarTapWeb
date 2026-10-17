// @parity tooling/audio-clock-feed
//
// Advances the analyzer's AUDIO clock the way audio does: chunk by chunk through the production entry
// point, `processAudioFrame(samples, levelDb, audioTime)`. The tap lifecycle's rests, the FLC hold and
// the capture window run on that clock, so a test feeds the audio a delay covers rather than sleeping
// through it — the same path playback and the microphone take. And a wall clock a test moves by hand,
// for the capture's safety timeout, which runs on the wall clock.
//
// Mirrors Swift GuitarTapTests/AudioClockFeed.swift and Python tests/audio_clock_feed.py.
import type { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { WallClock } from '../src/state/wallClock'

/** One chunk's duration at the app's 1024-sample chunk and 48 kHz. */
export const AUDIO_FEED_CHUNK_SECONDS = 1024 / 48000

const QUIET_CHUNK = new Float32Array(1024)

/** Feeds quiet chunks until the analyzer's audio clock has advanced exactly `seconds` past where it
 *  is, so an action due at that moment runs on the last chunk. The level is below every detection
 *  threshold, so feeding it cannot itself start a tap. */
export function advanceAudio(sut: TapToneAnalyzer, seconds: number, levelDb = -90): void {
  const target = sut.lastAudioTime + seconds
  let t = sut.lastAudioTime
  while (t < target) {
    t = Math.min(t + AUDIO_FEED_CHUNK_SECONDS, target)
    sut.processAudioFrame(QUIET_CHUNK, levelDb, t)
  }
}

/** A wall clock a test moves by hand: time stands still until `advance`, which runs each action as its
 *  time comes, in time order — including one an action schedules within the advance. */
export class ManualWallClock implements WallClock {
  private time = 0
  private pending: { due: number; order: number; action: () => void }[] = []
  private scheduled = 0

  now(): number {
    return this.time
  }

  after(seconds: number, action: () => void): void {
    this.pending.push({ due: this.time + seconds, order: ++this.scheduled, action })
  }

  /** Moves the time on by `seconds`, running every action due by then. */
  advance(seconds: number): void {
    const target = this.time + seconds
    for (;;) {
      const due = this.pending.filter((p) => p.due <= target)
      if (due.length === 0) break
      const next = due.reduce((m, p) => (p.due < m.due || (p.due === m.due && p.order < m.order) ? p : m))
      this.pending = this.pending.filter((p) => p !== next)
      this.time = next.due
      next.action()
    }
    this.time = target
  }
}
