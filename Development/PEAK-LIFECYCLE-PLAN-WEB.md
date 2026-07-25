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

### Phase 4 — One "unknown" predicate  ✅
### ✅ Phase 4 COMPLETE — fast suite green (319), golden `5c264de3941837f8` unmoved, parity 79 + USER-VERIFIED (2026-07-24). Committed `969eac7`.
**Changed (web):** `peaksInDisplayRange` (`dsp/guitarModes.ts`) gained `overriddenPeakIds: Set<number>`
(Swift's param order); filter `overriddenPeakIds.has(p.id) || isKnown(freq)`; doc comment reversed with a
`- Note:`. `overriddenPeakIds` built once at the App (`App.tsx`) from the freq-keyed overrides
(`peaks.filter(overrides.has(keyOf)).map(id)` — freq→id isolated there); `displayPeaks` (table) ORs the
override in, moved below `useAnnotations`; `chartPeaks` passes the set. Badges derive from the dot set.
Tests (`test/dot-layer.test.ts`): DL8 (named out-of-band peak visible with setting off), DL9 (override
kind irrelevant to dots), DL10 (named peak gets dot + badge; unnamed out-of-band gets neither); DL1–7
stand. **Also (bundled):** `PeakCard.tsx` — the "Reset to Auto" menu item moved to the TOP, matching
Swift/Python. **Run-reviewed by the user 2026-07-24** (name out-of-band peak, setting off → stays; menu
order correct).

**Rule (from Swift `08c66d5`).** A peak is unknown only when auto-classification placed it in no mode band
**and** the user has not named it — **naming a peak makes it known**. One predicate governs the display
surfaces; the annotation surface additionally applies its All/Selected/None gate. With Show Unknown Modes
**on**, nothing is filtered anywhere. Behaviour-preserving for every non-overridden peak (assigned-unknown
≡ positionally-out-of-band, because `classifyAll` falls back to a per-frequency lookup).

**Exact Swift shapes (read from the diff):**
- `overriddenPeakIDs = Set(peakModeOverrides where .assigned)` — the ids of user-named peaks.
- `isUnknown(peak) = peakMode(peak).normalized == .unknown && !hasManualOverride(peak.id)` (the table).
- `peaksInDisplayRange` gains `overriddenPeakIDs: Set<UUID> = []`; filter becomes
  `overriddenPeakIDs.contains($0.id) || isKnown(frequency:)` (the dots) — kept static + pure.
- The `GuitarMode.peaksInDisplayRange` doc comment (which argued "the positional test belongs on a chart
  layer") is **reversed** with a `- Note:` recording what changed and why.

### Verified against the web code 2026-07-24
| Swift site | Web site (verified) | Action |
|---|---|---|
| table `!isUnknown` | `displayPeaks` (`App.tsx:537`): `(modeByPeak.get(p.id) ?? 'unknown') !== 'unknown'` — assigned-mode, override-blind | keep the assigned-mode form but OR in the override: `… !== 'unknown' \|\| overridden` |
| dots `peaksInDisplayRange` | `peaksInDisplayRange` (`dsp/guitarModes.ts:118`): `isKnown(p.frequency, guitarType)` — positional, override-blind; the doc comment `:108-111` argues positional-belongs-on-chart (the reversible one) | add `overriddenPeakIds: Set<number> = new Set()`; filter `overriddenPeakIds.has(p.id) \|\| isKnown(...)`; **rewrite the doc comment** |
| dots caller | `chartPeaks` (`App.tsx:682`) | pass `overriddenPeakIds` (built at App from the freq-keyed overrides) |
| annotation badges | derived from `chartPeaks` via `buildGuitarMarkers(chartPeaks, …, annotationMode, …)` (`App.tsx:686`) — the All/Selected/None gate is inside `buildGuitarMarkers` | **no change** — badges are a subset of the (now override-aware) dot set |
| Swift's 4th "legacy fallback" site | **none** — the saved-measurement export (`measurementImage.ts:181`) passes ALL `loadedPeaks` to `buildGuitarMarkers` (no unknown filter), so it never hides a named peak. Not a Phase-4 site. | confirm the render doesn't separately filter dots by known-ness |

**Web override key = frequency** (`keyOf(p) = p.frequency.toFixed(1)`, `App.tsx:588`), not a UUID like
Swift. So `overriddenPeakIds` is built at the App call site:
`new Set(peaks.filter(p => overrides.has(keyOf(p))).map(p => p.id))` — the freq-key→id conversion stays at
the App layer (the standing web override-keying divergence; the selection-ownership restructure will
re-key onto the model). `peaksInDisplayRange` then checks by `id`, mirroring Swift's `Set<UUID>`.

**Stale-memory correction:** [[project_dot_annotation_parity]] says "web dots filter by assigned-mode, not
`isKnown`". Not any more — DL7 (committed 2026-07-21) already made the dots positional. The web is exactly
at Swift's pre-Phase-4 state: dots positional, table assigned-mode, **both override-blind**. Phase 4 adds
override-awareness to both. (Update that memory when this lands.)

### The work
1. **`peaksInDisplayRange`** (`guitarModes.ts`): constrain `<T extends { frequency: number; id: number }>`,
   add `overriddenPeakIds: Set<number> = new Set()`, filter `overriddenPeakIds.has(p.id) || isKnown(...)`,
   and **rewrite the doc comment** with a `- Note:` (mirror Swift).
2. **`chartPeaks`** (`App.tsx:682`): pass the App-built `overriddenPeakIds`.
3. **`displayPeaks`** (`App.tsx:537`): OR the override into the assigned-mode test.
4. Confirm badges (derive from `chartPeaks`) + the saved-export render.

### Tests — slug `view/dot-layer` (`test/dot-layer.test.ts`)
DL1–DL7 stand (non-override cases where positional ≡ assigned-unknown; DL7's in-band override stays shown,
rationale note updated). Add, mirroring Swift: **DL8** an out-of-band peak becomes visible once named
(freeform), **DL9** the same via a real-mode relabel, **DL10** table/dot/badge all agree on a user-named
peak. `gen_parity_map --check` 79; golden `5c264de3941837f8` unmoved.

### User verification — run-review script (from the Swift ledger; two-step by nature)
1. Show Unknown Modes **on**; name an out-of-band peak (the Back/Dipole gap is easiest) → row, dot, badge
   all present.
2. Show Unknown Modes **off** → the named peak **stays** on all three surfaces. *This is the change.*
3. Repeat with a real mode name ("Top") instead of a freeform label → same.
4. Setting off: an **in-band** custom-labelled peak shows everywhere (the table row is what used to vanish).
5. Setting off: an **unnamed** out-of-band peak is still hidden everywhere — the filter still works.
6. Setting on: everything appears, exactly as before.

### Phase 4a — Durable/display audit (rename + route every measurement-fact to the durable set)  ✅ COMPLETE
*(Verify-and-document phase — no code commit of its own: the durable routing was already done by Phases 1
& 3, the rename landed in Phase 1, and the remaining fact-state move — selection/overrides/offsets onto
the model — is realized by the selection-ownership restructure below (RA `b251418`, RB `fa290d0`, RC).
Deliverables done: the seven-site audit table, the Save-guard confirmation, and the ratio→Phase 6 deferral.)*
**Verified against Swift 2026-07-24** (`getPeak(for:)` @ `TapToneAnalyzer+AnalysisHelpers.swift:72` reads
`allPeaks` + selection + override; the seven-site ledger below). Headline: **Phases 1 and 3 already did the
durable routing, and the web never had Swift's snapshot bug source — so the code-change surface here is
near-zero.** The substantive Swift-alignment work adjacent to 4a is the per-peak-state restructure, which
**folds in here** (next section) — because 4a's own thesis cannot be finished while the per-peak facts
still live in the view.

**Rename — already done (Phase 1).** Analyzer `peaks` = the durable full set (Swift `allPeaks`); the App
`peaksAbovePeakMin` memo = the Peak-Min display projection (Swift `currentPeaks`). Deliverable: strengthen
the `peaksAbovePeakMin` doc comment to name the three scopes (measurement / Peak-Min *setting* / viewport
range + `isUnknown`), mirroring Swift's property doc, so it can never be re-read as "the peaks".

**The seven-site durable-vs-displayed audit — web outcome (no code change):**

| Swift site | Web equivalent | Status |
|---|---|---|
| `+PeakAnalysis:170/577` selection carry-forward + auto-select default | `useAnnotations` `autoIds` over durable `peaks` (App:557) | ✅ already durable (Phase 1) |
| `+PeakAnalysis:178/184` offset + override snapshot | **no web equivalent** — offsets/overrides live in `useAnnotations` useState, never snapshotted from the peak set on recalc | ✅ N/A (but see the structural note below) |
| `+MeasurementManagement:371` saved `selectedPeakFrequencies` | `buildGuitarMeasurement(peaks durable, selectedIds)` | ✅ already durable (Phase 1 full-set save) |
| `+MeasurementManagement:1099` `avgSelectedPeaks` | `avgModes = resolvedModePeaks(peaks)` durable | ✅ already durable (Phase 3) |
| `TapToneAnalyzer:731` `selectAllPeaks` | `selectAll` over durable `peaks` (dies Phase 5) | ✅ already durable |

**Save guard — already WYSIWYG.** Web Save is `disabled={… !captured}` (a measurement exists), never
peaks-empty; already matches Swift's `!isMeasurementComplete`. No change.

**The one measurement-fact reader NOT yet durable → Phase 6, not here.** App `tapRatio` reads
`peaksAbovePeakMin` (display); Swift's ratio reads `getPeak` → `allPeaks` (durable) + selection +
override-aware mode. Correcting the *set* alone now is throwaway — Phase 6 replaces the whole expression
with the unified `getPeak`-equivalent resolver (durable + selection + override in one place). Deferring
here **is** the Swift-aligned choice. (Low interim risk: `resolvedModePeaks` picks the strongest per mode,
and a Peak-Min-hidden peak is by definition too weak to be the Air/Top winner.)

**Tests.** The durable-set behaviour 4a would pin is already pinned by the Phase-1 durability block in
`test/frozen-peak-recalc`. The Swift 4a inverted `…offsetForFilteredOutPeak_isDropped`→`_survives` + new
`reanalyzePreservesStateOfPeaksHiddenByPeakMin` are the PR1/PR3–PR7 `applyFrozenPeakState` family — they
land **with the restructure below** (where the state moves to the model), which
`frozen-peak-recalc.test.ts` lines 11-15 already records.

### Selection-ownership restructure — FOLDS 4a's fact-state audit; runs NOW, before Phase 5  ✅ COMPLETE (RA `b251418` · RB `fa290d0` · RC `37e3183`)
**Decided 2026-07-24 (scope widened from "prerequisite" to "the substantive half of 4a").** 4a's own
thesis — route every *fact about the measurement* to the durable set — cannot be finished while the
per-peak facts (selection / overrides / dragged offsets) still live in the **view** (`useAnnotations`)
keyed by `frequency.toFixed(1)`. Swift's 4a audited *model-owned* state; the web has to *make* the state
model-owned before the equivalent audit means anything. So this is not a cosmetic move — it is where the
web finally matches Swift's architecture ([[project_architectural_restructure]], `RESTRUCTURE-NOTES.md`
"Peak-selection & annotation ownership → analyzer").

**Why the frequency-keyed view state is a real divergence (not just "different"):**
- **Key collisions** — two peaks rounding to the same 0.1 Hz share one override/offset slot; Swift UUIDs can't.
- **Frequency drift on Re-analyze** — `findPeaks` re-runs, a peak's averaged frequency shifts, the key no
  longer matches, and the override is **orphaned**. Swift's remap uses proximity, so it survives.
- **The Phase 5 invariant can't reach view state** — "one definitive peak per Air/Top/Back" is a *model*
  rule; leaving selection in the view forces Phase 5 to run on view state, re-conflating the two.

**The work (mirror Swift):**
- Move `selectedIds` / `overrides` / `annotationOffsets` off `useAnnotations` onto `TapToneAnalyzer`,
  **re-keyed by peak `id`** (Swift `selectedPeakIDs` : `Set<UUID>`, `peakModeOverrides` / offsets keyed by
  UUID). The hook is reduced to read/dispatch against the analyzer.
- Add the explicit **remap-on-re-mint** — the web equivalent of Swift `applyFrozenPeakState`: when
  `recalculatePeaks` re-mints peaks (Re-analyze; new capture), carry selection/overrides/offsets forward
  from the old peaks to the new by **frequency proximity**, reading the **durable** old set (this is where
  Swift 178/184 read the *display* set and dropped hidden peaks — the web must read durable). Peak Min no
  longer re-mints (Phase 1), so this fires only on Re-analyze / new capture.
- Land the paired **model** tests: PR1/PR3–PR7 (`applyFrozenPeakState` remap) + the two Swift 4a
  `…ForFilteredOutPeak_survives` tests + `reanalyzePreservesStateOfPeaksHiddenByPeakMin`, appended to
  `test/frozen-peak-recalc`.

Then Phase 5 is purely "port the enforce-uniqueness rules onto the now-model-owned state" (mirroring how
Swift's Phase 5 was just the rules); Phase 3's `selectedPeaks` + Phase 6's definitive values read that same
model selection. **From here on the web's selection architecture mirrors Swift's.**

**Swift anchors to read at implementation:** `applyFrozenPeakState` (`+PeakAnalysis.swift`), `getPeak(for:)`
/ `definitiveModeInfo` (`+AnalysisHelpers.swift:72`), `togglePeakSelection` / `setModeOverride` /
`updateAnnotationOffset` (`TapToneAnalyzer.swift`).

**Selection paradigm — full Swift, one algorithm all three (decided 2026-07-24).** Drop the web's
"derive auto on the fly, store only manual" idiom. `selectedPeakIds` is **concrete** model state, and
`applyFrozenPeakState` **always** recomputes it on re-mint — unmodified ⇒ run `guitarModeSelectedPeakIds`
and store the result; modified ⇒ carry forward by ±5 Hz proximity, keeping below-Peak-Min freqs in
`selectedPeakFrequencies` — exactly Swift's `applyFrozenPeakState` branches, gated by
`userModifiedSelection` (Swift `userHasModifiedPeakSelection`). No `effectiveSelectedPeakIds` getter. The
old "derive it so it can't lag a Peak Min re-mint" reason is void post-Phase-1 (Peak Min no longer
re-mints), and Phase 5's `enforceDefinitiveModeUniqueness` then ports verbatim onto the same concrete
state Swift/Python use.

**Sub-steps — sliced by CONCERN, not by layer (each fully functional + testable → its own commit).** A
by-layer split (analyzer-first, wire-later) leaves dead parallel state until a big-bang cutover; slicing
by concern moves each one end-to-end (analyzer state + remap + App/PeakCard/chart wiring + `fromLive`/
`decode` boundary + tests), so the app works after every commit. File format, golden `5c264de3941837f8`,
and parity are untouched throughout (the file was already id-keyed; only in-memory keying changes).
- **RA — overrides** ✅ **COMPLETE** (`b251418`; user-verified 2026-07-24) → analyzer (id-keyed
  `overrides` + `setModeOverride`/reset + the override half of `applyFrozenPeakState` +
  PeakCard/`overriddenPeakIds` + `fromLive`/`decode` boundary + tests).
- **RB — annotation offsets** ✅ **COMPLETE** (`fa290d0`; user-verified 2026-07-24) → analyzer
  (ONE id-keyed `annotationOffsets` for guitar AND material — `MaterialPeak` gained an `id`, matching
  Swift/Python's single id-keyed store; `updateAnnotationOffset`/reset + the offset half of the remap +
  chart-drag wiring + save/load + tests). Also folded in: the **per-label right-click reset** (right-click
  a badge → ↺ "Reset Position", disabled when unmoved — mirrors Swift `PeakAnnotations.contextMenu`; the
  web had documented it but never wired it).
- **RC — selection** ✅ **COMPLETE** (`37e3183`; user-verified 2026-07-24) → analyzer
  (`selectedPeakIds` + `selectedPeakFrequencies` cache + `userModifiedSelection` + toggle/all/none/wand +
  the selection branch of the remap: auto re-run vs proximity carry-forward with below-min preservation).
  Landed the selection carry-forward + below-Peak-Min-preservation tests. `useAnnotations` **deleted** (it
  had no `@parity` tag). NOTE: the manual-toggle stale-cache is mirrored from Swift (toggle doesn't sync
  `selectedPeakFrequencies`) — a latent cross-platform behavior, candidate for a Phase-5 fix.

#### RA — overrides: diff-level plan  ✅ COMPLETE (`b251418`)
Keeps the web's string-value idiom (`Map` value stays the label string); only the **key** flips
`frequency.toFixed(1)` → numeric peak `id`. Remap tolerance = Swift's ±5 Hz.
- **`tapToneAnalyzer.ts`** — field `overrides: Map<number, string>` (added to the snapshot);
  `setModeOverride(id, label)` / `resetModeOverride(id)` (set/delete + `notify()`; **no**
  `enforceDefinitiveModeUniqueness` — that is Phase 5); `overriddenPeakIds` in the snapshot =
  `new Set(overrides.keys())` (a stale id can't match a live peak, so it is harmless); `restoreOverrides(map)`
  for the load path. New private `applyFrozenPeakState(oldPeaks, newPeaks)` called in `recalculatePeaks`
  just before `this.peaks = peaks`, doing **overrides only** for now: snapshot `{freq → label}` from
  `oldPeaks` (the DURABLE old set), rebuild `this.overrides` against `newPeaks` by ±5 Hz proximity. Identity
  on the loaded path (ids stable); real work only on a findPeaks re-mint (guitar-type / range / Re-analyze).
- **`App.tsx`** — drop `overrides` / `setLabel` / `resetLabel` from the `useAnnotations` destructure;
  `labelFor(p,mode) = snapshot.overrides.get(p.id) ?? MODE_DISPLAY_NAME[mode]`;
  `overriddenPeakIds = new Set(snapshot.overrides.keys())`; `isManualOverride = snapshot.overrides.has(p.id)`;
  PeakCard `onSetLabel/onResetLabel` → `analyzer.setModeOverride(p.id, …)` / `resetModeOverride(p.id)`;
  `buildGuitarMeasurement` `overridesByFreq: overrides` → `overridesById: snapshot.overrides`; load restore
  routes overrides to `analyzer.restoreOverrides(...)` (selection/offsets stay in the hook until RC/RB).
  `keyOf` stays for now (offsets still use it — retired in RB).
- **`fromLive.ts` / `decode.ts`** — the conversion boundary flips freq-key → id-key: `overridesByFreq:
  Map<string,string>` → `overridesById: Map<number,string>` (save reads `a.overridesById.get(p.id)`; load
  builds the id-map against the loaded peaks' numeric ids, reusing decode's existing ±proximity heal).
  **`encode.ts` / `types.ts` / the file are unchanged** — already file-id-keyed.
- **Tests** — analyzer override set/reset + the ±5 Hz override-remap (survives within tolerance, orphans
  beyond); re-point `fromLive`/`decode` round-trip + any `overridesByFreq` fixtures (e.g. `dot-layer`) to
  id-keys. Golden `5c264de3941837f8` unmoved; `gen_parity_map --check` = 79; `npx tsc --noEmit` clean.
- **After RA** the app is fully functional — overrides model-owned + id-remapped; offsets + selection still
  ride `useAnnotations` untouched.

#### RB — annotation offsets: diff-level plan  ✅ COMPLETE (`fa290d0`)
Same mechanics as RA (id-key + ±5 Hz remap), for guitar AND material — the **unified single store** that
matches Swift and Python (decided 2026-07-24 after checking both).

**Design decision — ONE id-keyed store (match Swift + Python, don't invent a third design).** Swift keeps
one `peakAnnotationOffsets: [UUID: CGPoint]` and its material L/C/FLC peaks are `ResonantPeak`s WITH UUIDs
in that store; **Python is identical** — `peak_annotation_offsets` keyed by `peak_id`, and its material
peaks (`selected_longitudinal_peak`/`cross`/`flc`) are `ResonantPeak`s with a UUID `id`
(`resonant_peak.py:80`). The web's `MaterialPeak` lacking an id is the divergence. So RB **gives the web's
material peaks ids** and uses a single id-keyed `annotationOffsets: Map<number, [number,number]>` for both
— not the two-field split (which would be a third design). The `.guitartap` file is **already**
material-UUID-keyed (`buildMaterialMeasurement` mints a UUID per material peak), so only live state changes.

- **`MaterialPeak`** gains `id: number`, assigned **role-stably** (L/C/FLC) when a phase's averaged peak is
  stored, so an offset sticks across a Redo. Guitar and material never coexist (cleared between by
  `clearResult`/`resetMaterial`), so their ids share one `Map<number,…>` without collision concern.
- **`tapToneAnalyzer.ts`** — `annotationOffsets: Map<number,[number,number]>` (+ snapshot);
  `updateAnnotationOffset(id,pos)` / `resetAnnotationOffset(id)` / `resetAllAnnotationOffsets()` /
  `restoreOffsets(map)`. Extend `applyFrozenPeakState` with the guitar-offset remap (material entries are
  never present during a guitar re-mint, so nothing to guard). `clearResult` clears offsets; `resetMaterial`/
  `startMaterial` also clear them (material's own reset).
- **`buildGuitarMarkers` + `buildMaterialMarkers`** (`measurementImage.ts`) — both take `offsetsById:
  Map<number,[number,number]>` and set `annoKey = String(p.id)`, `annoOffset = offsetsById.get(p.id)`.
- **`App.tsx`** — guitar + material read the analyzer offsets (snapshot); the single chart
  `onAnnotationDrag` is `(key,pos) ⇒ analyzer.updateAnnotationOffset(Number(key), pos)` for both (markers
  carry `String(id)`); `hasMovedLabels`/`resetLabels` read the analyzer store; guitar + material save →
  `annotationOffsetsById`; restore → `analyzer.restoreOffsets(...)`.
- **`fromLive.ts`** — `annotationOffsetsByFreq` → `annotationOffsetsById: Map<number,[number,number]>` in
  `BuildMeasurementArgs`, `LiveRestore`, `BuildMaterialArgs`, `MaterialRestore`; save reads by material-peak
  id → the minted file UUID (as today), restore maps file-UUID → material-peak id. File format unchanged.
- **Tests** — analyzer offset set/reset/remap (survives id-shift, orphans beyond ±5 Hz, clearResult,
  restore) + a material-offset id set/restore case; re-point `fromLive`/`g6` offset round-trips to id-keys.
  Golden `5c264de3941837f8` unmoved; `--check` = 79; `tsc` clean.
- **After RB** the app is fully functional — guitar+material overrides+offsets model-owned & id-keyed
  (one store, matching Swift/Python); only **selection** still rides `useAnnotations`.

#### RC — selection: diff-level plan  ✅ COMPLETE (`37e3183`)
The final slice: move selection onto the analyzer as **concrete** state (full-Swift paradigm, decided
2026-07-24 — no derived `effectiveSelectedIds`), then delete `useAnnotations`. This clears the runway for
Phase 5 (the enforce-uniqueness rules port onto this same model-owned state).

**Swift being mirrored** (`+PeakAnalysis.swift`, `TapToneAnalyzer.swift`):
- State: `selectedPeakIDs: Set<UUID>` (concrete) + `selectedPeakFrequencies: [Float]` (the **stable
  cache** so a selected peak hidden below Peak Min survives and re-selects when revealed) +
  `userHasModifiedPeakSelection`.
- `applyFrozenPeakState` selection branch: snapshot `previouslySelectedFrequencies` (from the cache, or
  derive from `selectedPeakIDs` over the durable OLD peaks) **before** re-mint; then — **modified** ⇒
  carry forward by ±5 Hz proximity, keeping below-threshold freqs in the cache so they re-select later;
  **unmodified** ⇒ re-run `guitarModeSelectedPeakIDs` and store the result. (Swift's material branch is
  N/A — the web has no per-peak material selection.)
- `togglePeakSelection` (flip id in the set, `userModified = true`; **NO** `enforceDefinitiveModeUniqueness`
  — that is Phase 5), `selectNoPeaks`, `resetToAutoSelection` (the wand: `userModified = false`, clear the
  cache, `selectedPeakIDs = guitarModeSelectedPeakIDs(allPeaks)`). `selectAllPeaks` is KEPT here (moved,
  not removed) — Phase 5 removes it.

**The moves:**
- **`tapToneAnalyzer.ts`** — fields `selectedPeakIds: Set<number>`, `selectedPeakFrequencies: number[]`,
  `userModifiedSelection: boolean` (+ snapshot; the snapshot exposes the CONCRETE `selectedPeakIds`, not a
  derived set). Methods `togglePeakSelection` / `selectAllPeaks` / `selectNoPeaks` / `resetToAutoSelection`
  / `guitarModeSelectedPeakIds(peaks)` (wraps `resolvedModePeaks`) / `restoreSelection(ids, freqs,
  userModified)` — all fresh-Set/array reassignment for memo identity. Extend `applyFrozenPeakState` with
  the selection branch (snapshot prev-freqs before `this.peaks = peaks`). `clearResult` resets selection
  (empty set, `userModified = false`, empty cache) — the next recalc auto-selects.
- **`App.tsx`** — read `snapshot.selectedPeakIds` (drop the `useAnnotations` destructure entirely); wire
  the star/Select-None/Select-All/wand to the analyzer methods; the wand's disabled state reads
  `snapshot.userModifiedSelection`; save reads `snapshot.selectedPeakIds` + `userModifiedSelection`; load
  calls `analyzer.restoreSelection(...)` (its stable-id restore needs no capture-reset guard now).
- **`useAnnotations.ts`** — **deleted**. Move its `@parity view/annotations` (or equivalent) tag onto the
  analyzer + regenerate PARITY-MAP. The `captured`/`material` fresh-capture reset it did for selection is
  now `clearResult` on the analyzer.
- **`fromLive.ts` / load** — `LiveRestore` already carries `selectedIndices` + `userModified`; add the
  selected-peak **frequencies** for the cache (or derive from the loaded peaks at restore). File format
  unchanged (`selectedPeakIDs` + `selectedPeakFrequencies` already written).

**Tests** — PR1/PR3–PR7 selection carry-forward in `test/frozen-peak-recalc`: a selected peak survives a
re-mint that shifts its id (±5 Hz); a **below-Peak-Min selected peak's frequency is preserved and
re-selects on reveal** (the stable-cache invariant — the core survives-test); `resetToAutoSelection` re-autos
over the durable set; `clearResult` empties it. Re-point `test/annotation-state` selection setup to the
analyzer. Golden `5c264de3941837f8` unmoved; `--check` = 79; `tsc` clean.
- **After RC** selection is concrete model state (one algorithm across all three); `useAnnotations` is gone;
  Phase 5's `enforceDefinitiveModeUniqueness` ports verbatim onto `selectedPeakIds`.

### Phase 5 — The selection model  ✅ COMPLETE (`3e50e10`; user-verified 2026-07-24)
**Goal.** **Invariant: at most one *selected* peak per Air/Top/Back** — the selected one is *the*
definitive Air/Top/Back; Dipole/Ring/Upper are clusters and unconstrained. Enforced in ONE place, called
from the only two things that can break it: selecting a peak, and changing the mode of an *already-selected*
peak. No auto-promotion.

**This is a SELECTION problem, not classification.** Classification (band membership) is independent and
unconstrained, and **multiple same-mode candidates are perfectly fine** — whether they arose from
classification (several peaks in the Top band) OR from a user override to that mode. Deselecting never
relabels. The uniqueness constraint is purely about the **selection**, and ONLY for the single-holder modes
**Air / Top / Back**: it fires only when a peak whose *effective* mode is Air/Top/Back is selected (or an
already-selected peak is overridden to one) while another selected peak already holds that same mode. For
any other mode — **Dipole / Ring / Upper** (and Unknown) — multiple selected peaks are fine; nothing is
enforced. Mode is resolved through the **override-aware** path (Swift `peakMode(for:)` =
`effectiveMode(override, auto)`), NEVER `classifyAll` / `identifiedModes` alone (override-blind).

**Verified against the web code 2026-07-24.**
- Selection is model-owned (RC). `togglePeakSelection`'s select branch already has the placeholder for the
  enforce; `setModeOverride` (RA) currently just sets the override.
- The web has **no override-aware mode resolver yet.** `modeByPeak` is `classifyAll` (override-blind);
  overrides are a separate id→display-name-string map. So Phase 5 adds `effectiveMode(id)`, the direct
  mirror of Swift `peakMode(for:)` → `GuitarMode.effectiveMode(override:auto:)` (`GuitarMode.swift:473`):
  `if an override exists → MODE_BY_DISPLAY_NAME[override] ?? 'unknown'` (a **freeform** override →
  `'unknown'`, it does NOT fall through to auto — matching Swift's `fromDisplayName(label) ?? .unknown`);
  `else → modeByPeak[id] ?? 'unknown'`. NOT `MODE_BY_DISPLAY_NAME[override] ?? modeByPeak[id]` (that `??`
  would wrongly fall a freeform override through to the auto mode). The web `ResolvedMode` is already
  canonical, so no `.normalized` step.
- **Reset-to-Auto label fix (folded into Swift's Phase 5): ALREADY satisfied on the web.** `PeakCard`'s
  `autoName = MODE_DISPLAY_NAME[mode]` already uses the override-blind `mode` prop (`modeByPeak`), so the
  "Reset to Auto (X)" item already names the auto-classification, not the override. No change.
- The web has **no `selectAll` tests** to delete (they were Swift-specific).

**The work (mirror Swift `enforceDefinitiveModeUniqueness`):**
- **`tapToneAnalyzer.ts`** — `effectiveMode(id): ResolvedMode` (override-aware; imports
  `MODE_BY_DISPLAY_NAME` — a minor state→presentation coupling, precedent: `MaterialPeaks` from
  components; Phase 6 unifies the resolver). `singleHolderModes = {'air','top','back'}`.
  `enforceDefinitiveModeUniqueness(id)`: guard guitar + `selectedPeakIds.has(id)` + the peak exists; resolve
  `mode = effectiveMode(id)`; if `singleHolderModes.has(mode)`, deselect every OTHER selected peak whose
  `effectiveMode == mode`. Only ever REMOVES from the selection — never reclassifies, never promotes. Call
  it from `togglePeakSelection` (select branch — replace the placeholder) and `setModeOverride` (after
  writing the override). **Remove `selectAllPeaks`.**
- **`App.tsx`** — remove the **Select All** button (`CheckIcon`, ~:1372) + the `selectAll` dispatcher (drop
  the now-unused `CheckIcon` import if nothing else uses it). Keep **Select None** + the **wand**.
- **Tests, slug `test/annotation-state`** — new `DefinitiveModeUniqueness` suite, six cases, each driven by
  manual assignment (override) to create the same-mode selection: (1) assign+select a second Top → the first
  Top deselects, and the displaced peak stays classified Top (deselect ≠ relabel); (2) Dipole allows several
  selected; (3) override an *already-selected* peak into Top → displaces the holder; (4) override an
  *unselected* peak into Top → no selection change; (5) override the definitive Top *away* → Top holderless
  (no promotion); (6) Select None leaves classification intact. No deletions (web never had `selectAll` tests).

**Risk:** medium — user-visible (Select All gone; selection now enforces one definitive Air/Top/Back).

**User verification — run-review script:**
1. Assign a peak to **Top** and select it while another Top is already selected → the previous Top
   deselects; the displaced peak keeps its Top classification (its row/label unchanged, just unstarred).
2. Select several **Dipole** (or Ring/Upper) peaks → all stay selected.
3. Override an **already-selected** peak to Top → the previous definitive Top deselects.
4. Override an **unselected** peak to Top → nothing in the selection changes.
5. Override the **definitive Top away** (to another mode) → Top now has no definitive peak; nothing
   auto-promotes.
6. **Select None** → classification/labels intact; nothing relabels.
7. The **Select All** button is gone; Select None + wand remain.

### Phase 6 — Derived values unified  ✅ COMPLETE (`6d2ca8a`; user-verified 2026-07-24)
*(Folded in: a pre-existing PDF divergence — the Ring-Out card was missing the "Sustain quality"
`detailSubtitle` under the quality label, which Swift's `analysisBox` renders. Fixed in `pdfReport.ts`.)*
**Goal.** Every derived "the Air/Top/Back" reads the **definitive** peak — the *selected* peak whose
*override-aware* mode is that mode — via one shared `effectiveMode` resolver, so the live ratio, the
saved-list ratio, and the exported PDF/image ratio cannot disagree. Legacy files healed to a valid
definitive selection on read.

**Verified against Swift 2026-07-24** (`GuitarMode.effectiveMode` `GuitarMode.swift:473`; analyzer
`getPeak(for:)` `+AnalysisHelpers.swift:72` + `calculateTapToneRatio` `:105`; measurement `definitivePeak`
`TapToneMeasurement.swift:522` + `tapToneRatio` `:505`; decode selection-heal `:731–773`).

**The definitive rule (identical everywhere):** `selectedPeaks.filter(p ⇒ effectiveMode(p) === mode).max(magnitude)`.
`effectiveMode(override, auto)` = a present override → `MODE_BY_DISPLAY_NAME[label] ?? 'unknown'` (freeform →
`'unknown'`), else `auto`. Swift does NOT shortcut via the stored `modeLabel` — it re-runs `classifyAll`
for the auto mode and consults `peakModeOverrides`; the web must do the same.

**Verified against the web code 2026-07-24 — THREE divergent ratio surfaces today, all to unify:**
1. **Live** — `App.tsx:526` `tapToneRatio(peaksAbovePeakMin, guitarType)` (`analysisQuality.ts:71`):
   auto-strongest over the DISPLAY projection; no selection, no override.
2. **Saved-list** — `MeasurementsPanel:31` `measurementTapToneRatio(m)` (`fromLive.ts:320`): selection-aware
   but **override-blind** (`classifyAll`) and takes the FIRST air/top, not the definitive holder.
3. **Exported PDF/image** — `measurementImage.ts:300` `tapToneRatio(r.loadedPeaks, guitarType)`: auto-strongest
   over ALL loaded peaks; no selection, no override. (Feeds `pdfReport.ts:409`.)
The web already has `effectiveSelectedPeakIDs` (`types.ts:142`) and the `healMeasurement`/`wasHealed`
duplicate-peak heal (`decode.ts:266`) to extend.

**The work:**
- **Shared resolver** — add `effectiveMode(overrideLabel: string | undefined, auto: ResolvedMode): ResolvedMode`
  to `presentation/modeColors.ts` (where `MODE_BY_DISPLAY_NAME` lives; the analyzer + `fromLive` already
  import from there). Mirrors Swift `GuitarMode.effectiveMode`. The analyzer's `effectiveMode(id)` (Phase 5)
  delegates to it (behaviour-preserving).
- **Analyzer** — `definitivePeak(mode): Peak | undefined` = `selectedPeaks.filter(p ⇒ effectiveMode(p.id) ===
  mode).max(mag)` (= Swift analyzer `getPeak(for:)`); `tapToneRatio(): number | null` =
  `definitivePeak('top').freq / definitivePeak('air').freq` or null (= Swift `calculateTapToneRatio`).
- **Live ratio** — `App.tsx:526` `tapRatio` reads `analyzer.tapToneRatio()` (a `useMemo` keyed on the
  snapshot). Selected + override-aware over the durable set.
- **Saved-measurement ratio** — rewrite `measurementTapToneRatio` to Swift's `definitivePeak` rule:
  `classifyAll(peaks-by-index)` + `peakModeOverrides` (by file id) + `effectiveMode`, filter
  `effectiveSelectedPeakIDs(m)`, `max(mag)`, top/air. A `measurementDefinitivePeak(m, mode)` helper.
- **Exported PDF/image ratio** — `measurementImage.ts:300` calls `measurementTapToneRatio(m)` instead of
  `tapToneRatio(r.loadedPeaks)`, collapsing surfaces 2+3 onto the one definitive resolver.
- **Remove `analysisQuality.ts:tapToneRatio`** (the auto-strongest one) — now unused, and it is exactly the
  divergent implementation this phase eliminates. Migrate its `analysis-quality.test.ts` cases into the new
  definitive tests.
- **Legacy heal** — extend `healMeasurement` (`decode.ts`) with the guitar-only selection heal (Swift
  `:731–773`): `isMaterial` guard; `autoMap = classifyAll(peaks)`; `effMode(p) = effectiveMode(overrides[id],
  autoMap[id])`; `singleHolder = {air,top,back}`. **nil selection** → set it to the strongest peak per
  effective mode (skip unknown); **else** → prune to at most the strongest selected peak per single-holder
  mode (cluster modes + unknown untouched). Set the existing `wasHealed`/re-save flag.

**Deliberately deferred to Phase 6b (mirroring Swift's split):** the multi-tap **Averaged row** →
`definitiveModeInfo` (selected + override-aware) and the comparison `modePeakIDs` (a `.guitartap` format
addition) + the override-marker on the comparison/multi-tap tables. **Web efficiency:** Swift's Phase 6
core made the on-screen Averaged row override-aware via `resolvedModePeaks(overrides:)` as an intermediate
step before 6b upgraded it to `definitiveModeInfo`; the web SKIPS that throwaway step and does the
definitive Averaged row directly in 6b (identical end state).

**Tests, slugs `test/annotation-state` + `test/measurement-codable`.** Analyzer definitive-ratio cases
(selected-holder-not-strongest; rename-the-Top-drops-ratio; deselect-drops-ratio; override-retargets-Top);
saved-ratio override/selection cases (freeform override → null; override retargets Top; deselected Top →
null; live == saved for the same measurement); decode selection-heal (nil → healed to definitive; two Tops →
pruned; valid → not reflagged). **Fixture caution (from the Swift ledger):** mode bands are per guitar type
(classical Top 170–230, generic 140–260) — pick fixture freqs against the actual band table, and put a peak
below the Back lower bound when you need it Top-only.

**Risk:** medium — ratios change for any measurement where a winner was deselected/overridden (intended); a
legacy file with a bad/nil selection is silently repaired + re-saved on first load.

**User verification — run-review script:**
1. Rename the **Top** peak (to another mode or a freeform label) → the tap-ratio disappears — on screen AND
   in the exported PDF/image.
2. **Deselect** the definitive Top → ratio disappears.
3. Relabel/assign another peak to **Top** and select it → the ratio returns, using that peak.
4. Open a measurement saved **before this work** (nil or messy selection) → it shows a sensible ratio and, if
   its selection was bad, is silently repaired (and re-saved by the library).
5. For the same measurement, the **on-screen ratio == the saved-list ratio == the PDF ratio**.

### Phase 6b — Definitive modes for the two override-blind surfaces  ✅ COMPLETE (`9c8ddd2`; user-verified 2026-07-24)
**Goal.** The two surfaces Phase 6 core left override-blind: the multi-tap **Averaged row** and the
cross-measurement **comparison** table. **Two UNRELATED tracks** sharing the `ComparisonEntry` container —
keep them separate (user ruling).

**Verified against Swift 2026-07-24** (`ComparisonEntry.modePeakIDs`/`modeIDMap`/`modeFrequency`
`TapToneMeasurement.swift:87–131`; `definitiveModeInfo` analyzer `+AnalysisHelpers.swift:82` + measurement
`:537`; the decode comparison-heal `:775–793`). **Key facts nailed down:**
- `modePeakIDs` is keyed by `GuitarMode.rawValue` = **"Air (Helmholtz)" / "Top" / "Back"** — which EQUALS
  the web `MODE_DISPLAY_NAME`, so the web writes the SAME keys Swift/Python read. Value = a peak id that
  references the entry's OWN `peaks`.
- **Peak ids round-trip through comparison entries on the web** (`encodePeak` writes `id`, `decodePeak`
  reads it — the ledger's must-verify: ✓). So the id-referenced map is viable.
- `ComparisonEntry` carries **no `isOverride`** → the comparison table shows the definitive freq but **no**
  italic/`*` marker. The italic+`*` marker is EXCLUSIVE to the multi-tap Averaged row (`definitiveModeInfo`
  carries `isOverride`). Matches Swift — do NOT add a marker to the comparison table.
- The web routes EVERY comparison-style table (cross-measurement comparison + the multi-tap PDF) through
  ONE resolver, `comparisonEntryModeFreqs` (`fromLive.ts:766`) — updating it covers all render sites.

**Track 2 — multi-tap MEASUREMENT (NO format change; all data is in its own file).**
- **`tapToneAnalyzer.ts`** — `definitiveModeInfo(): { air|top|back → { frequency, isOverride } | null }`
  = `definitivePeak(mode)` per mode + `isOverride = overrides.has(peak.id)` (Swift `definitiveModeInfo` /
  `hasManualOverride`).
- **On-screen Averaged row** — `App.tsx:617` `avgModes` reads `analyzer.definitiveModeInfo()` instead of
  `resolvedModePeaks(peaks)`. `MultiTapComparisonResultsView`'s `avg` prop gains the per-mode `isOverride`;
  the Averaged `FreqCells` render **italic + trailing ` *`** on an overridden value (the app-wide override
  marker, [[project_override_marker_consistency]]). Per-tap rows unchanged (each tap's own auto-classification).
- **Multi-tap PDF Averaged row** — `multiTapComparisonEntries` (`fromLive.ts:737`) populates the "Averaged"
  entry's `modePeakIDs` via `measurementDefinitivePeak(m, mode)` (override-aware); per-tap entries get none
  (positional). Then `comparisonEntryModeFreqs` reads it. (No italic marker in the PDF container — no
  `isOverride` field, matching Swift.)

**Track 1 — comparison MEASUREMENT (FORMAT CHANGE; aggregates *other* measurements' overrides).**
- **`types.ts`** — `ComparisonEntryModel` gains `modePeakIDs?: Record<string, string>` (key = the mode's
  `MODE_DISPLAY_NAME`, value = an entry-peak id).
- **`encode.ts` / `decode.ts`** — write/read `modePeakIDs` on the comparison entry (round-trip, don't drop).
- **`fromLive.ts` `buildComparisonEntries`** — populate `modePeakIDs` from EACH SOURCE measurement:
  `measurementDefinitivePeak(source, 'air'|'top'|'back')` → its id (the entry keeps the source's selected
  peaks, SAME ids, so the id is in `entry.peaks`). A `modeIDMap` helper.
- **`comparisonEntryModeFreqs`** — read `entry.modePeakIDs[MODE_DISPLAY_NAME[mode]]` → the peak in
  `entry.peaks` → its frequency; **fall back** to `resolvedModePeaks` (positional) only when absent. This
  one change makes the comparison table, the detail view, and the comparison PDF all self-describing.
- **Legacy heal** — in `healMeasurement` (`decode.ts`): a decoded comparison whose entries lack
  `modePeakIDs` is filled positionally (`resolvedModePeaks`, override-blind — an old file never stored the
  sources' overrides, so this only freezes what the old app showed) + set `wasHealed`/re-save.

**Tests, slug `test/comparison` (+ Track 2 in `test/annotation-state`).** The self-describing test is the
important one — `comparisonEntryModeFreqs` reads the stored `modePeakIDs` even when it deliberately
DISAGREES with `classifyAll` (proves the reader must NOT re-classify); a source override shows as the
comparison's Top; `modePeakIDs` round-trips; a legacy entry heals + flags re-save. Track 2: the Averaged
row honours an override (retargets the definitive Top) and marks it italic+`*`.

**Risk:** medium — a `.guitartap` format addition (comparison `modePeakIDs`) + a user-visible Averaged-row
change. Golden untouched (no DSP).

**User verification — run-review script:**
1. Multi-tap: capture/load a multi-tap guitar measurement, override the Top on the averaged result → the
   **Averaged** row shows the overridden Top (and Back re-fills correctly), marked italic + ` *`; per-tap
   rows are unchanged.
2. Comparison: compare measurements where one has a renamed/overridden Top → the comparison table + PDF
   show the rename. Save, reload → still correct.
3. Open a comparison saved **before this build** → sensible values, silently re-saved (self-healed).
4. A multi-tap PDF's Averaged row respects the override.

### Phase 7 — The remaining triggers  ✅ COMPLETE (`998efb7`; user-verified 2026-07-24)
**Implemented (suite 361 fast, golden `5c264de3941837f8` unmoved, parity 79):** analyzer
`reclassifyForGuitarTypeChange(guitarType)` (clear overrides + `resetToAutoSelection`) +
`startTapSequence` unified (delegates to `clearResult` + arm); `App.tsx` type-transition converted to a
layout effect (before recalc) gating subtype clean-slate vs paradigm reset via `prevTypeRef`, and the
measurement-type-notify effect promoted to a layout effect for ordering; analysis-range setting removed
(`ANALYSIS_MIN_HZ`/`ANALYSIS_MAX_HZ` in `dsp/peaks.ts`; fields gone from `settings.ts`/`ANALYSIS_KEYS`;
`SettingsPanel` control + `QuickStartGuide` Help entry + stale "analysis range" comments removed). Paired
twins added to `test/annotation-state.test.ts` (clean-slate + `startTapSequence` clears-all). Items 5 +
teardown verified already-satisfied. **Awaiting the run-review below before commit.**
**Goal.** (1) Guitar-type change = clean slate for the new type (reclassify, clear overrides,
re-auto-select) firing ONLY on an actual type change; display-only change disturbs nothing; the reset
control stays pure-auto. (2) A new tap sequence clears ALL per-peak state. (3) Analysis-range SETTING
removed (fixed 30–2000 constant; UI + Help). (4) Teardown verified per-platform (React effect cleanup —
NOT the Swift Combine `deinit`). *(Web assess: the Apply/settings flow in `App.tsx`; the analysis-range
setting + its Help entry in `QuickStartGuide.tsx`.)*

**🐛 MUST-FIX here (found in RA run-review 2026-07-24, deferred to 7 with the user).** The
measurement-type-change effect (`App.tsx` `useEffect` on `settings.measurementType`, ~:335–350) fires on
**any** type change — including a guitar **subtype** change (generic↔flamenco↔classical↔acoustic) — and
does a full reset (`setLoadedPeaks(null)` + `analyzer.clearResult()` + `armForCurrentType()`), throwing
the frozen measurement away and **re-arming a new tap**. Its own comment says it should reset only "across
the guitar↔material boundary." Correct behavior = Swift `reclassifyForGuitarTypeChange`: a guitar-subtype
change **reclassifies in place** (the recalc effect already re-runs `classifyAll` for the new bands),
preserving the frozen spectrum + peaks; only crossing guitar↔material, or plate↔brace, needs a fresh
sequence. Concrete fix: gate the reset on an actual paradigm change (extract a tested predicate e.g.
`isGuitarSubtypeChange(prev, next)` in `settings.ts`, tracking the previous type via a ref) and fold in
Phase 7's clear-overrides + re-auto-select. **This is pre-existing (RA's App.tsx edits are nowhere near
this effect) — do NOT let it slip.**

**Web-source assessment (each claim verified against the actual web code 2026-07-24, per the Phase 9
re-verify rule — not the ledger's UNVERIFIED web predictions). Swift `e3a7303` reviewed file-by-file +
paired test `c6e43fd`.**

**Item 1 — Guitar-type change = clean slate (folds in the 🐛 fix).**
- *Swift did:* `reclassifyForGuitarTypeChange()` = `peakModeOverrides = [:]` → `reclassifyPeaks()` →
  `resetToAutoSelection()`; wired through `onApply(measurementChanged:guitarTypeChanged:)` with
  `guitarTypeChanged = typeChanged && bothGuitar`. Display-only Apply disturbs nothing; the wand stays
  the pure-auto reset; **dragged offsets kept** (peaks unchanged, position orthogonal to mode).
- *Web today:* the `App.tsx` type-change `useEffect` (`:328–343`) fires on **any** `measurementType`
  change and ALWAYS runs the destructive reset (`setLoadedPeaks(null)` + `analyzer.clearResult()` +
  `resetMaterial()` + `armForCurrentType()`) → throws the frozen measurement away and re-arms a new tap
  even on a guitar **subtype** change. That is the 🐛.
- *Web mirror:*
  - New analyzer method `reclassifyForGuitarTypeChange(guitarType)` = `this.overrides = new Map();
    this.resetToAutoSelection(guitarType)`. `resetToAutoSelection` (`:681`) already sets
    `userModifiedSelection = false`, clears `selectedPeakFrequencies`, and computes a fresh selection via
    `guitarModeSelectedPeakIds → resolvedModePeaks(peaks, newType)`, which **self-classifies** — so the
    selection is correct for the new bands even before `modeByPeak` is recomputed. Offsets untouched
    (kept, matching Swift). The web's `modeByPeak` reclassification is done by the existing recalc effect
    (its dep array already contains `guitarType` → `classifyAll(peaks, newType)`), so this method is the
    faithful analogue of Swift's clear-overrides → reclassify → reset-selection.
  - **Gate the type-change effect** (`:328`): track the previous type via a `prevTypeRef`;
    `bothGuitar = isGuitarType(prev) && isGuitarType(next)` (mirrors Swift). On a guitar-subtype change
    call `reclassifyForGuitarTypeChange(guitarType)` and **keep the frozen measurement** — no
    `clearResult`, no `setLoadedPeaks(null)`, no re-arm. On a paradigm change (crossing guitar↔material,
    or plate↔brace: `!bothGuitar`) keep the existing destructive reset. Initial mount (`prev === next`)
    falls through to the existing reset (harmless on an empty result — preserves current behaviour).
  - **Ordering — RESOLVED: no flash (Option B), because both canonical platforms are synchronous.**
    Recalc is a `useLayoutEffect` (`:508`, before paint); the current type-change reset is a `useEffect`
    (`:328`, after paint) — layout effects run first, so a naive subtype branch in `:328` would let recalc
    paint the old overrides/selection remapped onto the new classification for one frame before the
    clean-slate clears them. Swift (`onApply`) and Python (`_on_measurement_type_changed` →
    `reclassify_for_guitar_type_change`, `tap_tone_analysis_view.py:3468-3479`) both apply it
    **synchronously with no flash**, so the web must not flash either (user, 2026-07-24: "If they both
    have no flash then the web should have no flash"). Fix: **convert the type-transition effect (`:328`)
    to a `useLayoutEffect` placed immediately BEFORE the recalc layout effect**, so one place owns
    `prevTypeRef` and both branches (guitar-subtype clean-slate / paradigm reset) run before paint. On a
    subtype change the clean-slate runs first (overrides cleared, `userModifiedSelection` false), then
    recalc reclassifies + auto-selects in the same pre-paint pass — no intermediate frame.

**Item 2 — CANCELLED (matches Swift).** The web has no unconditional `peakMinThreshold` write; Peak Min
has been a pure display projection since web Phase 2. Nothing to do.

**Item 3 — Analysis-range SETTING removed (concept kept as a constant).**
- *Swift did:* `TapDisplaySettings.analysisMin/MaxFrequency` → computed constants (30/2000); removed the
  Settings fields + bindings + validation + persistence; removed the two Help entries (`HelpView` **and**
  the Quick-Start guide); `findPeaks` still restricts detection to the range; old UserDefaults keys
  orphaned. **Not** a `.guitartap` format change (range was never persisted).
- *Web surfaces (verified):* `settings.ts` (`analysisMinHz`/`analysisMaxHz` field `:118-119`, default
  `:152-153`, `ANALYSIS_KEYS` `:188`); `App.tsx` (destructure `:230`, `recalculatePeaks` arg `:509`, dep
  array `:510`); `measurement/fromLive.ts` (full-set-save `findPeaks` bound `:139-140`);
  `components/SettingsPanel.tsx` (the "Analysis Frequency Range" `RangeField` `:441-449` + `ANALYSIS_KEYS`
  Reset `:474`); `components/QuickStartGuide.tsx` (Advanced-Settings body mention `:124`, Re-analyze
  mention `:278`, the "Analysis Frequency Range" Help entry `:399-401`). **Not in the `.guitartap`
  format** — it is an app setting (localStorage) used only as a `findPeaks` bound; `findPeaks` already
  defaults to 30/2000 (`dsp/peaks.ts:39-41`). Mirrors Swift (UserDefaults-only).
- *Web mirror:*
  - Add module constants `ANALYSIS_MIN_HZ = 30`, `ANALYSIS_MAX_HZ = 2000` (mirror Swift's
    `defaultAnalysisMin/MaxFrequency`; concept stays, knob goes).
  - Remove `analysisMinHz`/`analysisMaxHz` from the `Settings` type, `DEFAULT_SETTINGS`, and
    `ANALYSIS_KEYS`. Old localStorage values orphaned & ignored (mirror Swift).
  - Feed the constants where the settings were read (`App.tsx` recalc call — and drop them from the dep
    array; `fromLive.ts` full-set-save `findPeaks`).
  - `SettingsPanel.tsx`: remove the "Analysis Frequency Range" `RangeField`.
  - `QuickStartGuide.tsx`: remove the "Analysis Frequency Range" Help entry (byte-identical to the
    `HelpView.swift` entry Swift removed in `e3a7303`) + drop the "analysis range" phrase from the
    Advanced-Settings body (`:124`) and the Re-analyze mention (`:278`). **RESOLVED (user, 2026-07-24):
    the analysis-range Help removal is done NOW, in Phase 7** — Swift removed those entries in the Phase 7
    commit, and a Help entry describing a removed setting is a bug. The broader Help/Quick-Start authoring
    (the Peaks-&-Modes additions, the fuller Re-analyze/Peak-Min rewrites) stays in the web cross-cutting
    docs deliverable.

**Item 4 — New sequence clears ALL per-peak state + UNIFY the method name (user, 2026-07-24: "my desire
is for unified naming").** The BEHAVIOUR is already satisfied — the web clears
`overrides`/`annotationOffsets`/`selectedPeakIds`/`selectedPeakFrequencies`/`userModifiedSelection` in
`clearResult()` (`:339-343`), and every fresh-sequence path routes through it (`newTap :455`,
`cancelTap → newTap :479-482`, type-switch `:334`, play-file). But the NAME diverges, and the divergence
is real, not cosmetic: the web SPLIT the canonical `start_tap_sequence` (which arms **and** clears
everything) into two half-methods —
- `startTapSequence()` (`:229`) — arms (`isDetecting`, prompt, `currentTapCount`, frozen/complete) but
  does **not** clear per-peak state. **This is the parity-tested model entry point** (`state-invariants`
  V2, `start-tap-race`, `measurement-complete` MC4/MC5, `scenario-trace`, `tap-count-change`; several
  paired with Python), NOT dead code — so the web twin of `startTapSequence_clearsAllPerPeakState` must
  drive THIS method to line up with Swift/Python.
- `clearResult()` (`:329`) — clears result + per-peak state but does **not** arm.

*Unify:* make `startTapSequence()` the canonical method — it delegates to `clearResult()` for the shared
clearing (one clearing implementation, no duplication) **and** arms. Then `startTapSequence()` genuinely
"clears all per-peak state", the twin test drives `startTapSequence()` exactly like Swift
`startTapSequence_clearsAllPerPeakState` / Python `test_start_tap_sequence_clears_all_per_peak_state`, and
name ≡ behaviour ≡ test. **Risk:** `startTapSequence` is parity-tested — re-run those suites and confirm
none set per-peak state expecting it to survive a `startTapSequence` (a fresh sequence clearing it is
correct; they test detection/count/complete/invariants, not per-peak persistence).

*The one residual divergence — named, not nodded at:* production still calls the clear-only
`clearResult()` at the New-Tap / type-switch / play-file sites, because the web's **engine**
(`RealtimeFFTAnalyzer`), not the analyzer, owns detection arming and may be stopped at those sites — so
they must clear WITHOUT arming (`startTapSequence`'s `isDetecting = true` would be wrong with the engine
off). That clear-without-arm need is the genuine engine/analyzer architectural split
([[project_architectural_restructure]]), out of Phase 7 scope. After this change `clearResult` is
honestly documented as "the clear-only half `startTapSequence` builds on for the engine-split call
sites," not a divergent parallel method.

**Item 5 — Material guard & teardown: ALREADY SATISFIED.** (5) The web Peak-Min projection is
guitar-gated — `peaksAbovePeakMin` passes material through (`App.tsx:514-517`). (Teardown) Swift's
Combine-`deinit` race is Swift-specific and **must not be transcribed** (ledger). The web equivalent is
verified present: `useAudioEngine` has effect-cleanup `return () => { void engineRef.current?.stop() }`
(`:273-276`) releasing the mic on unmount; the analyzer is a plain object read via snapshot with no
subscription-teardown race. Nothing to port.

**Tests — the two paired twins the web owes (slug `test/annotation-state`; Swift `c6e43fd`, paired with
Python `TestPhase7Triggers`):**
- `reclassifyForGuitarTypeChange` is a clean slate — set overrides + a modified selection; call
  `reclassifyForGuitarTypeChange(newType)`; assert overrides empty, `userModifiedSelection === false`,
  `selectedPeakIds` equals `guitarModeSelectedPeakIds(peaks, newType)`. (Twin of
  `reclassifyForGuitarTypeChange_isACleanSlate`.)
- `startTapSequence` clears all per-peak state — set overrides/offsets/selection/freq-cache/`userModified`;
  call `startTapSequence()`; assert all cleared. (Twin of Swift `startTapSequence_clearsAllPerPeakState` /
  Python `test_start_tap_sequence_clears_all_per_peak_state` — after the item-4 unification the web's
  `startTapSequence` delegates to `clearResult`, so it drives the canonical method by name.)
- The App-effect gating (subtype vs paradigm) + the analysis-range removal are UI/settings-triggered →
  covered by run-review, matching Swift (no unit tests for those). Both twins land in the existing
  `test/annotation-state.test.ts` (no new parity group → `--check` stays **79**); golden
  `5c264de3941837f8` unmoved.

**Run-review script (web) — mirrors Swift's six:**
1. **Guitar-type change = clean slate (the 🐛 fix).** Override a peak + select a couple; change guitar
   type (e.g. Classical → Flamenco) → reclassified for the new type, manual labels cleared, fresh
   auto-selection, **and the frozen measurement is KEPT** (not thrown away / re-armed).
2. **Display-only change disturbs nothing.** Change only Peak Min or dB (same type) → selection + labels
   untouched.
3. **Wand still = pure auto** (unchanged).
4. **No state leak.** Measurement with a custom label + a dragged annotation + a selection → New Tap →
   fresh capture → save → reload → none of the previous labels/offsets/selection.
5. **Analysis-range setting gone.** Settings → no "Analysis Frequency Range" field; detection still finds
   peaks; Quick-Start Help no longer lists it.
6. **Material unaffected.** Plate/brace: Peak Min disabled, L/C/FLC as before.

**Decisions — all RESOLVED with the user 2026-07-24:** (a) effect ordering → **Option B, no flash**
(both canonical platforms are synchronous); (b) analysis-range Help entry → **removed now, in Phase 7**;
(c) fresh-sequence clearing → **unify the name**: `startTapSequence` becomes the canonical clear+arm
method (delegating to `clearResult`), the twin test drives it, and the residual clear-without-arm split
is named as architectural-restructure scope. Ready to implement.

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
- **De-label sweep at close** (user, 2026-07-24) — strip ephemeral phase/task labels (`Phase N`, `RA`/
  `RB`/`RC`, "arrives in Phase X") from the SOURCE + tests touched by this work, replacing them with
  durable wording; **keep** Swift/Python-mirror references (`Mirrors Swift definitiveModeInfo`, etc.),
  which are durable. Covers the restructure files (analyzer, `App.tsx`, `frozen-peak-recalc.test.ts`,
  `measurementImage.ts`, `gatedCapture.ts`, the committed RA `b251418` / RB `fa290d0` diffs) and the
  Phase 1/3/4 refs. ONE pass when the peak-lifecycle web work is otherwise done. Rationale: the labels aid
  navigation while the multi-slice work is active; a piecemeal strip would leave committed files
  inconsistent. See [[feedback_no_phase_labels_in_comments]].

## Log
- 2026-07-24 — doc created (prep). Structure mirrors the Swift/Python plans. Phases are goal-stubs; each
  begins with a web-source assessment written INTO this doc before any code. RESUME at **Phase 1
  assessment**.