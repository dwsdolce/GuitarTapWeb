// @parity test/frequency-format
//
// A frequency for display (one decimal, kHz from 1000 Hz) and the range line above the guitar peak
// list built from it, and a sample rate or bandwidth in whole hertz grouped by the locale. Mirrors Swift
// FrequencyFormatTests.
import { describe, it, expect } from 'vitest'
import { displayRangeLabel, formattedAsFrequency, formattedAsWholeHertz } from '../src/presentation/frequencyFormat'

describe('frequency format', () => {
  it('below 1 kHz is Hz with one decimal', () => {
    expect(formattedAsFrequency(440)).toBe('440.0 Hz')
    expect(formattedAsFrequency(25.37)).toBe('25.4 Hz')
    expect(formattedAsFrequency(999.9)).toBe('999.9 Hz')
  })

  it('from 1 kHz is kHz with one decimal', () => {
    expect(formattedAsFrequency(1000)).toBe('1.0 kHz')
    expect(formattedAsFrequency(2500)).toBe('2.5 kHz')
  })

  it('the range label shows both bounds', () => {
    expect(displayRangeLabel(25, 45)).toBe('Showing 25.0 Hz - 45.0 Hz')
  })

  it("the range label keeps a zoomed range's fraction", () => {
    expect(displayRangeLabel(25.37, 44.81)).toBe('Showing 25.4 Hz - 44.8 Hz')
  })

  it('the range label crossing 1 kHz mixes units', () => {
    expect(displayRangeLabel(800, 1200)).toBe('Showing 800.0 Hz - 1.2 kHz')
  })

  it('whole hertz groups by the locale', () => {
    expect(formattedAsWholeHertz(48000, 'en-US')).toBe('48,000 Hz')
    expect(formattedAsWholeHertz(22050, 'en-US')).toBe('22,050 Hz')
    expect(formattedAsWholeHertz(48000, 'de-DE')).toBe('48.000 Hz')
  })

  it('whole hertz rounds to the nearest hertz', () => {
    expect(formattedAsWholeHertz(44100.4, 'en-US')).toBe('44,100 Hz')
  })
})
