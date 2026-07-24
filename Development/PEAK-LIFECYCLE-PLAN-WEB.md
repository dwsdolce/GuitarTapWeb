# Peak Lifecycle — Web Port Plan & Tracker

Companion to `PEAK-LIFECYCLE-PLAN-SWIFT.md` and `PEAK-LIFECYCLE-PLAN-PYTHON.md`. Tracks the **web**
port of the peak-lifecycle rework. **Swift is canonical**; this doc replays the Swift plan's per-phase
**port ledgers** into the web app, one phase at a time — the Python doc is a second reference (it hit
the same phases and recorded ledger corrections + view-sync gaps that often apply here too).

Web repo: `/Users/dws/src/GuitarTapWeb` (this repo). Stack: **TypeScript + React + Vite + Vitest**.
DSP in `src/dsp/` (`peaks.ts`, `classify.ts`, `guitarModes.ts`, `analysisQuality.ts`); the measurement
model in `src/measurement/` (`types.ts`, `decode.ts`, `encode.ts`, `fromLive.ts`); UI state + wiring in
`src/App.tsx` (+ hooks); presentation in `src/presentation/`. Tests in `test/*.test.ts` (one per slug).

**⚠️ The web is the most architecturally DIVERGENT port.** Swift/Python share an analyzer/model split;
the web diverged at the VIEW/STATE layer — React hooks + `App.tsx` reactivity in place of SwiftUI
`@Published` / Qt signals, and it has NOT had the architectural-parity restructure. See
`Development/RESTRUCTURE-NOTES.md` and [[project_architectural_restructure]]. So: mirror Swift's *model
behaviour and naming* exactly (web is camelCase like Swift — a tighter mirror than Python's snake_case);
diverge only where React/TS forces it, and **name every divergence explicitly** — never invent a web-only
shape. Where Python recorded a Qt-vs-`@Published` view-sync gap, expect a React-reactivity analogue.

---

## Ground rules (from `PEAK-LIFECYCLE-PLAN-SWIFT.md` — the mother document)

- **The golden peak baseline must not change.** `peak-baseline-expected.json` / the web
  `test/peak-fixture-regression.test.ts` + `parity-oracle.json` pin detection — hash **`5c264de3941837f8`**,
  byte-identical across the three repos. Detection *itself* is not changing — only *when* it runs. Pass
  the −100 floor **explicitly at the call site** (`peakMinOverride`, `dsp/peaks.ts:178`), never change the
  `findPeaks` default. **If the baseline moves, STOP.**
- **Tests change WITH the phase** that changes the behaviour — never a separate "fix the tests" pass.
  Tests the spec deletes are deleted/inverted *as part of* the phase, reason in the commit message.
- **Each phase ends green** (`npm test` + the fixture regression) and is independently committable.
- Per-phase commits; the user commits ([[feedback_commit_code_then_hash_then_doc]]).
- **Every completed phase carries a Port ledger** (the durable `Rule.`), written the turn it lands.

**The Swift ledger's shape** (reproduce, don't re-derive): **Rule** (one platform-independent sentence) ·
**Swift** (symbols changed — authoritative) · **Ports (UNVERIFIED)** (a *prediction* of the web shape — a
map of where to look, to VERIFY against the code at port time, never trust from the doc) · **Tests**
(added/deleted/inverted + the `@parity` slug). The web port reduces to "make these named tests exist and
pass"; `gen_parity_map.py --check` flags any web twin that never got created.

## Cross-platform anchor map — Web column (Swift is authoritative; web spot-verified 2026-07-24)

From the Swift plan's anchor map. The Swift doc marks the web column UNVERIFIED — the entries checked
against current web code on 2026-07-24 are tagged ✓; the rest still need per-phase confirmation.

