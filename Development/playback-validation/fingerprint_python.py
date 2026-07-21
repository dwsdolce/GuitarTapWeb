# Fingerprint the replayed frozen spectrum (Python). Independent of findPeaks.
import sys
sys.path.insert(0,"/Users/dws/src/guitar_tap/src"); sys.path.insert(0,"/Users/dws/src/guitar_tap/src/guitar_tap")
from models.tap_tone_analyzer import TapToneAnalyzer
from models.measurement_type import MeasurementType
D="/Users/dws/src/GuitarTap/Tests/All Platforms"; STEM="dws-2024-umik-1-python-mac-1784225140"
import json
m=json.load(open(f"{D}/{STEM}.guitartap"))[0]
a=TapToneAnalyzer.for_testing()
a.peak_min_threshold=m["peakMinThreshold"]; a.tap_detection_threshold=m["tapDetectionThreshold"]
a.play_file_for_testing(f"{D}/{STEM}.wav", MeasurementType.GENERIC, 1, calibration_path="/Users/dws/src/GuitarTap/Tests/7108913.txt")
r=list(a.frozen_magnitudes)
print(f"len={len(r)} sum={sum(r):.12e} b1000={r[1365]!r} b8000={r[10923]!r} b19181={r[26189]!r}")
