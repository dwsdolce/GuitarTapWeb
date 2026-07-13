#!/usr/bin/env python3
"""Generate the OUT-4 noisy plate fixture — the test that separates the two detection models.

    python3 tooling/make-noisy-fixture.py

Writes `test/fixtures/plate-umik-1-noisy-52.wav`: the clean plate session WAV with broadband noise
mixed in to lift its noise floor from -77 dBFS to **-52 dBFS**. Deterministic (fixed seed), so every
repo can regenerate byte-identical audio — the fixture is committed, this script documents its
provenance and lets it be rebuilt.

WHY THIS FIXTURE EXISTS
-----------------------
Swift/Python detect material taps against an EMA-tracked noise floor; the web uses a fixed absolute
dBFS threshold. The relative rule reduces to:

    rising = max(tapDetectionThreshold, noiseFloor + 10 dB)

so the two models are the SAME FUNCTION until the noise floor climbs within 10 dB of the threshold.
Every existing fixture sits at -64..-69 dBFS, far below that — which is why no test has ever been able
to tell the models apart. This fixture is the first one that can.

WHY -52 dBFS
------------
The plate fixture's tap-detection threshold is -53.34 dBFS. At a -52 floor the background sits ABOVE
the threshold, so the ABSOLUTE detector saturates: `above` is permanently true, `prevAbove` never
falls, `consecutive` never seeds — it captures NOTHING. The RELATIVE detector floats its threshold to
floor+10 = -42 and still catches every tap (they peak at -24..-27 dBFS chunk-RMS).

Verified against the real engines:
    web (absolute):        0 / 3 phases      <- fails, as intended
    Python (relative):     3 / 3 phases      <- once playback runs the live path (see the spec)
    clean control:         3 / 3 on both

WHY PLATE, NOT BRACE
--------------------
Brace is the realistic low-amplitude case, but its tap decays too fast: it clears -52 dBFS for only ONE
chunk, and CONFIRM_CHUNKS=2 then pins the rising threshold at <= -52.5, colliding with the divergence
boundary. Its usable noise window is 0.8 dB — not a fixture, a coincidence. Plate's is 17.3 dB.
(REG-B1 today passes with exactly two chunks of margin. It is already on the edge.)

Do NOT raise the noise further: at a -48 floor the relative model breaks too and the test goes vacuous.

Full analysis: Development/OUT-4-DETECTION-SPEC.md
"""
from __future__ import annotations

import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "test", "fixtures", "plate-umik-1-swift-mac-1778816330.wav")
DST = os.path.join(ROOT, "test", "fixtures", "plate-umik-1-noisy-52.wav")

TARGET_FLOOR_DBFS = -52.0
SEED = 20260713           # fixed -> byte-identical output on every machine
CHUNK = 1024              # the engine's audio chunk (21.3 ms @ 48 kHz)


def main() -> int:
    if not os.path.exists(SRC):
        print(f"source fixture not found: {SRC}", file=sys.stderr)
        return 1

    x, sr = sf.read(SRC, dtype="float64", always_2d=True)
    rng = np.random.default_rng(SEED)
    noise = rng.normal(0.0, 1.0, x.shape[0])
    noise *= 10 ** (TARGET_FLOOR_DBFS / 20) / np.sqrt((noise ** 2).mean())  # exact target RMS
    y = x + noise[:, None]

    peak = float(np.abs(y).max())
    if peak >= 0.99:
        print(f"ERROR: mix clips ({20*np.log10(peak):.1f} dBFS)", file=sys.stderr)
        return 1

    sf.write(DST, y, sr, subtype="FLOAT")

    # Verify what we wrote, in the real detection domain (per-chunk RMS dBFS).
    z, _ = sf.read(DST, dtype="float64", always_2d=True)
    z = z[:, 0]
    m = len(z) // CHUNK * CHUNK
    db = 20 * np.log10(np.maximum(np.sqrt((z[:m].reshape(-1, CHUNK) ** 2).mean(axis=1)), 1e-10))
    floor = float(np.percentile(db, 20))

    print(f"wrote {os.path.relpath(DST, ROOT)}")
    print(f"  duration      {len(z)/sr:.1f} s")
    print(f"  noise floor   {floor:.1f} dBFS   (target {TARGET_FLOOR_DBFS})")
    print(f"  peak          {db.max():.1f} dBFS")
    print(f"  threshold     -53.34 dBFS -> background sits {floor + 53.34:+.2f} dB above it (saturates absolute)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())