| Concept | Swift (authoritative) | Web |
|---|---|---|
| Durable full set | `allPeaks` | **none** — no durable full set yet (the Phase 1 gap) |
| Display projection | `currentPeaks` + `refreshDisplayedPeaks()` | `recalculatePeaks` (`src/state/tapToneAnalyzer.ts`) ✓ — plus a `displayPeaks` / `displayPeaksInRange` `useMemo` layer (`App.tsx:521,533`) ✓ |
| Peak Min trigger | `peakMinThreshold.didSet` | `peakMin` is an **input to `recalculatePeaks`** (`App.tsx:505-513`) ✓ — the defect vector (see warning) |
| Detection floor | `peakDetectionFloor` (−100) via `peakMinOverride:` | `opts.peakMinOverride ?? opts.peakMinThreshold ?? -60` (`dsp/peaks.ts:178`) ✓ |
| ±5 Hz carry-forward | `applyFrozenPeakState` | **none** — peaks are re-minted; per-peak state (offsets, overrides keyed by peak id) is lost outright |
| Selection cache | `selectedPeakFrequencies` | **none** (verify) |
| Full save set | `guitarFullSavePeaks()` | **none** (verify) |

### ⭐ The structural warning — the web's Peak-Min surgery DIFFERS (from the Swift plan, verbatim intent)
The web reaches the same defect by a different mechanism: because `peakMin` is an **input to the recompute**
(`recalculatePeaks`), a slider tick re-runs `findPeaks` on the frozen spectrum and **mints new peak
objects** — and because the web has **no carry-forward remap at all**, offsets and overrides keyed by peak
id are **destroyed outright** rather than approximately preserved. **So the web port is NOT a transcription
of the Swift diff: it is "remove `peakMin` from the recompute inputs, apply it in a separate display
selector."** Same Rule, different surgery. (A `displayPeaks` selector already exists at `App.tsx:521` — the
Phase 1/2 work is to make the durable set full at −100 and route Peak Min through that selector, not the
recompute.)

---

## Porting discipline

1. **Read the corresponding Swift change FIRST** (`git show <phase-hash>` in `/Users/dws/src/GuitarTap`
   + the surrounding source), then the Python port (for its ledger corrections + view-sync notes), then
   do the web one **non-divergently** — model behaviour, structure, and naming as close to Swift as
   possible.
2. **Naming:** TS camelCase mirror of Swift camelCase (`allPeaks ↔ allPeaks`,
   `peaksAbovePeakMin ↔ peaksAbovePeakMin`, `reclassifyForGuitarTypeChange ↔ reclassifyForGuitarTypeChange`).
   The web already matches Swift's casing — keep the mirror tight.
3. **Diverge ONLY where React/TS forces it** — chiefly the VIEW/STATE layer (`App.tsx` hooks/derived
   state vs SwiftUI `@Published`). Name divergences explicitly; don't invent web-only shapes.
4. **Per phase:** implement the Rule → create the counterpart tests (the slug the Swift ledger names,
   as `test/<slug>.test.ts`) → update `@parity` tags → `python3 /Users/dws/src/GuitarTap/Tooling/parity/gen_parity_map.py --check`
   (zero new orphans; currently **79 groups**) → the web peak-fixture regression + `parity-oracle.json`
   **unmoved** (`test/peak-fixture-regression.test.ts` — the web analogue of the Swift/Python golden).
   A phase is ported when its tests pass — not when the code "looks like" the Swift.
5. **Re-verify every ledger claim against the WEB code before implementing.** The Swift/Python ledgers
   are a *map of where to look*, not proof of what's here. A claim you can't confirm is a bug in the
   ledger — correct it in the same change. Some lifecycle behaviour may ALREADY exist in the web (e.g.
   parts touched by the override-marker work) — each phase's first step is a web-source assessment.
6. **Fast test loop:** `npm run test:fast` (skips the slow `file-playback.test.ts` pipeline; see
   [[project_guitartap_web_phase2]]). Full run `npm test`; typecheck `npm run typecheck`.

