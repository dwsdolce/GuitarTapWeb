# Peak finding emits duplicate peaks — core defect, all three platforms

**Status: 🔴 OPEN — investigation complete, no code changed.**
_Opened 2026-07-19 (found during Step-8 re-test sweep, iPhone + iPad legs)._

This is **core code**. The rule for this item: **nothing is committed until the regression tests are
proven to fail on the current code for the expected reason, and proven to pass after the fix.**
Tests are written first and demonstrated failing before the fix exists, then demonstrated passing
after it — both directions, all three repos.

---

## 1. Symptom as reported

Loading `dws-2024-umik-1-swift-iphone-1784498431.guitartap` into Python (Mac **and** PC):

- The **graph** annotates Top 196.4 Hz and Back 239.2 Hz — correct.
- The **Analysis Results** table shows 196.4 starred, but **two identical 239.2 Hz rows**, neither
  starred, even though one of them is in `selectedPeakIDs`.

Loading `dws-2024-umik-1-swift-ipad-1784313066.guitartap` is worse: two identical **235.8 Hz** rows,
both labelled **Air** in the table while the graph annotates the same peak as **Back**.

---

## 2. Evidence — it is universal, not device-specific

Every guitar measurement in `GuitarTap/Tests/All Platforms/`, across all three platforms and four
devices, contains **exactly one duplicated peak, always in the 233–240 Hz band**:

| Fixture | peaks | duplicate |
|---|---|---|
| `dws-2024-umik--3-tap-swift-iphone-1784498523` | 7 | 234.58588 ×2 |
| `dws-2024-umik-1-3-tap-python-mac-1784227748` | 47 | 239.63255 ×2 |
| `dws-2024-umik-1-3-tap-swift-ipad-1784313182` | 26 | 233.01845 ×2 |
| `dws-2024-umik-1-3-tap-swift-mac-1784227758` | 47 | 239.62120 ×2 |
| `dws-2024-umik-1-3-tap-web-mac-1784227768` | 47 | 239.61887 ×2 |
| `dws-2024-umik-1-python-mac-1784225140` | 46 | 240.10553 ×2 |
| `dws-2024-umik-1-swift-ipad-1784313066` | 37 | 235.80417 ×2 |
| `dws-2024-umik-1-swift-iphone-1784498431` | 8 | 239.24443 ×2 |
| `dws-2024-umik-1-swift-mac-1784225155` | 50 | 240.10170 ×2 |
| `dws-2024-umik-1-web-mac-1784225174` | 49 | 240.10588 ×2 |

**No plate/brace file is affected** — material uses a different capture path.

The duplicated pair is bit-identical in every field except `id`:

```
239.24443 Hz  −55.915695 dB  Q 23.357143  BW 10.253906  "Back"  A#3 +45¢  ts 21:59:07
  id C5E74B3C-7E5E-4E54-9A8C-7312E5D9A6A7   ← in selectedPeakIDs
  id 378861BD-C08D-4DF2-AE19-03C6F25B587A   ← not
```

Same bin, same interpolated frequency, same magnitude, same timestamp. Two UUIDs.

---

## 3. Root cause

### 3a. The duplicate is minted in `findPeaks`

`TapToneAnalyzer+PeakAnalysis.swift` `findPeaks(...)` interleaves **detection** (positional, over
spectrum bins) with **classification** (identity-based, over peaks). Step 1 walks each mode range
low-to-high and, for every above-threshold local maximum, does:

```swift
let peak = makePeak(at: i, magnitudes: magnitudes, frequencies: frequencies)
// Add every above-threshold local maximum to the candidate pool
// so that non-strongest peaks within a mode range are still visible
// and selectable by the user.
allPeaks.append(peak)
```

`makePeak` mints a **fresh UUID** on every call. Where the Top and Back ranges overlap, the same bin
`i` is scanned by both mode passes, so `makePeak` is called **twice on the identical bin** and
produces two objects that differ only by `id`.

The `lastClaimedBinIdx` cursor advances only past each mode's *winner*, so a **non-strongest** shared
bin is re-scanned. That is why the duplicate is always in the Top/Back overlap band, and why it never
appears anywhere else in the spectrum.

### 3b. Step 3 fails to reconcile them

```swift
allPeaks = removeDuplicatePeaks(allPeaks)                                       // keeps UUID A
let guaranteedPeaks = removeDuplicatePeaks(Array(strongestPeakPerMode.values))  // holds UUID B
for peak in guaranteedPeaks { finalPeaks.append(peak); includedPeakIDs.insert(peak.id) }
let otherPeaks = allPeaks.filter { !includedPeakIDs.contains($0.id) }           // A ≠ B → A survives
```

Two lists deduplicated **independently**, then reconciled **by UUID**. `removeDuplicatePeaks` keeps
the *first* of an equal-magnitude pair, and the two lists do not agree on which twin that is. So the
mode winner (B) takes the guaranteed slot and the pool survivor (A) slips through the ID filter.
`finalPeaks` is never checked for frequency collisions.

