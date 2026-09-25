// @parity tooling/audio-clock-feed
//
// Advances the analyzer's AUDIO clock the way audio does: chunk by chunk through the production entry
// point, `processAudioFrame(samples, levelDb, audioTime)`. The tap lifecycle's rests, the FLC hold and
// the capture window run on that clock (#19), so a test that used to sleep through a wall-clock delay
// now feeds the audio that delay covers — the same path playback and the microphone take.
//
// Mirrors Swift GuitarTapTests/AudioClockFeed.swift and Python tests/audio_clock_feed.py.
import type { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

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
