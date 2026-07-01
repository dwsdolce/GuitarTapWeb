// Equal-temperament pitch — note name, cents offset, nearest-note frequency.
// Ported from Pitch.swift / pitch.py: 12-TET anchored at A4 (default 440 Hz),
// C0 = A4·2^(−4.75). All in float64. Stored per peak as pitchNote/pitchCents/
// pitchFrequency. See INVENTORY.md "Pitch".
// @parity dsp/pitch tests=test/pitch

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export class Pitch {
  readonly a4: number
  readonly c0: number

  constructor(a4 = 440) {
    this.a4 = a4
    this.c0 = a4 * 2 ** -4.75 // 4 octaves + 9 semitones below A4
  }

  /** Nearest semitone as (note 0–11, octave). Uses floor div/mod (matches Python). */
  pitch(frequency: number): { note: number; octave: number } {
    const halfSteps = Math.round(12 * Math.log2(frequency / this.c0))
    const octave = Math.floor(halfSteps / 12)
    const note = ((halfSteps % 12) + 12) % 12
    return { note, octave }
  }

  /** Exact frequency for a note/octave: c0·2^(note/12)·2^octave. */
  freq(note: number, octave: number): number {
    return 2 ** (note / 12) * this.c0 * 2 ** octave
  }

  /** Nearest note name, e.g. "A4", "C#3". */
  note(frequency: number): string {
    const { note, octave } = this.pitch(frequency)
    return `${NOTE_NAMES[note]}${octave}`
  }

  /** Frequency (Hz) of the nearest note. */
  freq0(frequency: number): number {
    const { note, octave } = this.pitch(frequency)
    return this.freq(note, octave)
  }

  /** Signed cents from the nearest note: 1200·log2(f / f_nearest). */
  cents(frequency: number): number {
    const { note, octave } = this.pitch(frequency)
    return 1200 * Math.log2(frequency / this.freq(note, octave))
  }
}