`selectedPeakIDs` contains only the guaranteed twin — which is why one duplicate is selected and its
identical sibling is not.

### 3c. The same algorithm already exists, correct, elsewhere

`GuitarMode.classifyAll` implements exactly the intended algorithm — ordered modes, strongest peak
claimed per range, Back constrained strictly above the claimed Top frequency, unclaimed peaks
labelled by position with the overlap guard:

```swift
if mode == .back, let topFreq = claimedTopFrequency {
    effectiveLowerBound = max(range.lowerBound, topFreq + 1.0)
}
```

It operates on a **peak list**, where each peak is one object with one identity, and claims via
`claimedIDs`. It cannot produce a duplicate. `findPeaks` re-implements the same logic over **bins**,
substituting `strongestPeakPerMode` + `lastClaimedBinIdx` + a 2 Hz proximity check for `claimedIDs`
— and that second copy is the broken one.

### 3d. Python's results table then amplifies it

Independent, Python-only, and worth fixing regardless.

`PeaksModel.freq_index()` (`views/shared/peaks_model.py:296-301`) deliberately returns **−1** when a
frequency is not unique:

```python
index = np.where(self._data[:, 0] == freq)
if len(index[0]) == 1:
    return index[0][0]
return -1
```

The card list maps each card back to its model row **by frequency**
(`views/shared/peak_card_widget.py:537`) and never checks for −1:

```python
src_idx = self.model.index(int(self.model.freq_index(freq)), 0)
mode = self.model.mode_value(src_idx)
show = self.model.show_value(src_idx)
```

`show_value_bool` then evaluates `self._peaks[-1].id in self.selected_peak_ids` — Python's negative
indexing silently reads the **last peak in the list**. So the star, the mode label and the pitch on
both duplicate rows are taken from an unrelated peak. That is the "Back on the graph, Air in the
table" divergence: annotations iterate rows directly (`self._peaks[row].id`) and are correct; the
cards go through `freq_index` and are not.

Cards should carry the peak **`id`**, not the frequency. A sentinel that is also a valid Python index
is a trap independent of this bug.

---

## 4. The hard constraint

**The graph is correct today. The peak results the graph is built from must not change.**

The full peak list is deliberate — the Analysis Results table shows *all* in-range peaks; the graph
shows what the Visibility control selects. So the fix is **not** "return fewer peaks". `findPeaks`
keeps picking winners; it just has to do it without minting the same bin twice.

The acceptance bar is therefore a **golden-baseline diff**, not an eyeball:

> For every fixture spectrum, the peak set after the fix is **identical** to the peak set before it —
> same count minus one, same frequencies, magnitudes, Q, bandwidth, mode labels, same winners, same
> `selectedPeakIDs` — with the **only** difference being that the spurious twin is gone.

Any other delta is a regression and must be explained before it is accepted. Coverage is provably
unchanged by the fix (see section 7), so no delta beyond the removed twin is expected at all.

---

## 4a. Hard requirement — no per-mode-range scanning

**Decided by the user, 2026-07-19. Non-negotiable; any candidate fix that scans per mode range is
rejected regardless of whether it passes the tests.**

`findPeaks` must scan the spectrum **once**, in frequency order, end to end. It must not iterate mode
ranges, and it must not consult mode ranges at all while detecting.

The mode ranges **overlap** — that is the physical reality for every guitar type and especially for
Generic. A detector that iterates overlapping ranges visits some bins more than once and other bins
under two different labels, and every mechanism in the current code exists to paper over that:
`lastClaimedBinIdx`, `strongestPeakPerMode`, the 2 Hz proximity check, the guaranteed-slot vs pool
reconciliation, and two independent calls to `removeDuplicatePeaks`. None of them would be needed if
each bin were visited once.

This is very likely the root of the whole family of peak problems seen over successive passes on
this code, not just the duplicate. Detection is positional and belongs to the spectrum;
classification is identity-based and belongs to the peak list. Keeping them in one loop is what
couples them, and the coupling is the defect.

---

## 5. Existing test coverage — and why it never caught this

Parity group `test/peaks`:

| Swift | Python | Web |
|---|---|---|
| `GuitarTapTests/PeakFindingTests.swift` | `tests/test_peak_finding.py` | `test/peaks.test.ts` |

Covered today (three faithful mirrors): single pure tone · silence · clipped/flat · three distinct
tones · all below threshold · near-duplicate within 2 Hz removed / separated peaks kept · Q and −3 dB
bandwidth · spectrum averaging.

Every case is a **synthetic spectrum of isolated tones**, and every one exercises
`removeDuplicatePeaks` on a *single* list. Nothing in the group:

- puts two local maxima inside one mode range,
- puts anything in the Top/Back overlap zone,
- asserts the returned set contains no duplicate frequencies,
- exercises step 3's guaranteed-slot vs pool reconciliation,
- runs against a real captured spectrum.