### The per-phase loop (THE PROCESS — follow it in order, every phase)
1. **Start from the Swift doc's `### Port ledger — Phase N` → its `Python / web` subsection** in
   `PEAK-LIFECYCLE-PLAN-SWIFT.md`, PLUS the Python doc's `### Port ledger — Phase N` (ledger corrections).
   PLUS read the Swift code (`git show <phase-hash>`).
2. **Write the web plan INTO THIS DOC first — the doc leads the code.** Verify every ledger claim against
   the *web* source as you go (a claim you can't confirm is a bug — fix it here). Add the phase's
   `### Verified against the web code <date>` + `### The work` + `### Tests` + a REQUIRED
   `### User verification — run-review script` (lifted from the Swift ledger). Flip the header to 🟡.
3. Only then implement → counterpart tests (the named slug) → `@parity` tags → `gen_parity_map --check`
   (79) → the web regression/oracle unmoved.
4. Hand the **run-review script** to the user. **Not done until the user runs it**
   ([[feedback_not_done_until_user_verifies]]) — run-review via `npm run dev` (and `npm run preview` for
   dev-only audio bugs, per [[project_web_strictmode_engine_leak]]). Commit per
   [[feedback_commit_code_then_hash_then_doc]] (mark this doc ✅ COMPLETE with a `<hash pending>`
   placeholder BEFORE committing; the WEB code hash goes in the header; user commits).
5. Mark the header `✅ Phase N COMPLETE … Committed <hash>` — the WEB code hash only. Add a Log line.

### Phase-entry anatomy (match the completed Swift/Python phases)
Before implementing, a phase carries: `### Verified against the web code <date>` (the Swift→web site
mapping, confirmed against source) · `### The work` · `### Tests` (slug + which `.test.ts`) ·
`### Parity / verification` · `### User verification — run-review script` (lifted verbatim from the Swift
ledger — required). After it lands: the `### ✅ Phase N COMPLETE` block + keep the durable `Rule.`.

## Status legend
⬜ not started · 🟡 in progress (plan written, implementing) · ✅ ported + tests green (NOT user-verified) ·
✔️ user-run-reviewed

---

## Phases (goals mirror Swift/Python; all ⬜ — assess web source, then write the per-phase plan here first)

### Phase 1 — The stored set becomes the FULL set  ✅  *(entangled with Phase 2 — one web surgery, mirroring Swift `9f9bc89` which committed 1+2 together)*
**Rule (platform-independent).** Detection stores the FULL peak set, found at a fixed −100 dB floor at
capture time. Peak Min never reaches detection; it is applied afterwards as a projection that hands back
*the same peak objects*, so filtering can never disturb identity. Auto-selection at freeze runs over the
full set. **Invariant: the durable set is NEVER assigned a filtered view.**

**⭐ Why 1+2 are one web surgery.** On Swift/Python the durable set is derived and Peak Min is a cheap
projection, so Phase 1 (store full set) is invisibly separable from Phase 2 (Peak Min = pure filter). On
the web `peakMin` is an **input to `recalculatePeaks`** (`App.tsx:514` dep array) — so even after we detect
at −100, keeping `peakMin` in the recompute would **re-mint the full set on every slider tick** and keep
destroying per-peak state. The correct surgery is the structural-warning one: **detect at −100 into a
durable set, REMOVE `peakMin` from the recompute inputs, and apply Peak Min in a separate display
selector.** That is Phase 1 (full set) + Phase 2 (pure filter) in a single change — exactly as Swift
entangled them into `9f9bc89`. This section plans that combined surgery; the Phase 2 section records the
projection-selector half.

### ✅ Phase 1 (+2) COMPLETE — fast suite green (313), golden `5c264de3941837f8` unmoved, parity 79 + USER-VERIFIED (2026-07-24). Committed `302a4b3`.

**Changed (web):**
- **`recalculatePeaks` (`state/tapToneAnalyzer.ts`)** detects at the fixed **−100 floor**
  (`peakMinOverride: PEAK_DETECTION_FLOOR`, added in `dsp/peaks.ts`) in the frozen/live **and** per-tap
  branches, and the loaded branch keeps the **whole** `loadedPeaks` — `this.peaks` is now the durable
  FULL set. **Dropped the `peakMin` param.**
- **App (`App.tsx`)** removed `peakMin` from the `recalculatePeaks` call + its `useLayoutEffect` dep array
  (the re-mint fix), and added `peaksAbovePeakMin = peaks.filter(mag >= peakMin)` (material passes
  through). The display chain (`sortedPeaks` → `displayPeaks`/`displayPeaksInRange`/`chartPeaks`/`markers`)
  + the live ratio + the averaged-row modes read the projection; **selection state (`useAnnotations`) and
  the save path read the full set.** So the slider no longer re-runs `findPeaks` — per-peak state
  (selection/overrides/offsets) survives it.
- **Tests (`test/frozen-peak-recalc.test.ts`, slug `test/frozen-peak-recalc`)** re-pointed off the old
  filter-at-detection assertions (PR-A2/A3/A4/PR2 now assert the full set + a `project()` display filter)
  + a new **Peak-Min durability** block (sub-Peak-Min peak kept; hidden-then-revealed peak is the SAME
  object; the set never shrinks). `test/status-message.test.ts` dropped the obsolete `peakMin` arg.

**Verified:** typecheck clean; fast suite 313; **golden unmoved** (detection unchanged, only its timing);
parity 79. `peak-fullset-save` + `peak-selection-persistence` green.

**Run-reviewed by the user 2026-07-24** (invisible at a given Peak Min; sub-Peak-Min reveal works;
override+dragged-label survive a Peak Min sweep; save keeps the full set).

### Verified against the web code 2026-07-24
| Swift (`9f9bc89`) | Web site (verified) | Action |
|---|---|---|
| `allPeaks` durable full set | **none** — `recalculatePeaks` stores `this.peaks` = the peakMin-filtered set (`state/tapToneAnalyzer.ts:337`) | **ADD** a durable full set (make `this.peaks` the −100 set; add the projection at the App layer — a `peaksAbovePeakMin` `useMemo`) |
| detect at −100 (`peakMinOverride: peakDetectionFloor`) at capture | `findPeaks(..., peakMinThreshold: p.peakMin)` at the frozen/live branch (`:329-333`) AND the per-tap branch (`:344-346`) | **CHANGE** both to detect at the −100 floor (`peakMinOverride: -100`), NOT at `peakMin` — `dsp/peaks.ts:178` default untouched |
| loaded peaks = the full saved set (projection filters) | loaded branch **filters** `loadedPeaks.filter(magnitude >= peakMin)` (`:319`) | **CHANGE** the durable set = the whole `loadedPeaks`; the peakMin filter moves to the display selector |
| Peak Min is a projection, not a detection trigger | `peakMin` is in the `recalculatePeaks` params + the `useLayoutEffect` dep array (`App.tsx:513-514`) | **REMOVE** `peakMin` from `recalculatePeaks` + its dep array (the re-mint fix); add `peaksAbovePeakMin = allPeaks.filter(magnitude >= peakMin)` `useMemo` feeding `displayPeaks`/`displayPeaksInRange`/`markers`/results |
| auto-selection at freeze over the FULL set | *(verify)* — where the web auto-selects at completion | **CONFIRM** it selects over the full −100 set (so a sub-Peak-Min Air is selected at freeze) |
| saved file writes the full set | *(verify)* — does `encode`/`getSnapshot` write `this.peaks` (today filtered) or the full set? (anchor map: "full save set: none") | **CONFIRM/CHANGE** the save path writes the durable full set |
| never assign the durable set a filtered view | the two temptation points are the loaded branch + any recalc that re-stores a filtered list | **TRAP** — both ports hit this; the durable set stays whole |

### The work
1. **`recalculatePeaks` detects at −100** (frozen/live + per-tap), stores the FULL set as the durable
   `this.peaks`; the loaded branch keeps the whole `loadedPeaks`. **Drop the `peakMin` param.**
2. **App layer:** remove `peakMin` from the recompute dep array; add `peaksAbovePeakMin = allPeaks.filter(pk => pk.magnitude >= peakMin)` `useMemo`; route `displayPeaks` / `displayPeaksInRange` / `markers` / the results list / export through it (they read `peaks`/`sortedPeaks` today).
3. **Auto-selection at freeze** runs over the full set (confirm/adjust).
4. **Save path** writes the full set (confirm/adjust).
5. **Invisible display** — findPeaks' local-max test is threshold-independent, so detect-at-−100 then
   filter-at-peakMin ≡ detect-at-peakMin; the visible list must not move. The *new* visible win (the
   Phase 2 half): a peak hidden then revealed via the slider returns **exactly as it was** — overrides
   and dragged offsets keyed by peak id survive, because the slider no longer re-mints peaks.

### Tests — slug `test/frozen-peak-recalc` (+ a durability suite)
Mirror Swift's `PeakMinDurabilityTests` (pinned generic): the saved set keeps peaks below the current
Peak Min; raising Peak Min then lowering it returns the same peak **objects/ids** (overrides + offsets
intact); auto-selection at freeze picks a sub-Peak-Min Air. Re-point any web test asserting the working
set *is* the Peak-Min-filtered set at the projection. **Golden `5c264de3941837f8` / the peak-fixture
regression + oracle MUST NOT move** — the proof only detection's *timing* changed. Parity 79.

### User verification — run-review script (from the Swift ledger + the 1+2 visible win)
1. **Invisible:** normal guitar capture → the Analysis Results list, chart dots, and export look exactly
   as before at the same Peak Min.
2. **Sub-Peak-Min reveal:** on a completed/loaded measurement, lower Peak Min → fainter peaks (incl. a
   low Air) appear, as during live; raise it → they hide; the on-screen ratio updates sensibly.
3. **Per-peak state survives the slider (the 1+2 win):** override a peak's mode + drag its label; raise
   Peak Min past it, then lower it back → the peak returns with its override and dragged position intact.
4. **Save keeps the full set:** save after raising Peak Min; reload; lower Peak Min → the fainter peaks
   are still there (they were not pruned on save).

### Phase 2 — Peak Min becomes a pure filter  ✅ *(landed WITH Phase 1 — one web surgery, committed `302a4b3`, user-verified 2026-07-24)*
**Goal.** A Peak Min change recomputes only the display projection — detects nothing, classifies nothing,
selects nothing. Selection and classification are facts about the *measurement*; only display depends on
Peak Min.

**Done in the Phase 1 (+2) commit** (see the Phase 1 ✅ block above): `peakMin` was removed from
`recalculatePeaks`' inputs + the `useLayoutEffect` dep array, and Peak Min became the App-level
`peaksAbovePeakMin = peaks.filter(mag >= peakMin)` display selector. So a slider tick no longer re-runs
`findPeaks`/`classifyAll` or re-mints peaks — exactly the structural-warning surgery. The "pure filter"
Rule is satisfied; classification (`modeByPeak`) is computed once over the durable set, not per Peak Min.

### Phase 3 — Per-tap entries computed once  ✅
**Rule (from Swift `11689b6`).** A `TapEntry` is detected and classified **once, when it is built**, over
the full −100 dB set, and is thereafter durable — nothing may re-derive it, least of all a display
control. Derived values (the multi-tap Averaged row) resolve over the **durable** set, never the Peak Min
projection.

### ✅ Phase 3 COMPLETE — fast suite green (316), golden `5c264de3941837f8` unmoved, parity 79 + USER-VERIFIED (2026-07-24). Committed `9a92a41`.

**Changed (web):** `processMultipleTaps` + `loadMeasurement` (`state/tapToneAnalyzer.ts`) build each
`TapEntry` with its peaks found **once** at the −100 floor (`findPeaks(..., peakMinOverride:
PEAK_DETECTION_FLOOR)`); the per-tap re-find was **deleted** from `recalculatePeaks` (the web's
`recalculateTapEntryPeaks` equivalent — comment left saying what went + why). `avgModes` (`App.tsx`)
resolves over the durable `peaks`, not `peaksAbovePeakMin`, so the multi-tap Averaged Air/Top/Back is
Peak-Min-independent (spec §5). Tests (`test/frozen-peak-recalc.test.ts`, +3): per-tap sets found once at
the floor; `recalculatePeaks` does NOT re-derive `tapEntries` (same array/object refs); loaded per-tap
path durable. **Named divergence:** load restores per-tap spectra, so the web re-derives per-tap peaks
from them once (deterministic + golden frozen ⇒ equals the saved peaks). Selection-over-durable (Swift
`selectedPeaks`) deferred to Phase 5 (needs the selection-ownership restructure).

**Run-reviewed by the user 2026-07-24** (Taps table steady across a Peak Min sweep; fresh vs reloaded
agree; PDF matches screen; a sub-Peak-Min peak stays in the Averaged row; single-tap load leaves no stale
table).

### Verified against the web code 2026-07-24
| Swift (`11689b6`) | Web site (verified) | Action |
|---|---|---|
| `recalculateTapEntryPeaks()` re-finds per-tap peaks — DELETE it + 3 call sites | the web's equivalent is **inline in `recalculatePeaks`** (`state/tapToneAnalyzer.ts:341-348`): it re-`findPeaks` every entry on every recompute (now at −100 after Phase 1, but still re-derived) | **REMOVE** the per-tap re-find block from `recalculatePeaks` |
| per-tap peaks computed once at capture (`+SpectrumCapture.swift:1664`, `peakMinOverride: floor`) | `processMultipleTaps` (`:220`) and `loadMeasurement` (`:248`) build `tapEntries` with **`peaks: []`**, filled later by recalc | **BUILD** the entries with `peaks: findPeaks(sp, { peakMinOverride: PEAK_DETECTION_FLOOR })` once, at construction. (`findPeaks` ignores `guitarType` — confirmed `peaks.ts:169` — so no guitar-type needed; classification stays at render via `resolvedModePeaks(e.peaks, guitarType)`.) |
| averaged row resolves selection over `allPeaks`, not the projection (`selectedPeaks`) | `avgModes` uses `resolvedModePeaks(peaksAbovePeakMin, …)` (the projection — set in Phase 1) (`App.tsx:618`) | **CHANGE** to `resolvedModePeaks(peaks, …)` (the durable full set) → the multi-tap table becomes Peak-Min-independent (spec §5). *(Selection-based `selectedPeaks` is Phase 5 — web has no selection model for the averaged row yet; strongest-over-durable is the Phase-3 shape.)* |
| per-tap rows over each tap's own set | `tapRows` uses `resolvedModePeaks(e.peaks, …)` (`App.tsx:609`) — `e.peaks` becomes the durable per-tap set after the change | **no change** (already per-tap; durable once the entry is built once) |

**Named web divergence (verified):** load restores per-tap **spectra** (`App.tsx:910` passes
`e.snapshot`), NOT the saved per-tap peaks — so the web re-derives per-tap peaks from the spectra **once**
at load. `findPeaks` is deterministic and the golden is frozen, so this equals the saved peaks; it stays
"computed once, then durable". (Swift restores the saved peaks directly — same durable result.)

### The work
1. **`processMultipleTaps` + `loadMeasurement`** build each `TapEntry` with its peaks found once at the
   −100 floor (`peaks: findPeaks(sp.magnitudesDb, sp.frequencies, { peakMinOverride: PEAK_DETECTION_FLOOR })`).
2. **Delete the per-tap re-find** from `recalculatePeaks` (`:341-348`) — leave a comment saying what went
   and why, so it isn't "restored" as a missing recompute (mirror Swift's removal-point comments).
