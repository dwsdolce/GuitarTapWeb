# FILE PATHS & NAMES — cross-platform audit and plan

**Status:** ⏳ ANALYSIS COMPLETE · **DECISIONS TAKEN 2026-07-14 (§0b)** · NO CODE WRITTEN
**Blocks:** the 1.0.2 release (found during release testing)
**Platforms:** Swift (canonical) · Python · web
**Parity slugs touched:** `view/save-sheet`, `view/measurements-list`, `view/settings`, `dsp/wav`, `model/measurement`

Where every user-visible file goes, what it is called, and what the app tells the user about it —
audited across all three editions. Every claim is cited to file:line.

---

## 0. Summary

### 0a. What is wrong

| # | Issue | Kind | Platforms |
|---|---|---|---|
| A | Save sheet pre-fills the Measurement Name with the measurement type | web diverges from canonical | web |
| B | PDF/PNG filenames carry an extra `-report-` / `-spectrum-` word | web diverges from canonical | web |
| C | Dumped-WAV timestamp has millisecond precision | web diverges from canonical | web |
| D | Export dialog opens inside the sandbox container, not `~/Documents/GuitarTap` | **macOS sandbox bug** | Swift (macOS) |
| E | The dumped WAV cannot be found, and all three describe it wrongly | UX gap + stale text | all 3 |
| F | The session WAV is unbounded — it records all the dead air while armed | design issue | all 3 |

Plus two incidentals (§7).

### 0b. Decisions taken (user, 2026-07-14)

1. **§3 — Measurement Name: match Swift/Python.** The field is *editable-empty* with suggestive
   placeholder text (`e.g. Martin 000-28, Spruce Top`). The web must drop its type-name pre-fill.
2. **§3 — NEW: the Measurement Name is now REQUIRED.** Save is **disabled until the field has
   text**, on all three. This is a new behaviour change, not just an alignment — see §3b for what it
   implies.
3. **§1b — the macOS sandbox bug gets fixed.**
4. **§2b — filenames: do what Swift does.** Drop `-report-` / `-spectrum-` from the web.
5. **§4 — the WAV folder becomes a visible, user-settable Setting**, showing the path, with a
   Change button. **Default = the app's `Documents/GuitarTap`, read per platform** — which on a
   sandboxed app *is* the container. That default therefore needs **no authorization and no
   first-run prompt**; the `NSOpenPanel` appears only on **Change…**, which is exactly when a grant
   is required and natural. Full design in §4b.
6. **§6 — ADOPT THE BOUNDED PRE-ROLL.** Before the first tap, keep only the last ~2 s. The live
   recordings exist to build **test cases**, and a measurement can never reproduce a waveform — so
   the capture must stay, and the three platforms' captures being near-identical is the point.
7. **§4c — the debug log stays put**, is not settable, and gets **no reveal affordance**. Verified:
   **no platform writes one today** (logging is disabled on all three).
8. **RELEASE SCOPE — all of it is in 1.0.2.** *"They are important to get correct."* Nothing ships
   until every step is done and tested, so the order (§8) is chosen for risk, not for triage.
   **This explicitly includes the Chromium `showDirectoryPicker()` folder picker for the web WAV dump**
   (§4c, Step 6) — it is *not* deferred. (An earlier draft wrongly marked it "later enhancement";
   that was never agreed and has been removed.) Safari/Firefox keep the Downloads fallback because
   they have no API for it, not as a scope choice.

**Nothing is open. §8 is the plan; §9 is the documentation impact.**

---

## 1. Where things are saved

### 1a. The measurement library — genuinely different by platform, and that is fine

