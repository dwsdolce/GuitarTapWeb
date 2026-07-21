//
//  PeakPlaybackReportTests.swift
//  GuitarTapTests
//
//  THROWAWAY diagnostic (not a suite addition — see the run-review-automation discussion).
//  Replays every Swift-captured guitar WAV through the FULL pipeline with the calibration named
//  in its own .guitartap, and reports the computed analysis vs the saved winners. This is the
//  automated form of a run-review across the corpus.
//
//  Delete along with the copied WAVs + ref_winners.json before committing.
//
// @parity none

import Testing
import Foundation
@testable import GuitarTap

private struct Winner: Decodable { let f: Double; let m: Double }
private struct Ref: Decodable {
    let cal: String?
    let taps: Int
    let peakMin: Double
    let tapThr: Double
    let winners: [String: Winner]
    let savedPeaks: Int
}
private final class BundleAnchor {}

@Suite("Peak playback report — full Swift corpus")
struct PeakPlaybackReportTests {

    // The six Swift-captured guitar files (mac / iPad / iPhone, single + 3-tap).
    static let stems = [
        "dws-2024-umik-1-swift-mac-1784225155",
        "dws-2024-umik-1-3-tap-swift-mac-1784227758",
        "dws-2024-umik-1-swift-ipad-1784313066",
        "dws-2024-umik-1-3-tap-swift-ipad-1784313182",
        "dws-2024-umik-1-swift-iphone-1784498431",
        "dws-2024-umik--3-tap-swift-iphone-1784498523",
    ]

    private func refs() throws -> [String: Ref] {
        let url = try #require(Bundle(for: BundleAnchor.self).url(forResource: "ref_winners", withExtension: "json"))
        return try JSONDecoder().decode([String: Ref].self, from: try Data(contentsOf: url))
    }

    @Test(arguments: stems)
    func replayReproducesSavedAnalysis(_ stem: String) throws {
        let r = try #require(try refs()[stem], "no reference for \(stem)")
        let bundle = Bundle(for: BundleAnchor.self)
        guard let wav = bundle.url(forResource: stem, withExtension: "wav") else {
            Issue.record("\(stem).wav not in bundle"); return
        }
        let calURL = r.cal != nil ? bundle.url(forResource: "7108913", withExtension: "txt") : nil

        let sut = TapToneAnalyzer.forTesting()
        sut.peakMinThreshold = Float(r.peakMin)
        sut.tapDetectionThreshold = Float(r.tapThr)
        try sut.playFileForTesting(url: wav, measurementType: .generic, numberOfTaps: r.taps, calibrationURL: calURL)
        #expect(sut.isMeasurementComplete, "\(stem): pipeline did not complete")

        let peaks = sut.currentPeaks.sorted { $0.frequency < $1.frequency }
        var dupes: [String] = []
        for i in peaks.indices { for j in peaks.indices where j > i {
            if abs(peaks[i].frequency - peaks[j].frequency) < TapToneAnalyzer.peakProximityHz {
                dupes.append(String(format: "%.3f", peaks[i].frequency))
            }
        } }

        print("╔══ \(stem)  [Swift, cal=\(r.cal ?? "none"), taps=\(r.taps)] ══")
        print("║ replay peaks: \(peaks.count)   saved: \(r.savedPeaks)   duplicates: \(dupes.isEmpty ? "NONE ✓" : dupes.joined(separator: ", "))")
        func check(_ name: String, _ mode: GuitarMode) {
            let p = sut.getPeak(for: mode)
            guard let w = r.winners[name.lowercased()] else {
                print("║ \(name): saved none   replay \(p.map { String(format: "%.2f Hz", $0.frequency) } ?? "none")")
                return
            }
            guard let p = p else { print("║ \(name): MISSING in replay (saved \(w.f) Hz)"); Issue.record("\(stem) \(name) missing"); return }
            let df = Double(p.frequency) - w.f, dm = Double(p.magnitude) - w.m
            print(String(format: "║ %-4@ replay %8.3f %7.2f   saved %8.3f %7.2f   Δ %+5.2fHz %+5.2fdB",
                         name as NSString, p.frequency, p.magnitude, w.f, w.m, df, dm))
            #expect(abs(df) < 1.0 && abs(dm) < 1.0, "\(stem) \(name) off tolerance: Δ\(df)Hz \(dm)dB")
        }
        check("Air", .air); check("Top", .top); check("Back", .back)
        print("╚" + String(repeating: "═", count: 40))
        #expect(dupes.isEmpty, "\(stem): duplicate peaks \(dupes)")
    }
}