3. **`avgModes`** resolves over the durable `peaks`, not `peaksAbovePeakMin` — the Averaged Air/Top/Back
   no longer changes with Peak Min.

### Tests — slug `test/frozen-peak-recalc`
- **`peakMinSweep_leavesTapEntriesUntouched`** — with Peak Min out of the recompute this is structurally
  true, but assert it via the analyzer: build entries, then `recalculatePeaks()` again (a non-peakMin
  input change) and assert each `tapEntry.peaks` is the SAME array/objects (not re-minted).
- **`recalculatePeaks_leavesTapEntriesUntouched`** — the direct guard against the deleted re-find
  returning: after building entries, `recalculatePeaks()` must not change them.
- **averaged row keeps a sub-Peak-Min peak** — the durable-set resolution (Swift's
  `selectedPeaks_resolveOverDurableSet`; here: `resolvedModePeaks(peaks)` includes a peak the projection
  would hide). Golden `5c264de3941837f8` unmoved; parity 79.

### User verification — run-review script (from the Swift ledger)
1. A pre-existing multi-tap measurement holds its **Taps** table steady across a Peak Min sweep.
2. A fresh multi-tap capture, saved and reloaded, **agrees with itself** (per-tap + Averaged rows).
3. The multi-tap PDF's per-tap and Averaged rows match the screen.
4. A peak below the current Peak Min still appears in the **Averaged** Air/Top/Back row.
5. Loading a **single-tap** measurement does not leave a stale Taps table showing (the Python Phase-3
   Qt view-reset find — verify the React analogue is absent, which it should be: `tapEntries.length > 1`
   gates it reactively).