The defect requires a **non-strongest** local max in the overlap band. No test has ever created one.

**And with the suite's helpers it could not** (found while authoring D2, 2026-07-19). `makeSpectrum`
defaults to **2048 bins**, a ~11.7 Hz bin width, so the +/-5-bin local-maximum window spans **+/-58 Hz**.
Two peaks 7 Hz apart — the real spacing of `231.877` and `239.244` in the field data — can never
both survive that window; the weaker one is suppressed as a non-maximum. Real captures use **32768
bins** (+/-3.7 Hz), where both are detected.

So the synthetic suite was **structurally incapable** of producing the input that triggers the bug,
regardless of which cases were written.

### Worse: Python's `test/peaks` does not test `find_peaks` at all

Found while authoring the Python side of step 3 (2026-07-19). The three files in the `test/peaks`
parity group do **not** all test the same thing:

| Platform | `test/peaks` file | Function actually exercised |
|---|---|---|
| Swift | `PeakFindingTests.swift` | `TapToneAnalyzer.findPeaks` — the real one |
| Web | `test/peaks.test.ts` | `findPeaks` from `src/dsp/peaks` — the real one |
| Python | `tests/test_peak_finding.py` | `peak_detection` from `realtime_fft_analyzer_fft_processing` — **a different function at a different layer** |

**No Python test calls `TapToneAnalyzer.find_peaks`.** `grep -rn "\.find_peaks(" tests/` returns
nothing; the two matches for `find_peaks` in `test_frozen_peak_recalculation.py` are docstrings. The
function may be reached indirectly through `recalculate_frozen_peaks_if_needed`, but nothing asserts
its peak-set output.

So the parity group is **mis-tagged**: it claims the same coverage on three platforms while Python
covers a lower-level helper. `PARITY-MAP.md` and `TEST-COVERAGE.md` overstate coverage accordingly.
The Python tests written in step 3 create this missing coverage for the first time — which is a
second reason the defect survived on that platform, independent of the bin-resolution issue above.

**Follow-up (do not bundle into the fix):** audit the rest of the `test/peaks` group, and spot-check
other groups, for the same layer mismatch. Same-named tests are not proof of same-behaviour tests. D2 sets `binCount: 32768` for exactly this reason, and that
line needs a comment forever or the next person will "simplify" it back to the default and silently
disarm the test.

---

## 6. Test plan — tests written first, proven failing, then proven passing

| ID | Test | Repos | Why it must fail on the current code |
|---|---|---|---|
| **D1** | **Uniqueness invariant** — no two returned peaks within `peakProximityHz` (2 Hz). Shared helper applied to every existing `test/peaks` case. | all 3 | the overlap fixture returns a 0 Hz-apart pair |
| **D2** | **Overlap-zone minimal repro** — Generic type; strong peak ~195 Hz + **two** local maxima ~232 / ~240 Hz. Assert: exactly one Top, one Back (stronger of the two), third unclaimed, no duplicates. | all 3 | the non-winner overlap peak is minted twice |
| **D3** | **Fixture regression** — replay each guitar `spectrumSnapshot` from `Tests/All Platforms` through `findPeaks`; assert no duplicates + expected winners. | all 3 | all 10 fixtures duplicate today |
| **D4** | **Winner invariants** — ≤1 peak per mode label; Back strictly above Top; `selectedPeakIDs` ⊆ returned IDs. | all 3 | pins the intended algorithm against drift |
| **D5** | **Golden baseline** — captured from current code (§4); asserts the post-fix set differs only by the removed twin. | all 3 | authored green against baseline, must stay green |
| **D6** | **Three-way parity** on the same fixture spectrum, 2–3 dp bar. | all 3 | guards the ports from diverging under the fix |
| **D7** | **Python `freq_index` / card identity** — duplicate frequencies must not corrupt star, mode label or pitch. | Python | −1 silently indexes the last peak |
| **D8** | **Heal on load** (section 7b) — a measurement containing duplicate peaks must load with them collapsed, and no dangling ids left in `selectedPeakIDs` / offsets / overrides. | all 3 | no heal exists yet |

D5 is the safety net for §4: it is authored **before** the fix, from current output, and is what
proves nothing else moved.

Each test is run against the **unfixed** code first and its failure inspected. A test that fails for
a reason other than the one predicted above means either the test is wrong or the diagnosis in §3 is
— and that must be resolved before the fix is written. A test authored after the fix proves only
that it passes, never that it would have caught the defect.

---

## 7. Fix design — shape settled, algorithm deferred to step 5

Shape follows directly from §4a — two separate passes, mode ranges consulted only in the second.

**Pass 1 — detection (positional, mode-blind).** One sweep over the spectrum in frequency order.
Every above-threshold local maximum, found once. **Each bin mints at most one peak object.** No mode
ranges, no claiming, no cursor, no dedup — duplicates become structurally impossible rather than
cleaned up after the fact. Output: peaks in ascending frequency order.

