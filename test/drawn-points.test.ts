// @parity none — the web's canvas (and Swift Charts) are given only the points near the range, so the
// edge segments must be included explicitly; Python's pyqtgraph is given the whole spectrum and clips it
// itself, so it has no such selection to test.
//
// The spectrum points the chart draws for its range: every point inside it plus the one just beyond
// each edge, so the line reaches both edges and the plot area clips it. Mirrors Swift DrawnPointsTests.
import { describe, it, expect } from 'vitest'
import { drawnIndices } from '../src/presentation/displayRange'

describe('drawn points', () => {
  const frequencies = [10, 20, 30, 40, 50]
  it('includes the point just beyond each edge', () => {
    expect(drawnIndices(frequencies, 25, 35)).toEqual([1, 4])
  })
  it('a range between two points draws the segment across it', () => {
    expect(drawnIndices(frequencies, 31, 39)).toEqual([2, 4])
  })
  it('a range wider than the spectrum draws every point', () => {
    expect(drawnIndices(frequencies, 5, 100)).toEqual([0, 5])
  })
})
