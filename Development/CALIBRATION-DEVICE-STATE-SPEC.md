# Calibration & Device-Selection State — Python single-source fix (design spec)

**Status:** ✅ RESOLVED — committed `5fdd8fd`, user-verified in the app (calibration resolves, calibrated
load no longer false-warns, clean quit), full suite 591 green. Item 11 (measurement-dimensions) web work is
un-parked. **Python-only:** Swift canonical + correct, web already single-source (both verified); no Swift or
web change.

**What landed (`5fdd8fd`):**
- **F1 — one device identity + one restore path.** Collapsed the two divergent persisted keys
  (`selected_input_device_fingerprint` vs `device_fingerprint`/`device_name`) and their two startup restore
  paths into one canonical key (`AppSettings.set_audio_device`, mirroring Swift's single
  `selectedInputDevice.didSet`/`selectedInputDeviceUID`). Fixes the wrong-mic restore that dropped the
  calibration → the false "different calibration."
- **F2/F3/F5 — MOOT.** The load-time comparison reads `_active_calibration_name`, which F1 now keeps synced
  with the applied profile (set in `load_calibration_from_profile`) — the web's `calibrationRef` pattern. No
  separate change needed.
- **F4 — one QSettings scope.** `CalibrationStorage._APP` unified `"GuitarTap"` → `"guitar_tap"` (one domain
  like Swift's single `UserDefaults.standard`), with a one-time legacy migration (`_migrate_legacy_scope`) and
  the pytest-isolation redirect it previously lacked.
- **Shutdown deadlock (found during the fix, F1-exposed).** A thread sample of a hung quit showed the main
  thread blocked in `Pa_Terminate` while the daemon `StreamClose` held CoreAudio's `HALB_Mutex`
  (`AudioDeviceStop`) — a USB-mic CoreAudio teardown stall, hit only now that F1 correctly runs on the UMIK‑1.
  Fixed with `os._exit(rc)` after the Qt loop (flush QSettings + logs first) to skip sounddevice's atexit
  `Pa_Terminate()`; the OS reclaims PortAudio/CoreAudio at process death. Native (AVAudioEngine) has no
  equivalent hang.

## 1. Symptom

Load a `.guitartap` that was recorded with the UMIK‑1 + its `7108913` compensation, on the same Mac, with
the same UMIK‑1 attached and (per the Settings dialog) `7108913` shown as the active calibration. On load
the app warns *"recorded with a different calibration"* — a **false positive** that makes every calibrated
measurement un-trustworthy to load, blocking Python validation.

## 2. Evidence (Python, verified 2026-07-29)

- **CAL-DEBUG at load** (user-run): device matched the UMIK‑1 by name; `_calibration_device_name =
  'Umik-1  Gain: 18dB'`; **`_active_calibration_name = None`**; `measurement.calibration_name = '7108913'`;
  sample rate 48000 == 48000. → the "calibration" diff fired purely because the tracked active-calibration
  name was `None`.
- **Startup log:** `Restored previously selected mic: MacBook Pro Microphone` → `No calibration for device
  'MacBook Pro Microphone' - using uncalibrated mode`. So the session was restored on the **built-in mic,
  uncalibrated** — not the UMIK‑1.
- **QSettings on disk** (`~/Library/Preferences/`):
  - **Two scopes.** `CalibrationStorage._APP = "GuitarTap"` → `com.dolcesfogato.GuitarTap.plist`; everything
    else (`AppSettings`, device selection) uses `_APP = "guitar_tap"` → `com.dolcesfogato.guitar_tap.plist`.
  - **Two disagreeing device keys** (in the `guitar_tap` plist):
    `audio/selected_input_device_fingerprint = "MacBook Pro Microphone:48000"` **vs**
    `audio/device_fingerprint = "Umik-1  Gain: 18dB:48000"` / `audio/device_name = "Umik-1  Gain: 18dB"`.
  - The calibration association itself is **correct** (in the `GuitarTap` plist):
    `deviceCalibrationMap = {"Umik-1  Gain: 18dB": "91b5…"}` → `storedCalibrations[… name:"7108913"]`.

## 3. Root cause — no single source of truth for "selected device + its calibration"

Swift resolves device + calibration from **one** property in **one** place. Python has fragmented this into
multiple keys, paths, and objects that drift:

1. **Two device-persistence mechanisms, two keys:**
   - `AppSettings.set_selected_input_device_fingerprint()` → `audio/selected_input_device_fingerprint`
     — written by the mic setter (`realtime_fft_analyzer.py:614`).
   - `AppSettings.set_audio_device(device)` → `audio/device_fingerprint` + `audio/device_name`
     (`tap_settings_view.py:229-234`).
2. **Two startup restore paths, reading different keys:**
   - `RealtimeFFTAnalyzer_device_management._auto_select_*` reads
     `selected_input_device_fingerprint` (`:257`) → restored the **MacBook mic**.
   - `fft_canvas.py:315` reads `audio_device_fingerprint()` (the `device_fingerprint`/`device_name` key,
     UMIK‑1) with its own built-in-mic-override.
   These can (and did) resolve **different devices**; whichever writes last wins, and they went out of sync.
3. **Calibration NAME tracked on a second object via a late-wired callback.** The mic
   (`RealtimeFFTAnalyzer`) applies corrections in its `selected_input_device` setter, but the active-name
   (`TapToneAnalyzer._active_calibration_name`) is only updated through `_on_mic_calibration_changed`
   (wired at `tap_tone_analyzer.py:1147`, after construction). So the applied profile and the tracked name
   can disagree — here the name is `None` while the association exists.
4. **Load-time warning reads the stale cache and gates the reload on a name-equality proxy.**
   `tap_tone_analyzer_measurement_management.py:786-806`: because `_calibration_device_name == match.name`
   (both UMIK‑1, from the stale second key), it decides "same device, no switch needed" and **never loads
   the UMIK‑1's calibration**, then compares `'7108913' != _active_calibration_name(None)` → warns.
5. **Two QSettings scopes** (`GuitarTap` vs `guitar_tap`) make the calibration store and the device settings
   live in different files — fragile, a rename artifact.
6. **Identity format:** selection persisted as a `name:rate` fingerprint, but the calibration map is keyed by
   **name**. A sample-rate change alone changes the fingerprint (not the name) → phantom "different device."

Net: startup restored the built-in mic (uncalibrated); a stale second key made the load-check believe the
UMIK‑1 was already the calibrated device, so 7108913 was never applied → false "different calibration."

## 4. Canonical model — Swift (works; do not change)

- **One identity: `device.uid`.** `selectedInputDevice.didSet` (`RealtimeFFTAnalyzer.swift:114`) is the
  single choke point: it **persists** `device.uid` to `UserDefaults "selectedInputDeviceUID"` **and**
  immediately **loads (and names)** that device's calibration via
  `CalibrationStorage.shared.calibration(forDeviceUID:)`, or clears it — every time the device changes.
- **Startup restore** (`+DeviceManagement.swift:232`) assigns `selectedInputDevice = savedDevice` → the same
  `didSet` runs → calibration follows. A live device change at startup is just another assignment. Selected
  device, persisted key, and active calibration cannot drift — all derived from one property, one place.

## 5. Web — already correct (verified; user's suspicion confirmed)

- One source of truth: `calibrationRef.current?.name` is read by **both** save (`buildMeasurement`) and the
  load-time provenance warning (`App.tsx:965`). The comment at `App.tsx:958-965` documents the *same* class
  of failure already fixed on web ("compared against `undefined` → always 'a different calibration'").
- `useAudioEngine.applyCalibrationForDevice(deviceId)` → `resolveActiveCalibration(deviceId)` is the single
  path that resolves + applies calibration on device change (device-specific → global → none). No second
  device key, no separate stale name cache. **No web change needed.**

## 6. Fix plan — make Python mirror Swift (single source of truth)

Order = smallest-unblock-first, then structural. Build + full `pytest` + user run-review between chunks.
Keep `@parity` tags + PARITY-MAP current.

- **F1 — One device identity + one restore path.** Collapse `selected_input_device_fingerprint` and
  `device_fingerprint`/`device_name` into a **single** persisted selected-device identity, written in one
  place (the device-selection setter — the `didSet` analog) and read by **one** startup restore path. Retire
  the duplicate `fft_canvas.py:315` restore (or make it defer to the single AppSettings key). The
  calibration map stays **name-keyed** (the device name is the identity, derived from the selected device —
  rate-independent, matching Swift's rate-independent uid). This is the core fix; it makes startup restore
  the *correct* device (the UMIK‑1) and apply its calibration.
- **F2 — Derive the active calibration from the applied profile, not a cache.** The load-time provenance
  check (and any "active calibration name" reader) compares the **actually-applied** calibration — the mic's
  live `_calibration_profile.name`, or `CalibrationStorage.calibration_for_device(current_device)` — mirroring
  the web's single `calibrationRef` source. Removes the stale-`None` false positive even if a cache lags.
- **F3 — Never gate calibration (re)load on device-name equality.** On load-match, ensure the matched
  device's calibration is actually resolved/applied before comparing (or compare the *intended* calibration
  for that device), rather than assuming "same name ⇒ calibration present."
- **F4 — Unify the QSettings scope.** Move `CalibrationStorage` to the `guitar_tap` `_APP` with a **one-time
  migration** that copies `storedCalibrations` / `deviceCalibrationMap` / `activeCalibrationID` from the old
  `GuitarTap` domain so existing associations survive.
- **F5 — Wire the calibration-name callback before the initial device selection** (or set the name directly
  in the single choke point), so the first auto-load at startup names the calibration too.

## 7. Verification (Python; run the app)

- **V1 — Startup selects the right mic + calibration.** With the UMIK‑1 attached and `7108913` associated,
  a fresh launch selects the UMIK‑1 and applies `7108913` (log shows the calibrated device, not the built-in
  mic); the Settings dialog and the live pipeline agree.
- **V2 — No false warning.** Load a `7108913`-calibrated `.guitartap` with the UMIK‑1 + `7108913` active →
  **no** "different calibration/microphone/sample-rate" warning.
- **V3 — Single device key.** Only one persisted selected-device identity exists; the restored selected
  device == the calibration device (no `selected_input_device_fingerprint` vs `device_name` split).
- **V4 — Migration.** Existing `7108913` association still present after the scope unification (no re-import).
- **V5 — Rate-independence.** Reconnecting the same mic at a different negotiated sample rate does not by
  itself produce a "different device"/"different sample rate" false positive for a same-mic measurement.
- **V6 — Suite + parity.** Full `pytest` green; `@parity`/PARITY-MAP clean; add a regression test for the
  provenance comparison (applied-calibration source), mirroring the web's guard.

## 8. Scope & priority

**BLOCKER.** No further Python validation until V1+V2 pass. Item 11 web work is parked (only the §10 plan
doc is committed — nothing mid-flight). Swift unchanged (canonical). Web unchanged (already single-source).