**Pass 2 — classification (identity-based).** Over the peak *list*, the `classifyAll` shape that is
already proven correct: walk modes in ascending range order, claim the strongest peak in each range,
constrain Back strictly above the claimed Top, label the remainder by position with the overlap
guard. Claiming is by peak identity, so an overlap peak can be claimed exactly once.

**Winners fall out of pass 2**, so `selectedPeakIDs` derives from the claims rather than from a
parallel structure built during detection.

Deletes: step 1's per-mode scan loop, step 2's outside-mode scan, both `removeDuplicatePeaks` calls,
`lastClaimedBinIdx`, `strongestPeakPerMode`, and the whole of step 3.

### Resolved — selection is already independent of `findPeaks` (traced 2026-07-19)

The §7 open question is closed. On **all three platforms**, auto-selection already takes a peak
*list*, runs the claiming classifier over it, and picks the strongest per mode. It never consults
`findPeaks`' internal mode machinery:

| Platform | Function | Derives from |
|---|---|---|
| Swift | `guitarModeSelectedPeakIDs(from:)` (`+PeakAnalysis.swift:711`) | `GuitarMode.classifyAll(candidates)` |
| Python | `guitar_mode_selected_peak_ids()` (`..._peak_analysis.py:758`) | `GuitarMode.classify_all(candidates, guitar_type)` |
| Web | `resolvedModePeaks()` (`src/dsp/classify.ts:70`) | `classifyAll(peaks, guitarType)` |

Python's version already carries a comment explaining that the simple range lookup is wrong
*precisely because* the overlapping Top/Back ranges make Back unselectable — the same reasoning as
§4a, already accepted in one place while the detector kept doing it the other way.

**Pass 2 of §7 therefore already exists and is already wired.** The fix does not have to build it,
and removing the detector's mode machinery cannot disturb selection.

### The apparatus being deleted affects membership only

`findPeaks` ends with `return finalPeaks.sorted(by: { $0.magnitude > $1.magnitude })` — every peak is
re-sorted by magnitude at the end, so the guaranteed-slot ordering has no effect on output order
either. `strongestPeakPerMode`, the guaranteed slots and the whole of step 3 therefore affect
**exactly one thing: set membership** — and the only membership change they produce is the duplicate
twin, because a mode winner is by definition the highest-magnitude peak in its range and so would
never have been dropped by `removeDuplicatePeaks`.

The deletion is **subtractive**. That is what makes the §4 constraint achievable, and it narrows the
residual risk to a single question, which D5 must answer:

> Does one uninterrupted frequency-ordered sweep find the same local maxima as the current
> step 1 ∪ step 2 union?

### Coverage is provably unchanged — retraction of an earlier claim

An earlier draft claimed a single sweep might find peaks the per-mode scan misses, because it has no
seams at mode-range boundaries. **That claim was wrong** — challenged by the user 2026-07-19,
retracted after actually checking. Recorded here because it shaped the acceptance bar.

Both current passes are confined to the same interval, `[startIdx + windowSize, endIdx - windowSize)`,
and both apply the identical +/-`windowSize` strict local-maximum test. Coverage is the only variable,
and step 1 union step 2 is complete:

- Step 2 skips a bin only when its frequency lies in a known mode range.
- So the only candidate hole is a bin `b` inside mode `M`'s range that `M`'s own scan skipped, which
  happens only when `b < lastClaimedBinIdx` — below the winner of an earlier mode `P`.
- Modes are iterated sorted by ascending `lowerBound`, so `P.lower <= M.lower <= b`.
- And `b < P.winner <= P.upper`.
- Therefore `b` lies in `[P.lower, P.upper]` — inside `P`'s range, so `P`'s scan already covered it.
- Induct on whatever constrained `P`'s start; the base case is the first mode, which has no claim
  restriction (`lastClaimedBinIdx = -1`).

No hole exists. A single uninterrupted sweep over the same interval finds **exactly** the same local
maxima. The sweep still uses the mode ranges — afterwards to label, rather than during to scan.

**Consequence for section 4:** the expected result is the current peak set **minus the twin, with
nothing added and nothing else moved**. D5 is not there to negotiate acceptable differences; **any**
difference beyond the removed duplicate contradicts the argument above and must halt the work until
it is explained.

---

## 7a. Candidate algorithms — DECISION DEFERRED TO STEP 5

Both satisfy section 4a (no per-mode-range scanning; each bin visited once). Steps 2-4 are
algorithm-independent, so the choice is not needed until step 5. **Revisit this section then.**

### The rule both must obey: rewind over peaks, never over bins

Whatever settles the overlap, it must never re-scan a **bin**. A second visit to a bin calls
`makePeak` again and mints a fresh UUID — rebuilding the present bug in new clothes. Re-examining
already-minted peak **objects** is safe: each bin still produced exactly one peak.

The sweep therefore holds two kinds of state: bins consumed once, strictly forward; and a small
buffer of peaks in the current overlap region that may be revisited. This distinction is the entire
defect and must be a comment in the shipped code, not a thing we remember.