### Phase 4 — One "unknown" predicate  ⬜
**Goal.** A single `isUnknown(peak)` + `overriddenPeakIDs`, threaded through every consumer (results
table, chart dots, annotations, legacy fallback). Naming a peak identifies it. *(Web assess: web dots
filter by assigned-mode, not `isKnown` — the tracked divergence in [[project_dot_annotation_parity]].)*

### Phase 4a — Rename to `peaksAbovePeakMin`  ⬜
**Goal.** The display projection is named `peaksAbovePeakMin` (mirror Swift/Python); the durable set is
`allPeaks`. *(Web assess: current names in `App.tsx` / `fromLive`.)*

### Selection-ownership restructure — PREREQUISITE for Phase 5  ⬜
**Decided 2026-07-24.** Swift keeps `selectedPeakIDs` + `peakModeOverrides` (and the
`enforceDefinitiveModeUniqueness` invariant) on the **analyzer/model**; the web keeps `selectedIds` +
`overrides` in the **view** (`useAnnotations`) — the standing architectural divergence
([[project_architectural_restructure]], `RESTRUCTURE-NOTES.md` "Peak-selection & annotation ownership →
analyzer"). Porting Phase 5's rules **non-divergently requires** that state on the model, so this
restructure lands as a **discrete step right before Phase 5**: move `selectedIds`/`overrides` (+ dragged
offsets) off `useAnnotations` onto `TapToneAnalyzer`, the view reduced to read/dispatch. Then Phase 5 is
purely "port the enforce-uniqueness rules onto the now-model-owned state" (mirroring how Swift's Phase 5
was just the rules), and Phase 3's `selectedPeaks` + Phase 6's definitive values read that same model
selection. **From Phase 5 onward the web's selection architecture mirrors Swift's.**

### Phase 5 — The selection model  ⬜
**Goal.** Classification (band membership + override) is independent of selection (which candidate is
definitive). **Invariant: at most one selected peak per Air/Top/Back**; Dipole/Ring/Upper unconstrained.
Enforced in ONE place, from select-a-peak and from change-mode-of-a-selected-peak. No auto-promotion.
*(Runs on the model-owned selection state from the restructure above; the enforce logic becomes an
analyzer method, mirroring Swift `enforceDefinitiveModeUniqueness`.)*

### Phase 6 — Derived values unified  ⬜
**Goal.** Every derived "the Air/Top/Back" reads the DEFINITIVE peak (selected + override-aware mode) via
one shared `effectiveMode` resolver — analyzer, saved-measurement ratio, static resolver cannot disagree.
Legacy files healed on read. *(Web assess: `classify.ts` `effectiveMode`? `tapToneRatio` in
`analysisQuality.ts`; the PDF/table already override-aware from the marker work — how much of 6 exists?)*

### Phase 6b — Definitive modes for the two override-blind surfaces  ⬜
**Goal.** Comparison `modePeakIDs` (self-describing saved comparisons) + `definitiveModeInfo` for the
multi-tap Averaged row. **The `.guitartap` format already carries `modePeakIDs` (Swift writes it)** — the
web `ComparisonEntry`/decode must round-trip it (do NOT silently drop it) + heal legacy. *(Web assess:
`src/measurement/` comparison decode/encode — does it read/write `modePeakIDs`?)*

### Phase 7 — The remaining triggers  ⬜
**Goal.** (1) Guitar-type change = clean slate for the new type (reclassify, clear overrides,
re-auto-select) firing ONLY on an actual type change; display-only change disturbs nothing; the reset
control stays pure-auto. (2) A new tap sequence clears ALL per-peak state. (3) Analysis-range SETTING
removed (fixed 30–2000 constant; UI + Help). (4) Teardown verified per-platform (React effect cleanup —
NOT the Swift Combine `deinit`). *(Web assess: the Apply/settings flow in `App.tsx`; the analysis-range
setting + its Help entry in `QuickStartGuide.tsx`.)*

---

## Paired tests already owed to the web (land with the relevant phase)
- **Phase 5/6/6b:** the `test/annotation-state.test.ts` D-tests (definitive uniqueness, effective mode,
  `definitiveModeInfo`) + `test/comparison-mode.test.ts` (`modePeakIDs` round-trip / render / heal) —
  paired counterparts of what Swift + Python now pin.
- **Phase 7:** `Phase7Triggers`-equivalent tests (clean-slate clears overrides + resets selection;
  new-sequence clears all per-peak state) — the Swift/Python pair (`reclassifyForGuitarTypeChange` /
  `startTapSequence` clearing). Web owes these too (user directive: paired tests go to all three).
- **Dot/annotation parity:** the missing 3-platform dot-list test ([[project_dot_annotation_parity]]).

## Cross-cutting deliverables (web)
- **Docs:** release notes `src/components/ReleaseNotes.tsx` + in-app Help/Quick-Start
  `src/components/QuickStartGuide.tsx` — mirror the Swift/Python wording (Peaks & Modes behaviours; Peak
  Min = display filter; Re-analyze; guitar-type clean slate; analysis-range removed). See
  [[project_doc_surfaces]].
- **Override-marker on the comparison/multi-tap tables** — DEFERRED from the override-marker work: web's
  `MultiTapComparisonResultsView` / `ComparisonResultsView` / `PdfComparison` carry no override info yet;
  it needs the `definitiveModeInfo` / `modePeakIDs` pipeline from Phases 6/6b (see
  `Development/OVERRIDE-MARKER-CONSISTENCY.md`). Fold into 6b.

## Log
- 2026-07-24 — doc created (prep). Structure mirrors the Swift/Python plans. Phases are goal-stubs; each
  begins with a web-source assessment written INTO this doc before any code. RESUME at **Phase 1
  assessment**.