| | Location |
|---|---|
| Swift | `saved_measurements.json` in the app's Documents. **Sandboxed**: `~/Library/Containers/com.dolcesfogato.GuitarTap/Data/Documents/saved_measurements.json` (`TapToneAnalyzer+MeasurementManagement.swift:59-67`) |
| Python | OS **app-data** dir, *not* Documents: `~/Library/Application Support/guitar-tap/` · `%APPDATA%\guitar-tap\` · `~/.local/share/guitar-tap/` (`tap_analysis_results_view.py:105-131`; app name pinned at `__main__.py:140`) |
| web | **IndexedDB** — no file at all. DB `guitartap`, store `measurements` (`src/measurement/store.ts:9-10`) |

Three storage models, none of which can be the others. **No action.**
*(Nit: Python's docstring at `tap_analysis_results_view.py:10-13` still claims `GuitarTap/`. Stale.)*

### 1b. Where the Save dialog opens — **ISSUE D · DECIDED: FIX**

Swift and Python both intend "default to `~/Documents/GuitarTap`, then remember the last-used
directory". Python does that. **Swift does not.**

```swift
// MeasurementFileExporter.swift:40  — macOS
private static var defaultSaveDirectory: URL {
    let dir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Documents/GuitarTap")
```

Under App Sandbox, `homeDirectoryForCurrentUser` returns the **container** home. On a fresh install
the Save panel therefore opens at `~/Library/Containers/…/Data/Documents/GuitarTap`, not the user's
real Documents. The user must navigate out by hand. Once they save somewhere real,
`lastUsedDirectory` pins it — which is why this survived unnoticed.

- It is **not** a security-scoped bookmark: a plain path string in UserDefaults
  (`MeasurementFileExporter.swift:48-74`). That is fine — the panel itself grants access.
- Python is correct: `default_export_dir()` → real `~/Documents/GuitarTap`, remembered in QSettings
  (`tap_analysis_results_view.py:74-100`).
- The same false comment appears here and in the logger — *"bypass the sandbox container redirect"*.
  It does not (`Logging.swift:36-37`, `MeasurementFileExporter.swift:39`).
- **Duplicated logic:** a second copy of `defaultSaveDirectory` at `PlatformAdapters.swift:91-96`
  (used by the live-view spectrum export). Same bug, twice. Fix once, de-duplicate.

**Fix:** compute the real home. `NSHomeDirectory()` and `homeDirectoryForCurrentUser` both return
the container under the sandbox; the real home comes from `getpwuid(getuid())->pw_dir`. The Save
panel is a **powerbox** panel, so it can legally *display and navigate to* a directory the app has
no read access to — the user's selection is what grants access. So pointing the panel's
`directoryURL` at the real `~/Documents/GuitarTap` is both legal and correct.

⚠ **Verify at implementation time:** that the panel accepts a `directoryURL` the app cannot itself
read, and creating the directory (`createDirectory`) is skipped or tolerated when it is outside the
container. Do not assume — test it.

### 1c. Where exports land — structurally different, no action

| | Mechanism |
|---|---|
| Swift macOS | `NSSavePanel` — user chooses. Default dir per §1b |
| Swift iOS | Share sheet over a temp file — no directory concept |
| Python | `QFileDialog` — user chooses, opens at last-used |
| web (Chromium) | `showSaveFilePicker()` — a real Save-As dialog (`src/saveFile.ts:22-33`) |
| web (Safari/Firefox) | **silent `<a download>` → Downloads folder, no dialog** (`saveFile.ts:38-45`) |

The web's split is forced — Safari has no File System Access API. **No action**, but the help text
should tell a Safari user to look in Downloads.

---

## 2. File names

### 2a. `.guitartap` — already consistent across all three ✅

`{measurementName | "measurement"}-{unix-seconds}.guitartap`; spaces and `/` → `-`; lowercased.
Swift `TapToneMeasurement.swift:460-466` · Python `tap_tone_measurement.py:463-478` · web
`fromLive.ts:248-252`. Library export = `guitartap-library-{epoch}.guitartap` on all three.

### 2b. PDF and PNG — **ISSUE B · DECIDED (2026-07-14): one rule, Swift's**

**THE RULE.**

```
    filename = {measurement name  OR  the artifact's own default word} - {unix timestamp} . {ext}
```

- The **timestamp is a discriminator**, not part of the name — two measurements may share a name.
- The **default word is per artifact**, used only when there is no name:

| artifact | default | example (no name) |
|---|---|---|
| `.guitartap` | `measurement` | `measurement-1784060789.guitartap` |
| `.png` | `spectrum` | `spectrum-1784060789.png` |
| `.pdf` | `report` | `report-1784060789.pdf` |

- It is a **default name, never an infix**. A named measurement's PDF is
  `martin-000-28-1784060789.pdf` — no `report` in it.

**Rationale (user):** an export from the *measurements list* has a name to use. An export from the
*live view* has none — the measurement has not been saved yet — and a bare timestamp
(`1784060789.pdf`) is ugly, so the artifact supplies its own word. Requiring a name at **save**
time (§3) does not remove this need: a live export happens *before* any save.

**Unnamed measurements are an oddity, and their filenames are allowed to be ugly** (user). Do not
over-engineer this corner.

**Swift already implements exactly this** and is correct: `MeasurementFileExporter.swift:132` +
`MeasurementsListView.swift:429` (named path, via `baseFilename`);
`TapToneAnalysisView+Actions.swift:405-413` (live path, `spectrum` fallback);
`TapToneAnalysisView+Export.swift:231-235` (live PDF, `report` fallback). Python mirrors it
(`measurements_list_view.py:451-456`, `:413-418`; live: `tap_tone_analysis_view.py:4498-4507`,
`:4709-4717`).

**The web is wrong in two ways at once** — it uses the word as a fallback stem *and* as an infix:

```ts
// App.tsx:783-791 (PDF) and :926-928 (PNG)
const stem = (loadedName ?? 'report')…            // ← fallback stem
void exportPdfReport(…, `${stem}-report-${ts}.pdf`)   // ← AND an infix
```

So today the web produces:

| | web (today) | target |
|---|---|---|
| named | `martin-000-28-`**`report`**`-1752516000.pdf` | `martin-000-28-1752516000.pdf` |
| **unnamed** | **`report-report-1752516000.pdf`** ← the word twice | `report-1752516000.pdf` |
| named PNG | `martin-000-28-`**`spectrum`**`-1752516000.png` | `martin-000-28-1752516000.png` |
| **unnamed PNG** | **`spectrum-spectrum-1752516000.png`** | `spectrum-1752516000.png` |

**Fix:** drop the infix. Keep the fallback stem. `MeasurementsPanel.tsx:190-205` too.

**A multi-tap report and a comparison report are just reports** (user, 2026-07-14). No special
naming, no `-multitap-` segment. They take the same single rule. The web's
`${stem}-multitap-report-${ts}.pdf` (`App.tsx:789`) is the same infix disease with an extra word.

**One narrow oddity to fix while we are here:** exporting a **PNG from the measurements list** for a
nameless measurement uses `baseFilename`, so it comes out `measurement-<ts>.png` instead of
`spectrum-<ts>.png` (`MeasurementsListView.swift:429`). The live view gets it right
(`TapToneAnalysisView+Actions.swift:407`). Same artifact, two different defaults depending on where
you exported from. Low priority — once a name is required, a *saved* measurement always has one, so
this can only be reached by a nameless file imported from an older build.

---

## 3. The Save sheet's Measurement Name — **ISSUE A · DECIDED**

### 3a. Current behaviour

| | Pre-filled value |
|---|---|
| Swift | **empty**, placeholder `"e.g. Martin 000-28, Spruce Top"` (`SaveMeasurementSheet.swift:84`; state never seeded, `TapToneAnalysisView.swift:95`) |
| Python | **empty**, same placeholder (`save_measurement_sheet.py:24`; `_measurement_name = ""`, `tap_tone_analysis_view.py:439`) |
| web | **pre-filled with the measurement type** — `Classical` / `Plate` / `Brace` / … or `Comparison` (`App.tsx:1521-1522`, `settings.ts:43-50`) |

The web's own doc comment (`SaveSheet.tsx:7`) claims it "mirrors Swift's `@Binding` pre-fill". It
does not.

### 3b. Target — and what "required" implies

**The field is editable-empty with the suggestive placeholder on all three** (the Swift/Python
behaviour, and the web already has the identical placeholder string — it just also passes a
`defaultName` that fills the field; drop it).

**NEW: the Measurement Name is required. Save is disabled until the field is non-empty.**

This is a *behaviour change on all three*, not merely an alignment. **Decided 2026-07-14:**

1. **Whitespace is trimmed.** A field of only spaces is empty and is not a valid name — Save stays
   disabled. A name that *is* typed is **stored trimmed**.
2. **A comparison is just a measurement** — the user must name it too. The web's `"Comparison"`
   pre-fill goes away with the type-name pre-fill.
2b. **NEW — the save sheet pre-fills from a LOADED measurement's name.** Today Swift never seeds the
   field (`TapToneAnalysisView.swift:95`; `loadedMeasurementName` is held separately), so loading
   *Martin 000-28*, nudging Peak Min and pressing Save gives you an empty box and a retype. Harmless
   today; a real papercut once Save is disabled until the field is filled. So: when a loaded
   measurement is being saved again — modified or not — the field starts with its name. The user can
   still edit it. (Low-use case, but free to get right.)

**The timestamp question is already answered — no work needed.** Saving a loaded measurement creates
a **new** record with a **fresh UUID and the current time** on all three; nothing is inherited and
the original is not overwritten (Swift `TapToneMeasurement.swift:344` `timestamp: Date = Date()` +
`MeasurementManagement.swift:341` append · Python `tap_tone_measurement.py:858-859`
`id=str(uuid.uuid4())`, `timestamp=_now_iso()` · web `fromLive.ts:87,167-168` `isoNow()`, `uuid()`).
Re-saving therefore yields a second record with the same name and a later timestamp — exactly the
case the filename discriminator exists for.
3. **We are changing the UI rule, not the file format.** `measurementName` stays **optional** in
   `.guitartap`. Making it mandatory in the format would be a real interop change — not wanted.
4. **The `"measurement"` fallback in `baseFilename` stays — but not for the reason first given.**
   It has *nothing to do with reading*: an absent name reads back fine, it is just an empty optional
   string. The fallback does exactly one job — supply a stem when **constructing an export filename**
   for a measurement that has no name, so you do not get `-1784060789.guitartap` with a leading dash.
   It stays because requiring a name in *this* build does not stop *other* builds producing nameless
   files: Python 1.0.1, the web, and every older release still can, and `.guitartap` is an
   interchange format — a user can hand you one. The UI rule does not constrain the data.
5. **Tests.** Any test that saves without a name will need a name. Expect fallout in the
   measurement/persistence suites on all three.
6. **The live-view export fallbacks stay** (`report` / `spectrum` stems, §2b). A live export happens
   *before* any save, so it still has no name to use — requiring a name at save time does not remove
   the need for a default at export time. This is not a leftover; it is the rule.

---

## 4. The dumped WAV — where it goes, and how you find it — **ISSUE E · DECIDED**

### 4a. Current behaviour

| | Location | Findable? |
|---|---|---|
| Swift macOS | container `…/Data/Documents/GuitarTap/` (`TapToneAnalyzer+SpectrumCapture.swift:121-130`) | ❌ **No affordance at all.** No reveal button, no menu item, no help text |
| Swift iOS | container `Documents/GuitarTap/` — **visible in Files** (`Info.plist`: `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` = true) | ✅ Files → On My iPhone → GuitarTap |
| Python | real `~/Documents/GuitarTap/` on all 3 OSes (`tap_tone_analyzer_spectrum_capture.py:178-183`) | ❌ No affordance |
| web | **browser Downloads folder, always, silently** (`App.tsx:113-125`) | ❌ No text says so |

Notes:
- **The web dump does not use the app's `saveFile()` helper.** It fires a raw `<a download>`, so it
  never prompts — *even on Chromium*, where every other export does.
- **All three captions are wrong.** They still say *"Save **each captured tap** as a WAV file…"* —
  untrue since per-tap dumps were dropped for one session recording. Swift's caption also names
  `Documents/GuitarTap`, which under the sandbox is **not** where the user will look.
  Swift `TapSettingsView+Sections.swift:487-491` · Python `tap_tone_analysis_view.py:6250-6253` ·
  web `SettingsPanel.tsx:463-468`.
- Python hardcodes `~/Documents` rather than asking the OS, so it ignores a **redirected Windows
  Documents folder** (OneDrive / enterprise) and Linux XDG `user-dirs.dirs`.

### 4b. AGREED DESIGN (2026-07-14)

**The key insight — and the thing that collapses the whole problem:** *"the app's
`Documents/GuitarTap`"* means **whatever that resolves to on the platform**. On a sandboxed app that
*is* the container's Documents. That is not a workaround; it is what Documents means there. Read that
way, the default needs **no authorization at all**, because it is inside the container.

**Settings gains, on every platform:**
- a **field showing the current WAV folder** (the real path — container path and all; truthful, and
  the user never has to read it thanks to the button beside it),
- a **Show in Finder / Open Folder** button, and
- a **Change…** button.

**Default = the app's `Documents/GuitarTap`**, per platform:

| | default WAV folder | authorization | Change…? |
|---|---|---|---|
| Swift macOS | container `…/Data/Documents/GuitarTap/` | **none needed** — inside the container | ✅ `NSOpenPanel` → **security-scoped bookmark** |
| Swift iOS | container `Documents/GuitarTap/` — already reachable via Files | none | ❌ **no Change button** — Files reaches it; a picker would drag bookmark machinery onto iOS for no benefit |
| Python | the **OS's** Documents dir + `/GuitarTap` — see below | none | ✅ `QFileDialog` |
| web (Chromium) | the browser's **Downloads** folder | none | ✅ `showDirectoryPicker()` → handle persisted in IndexedDB |
| web (Safari/Firefox) | the browser's **Downloads** folder | n/a | ❌ **no API** — field is informational text, no button |

**Consequences of the container-default, all good:**
- **No first-run prompt.** The default just works. The panel appears *only* when the user presses
  **Change…** — which is exactly when authorization is both required and natural: they are choosing
  a folder outside the container, and their choice is what grants the access.
- The "user cancels the panel" case disappears with it (nothing was pending). If a Change… is
  cancelled, the current folder simply stands.

**Rules agreed:**
1. **A missing / stale folder is handled by outcome — REVISED by the Step-0 spike (2026-07-14).**
   The original rule ("any staleness is an error, the user re-picks") was too blunt. The spike showed
   macOS tracks the folder by **identity, not path**:
   - **Folder renamed / moved** → the bookmark still resolves, the write **succeeds into the new
     location**, and `bookmarkDataIsStale` comes back `true`. This is a *relocation*, not an error:
     **re-mint the bookmark silently and update the displayed path.** Erroring here — or making the
     user re-pick a folder that still works — would be user-hostile.
   - **Folder deleted / volume unmounted / grant lost** → `URL(resolvingBookmarkData:)` throws, or
     `startAccessingSecurityScopedResource()` returns `false`. *This* is the error: report it and make
     the user re-pick. Never fall back silently to another location (undiscoverable).

   So: `isStale == true` ⇒ re-mint + update path (silent). Resolve-throws / startAccessing-false ⇒
   user-visible error + re-pick.
2. **Python's default must ask the OS**, not hardcode `~/Documents` — `QStandardPaths.writableLocation(DocumentsLocation)`
   — so a OneDrive-redirected Documents on Windows and XDG `user-dirs.dirs` on Linux are honoured.
   *(Python's **log** path already gets this right via `user_documents_dir()`
   (`utilities/logging.py:35-41`); only the WAV path is hardcoded
   (`tap_tone_analyzer_spectrum_capture.py:178-183`). Independent confirmation of the decision.)*
3. **The web is Chromium-vs-Safari split** — same shape as the export path already has (§1c), and
   **both halves are in 1.0.2** (user: all of it ships):
   - **Chromium** — a real folder picker via `showDirectoryPicker()`, the handle persisted in
     IndexedDB, so dumps write to the chosen folder with no re-prompting. Settings shows the chosen
     path + a Change button, matching the native apps.
   - **Safari / Firefox** — no File System Access API, so it stays a `<a download>` to Downloads;
     the caption says so (already done in Step 1). No picker possible.

⚠ **Verify at implementation time:** security-scoped bookmarks are **new ground in this codebase** —
`MeasurementFileExporter`'s `lastUsedExportDirectory` is a **plain path string**, not a bookmark
(§1b), which works only because the save panel itself grants access. A *silent* write to a chosen
folder needs a real bookmark, resolved on launch, with `startAccessingSecurityScopedResource()`
correctly paired with `stop…` on **every** write. Prove it works across a relaunch; do not assume.

### 4c. The debug log — stays put, no reveal, and currently writes nothing

**The log is not settable and does not follow the WAV folder** (user). It lives in the app's
`Documents/GuitarTap` — per platform, as above — and stays there. **No reveal affordance**: it is
documentable, very low usage, and expected to be a custom-build/debugging tool from now on.

**Verified 2026-07-14 — no platform writes a debug log today:**
- **Swift:** `_gtLogEnabled = false`, `_tapDebugEnabled = false` (`Logging.swift:19-20`); both `gtLog`
  and `TAP_DEBUG` test the flag *before* touching `_fileLogger` (`:85-99`). `_fileLogger` is a
  file-scope `private let`, so Swift initialises it **lazily** — nothing else references it, so
  `FileLogger()` is never constructed, `logFileURL` never runs, and its `createDirectory` never
  fires. **No file, no folder.**
- **Python:** `_gt_log_enabled = False` (`utilities/logging.py:22`); `_FileLogger.__init__` defers
  opening the file precisely so that *"a run with logging disabled never creates or touches the log
  file"* (`:28-32`).
- **web:** no file logging exists (browser), and zero `console.log` in `src/`.

*(The 28 MB `GuitarTap-debug.log` in the macOS container is a leftover from before the disable
landed — not something being written now.)*

**Nit:** the log filenames differ — Swift `GuitarTap-debug.log`, Python `guitar_tap-debug.log`. If a
user is ever asked to send one, that is two different filenames to explain.

---

## 5. Dumped-waveform names — **ISSUE C**

| | Name |
|---|---|
| Swift | `swift_session_Guitar_3tap_2026-07-14T13-25-01Z.wav` (`SpectrumCapture.swift:127-129`) |
| Python | `python_session_Guitar_3tap_2026-07-14T18-42-07Z.wav` (`..._spectrum_capture.py:185-187`) |
| web | `web_session_Guitar_3tap_2026-07-14T18-22-05`**`-123`**`Z.wav` (`App.tsx:117`) |

The `swift_` / `python_` / `web_` prefixes are **deliberate** — they are what makes a cross-platform
fixture set legible — and stay. The **labels already agree** (`Guitar_Ntap`, `Plate_LC`, `Plate_LCF`,
`Brace`) ✅.

The only divergence is precision: JS `toISOString()` emits `.123` milliseconds and the code strips
`[:.]`, leaving a stray `-123`. **Fix: drop the milliseconds on the web.**

---

## 6. Why the three WAVs are wildly different sizes — **ISSUE F · DECIDED: ADOPT THE PRE-ROLL**

> **Why the recording matters at all (user, 2026-07-14):** the live recordings exist to build a set
> of **test cases**. A waveform can reproduce a measurement on every platform; **a measurement can
> never reproduce the waveform.** The capture is the irreplaceable artifact — so it must stay, and
> the three platforms' captures being near-identical is a feature, not a nicety.


Measured from the user's three files — same microphone, same sitting:

| | format | duration | size |
|---|---|---|---|
| Swift | 32-bit float · mono · 48 kHz | **120.20 s** | 23.1 MB |
| Python | 32-bit float · mono · 48 kHz | 17.13 s | 3.3 MB |
| web | 32-bit float · mono · 48 kHz | 12.71 s | 2.4 MB |

**The formats are identical.** The difference is entirely duration.

All three start the session recording at the *same* point — `startTapSequence`, i.e. when **New Tap**
is pressed (Swift `Control.swift:186-188` · Python `tap_tone_analyzer_control.py:472` · web
`realtimeFFTAnalyzer.ts:363`) — and stop at completion. So **the WAV length is the wall-clock time
the app sat armed**, dead air and all. The Swift file is a *single tap*
(`swift_session_Guitar_1tap`) stretched over two minutes: it was armed first and idled while the
other two apps were set up. **User confirmed the three apps were armed at different times, so this
is not a recording bug.**

But it is a design issue: **the session WAV is unbounded**, in RAM as well as on disk.

### Proposed fix: a bounded pre-roll

While armed and **before the first tap**, retain only the last **~2 s** of audio, discarding anything
older. Once the first tap is detected, record through to completion.

Every dump then becomes *"2 s of room + the measurement"*, whether it was tapped immediately or left
armed for ten minutes. Three wins for one change:

1. **The files become comparable across platforms.** Same acoustic events in → near-identical files
   out, regardless of arming order.
2. **Memory and file size are bounded.** Today the buffer grows without limit while idle (120 s =
   23 MB; half an hour ≈ 350 MB of RAM).
3. **The playback lead-in guarantee is preserved.** The pre-roll retains `min(2 s, time-since-arm)`,
   and the first *detected* tap can never be sooner than 0.5 s after arming (detection is suppressed
   during the warm-up), so a dumped WAV always keeps ≥ 0.5 s before its first tap — the condition
   file playback needs (`OUT-4-DETECTION-SPEC.md`).

   ⚠ **Correction to an earlier draft of this spec:** it claimed the pre-roll would let us *retire*
   the lead-in warning in Help. **Wrong, twice over.** Session WAVs already guarantee the lead-in by
   construction (recording starts at arming; detection is suppressed for 0.5 s) — the pre-roll bounds
   the extra silence, it does not create the guarantee. And the Help warning was never about Guitar
   Tap's own recordings: it is about **externally recorded files**, which a pre-roll cannot help.
   **The Help warning stays.**

Swift already keeps `sessionCheckpoints` to truncate rejected phases out of the buffer
(`Control.swift:186-188`), so trimming the head is the same class of operation. Cross-platform:
designed once, applied to all three.

**Aside on comparing platforms:** three live microphones is the wrong instrument — each app has its
own audio clock and buffering, so a shared mic still does not give three identical inputs. Capture
once, then **Play File** that WAV into all three; the input is then bit-identical. That is exactly
why the regression harness plays files rather than listening.

---

## 6b. A nameless measurement displays as "Comparison"

`MeasurementRowView.swift:81` — `Text(measurement.measurementName ?? "Comparison")`. The fallback was
meant for comparison records and now applies to **any** unnamed measurement, so a nameless
measurement is *labelled a comparison* in the list. Not merely ugly — misleading. Unreachable for new
saves once the name is required (§3), but an imported nameless file still hits it. Fix the fallback
word.

*(Related, for completeness — the other nameless-measurement fallbacks in Swift: delete dialog
`"Measurement"` (`MeasurementsListView.swift:263`), comparison-PDF label `"measurement"` (`:552`),
`baseFilename` `"measurement"`, PDF basename `"report"`, live PNG `"spectrum"`. The per-artifact ones
are the agreed rule (§2b); the display ones just need to not say "Comparison".)*

---

## 7. Incidentals

1. **Swift writes fractional seconds into a filename.** `ExportView.swift:180`:
   `"measurements-\(Date().timeIntervalSince1970).json"` interpolates a `Double` →
   `measurements-1784060789.123456.json`. Every other path uses `Int(...)`. Almost certainly a bug.
2. **Python drops a file on the user's Desktop.** `realtime_fft_analyzer_engine_control.py:238`
   writes `~/Desktop/guitar_tap_raw_capture.wav` — a hardcoded raw-PCM diagnostic, unrelated to the
   Dump Capture Audio setting.

---

## 8. Implementation plan

**Release scope — DECIDED: ALL of it goes into 1.0.2** (user, 2026-07-14). *"They are important to get
correct."* Nothing ships until every step is done and tested, so the **order is not load-bearing** —
it is chosen to surface surprises early and to keep the one risky piece from blocking the rest.

**Standing rules apply to every step:** canonical **Swift → Python → web**; `@parity` tags updated and
`PARITY-MAP.md` regenerated in the *same* change; tests land with the code, three-way; **nothing is
marked ✅ until the user has run all three apps** — green suites are not a run-review.

**A principle carried in from the `canReanalyze` work (2026-07-13):** any new rule that a view asks
("is Save enabled?", "can this be re-analyzed?") belongs **on the model**, not in each view's
`disabled:`. A view boolean is untestable, which is exactly how the old Re-analyze proxy stayed
wrong in both directions for so long. This applies directly to Step 3.

---

### Step 0 — SPIKE: prove security-scoped bookmarks (throwaway, NOT committed)

**Why first:** bookmarks are the only thing in this plan the codebase has **never done** — and the
whole §4 design rests on them. `MeasurementFileExporter`'s `lastUsedExportDirectory` is a *plain path
string*, which works only because the save panel itself grants access (§1b). A **silent** write into a
user-chosen folder is a different problem.

Prove, end to end: pick a folder via `NSOpenPanel` → persist a bookmark → **quit and relaunch** →
resolve → write a file into it.

- [ ] bookmark survives a relaunch
- [ ] `startAccessingSecurityScopedResource()` / `stopAccessing…` pair correctly on the **write path**
      (which runs off the main thread, at measurement completion)
- [ ] a **stale** bookmark (folder renamed / deleted / volume unmounted) is *detectable*, so §4b's
      "it is an ERROR, the user re-picks" rule is actually implementable

**Test:** the spike *is* the test. If it fails, **§4b is redesigned before any production code is
written.** Finding this out at the end of the release would be expensive.

**Spike results (2026-07-14) — `GuitarTap/Views/Utilities/_SpikeBookmark.swift`, throwaway, to delete:**
- [x] Panel opens at the real `~/Documents/GuitarTap` (a folder the app cannot read) ✅ — powerbox
      shows it, confirming the Step 5 premise.
- [x] Write from **main thread** ✅
- [x] Write from **background thread** (the real dump path runs off-main) ✅
- [x] **Folder renamed** → write still succeeds, into the new location, `isStale = true` ✅ — a
      *relocation*, re-mint silently (see the revised rule below).
- [x] **⌘Q + RELAUNCH, then write with no folder picked** ✅ — the grant survived; wrote into the
      chosen folder with no re-pick. **This is the load-bearing result: §4b stands.**
- [x] **Folder deleted / missing** → `URL(resolvingBookmarkData:)` throws ("file couldn't be
      opened") ✅ — a clean, reportable error, not a silent failure. The §4b error path is real.

**VERDICT: §4b is implementable as designed. No redesign needed. Spike passed on every check.**
Delete `GuitarTap/Views/Utilities/_SpikeBookmark.swift` and its hook (the button in
`TapSettingsView+Sections.swift` + the `showingBookmarkSpike` state in `TapSettingsView.swift`).

---

### Step 1 — Truth in text (zero behaviour change) ✅ COMMITTED 2026-07-14

- [x] Settings captions, all 3 → "Save the captured audio of each measurement as a WAV file"
      (web adds "to your browser's Downloads folder" — the one edition that can name the destination)
- [x] Swift's caption names no folder (it becomes a settable field in Step 6)
- [x] Killed the false *"bypass the sandbox container redirect"* comments (`Logging.swift`,
      `MeasurementFileExporter.swift`); documented that the log stays put and does not follow the
      WAV folder (§4c)
- [x] Python's docstring corrected — the app name is `guitar-tap` (not `GuitarTap`), so the real
      dir is `~/Library/Application Support/guitar-tap/` etc. *(Doc catching up to reality — the
      runtime has resolved there all along; no directory moved.)*

**Test:** none — text only. Swift builds, web `tsc` clean, Python parses. Committed on all three.

---

### Step 2 — Filenames (§2b, §5, §6b, §7.1) ✅ CODE DONE, NOT YET USER-VERIFIED

**Structural win (option B): one canonical stem helper per platform**, all sites routed through it —
Swift `ExportFilename.stem` · Python `export_filename.export_stem` (+ a thin `export_stem_for`
adapter for the ISO-string timestamp) · web `exportStem`. New `@parity model/export-filename`
(tests=`test/export-filenames`), map regenerated (64 groups, no problems).

- [x] web: dropped the `-report-` / `-spectrum-` **infix** and the **double-word** bug
      (`report-report-…` / `spectrum-spectrum-…`)
- [x] web: multi-tap and comparison reports are **just reports** — no `-multitap-` segment
- [x] web: dropped the **millisecond** segment from the dumped-WAV name (§5)
- [x] Swift: list-PNG fallback `measurement` → `spectrum`
- [x] Swift: nameless measurement no longer displays as **"Comparison"** (now `Measurement`;
      Python/web row titles were already correct — Swift was the outlier)
- [x] Swift: `Int()` the fractional-second JSON name (§7.1)

**Extra bugs consolidation exposed and fixed (not in the original checklist):**
- [x] web PNG/PDF used a **different slug** (`[^\w.-]`) than its own `.guitartap` path — `\w` is
      ASCII-only, so "Ramírez" mangled to "ram-rez". Now one Unicode-safe rule everywhere.
- [x] web saved-measurement PNG/PDF used **`Date.now()`** instead of the **measurement's** timestamp
      (natives use the measurement's). Now aligned.
- [x] Swift **list-comparison PDF** used `measurement` default, not `report`; both comparison paths
      slugged spaces but **not `/`**. Python had the same list-comparison-PDF bug. Both fixed by the
      helper.

**Test — NEW 3-way suite `test/export-filenames`** (new `@parity` slug):
Swift `ExportFilenameTests.swift` · Python `test_export_filenames.py` · web `export-filenames.test.ts`.

Table-driven, exact expected strings, covering the full matrix:

| | `.guitartap` | `.pdf` | `.png` |
|---|---|---|---|
| named | `martin-000-28-<ts>` | `martin-000-28-<ts>` | `martin-000-28-<ts>` |
| unnamed | `measurement-<ts>` | `report-<ts>` | `spectrum-<ts>` |

plus: multi-tap PDF == plain PDF name · comparison PDF == plain PDF name · slugging (spaces and `/`
→ `-`, lowercased) · library export `guitartap-library-<epoch>.guitartap` · dumped WAV
`<platform>_session_<Label>_<ISO-seconds>Z.wav` for `Guitar_Ntap` / `Plate_LC` / `Plate_LCF` / `Brace`.

*Pin every cell on all three and this entire class of bug cannot come back.*

**Sequencing note:** filenames go **before** Step 3 deliberately — the unnamed fallbacks are still
easy to reach and pin now; once a name is required they become rare (only imported nameless files).

---

### Step 3 — Measurement Name required (§3) ✅ CODE DONE, NOT YET USER-VERIFIED

**Predicate on the MODEL** (`TapToneMeasurement.isValidName` / `is_valid_name` / web
`isValidMeasurementName`; `normalizedName` / `normalized_name` / `normalizedMeasurementName` for the
trimmed store). New `@parity model/measurement-name` (tests=`test/measurement-name`), symbol-tagged
on the native statics; map regenerated (66 groups, no problems).

- [x] Predicate on the model; all 3 Save buttons bind to it — **no view-local `disabled:` logic**
      (Swift `.disabled(!canSave)`, Python `_save_btn.setEnabled` on `textChanged`, web `disabled`
      + Enter-guard)
- [x] Save disabled until non-empty after trimming; whitespace-only is empty
- [x] A typed name is **stored trimmed** (`normalizedName`; web `SaveSheet` passes `name.trim()`)
- [x] web: dropped the type-name pre-fill and the `"Comparison"` pre-fill — now `defaultName = loadedName ?? ''`
- [x] A **comparison needs a name too** — same sheet, same predicate; its `defaultName` is empty
- [x] **Pre-fill from a loaded measurement's name** on re-save: the sheet takes `defaultName =
      loadedMeasurementName ?? ""` (native seed on-appear-if-empty; web `useState(defaultName)`)
- [x] Fixed the `SaveSheet.tsx` doc comment that falsely claimed it mirrors a Swift `@Binding` pre-fill

**Test — 3-way `test/measurement-name`:** Swift `MeasurementNameTests.swift` · Python
`test_measurement_name.py` · web `measurement-name.test.ts`. empty/whitespace→invalid, real
text→valid, trim-on-store, blank→nil, and validity-agrees-with-storage.

**Predicted test fallout did NOT occur** — and that confirms the design. The rule is enforced at the
**view** (Save disabled); the model's save path stays **tolerant of nil**, so existing tests that
save nameless measurements through the model API still pass. `measurementName` stays **optional in
the format** (§3b) — UI rule, not format change; the `"measurement"` fallback stays for reading.

Suites: Swift 361 · Python 469 · web 243 (+4 each).

---

### Step 4 — Bounded pre-roll (§6)

Pure model work, no UI. The highest test value in the plan.

- [ ] While armed and **before the first tap**, retain only the last **~2 s** of audio
- [ ] On the first detected tap, record straight through to completion
- [ ] Buffer is bounded **while idle** — not merely trimmed at the end (this is the memory half, and
      the half a naive implementation gets wrong)

**Test — 3-way** (extend the session-recording coverage):
- [ ] arm → advance **60 s** with no tap → tap → complete ⇒ WAV ≈ *pre-roll + measurement*, **not**
      60 s + measurement
- [ ] the **≥ 0.5 s lead-in survives** — the property file playback depends on
      (`OUT-4-DETECTION-SPEC.md`). The pre-roll retains `min(2 s, time-since-arm)`, and the first
      *detected* tap can never be sooner than 0.5 s after arming (detection is suppressed during the
      warm-up), so the guarantee holds
- [ ] the accumulation buffer stays bounded during a long idle (assert its length, not just the file)
- [ ] tap **immediately** after arming ⇒ still a valid fixture (short pre-roll, but ≥ 0.5 s)

**Rationale to keep in view (user):** these recordings exist to build **test cases**. A waveform can
reproduce a measurement on every platform; a measurement can **never** reproduce the waveform.

---

### Step 5 — macOS export-dialog default (§1b)

Swift only.

- [ ] `defaultSaveDirectory` resolves the **real** home (`getpwuid(getuid())->pw_dir`), not the
      container — `homeDirectoryForCurrentUser` and `NSHomeDirectory()` both return the container
- [ ] **De-duplicate** the second copy at `PlatformAdapters.swift:91-96`
- [ ] Do **not** `createDirectory` outside the container (it will fail); the powerbox panel can still
      *display* a directory the app cannot read

**Test:**
- [ ] unit-test the path helper returns the real home, not the container
- [ ] **manual:** on a machine with no `lastUsedDirectory` set, the Save panel opens at the real
      `~/Documents/GuitarTap`. ⚠ Verify the panel accepts a `directoryURL` the app has no access to —
      **do not assume**

---

### Step 6 — WAV folder setting (§4b, §4c)

The big one. Shaped by whatever Step 0 taught us.

- [ ] Settings: **path field** + **Show in Finder / Open Folder** + **Change…**
- [ ] Default = **the app's `Documents/GuitarTap`**, per platform — container on macOS/iOS (so **no
      authorization and no first-run prompt**), real Documents on Python
- [ ] macOS **Change…** → `NSOpenPanel` → **security-scoped bookmark** (the only path needing a grant)
- [ ] iOS: **no Change button** (Files already reaches the container)
- [ ] Python: default from **`QStandardPaths.writableLocation(DocumentsLocation)`**, *not* hardcoded
      `~/Documents` — honours a OneDrive-redirected Documents and Linux XDG
- [ ] A **missing / stale folder is an ERROR** and the user re-picks — never a silent fallback
- [ ] web **Chromium**: a real folder picker via `showDirectoryPicker()`, handle persisted in
      IndexedDB, dumps written to the chosen folder with no re-prompting. Settings shows the chosen
      path + Change button. **In 1.0.2.**
- [ ] web **Safari/Firefox**: no File System Access API — stays `<a download>` to Downloads. The
      Step-1 caption ("your browser's Downloads folder") covers this case.
- [ ] web caption becomes **browser-conditional**: Chromium-with-a-chosen-folder shows the chosen
      location; Safari/Firefox show "Downloads". Same split as the export path (§1c).
- [ ] The **debug log does not follow** this setting — it stays in the app's `Documents/GuitarTap` (§4c)

**Test:**
- [ ] 3-way unit tests on **path resolution** and **stale detection**
- [ ] **manual (macOS, essential):** pick a folder → quit → relaunch → dump → the WAV lands in the
      chosen folder. Then rename the folder → the app **reports an error** and asks for a re-pick.
      The bookmark round-trip is **not** unit-testable; this run-review is the real gate

---

### Step 7 — Incidentals (§7)

- [ ] Python: `~/Desktop/guitar_tap_raw_capture.wav` (`realtime_fft_analyzer_engine_control.py:238`) —
      a hardcoded raw-PCM diagnostic that litters the user's Desktop
- [ ] *(Swift's fractional-second filename folded into Step 2)*
- [ ] *(Nit) log filenames differ: `GuitarTap-debug.log` vs `guitar_tap-debug.log`*

---

### Step 8 — Documentation, then release notes LAST

Manual and Help/Quick Start updates land **with their step**, per the standing rule. **Release notes go
last, alone** — see §9. The build number is the commit count *at the release commit*, so the notes
files get **renamed** once everything else has landed.

---

## 9. Documentation impact

Every item here is user-visible, so the docs are **part of the work, not a follow-up**.

### 9a. User Manual (`GuitarTap/Documentation/Manual/`)

| File | Change | Why |
|---|---|---|
| `ch07-save-export-share.md` | **Wrong today and about to be wronger.** Line 16 says the Save sheet's two fields are *"both optional"*; line 23 says *"If left blank, the date and time serve as the name."* **Nothing does that** — the code shows `"Comparison"` in the list (§6b) and `measurement-<ts>` in filenames. Rewrite: the **Name is required**. | §3 |
| `ch08-settings-reference.md` | Lines 157-161: *"each captured tap is saved as a … WAV"* → **one session WAV per measurement**. *"The save location is: macOS / Linux … `~/Documents/GuitarTap/`"* → **wrong on sandboxed macOS**. Document the **new WAV-folder setting** (path field + Show in Finder + Change…), with the per-platform defaults from §4b. | §4, §1b |
| `ch09-controls-reference.md` | **Save** is now disabled until a name is entered. | §3 |
| `ch10-tips-and-troubleshooting.md` | Re-read the file-playback **lead-in** note against the pre-roll. It **stays** — it is about *externally recorded* files, which the pre-roll does not touch (§6). Check the wording still says so. | §6 |
| `app-b-file-formats.md` | Confirm `measurementName` remains **optional in the format**. We are changing the UI rule, not the format. | §3b |

### 9b. In-app Help / Quick Start — all three

- Saving a measurement now **requires a name**.
- **Dump Capture Audio** entry: one WAV per measurement; the new folder setting; on the **web**, say
  it goes to the browser's **Downloads** folder (Safari/Firefox) — the only artifact with no dialog.
- Swift `HelpView.swift` · Python `help_view.py` · web `QuickStartGuide.tsx`.

### 9c. Release notes — **already committed, and now incomplete**

The 1.0.2 notes were written and committed *before* this audit. Everything above is user-visible, so
all three sets need extending **before release**:

- Measurement Name is now required (behaviour change — most visible item).
- New WAV folder setting + Show in Finder.
- Export/report/spectrum filename corrections (web).
- macOS: the export dialog now opens in the right place.
- Session recordings are bounded (no more minutes of silence).

Swift `Documentation/ReleaseNotes-1.0.2-<build>.md` (+ PDF) · Python `docs/ReleaseNotes-1.0.2-<build>.md`
(+ PDF) · web `src/components/ReleaseNotes.tsx`. **⚠ The build numbers will move** — the notes are
named for the commit count *at the release commit*, so they must be renamed once these changes land.

---

Tests + `@parity` tags updated in the same change as the code. Nothing is marked ✅ until you have
run all three.