### Candidate A — sweep detects, `classifyAll` claims (two passes)

Pass 1 detects, mode-blind, one bin at a time. Pass 2 is the existing `classifyAll` over the peak
list.

- **For:** one implementation of the claiming rules. `classifyAll` already exists, is already correct,
  and is already wired to selection (see above). Deletion is purely subtractive.
- **Against:** one extra iteration over a few dozen peaks (immaterial).

### Candidate B — single pass, identification and selection together (user's proposal)

Sweep ascending, tracking a running maximum inside the active mode range. The **end of the mode
range** is the event that settles the winner: at that point the running max becomes the selected Top
peak. Scanning then resumes from the peak **after** the settled winner, re-labelled as Back, running
its own maximum to the end of the Back range, and so on.

Region between the found Top and the end of the Top range is visited twice — the second time only to
re-label and to feed the Back maximum. Under the rule above, that revisit walks buffered peaks, not
bins.

- **For:** identification and selection settled in one traversal; the overlap transition is explicit
  and event-driven rather than implied by a filter predicate.
- **Against:** it does **not** replace `classifyAll`, which must keep existing for peak lists that
  never came from a sweep — loaded `.guitartap` files, `recalculateFrozenPeaksIfNeeded`, comparison
  views, PDF export. So the claiming rules would exist in two places again, on two data shapes. That
  is precisely the section 3c condition that produced this bug, and the copy embedded in the scan is
  the one that drifted. Choosing B means committing to a test that pins the two implementations to
  agree on every fixture, permanently.

### Investigations — DONE 2026-07-19

**1. Mode ranges and whether overlap chains.** It does not. The only genuine overlap on every guitar
type is Top/Back; Ring/Upper merely touch at a single point (zero width), which is a boundary, not an
overlap.

| Type | scan order (ascending `lowerBound`) | real overlap |
|---|---|---|
| classical | air, top, back, dipole, ring, upper | top/back 190–230 (40 Hz) |
| flamenco | air, **back, top**, dipole, ring, upper | top/back 190–240 (50 Hz) |
| acoustic | air, top, back, dipole, ring, upper | top/back 210–210 (0 Hz) |
| generic | air, top, back, dipole, ring, upper | top/back 180–260 (80 Hz) |

So B's rewind would be a single bounded region, never a cascade. This was the main risk against B and
it is not real.

**2. Would B match `classifyAll` below the settled Top winner?** Yes. `classifySingle` tests bands in
fixed order air→upper, so Top is tested before Back and an overlap-zone peak below the claimed Top
resolves to `top`. A streaming sweep still inside Top mode labels it the same. Verified by reading
`classifySingle`, not assumed.

**3. What B would have to reproduce** from `classifyAll` — five behaviours, each a place to drift:
claim strongest per mode in ascending-lowerBound order; Back's effective lower bound
`max(back.lo, claimedTop + 1)`; `classifySingle` fallback in fixed air→upper order; the override that
sends an unclaimed peak above the claimed Top within the Back range to `back`; and `unknown` for
peaks outside every band. Under A that count is zero.

### Decision — Candidate A (user, 2026-07-19)

Detection and classification are separated. `findPeaks` detects only; `classifyAll` classifies and
claims. One implementation of the claiming rules, and the deletion is subtractive.

**Consequence: `classifyAll` becomes the single source of truth for classification on all three
platforms.** That raises the stakes on it being correct — see the defect immediately below.

---

## 7c. Pre-existing defect found during step 5: flamenco inverts Top and Back

**Not the duplicate bug. Separate, older, and present on all three platforms.**

`classifyAll` claims modes in ascending `lowerBound` order and constrains Back to sit above the
claimed Top. For flamenco, `back.lo` (180) is **below** `top.lo` (190), so **Back is claimed first**
and `claimedTopFrequency` is still null when it runs — the physics guard never fires.

Verified against real code (web `classifyAll`), two peaks at 200 Hz (−40 dB) and 230 Hz (−50 dB):

```
flamenco   top=230 Hz  back=200 Hz  *** INVERTED ***
classical  top=200 Hz  back=230 Hz  OK
generic    top=200 Hz  back=230 Hz  OK
```

Identical input; flamenco labels the strongest peak Back and the weaker, higher peak Top — physically
backwards and opposite to every other guitar type. Swift and Python carry the same ranges
(`top=(190,250)`, `back=(180,240)`), so the inversion is faithful across all three.

The guard is written to depend on *range* order when it should depend on *claim* order: Top must be
claimed before Back regardless of which range starts lower.

### Resolved as a DATA fix — 2026-07-19 (user)

There was no provenance for the numbers anywhere: no citation in `GuitarType.swift`, `GuitarMode.swift`,
the developer docs or the manual. The struct's own doc comment also claims *"Bands are non-overlapping
and cover the full audible spectrum"*, which is false — Top/Back overlap on every type, and
`findPeaks` step 2 leans on that false claim via its `isInKnownMode` skip.

