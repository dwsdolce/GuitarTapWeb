// The spectra the shared case files describe — 'gaussians' (each peak 'peakDB' − (f − peakHz)² / (2σ²),
// σ = halfWidthHz / 2.355, floored at noiseFloor, the element-wise maximum of the peaks), 'flat' (one value)
// or 'triangle' (peakDB − slopeDBPerBin × |i − peakBin|) — with bins binSpacingHz apart, or at
// i × (sampleRate / 2) / (binCount − 1). Mirrors Swift PeakFindingTests.spectrum and Python
// tests/test_peak_finding._spectrum.

type Row = Record<string, unknown>

export function spectrum(s: Row): { mags: number[]; freqs: number[] } {
  const bins = s.binCount as number
  const spacing = (s.binSpacingHz as number | undefined) ?? (s.sampleRate as number) / 2 / (bins - 1)
  const freqs = Array.from({ length: bins }, (_, i) => i * spacing)
  if (s.kind === 'flat') return { mags: new Array<number>(bins).fill(s.value as number), freqs }
  if (s.kind === 'triangle') {
    const peakBin = s.peakBin as number
    return { mags: freqs.map((_, i) => (s.peakDB as number) - (s.slopeDBPerBin as number) * Math.abs(i - peakBin)), freqs }
  }
  const floor = s.noiseFloor as number
  const mags = new Array<number>(bins).fill(floor)
  for (const p of s.peaks as Row[]) {
    const sigma = (p.halfWidthHz as number) / 2.355
    for (let i = 0; i < bins; i++) {
      const d = freqs[i]! - (p.peakHz as number)
      mags[i] = Math.max(mags[i]!, Math.max(floor, (p.peakDB as number) + -(d * d) / (2 * sigma * sigma)))
    }
  }
  return { mags, freqs }
}
