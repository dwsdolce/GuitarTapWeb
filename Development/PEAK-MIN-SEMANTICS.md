# Peak Min: documented as a display filter, actually a detection gate

**Status: 📋 OPEN — behaviour fully understood; only the design choice remains.**
_Opened 2026-07-19, from Step-8 run-review on the Swift build._

Detail doc for STATUS item **"Peak Min is documented as a display filter but is a detection
gate"**. Separate from the duplicate-peak work ([PEAK-FINDING-DUPLICATE-PEAKS.md](PEAK-FINDING-DUPLICATE-PEAKS.md))
— that fix is **not** the cause, proven in §5 below.

---

## 1. What was observed

Loading `dws-2024-umik-1-swift-iphone-1784498431.guitartap` (the "DWS 2024 UMIK-1 Swift iPhone"
measurement) into the current Swift build, with **Show Unknown Modes ON**:

- no unknown-mode peaks appear;
- moving **Peak Min** downward adds no peaks;
- cycling **Annotations** All → Selected → None does not behave as expected.

Initially this looked like a Swift-vs-Python divergence. It was not: the Python comparison had been
run against the **iPad** file. Loading the **iPhone** file into Python reproduces the Swift result
exactly. No platform divergence exists.

## 2. The user's expectations (stated 2026-07-19)

Recorded verbatim as requirements input, not as a bug report:

1. *"I thought the min peaks only affected the display of the peaks and not the saving of the
   peaks."*
2. *"I thought that all peaks are saved if Show Unknown Peaks is on."*
3. *"The min peaks setting affects the peaks and moving it below the peaks should show the unknown
   peaks."*
4. Cycling Annotations to **All** should show **all** peaks.
5. Moving **Peak Min** should make peaks appear and disappear.

Expectations 1 and 2 describe the opposite of the implemented behaviour. Expectation 3 holds for a
live capture but not for a loaded measurement. Expectation 5 likewise.

## 3. What is actually true

| Control | Believed | Actual |
|---|---|---|
| **Peak Min** | display filter | **detection gate** — `effectiveThreshold` in `findPeaks`. Peaks below it are never created, so never saved. The saved file contains only peaks above the capture-time value. |
| **Show Unknown Modes** | controls what is saved | **display only** — appears in exactly one behavioural place, `visiblePeaks`. Never affects detection or saving; persisted only as snapshot metadata. |

The two settings have the opposite character to what was assumed: the one believed cosmetic is
destructive at save time, and the one believed to control saving is purely cosmetic.

Two further rules complete the picture:

- **Loaded peaks are authoritative.** `recalculateFrozenPeaksIfNeeded` takes the
  `loadedMeasurementPeaks` path and *filters* saved peaks by magnitude; it never re-detects. So on a
  loaded measurement Peak Min can only ever **subtract**.
- **The full spectrum is saved.** Nothing is permanently lost. `reanalyzePeaks()` (the **wand**)
  clears `loadedMeasurementPeaks` and re-runs `findPeaks` against the frozen spectrum — the only
  route back to peaks below the capture-time Peak Min.

## 4. Evidence

Unknown-mode peaks exist only in the gaps between mode bands — for Generic: **135–140, 260–310 and
460–580 Hz**. Those regions are low-amplitude in a guitar tap, so whether any are captured depends
entirely on the Peak Min in force at the time.

Across all ten guitar fixtures, Unknown count tracks capture-time Peak Min exactly:

| fixture | Peak Min at capture | peaks | Unknown |
|---|---|---|---|
| swift-iPhone `1784498431` | −60 | 8 | **0** |
| iPhone 3-tap `1784498523` | −60 | 7 | **0** |
| swift-iPad `1784313066` | −71 | 37 | 5 |
| iPad 3-tap `1784313182` | −71 | 26 | 4 |
| swift-mac `1784225155` | −78 | 50 | 10 |
| python-mac `1784225140` | −77 | 46 | 9 |
| web-mac `1784225174` | −78 | 49 | 9 |

Every file captured at −60 has zero Unknown; everything at −71 or lower has 4–10. That is the whole
difference between the iPhone and iPad files — not a platform bug.

**The peaks are in the recording.** Replaying the iPhone file's own saved spectrum at lower
thresholds recovers them:

| Peak Min | peaks | Unknown | Unknown frequencies |
|---|---|---|---|
| −60 | 7 | 0 | — |
| −65 | 23 | 1 | 300.1 |
| −70 | 36 | 5 | 300.1, 557.9, 485.9, 137.9, 542.2 |
| −75 | 37 | 6 | + 526.5 |
| −85 | 60 | 9 | + 38.0, 45.9 |

So on that measurement: lower Peak Min to −70 and press the **wand**, and the missing peaks appear.
The slider alone will not do it.

**And it is not only unknown-mode clutter that is missing.** Classifying the same replay by mode:

| Peak Min | peaks | modes present |
|---|---|---|
| −60 | 7 | top 1, ring 1, back 2, dipole 3 — **no Air** |
| −65 | 23 | top 2, ring 7, back 5, dipole 7, unknown 1, upper 1 — **no Air** |
| −70 | 36 | + **air 2** — 126.7 Hz @ −68.2 dB and **97.4 Hz @ −69.5 dB** |

The 97.4 Hz peak is the **Helmholtz air resonance** — a primary structural mode, not gap-region
noise. The saved iPhone measurement is missing a named mode a luthier would expect to see, because
it sat 9.5 dB below the Peak Min in force at capture. This is the strongest argument that the
current behaviour needs more than a documentation fix: the truncation can remove headline results,
silently, with no indication in the saved file that anything is absent.

Re-analyzing restores the full set, and from that point the Peak Min slider behaves exactly as
expected — because `loadedMeasurementPeaks` is cleared and the measurement is back on the live path.

## 5. The duplicate-peak fix is NOT the cause

The same sweep run through the old algorithm (web, unmodified at the time) and the new one (Python,
already rewritten) gives:

| Peak Min | old peaks | new peaks | old Unknown | new Unknown |
|---|---|---|---|---|
| −60 | 8 | 7 | 0 | 0 |
| −65 | 24 | 23 | 1 | 1 |
| −70 | 37 | 36 | 5 | 5 |
| −75 | 38 | 37 | 6 | 6 |
| −80 | 49 | 48 | 6 | 6 |
| −85 | 61 | 60 | 9 | 9 |

Every row differs by exactly one peak — the removed duplicate — with identical Unknown counts and
identical Unknown frequencies. Unknown detection is untouched by the rewrite, across a 25 dB sweep.
This is a stronger result than D5, which pinned a single threshold; it is worth promoting into the
suite as a threshold-sweep regression test.

## 6. The manual is wrong — three places

This is where the expectation came from. All three ship with the release.

**§2.7 (ch02-getting-started.md)** — the primary description:

> "Peak Min sets the minimum spectrum magnitude at which a peak is **annotated on the chart** and
> considered for guitar-mode analysis."

**§8 (ch08-settings-reference.md)** — Settings reference:

> "Sets the minimum magnitude (dB) a peak must reach to be **annotated** and included in the
> analysis."

Both read as display filters. Neither states that peaks below the value are never detected and
therefore never saved.

**§3.6 (ch03-guitar-mode.md)** — and this one hides the remedy:

> "the wand **re-classifies the visible peaks** against the current Peak Min and re-selects one per
> mode window."

`reanalyzePeaks()` does considerably more than re-classify visible peaks: it clears
`loadedMeasurementPeaks` and **re-detects from the frozen spectrum**. Described as a selection
refresh, a reader with exactly this problem would never think to press it.

Missing everywhere: *Peak Min gates detection; the saved file contains only peaks above the
capture-time value; the wand recovers the rest from the saved spectrum.*

## 7. RESOLVED — the All/Selected/None symptom was not a defect

Closed by the user 2026-07-19. On loading the iPhone file at the default display range, Analysis
Results shows 3 peaks and the chart annotates 2; zooming all the way out shows **7 in both**.

The peaks were never missing — the default **75–350 Hz display range** filters the chart and the
results panel together, exactly as intended. 7 is also the arithmetic check: 8 saved peaks minus the
one removed by the duplicate heal.

No action. The annotation toggle behaves correctly.

## 8. Open design question — what should it do?

**Not decided.** Three candidates (user, 2026-07-19). All three assume the §6 documentation errors
are corrected regardless — that is a prerequisite, not an option.

### Option 1 — re-analyze automatically on every load

**For.** A loaded measurement behaves exactly like a live one; the slider works immediately and the
two-modes problem disappears entirely. The full peak set is always present, so nothing is silently
missing — including the Air resonance in the iPhone case.

**Against.** It abandons *loaded peaks are authoritative*. The saved analysis record is replaced by a
fresh computation on every open, and that computation can legitimately differ from what was saved —
different app version, analysis range, or guitar type. **A measurement a luthier saved, cited or
shared could show different peaks than when they saved it, with no indication why.** For a
measurement record, that is a serious property to give up.

### Option 2 — leave as is; the user runs re-analyze when they want it

**For.** The saved measurement is exactly what was saved — faithful and reproducible. No surprise
changes, no lost work, zero implementation risk.

**Against.** The reported confusion persists: the slider silently does nothing downward, with no
indication which mode you are in. The remedy is undiscoverable — and §3.6 of the manual currently
describes the wand as re-classifying *visible* peaks, so even a careful reader would not know it is
the answer. Fixing the docs makes this defensible, but the control still lies about itself.

### Option 3 — re-analyze when the Peak Min slider is moved

**For.** Loaded peaks stay authoritative until the user actively asks for something the saved set
cannot provide. Opening a measurement never changes it — only a deliberate gesture does. The control
then does what it appears to do, with no dead zone.

**Against.** One control acquires two behaviours — moving up filters saved peaks, moving down
re-detects — which may be more confusing than an inert range, not less. Re-running detection on
every slider tick needs debouncing or a "only below the saved minimum" trigger. And after the first
move the on-screen peak set no longer matches the file until saved, with nothing indicating that.

