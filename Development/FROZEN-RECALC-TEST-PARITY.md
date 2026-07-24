# Python↔Swift test-fixture divergence — frozen-peak-recalc

**Status:** 📋 open (STATUS item 14). Found 2026-07-23 during the Phase 4a Python port.
**Scope:** Python vs Swift *test infrastructure*, not production code. Production DSP is equivalent.

## The finding

The `test/frozen-peak-recalc` `@parity` slug pairs Python's `test_frozen_peak_recalculation.py`
with Swift's `FrozenPeakRecalculationTests.swift`. The tests carry the same slug and cover the same
behaviours, but they **exercise those behaviours in different ways**:

| | Swift (`FrozenPeakRecalculationTests`) | Python (`test_frozen_peak_recalculation.py`) |
|---|---|---|
| Set up a frozen measurement | `freeze(sut, peaks:)` — **injects** a pre-computed `[ResonantPeak]`, bypassing detection | `_make_spectrum_with_peak` / `_add_tone` — builds a synthetic spectrum and runs **real `find_peaks`** |
| Real-spectrum fixture | `gaussianSpectrum` / `freezeOnRealSpectrum` — **added in Phase 4a**, used by exactly one test | `_make_spectrum_with_peak` — **pre-existing**, used across the PRA integration tests |

So Python's PRA tests (`test_PRA1…`, etc.) drive the detection pipeline where Swift's inject peaks.
They are twins in **name and slug**, not in **approach**.

## Why it matters

Two tests that assert the same behaviour in different ways do not prove equivalence — they can drift
independently, and a bug present on one platform can be invisible to the "equivalent" test on the
other. The paired-test discipline exists precisely to prevent that; a divergent pair quietly defeats
it.

## Why `--check` missed it

`gen_parity_map.py --check` verifies that a slug has a test on each platform (presence), **not** that
the paired tests are behaviourally equivalent. A slug can be green while its two tests diverge in
setup, fixture, or assertion shape. This is a known limitation, not a bug in the tooling — but it is
the reason the check a week before this finding passed while the divergence existed.

## How it happened

Divergence predates this work. Python built `_make_spectrum_with_peak` when its PRA
(`recalculate_frozen_peaks_if_needed`) integration tests were written — Python chose to exercise real
detection. Swift's frozen-recalc tests injected peaks via `freeze`. Swift only needed a real-spectrum
fixture for the one new Phase-4a test (`reanalyzePreservesStateOfPeaksHiddenByPeakMin`), where it
added `gaussianSpectrum`.

## Phase 4a decision (2026-07-23, user: "do (b)")

For the one new Phase-4a test, Python **mirrors** Swift's fixture: `_gaussian_spectrum` /
`_freeze_on_real_spectrum` were added to `test_frozen_peak_recalculation.py` as faithful snake-case
ports of `gaussianSpectrum` / `freezeOnRealSpectrum`, and
`test_reanalyze_preserves_state_of_peaks_hidden_by_peak_min` uses them — so at least this test is a
true twin. The broader PRA divergence is **logged here for reconciliation**, not fixed, to keep the
peak-lifecycle work moving.

## Reconciliation (when picked up)

1. Read Python's `test_frozen_peak_recalculation.py` against Swift's `FrozenPeakRecalculationTests.swift`
   test-for-test.
2. Where Swift injects peaks via `freeze`, Python should too (add a `freeze(sut, peaks)` equivalent
   and use it); where Swift detects via `gaussianSpectrum`, Python uses `_gaussian_spectrum` (already
   present). Decide, per test, which approach is canonical (Swift leads) and align Python to it.
3. Consider whether `_make_spectrum_with_peak` should be retired or kept for genuinely
   Python-specific detection tests that have no Swift twin (and if so, tag them `@parity none` or a
   Python-only slug so the pairing is honest).
4. Sweep the **other** shared slugs for the same false-twin shape — this was found by reading, not by
   tooling, so others may exist. A longer-term improvement: teach `--check` (or a companion check) to
   flag paired tests whose fixtures/approach diverge.

## Related
- STATUS item 2 (architectural-parity restructure) is **web-vs-native view layer** — a different
  concern; do not fold this into it.
- `PEAK-LIFECYCLE-PLAN-PYTHON.md` Phase 4a — where the mirrored fixture landed.