The user supplied the correct figures: **flamenco top 180–220 Hz, back 200–250 Hz**. The old values
were not merely imprecise, they were inverted.

| | old | new |
|---|---|---|
| flamenco top | 190–250 | **180–220** |
| flamenco back | 180–240 | **200–250** |

Top reaches 220 because modern flamenco tops are built closer to classical (user). That leaves a
deliberate 20 Hz Top/Back overlap on 200–220 — which is correct and expected; overlap is the norm on
every guitar type.

What actually mattered was the **ordering**, not the width. Because `top.lo` (180) now sits below
`back.lo` (200), the scan order is `air, top, back, …` like every other type, Top is claimed before
Back, and the physics guard fires. **The inversion disappears without touching `classifyAll`** — no
classifier change, no new condition, no blast radius beyond flamenco classification itself.

Applied to all three: `GuitarType.swift`, `guitar_type.py`, `guitarModes.ts`. Verified: flamenco now
reports `top=200 back=230`, matching classical and generic on identical input.

**Context (user):** all the per-type bands are approximations — which is why Generic exists and is the
more useful setting in practice. Every fixture in the corpus is Generic, and the duplicate defect lives
in Generic's 80 Hz Top/Back overlap. So this fix corrects a wrong ordering, not a precision problem.

### Fallout — stale test expectations and a parity gap

Correcting the bands broke one test on Swift and one on Python; both had encoded the inverted ranges
as expected values:

- Swift `flamenco_backRange_classifiesAsBack` asserted `.back` at **185 Hz**, commented "in back
  only" — true only under the old bands.
- Python `test_flamenco_top_220Hz` asserted `TOP` at **220 Hz** — likewise.

Both now assert the corrected behaviour, and each platform gained a **regression guard**
(`flamenco_topIsClaimedBelowBack` / `test_flamenco_top_is_claimed_below_back`) pinning
Top-below-Back on two peaks straddling the overlap.

**The web broke nothing — because `test/classify.test.ts` had no flamenco cases at all.** Swift and
Python both covered flamenco in the `test/classify` group; the web did not. That gap is now closed
with five cases including the regression guard and a cross-type agreement check, since the inversion
originally showed up as flamenco disagreeing with classical and generic on identical input.

Note the shape of this: a platform showing no failure looked like good news and was actually missing
coverage. Same lesson as Python's `test/peaks` in section 5 — a green suite is only as meaningful as
what it touches.

### Also corrected — the `ModeRanges` doc comment

It claimed *"Bands are non-overlapping and cover the full audible spectrum"*, which is false on every
guitar type (user confirmed: Top and Back can definitely overlap). `findPeaks` step 2 actively
depended on that false claim via its `isInKnownMode` skip.

Replaced on all three with an accurate description that also states the rule from section 4a:
overlap is by design, a frequency may fall in more than one band, resolving that is `classifyAll`'s
job, and **detection must not consult these bands at all**. Putting it next to the data means the
next person to touch `findPeaks` sees the constraint without reading this document.

## 7b. Heal corrupt files on load — DECIDED 2026-07-19 (user)

Fixing `findPeaks` stops *new* corruption. It does nothing for files already written.

Loaded peaks are authoritative: `loadMeasurement` assigns `currentPeaks = measurement.peaks`
(Swift `+MeasurementManagement.swift:516`, mirrored on Python and web) and
`recalculateFrozenPeaksIfNeeded` filters saved peaks by magnitude without deduplicating. That rule
is correct and stays — re-running `findPeaks` on a loaded spectrum is exactly what must never
happen. But it means **every `.guitartap` file ever written carries the twin permanently**, so after
the fix:

- new captures — clean
- every existing saved measurement — still an extra Analysis Results row on all three platforms,
  plus corrupted star / mode label / pitch on Python via the `freq_index` defect (section 3d)

The entire test corpus in `Tests/All Platforms` is affected, as is every measurement any user has
saved. **Decision: heal on load**, in the same shape as the shipped material-selection heal — detect
the corruption when reading a measurement and repair it in memory, so old files render correctly
without being rewritten.

### Rule

Collapse peaks closer together than `peakProximityHz` (2 Hz), keeping — in order of preference:

1. the peak whose id is in `selectedPeakIDs` (the claimed mode winner), else
2. the higher magnitude, else
3. the first encountered.

This can never discard a peak `findPeaks` itself would have kept: its own dedup already guarantees
every legitimately saved peak is at least 2 Hz from its neighbours, so any pair closer than that is
by definition corruption. The observed twins are bit-identical apart from `id`, so in practice
rule 1 decides every real case.

The removed twin's id must also be dropped from `selectedPeakIDs`, `peakAnnotationOffsets` and
`peakModeOverrides`, or those maps retain dangling references.

### Where it goes — DECIDED 2026-07-19 (user)

**At decode time, not at load time**, and it must cover reading a `.guitartap` file from disk **and**
reading the saved-measurements store. The per-measurement decoder is that choke point on all three:

| Platform | Site | Notes |
|---|---|---|
| Swift | `TapToneMeasurement.init(from decoder:)` (`TapToneMeasurement.swift:488`) | already a custom init; `decodeMeasurements(_:)` funnels every read through it and says so in its own doc comment |
| Python | `TapToneMeasurement.from_dict` | 4 call sites, all of them decode paths |
| Web | `decodeMeasurement(d)` (`src/measurement/decode.ts:163`) | used by `parseGuitarTapFile` and the saved-store reader |

Per-measurement rather than per-file is deliberate: it covers every existing read path and any future
one, so no later loader can bypass the heal. It also keeps `loadMeasurement` free of repair logic —
by the time a measurement reaches it, the data is already sound.

Note a small structural asymmetry to fix while here: Swift has a named single decode helper
(`decodeMeasurements`), Python does not — it calls `from_dict` in a comprehension at each site.

### Persisting the repair — DECIDED 2026-07-19 (user)

**The corrected form gets written.**

- **Saved-measurements store** — when a heal occurs during load, **force a save**. The store is ours
  and repairs itself immediately, so the corruption is gone after one launch.
- **`.guitartap` files** — healed in memory and written in corrected form whenever the measurement
  is next saved. A file merely opened is not silently rewritten on the user's disk; if they never
  save it, it is simply healed again on the next read. Healing is cheap and idempotent, so a
  never-saved file costs nothing but stays correct on screen.

### API consequence

The decoder must be able to report that it healed something, or the store loader cannot know to
force the save. Expected shape: a transient, **non-serialised** `wasHealed` flag on the decoded
measurement, with the store loader persisting when any decoded measurement carries it. That flag
must never round-trip into the JSON — a heal marker written to disk would be meaningless on the next
read and would show up as a spurious field in the format. D8 asserts both the flag and its absence
from the encoded output.

## 8. Tracking

Order is Swift → Python → web throughout (canonical first).

| Step | Description | State |
|---|---|---|
| 0 | Investigation + this write-up | ✅ done 2026-07-19 |
| 1 | Trace `guitarModeSelectedPeakIDs` (§7 open question); confirm the fix shape against §4a | ✅ done 2026-07-19 — selection already derives from `classifyAll` on all 3; deletion is subtractive |
| 2 | Capture golden baselines (D5) from **current** code, all 3 | ✅ done 2026-07-19 — 364 peaks / 10 fixtures, **Swift = Python = web, zero mismatches**, max delta 6.1e-5 |
| 3 | Author D1–D4, D6, D7, D8 against the **unfixed** code, all 3 | ✅ done 2026-07-19 |
| 4 | **PROVE THEY FAIL**: run all 3 suites; record each failure and confirm the reason matches §3 | ✅ done 2026-07-19 — see "Step 4 record" below |
| 5a | Investigations (section 7a) + algorithm decision | ✅ done 2026-07-19 — overlap never chains; B would have matched `classifyAll`; B would have duplicated 5 behaviours. **Decision: Candidate A** (user) |
| 5b | Flamenco band correction (section 7c) — data fix, all 3 + tests + parity gap closed | ✅ done 2026-07-19 — `top 180–220`, `back 200–250`; 2 stale tests corrected, 3 regression guards added, web flamenco coverage created |
| 5c | Implement `findPeaks` (detection only) **and** the decode heal (section 7b) — Swift | ✅ done 2026-07-19 — 211 lines → 77; heal in `init(from:)` incl. `tapEntries`; store force-save |
| 6 | Mirror `findPeaks` + heal — Python | ✅ done 2026-07-19 — plus the **D7 view fix**: `freq_index`, `_card_for_freq` and `_auto_mode_map` all used frequency where identity was meant |
| 7 | Mirror `findPeaks` + heal — web | ✅ done 2026-07-19 — heal exported as `healMeasurement`; **IndexedDB store holds decoded objects and never reaches the decoder**, so it heals on read + writes back |
| 8 | **PROVE THEY PASS**: all 3 suites green; D5 diff shows *only* the removed twin | ✅ done 2026-07-19 — **Swift 403 / Python 522 / web 305, all pass.** D5 green on every fixture from the first run of the Swift rewrite |
| 9 | User run-review on real captures (macOS · iPad · iPhone · PC) | 📋 **NEXT — nothing is committed until this passes** |
| 10 | `@parity` tags + regenerate PARITY-MAP / parity-index / TEST-COVERAGE | ✅ done 2026-07-19 — new `test/peak-heal` group (all 3); `--check` clean, **77 groups**, 16 platform-specific |
| 11 | Commit all 3 | 📋 |

**Nothing is committed before step 8 passes and step 9 is confirmed by the user.**

### Step 4 record — proof of failure, 2026-07-19

Full suites, all three platforms, against unmodified production code.