### Option 4 — save every detected peak; Peak Min filters on read (user, 2026-07-19)

Stop truncating at save time. Detect against a low absolute floor, record the **full** peak set in
the file, and let Peak Min act as what the manual already claims it is: a filter applied when
displaying and analysing. Live and loaded then behave identically, because both are filtering the
same complete set.

**The load path already works this way.** `recalculateFrozenPeaksIfNeeded` does
`savedPeaks.filter { $0.magnitude >= peakMinThreshold }` — a display filter over the saved record.
It behaves "wrong" today only because the saved record was truncated before it ever got there. Feed
it a complete set and the existing code does the expected thing with no change.

**The floor is −100 dB, and it is fixed by two existing constraints** (user, 2026-07-19; both
confirmed in code):

- `TapDisplaySettings.defaultMinMagnitude = -100` — the chart's magnitude floor, so a peak below
  −100 dB **cannot be drawn**.
- `Slider(value: $peakMinThreshold, in: -100...(-20), step: 1)` — Peak Min bottoms out at −100 and
  the range is not configurable, so the user **cannot lower the filter far enough to admit one**.

A peak below −100 dB is therefore unreachable twice over. Recording it would add bytes that no
setting can ever surface. −100 dB is not a tuning choice — it is the point below which the rest of
the application cannot represent the data.

**It is bounded, and cheap.** Peak count saturates well within that floor, because the ±5-bin
local-maximum test limits how many peaks a spectrum can contain:

| Peak Min | −60 | −70 | −80 | −90 | −100 | −120 | −200 |
|---|---|---|---|---|---|---|---|
| iPhone capture | 7 | 36 | 48 | 80 | 91 | **92** | **92** |
| mac capture | 5 | 31 | 53 | 74 | 111 | **114** | **114** |

At the −100 dB floor: **91 of the iPhone capture's 92 reachable peaks, and 111 of the mac's 114** —
the remainder lie below −100 and could never be displayed anyway. So "everything" is ~100 peaks, not
thousands. At ~268 bytes of JSON per peak that is **~30 KB against a 341 KB spectrum blob — under 10%
growth**, on files already dominated by the spectrum arrays.

**For.** The manual becomes true rather than being rewritten to describe a surprise. One behaviour on
live and loaded, so the confusion cannot recur. No headline mode can go missing — the Helmholtz peak
in §4 would be in the file. `loaded peaks are authoritative` is *preserved*, not abandoned: the record
is complete, so nothing needs re-deriving. Manual selection is never at risk, because no re-analysis
happens. And it needs no new UI, no debouncing and no confirmation.

**Against.** It is the largest change of the four, and it must land on all three platforms together.
The live path must gain the split the loaded path already has — detect against the absolute floor,
then filter by Peak Min for display and analysis — where today detection *is* the filter. The
meaning of `peakMinThreshold` in the file changes from "the gate that produced this peak list" to "the
display setting in force at save", which is a format-semantics change even though the field stays.
And it fixes the future only: **files already saved remain truncated**, so re-analyze — or the
decode heal — is still the route for those.

**Assessment.** This is the only option that makes the system self-consistent rather than managing a
discrepancy. Options 1–3 all negotiate around a truncated record; Option 4 stops creating one. The
cost is real but the numbers are small, and it removes the whole class of problem rather than
signposting it.

### The objection common to Options 1 and 3 — and it is fixable

`reanalyzePeaks()` **discards manual selection**: auto-selection re-runs, so a hand-selected peak is
deselected. Mode overrides survive (remapped onto new peak UUIDs by ±5 Hz proximity); selection does
not. Under Option 1 that happens on **every load**, silently destroying user intent. Under Option 3 it
happens mid-drag.

That is the sharpest hazard in both, and it is **independent of this decision**: selection could be
carried across a re-analysis by the same ±5 Hz frequency-proximity remapping already used for
overrides. Resolving it first would remove the main objection to both options and is worth doing on
its own merits.

### Recommendation for the discussion

Options are not mutually exclusive, and they split into two groups: **1–3 manage a truncated
record; 4 stops producing one.**

A plausible sequence:

1. Fix the documentation — required under every option.
2. Adopt **Option 4** for new captures, so the problem stops being created.
3. Keep **Option 2** for existing files — they stay faithful to what was saved, with re-analyze as
   the documented route to recover peaks below their capture-time Peak Min.
4. Independently, make `reanalyzePeaks()` preserve selection by frequency proximity. That is a
   defect in its own right (see above) and it makes the re-analyze route safe to recommend.

That combination gets one behaviour going forward, keeps old records honest, and avoids Option 1's
hazard entirely. Option 1 remains the one to be most careful about: silently changing a saved record
on open is a different class of decision from anything else here.

**Option 4's floor is settled: −100 dB**, fixed by the chart's `defaultMinMagnitude` and the Peak Min
slider's lower bound — below that the application cannot display a peak or be asked to admit one. No
empirical tuning required.
