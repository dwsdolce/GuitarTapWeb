// Equal-temperament pitch — mirrors Swift Pitch.swift / Python pitch.py.
// @parity dsp/pitch tests=test/pitch

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * Equal-temperament pitch analysis — note detection, cents deviation, and
 * frequency conversion. Mirrors Swift `Pitch.swift` and Python `pitch.py`.
 *
 * 12-tone equal temperament (12-TET): semitones are equal-ratio intervals of
 * `2^(1/12)`, anchored at A4 (default 440 Hz). Per-peak results are stored as
 * pitchNote / pitchCents / pitchFrequency.
 *
 * Algorithm:
 * 1. C0 anchor — C0 is 4 octaves + 9 semitones below A4: `f_C0 = f_A4 · 2^(−4.75)`.
 * 2. Half-steps from C0 — `h = round(12 · log2(f / f_C0))`.
 * 3. Note and octave — `octave = h / 12`, `note = h mod 12` (0 = C … 11 = B).
 * 4. Frequency of a note — `f(note, octave) = f_C0 · 2^(note/12) · 2^octave`.
 * 5. Cents deviation — `cents = 1200 · log2(f_measured / f_nearest)`.
 *
 * @see https://www.johndcook.com/blog/2016/02/10/musical-pitch-notation/
 */
export class Pitch {
  /** Reference frequency of A4, in Hz (concert pitch 440; e.g. 432 / 415 for alternate tunings). */
  readonly a4: number
  /** Derived C0 = `a4 · 2^(−4.75)` — the base reference for all note-frequency math. */
  readonly c0: number

  constructor(a4 = 440) {
    this.a4 = a4
    this.c0 = a4 * 2 ** -4.75 // 4 octaves + 9 semitones below A4
  }

  /**
   * Nearest equal-temperament note as `(note 0–11, octave)`. Rounding snaps to the
   * nearest semitone; floor div/mod keep negative octaves correct (matches Python).
   * @param frequency Frequency to analyse, in Hz.
   * @returns `{ note, octave }` where note 0 = C, 1 = C#, … 11 = B.
   */
  pitch(frequency: number): { note: number; octave: number } {
    const halfSteps = Math.round(12 * Math.log2(frequency / this.c0))
    const octave = Math.floor(halfSteps / 12)
    const note = ((halfSteps % 12) + 12) % 12
    return { note, octave }
  }

  /**
   * Exact frequency of a note/octave: `c0 · 2^(note/12) · 2^octave`.
   * @param note Chromatic note index (0 = C … 11 = B).
   * @param octave Octave number (the middle-C octave is 4).
   * @returns Frequency in Hz.
   */
  freq(note: number, octave: number): number {
    return 2 ** (note / 12) * this.c0 * 2 ** octave
  }

  /**
   * Name of the nearest equal-temperament note, e.g. `"A4"` or `"C#3"`.
   * @param frequency Frequency to analyse, in Hz.
   * @returns The note-name-plus-octave string.
   */
  note(frequency: number): string {
    const { note, octave } = this.pitch(frequency)
    return `${NOTE_NAMES[note]}${octave}`
  }

  /**
   * Frequency (Hz) of the nearest note — useful for the Hz deviation from the ideal note.
   * @param frequency Frequency to analyse, in Hz.
   * @returns The exact frequency of the nearest note, in Hz.
   */
  freq0(frequency: number): number {
    const { note, octave } = this.pitch(frequency)
    return this.freq(note, octave)
  }

  /**
   * Signed cents offset from the nearest note: `1200 · log2(f / f_nearest)`.
   * Negative = flat, positive = sharp; ±50 cents spans one semitone.
   * @param frequency Measured frequency, in Hz.
   * @returns Cents offset from the nearest equal-temperament pitch.
   */
  cents(frequency: number): number {
    const { note, octave } = this.pitch(frequency)
    return 1200 * Math.log2(frequency / this.freq(note, octave))
  }
}