| | tests | passed | failed | typecheck |
|---|---|---|---|---|
| Swift | 401 | 389 | **11** (12 issues) | build clean |
| Python | 520 | 507 | **13** | n/a |
| Web | 300 | 289 | **11** | `tsc` clean |

**Every failure is in a file authored for this work. No pre-existing test was disturbed on any
platform.** Swift reports 12 *issues* across 11 tests because one test records two.

The same 11 tests fail on all three platforms. Python's extra 2 are D7, which covers a view-layer
defect that exists only there.

| Test | Predicted cause (section) | Observed |
|---|---|---|
| D2 overlap repro | 3a — overlap bin minted twice | two peaks `0.0 Hz` apart |
| D4 winner invariants | 3b — twin survives assembly | `back` claimed 2 peaks |
| D3 fixture duplicates ×3 | 3a/3b on real captures | `240.10170 / 240.10555 / 240.10588 Hz`, each `0.00000` apart |
| D5 golden baseline ×3 | one extra peak vs the step-2 capture | `50/46/49` against `49/45/48` |
| D7 card star (Python) | 3d — `freq_index` → −1 → `_peaks[-1]` | `['off','off']`, expected `['off','on']` |
| D7b card mode (Python) | 3d, same mechanism | `['Air','Air']`, expected `['Air','Back']` |
| D8 decode duplicates | 7b — no heal exists | duplicate survives decode; 50 peaks not 49 |
| D8 keeps selected twin | 7b | 2 survivors at 240.1 Hz |
| D8 heal reported | 7b — `wasHealed` absent | flag `nil` / `None` / `undefined` |

Every observed failure matches its prediction. Nothing failed for an unexplained reason, and the
three tests that initially did are recorded below.

Passing by design (guards, not red tests): D2b classification, D1 on non-overlap spectra, D8
dangling-ids, D8 flag-not-serialised. Their value is entirely in step 8 — they constrain what the
fix may do.

### Tests that failed for the wrong reason (step 3)

Three times an authored test failed, but not for the predicted cause. Each was a defect in the
test, caught only because the rule is to inspect *why* it failed rather than confirm that it did.
A suite written after the fix would have baked all three in as passing.

1. **D2, 2048-bin spectrum** — returned 1 peak, not the predicted 4. Cause: the +/-5-bin window spans
   +/-58 Hz at that resolution, so the two overlap peaks could not coexist. Led to the section 5
   finding that the suite was structurally unable to express the bug.
2. **D7b asserted on the Top card** — a unique frequency, which resolves correctly, so the test
   passed while the defect was untouched. Only the duplicate cards expose it.
3. **D7b expected value malformed** — compared `str(GuitarMode.AIR)` (`"GuitarMode.AIR"`) against a
   display name (`"Air (Helmholtz)"`). It failed for the right reason but could never have passed
   after the fix.

### Baseline artifacts (step 2, 2026-07-19)

Captured by replaying each fixture's own `spectrumSnapshot` through the current `findPeaks` with
identical options on all three platforms: `guitarType` and `peakMinThreshold` from the measurement,
`minHz 30`, `maxHz 2000`. **The 30-2000 Hz analysis range is the shipped default on all three apps
and has never been changed** (confirmed by the user, 2026-07-19) — so the baseline reflects the real
analysis window, not a harness approximation. Recorded per peak: frequency, magnitude, Q, bandwidth, mode label,
selected flag; plus per fixture: peak count, duplicate list, winners.

Scaffolding (**uncommitted**, deleted or folded into D5 before the fix lands):

- `scratchpad/baseline-web.ts` -> `baseline-web.json`
- `scratchpad/baseline_python.py` -> `baseline-python.json`
- `GuitarTap/GuitarTapTests/PeakBaselineCaptureTests.swift` -> `baseline-swift.json`
  (test host is sandboxed; writes into its container tmp, copied out)

**Findings:**

1. **The replay reproduces the stored files exactly** — same peak count and same duplicate frequency
   for all ten. The defect is fully deterministic from saved data; no live capture is needed to test
   it, and the replay harness is a valid oracle for D3 and D5.
2. **The three ports are one algorithm, not three similar ones.** 364 peaks compared three ways:
   zero mismatches in mode label or selection, max numeric delta 6.1e-5. The web and Python each
   reproduce the exact peak counts of files originally written by Swift. So this is one bug mirrored
   faithfully, and D6 already has a passing baseline to hold the fix against.
3. Every fixture has exactly **one** duplicate, always in the Top/Back overlap band — consistent
   with section 3a.

### Notes

- Existing guitar fixtures all contain the duplicate. Expected values in any test that counts peaks
  will shift by one — that shift is the *point*, and D5 is what proves it is the only one.
- Build numbers roll on any source edit, so steps 5–7 land together with 11.
- **This blocks the 1.0.2 release** (user, 2026-07-19). It is a long-standing defect present in every
  shipped build rather than a respin regression, but it is core analysis code and ships fixed. The
  respin's Step 8 (ship) does not proceed until step 9 below is confirmed.