"""Corpus playback report (Python engine) — replay every python-captured guitar WAV with
the calibration named in its own measurement file, report winners vs saved + duplicate check."""
import json, sys
sys.path.insert(0, "/Users/dws/src/guitar_tap/src"); sys.path.insert(0, "/Users/dws/src/guitar_tap/src/guitar_tap")
from models.tap_tone_analyzer import TapToneAnalyzer
from models.measurement_type import MeasurementType
from models.guitar_mode import GuitarMode

D = "/Users/dws/src/GuitarTap/Tests/All Platforms"
CAL = "/Users/dws/src/GuitarTap/Tests/7108913.txt"
ref = json.load(open("/private/tmp/claude-501/-Users-dws-src-GuitarTapWeb/0cf0989c-33d7-43de-8dfd-b5bc591c0172/scratchpad/ref_winners.json"))
FILES = [s for s in ref if "python" in s]
PROX = 2.0

for stem in sorted(FILES):
    r = ref[stem]
    a = TapToneAnalyzer.for_testing()
    a.peak_min_threshold = r["peakMin"]; a.tap_detection_threshold = r["tapThr"]
    cal_path = CAL if r["cal"] else None
    a.play_file_for_testing(f"{D}/{stem}.wav", MeasurementType.GENERIC, r["taps"], calibration_path=cal_path)
    peaks = sorted(a.current_peaks, key=lambda p: p.frequency)
    dupes = [f"{peaks[i].frequency:.3f}" for i in range(len(peaks)) for j in range(i+1, len(peaks)) if abs(peaks[i].frequency-peaks[j].frequency) < PROX]
    print(f"╔══ {stem}  [Python, cal={r['cal']}, taps={r['taps']}] ══")
    print(f"║ replay peaks: {len(peaks)}   saved: {r['savedPeaks']}   duplicates: {'NONE ✓' if not dupes else ', '.join(dupes)}")
    for name, mode in [("Air", GuitarMode.AIR), ("Top", GuitarMode.TOP), ("Back", GuitarMode.BACK)]:
        p = a.get_peak(mode); w = r["winners"].get(name.lower())
        if w is None: print(f"║ {name}: saved none  replay {'none' if p is None else f'{p.frequency:.2f}Hz'}"); continue
        if p is None: print(f"║ {name}: MISSING in replay (saved {w['f']} Hz)"); continue
        print(f"║ {name:<4} replay {p.frequency:8.3f} {p.magnitude:7.2f}   saved {w['f']:8.3f} {w['m']:7.2f}   Δ {p.frequency-w['f']:+5.2f}Hz {p.magnitude-w['m']:+5.2f}dB")
    print("╚" + "═"*40)
