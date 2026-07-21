// THROWAWAY — proves the replayed spectrum is byte-identical with/without the findPeaks
// duplicate fix (spectrum is produced upstream of findPeaks). @parity none
import Testing
import Foundation
@testable import GuitarTap

private final class FPAnchor {}

@Suite("Spectrum fingerprint (proof)")
struct PeakSpectrumFingerprintTests {
    @Test func fingerprint() throws {
        let b = Bundle(for: FPAnchor.self)
        let wav = try #require(b.url(forResource: "dws-2024-umik-1-swift-mac-1784225155", withExtension: "wav"))
        let cal = b.url(forResource: "7108913", withExtension: "txt")
        let sut = TapToneAnalyzer.forTesting()
        sut.peakMinThreshold = -78; sut.tapDetectionThreshold = -49.038
        try sut.playFileForTesting(url: wav, measurementType: .generic, numberOfTaps: 1, calibrationURL: cal)
        let r = sut.frozenMagnitudes
        let sum = r.reduce(Double(0)) { $0 + Double($1) }
        print(String(format: "FINGERPRINT len=%d sum=%.12e b1000=%.15f b8000=%.15f b19181=%.15f",
                     r.count, sum, Double(r[1365]), Double(r[10923]), Double(r[26189])))
        #expect(!r.isEmpty)
    }
}