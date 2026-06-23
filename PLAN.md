# GuitarTap Web — Migration Plan

## Scope

A web port of the Swift GuitarTap app, supported long-term in parallel with
Swift and Python — the same relationship Swift and Python have today.

- **Canonical reference:** Swift remains the spec for both algorithm and UX.
- **Tracking implementations:** Python and Web mirror Swift; behavior changes
  originate in Swift and propagate outward.

## Fidelity Bar

**Match the existing Swift ↔ Python consistency, extended to Web as a
third implementation.**

Concretely, starting from the same recorded WAV (or the same `.guitartap`
file), all three implementations must produce:

- **Numeric outputs** (peak frequencies, material measurements, spectral
  values) agreeing to 2–3 decimal places — the level Swift and Python
  already achieve today.
- **Categorical outputs** (peak picks, onset indices, tap-detection
  decisions, peak counts) matching exactly.
- **File round-trip:** writing a `.guitartap` in one implementation and
  reading it in another must preserve all of the above.

This is **not** byte-identical floating-point output. Different FFT
libraries (Accelerate vDSP, NumPy, JS) produce results that diverge in the
last few bits regardless of intent — chasing bit-identity would require
porting one exact FFT across all three platforms, which Swift ↔ Python
have not done and do not need. The bar is the existing
cross-implementation consistency, not tighter.

This is the hard constraint that shapes everything else in the plan.

## Target Devices

- **Primary:** Desktop browsers (Chrome, Safari, Firefox, Edge).
- **Secondary:** Mobile tablet — iPad (mobile Safari) and Android tablets
  (mobile Chrome).
- **Tertiary:** Mobile phone — iPhone (mobile Safari) and Android phones
  (mobile Chrome).

Implications:

- Both Chromium and Safari are first-class targets; Firefox should work
  but isn't a validation gate. Layout collapses from desktop → tablet →
  phone, but the audio + DSP stack is shared across all three tiers.
- iOS Safari and Android Chrome have different AudioWorklet, mic
  permission, and PWA install behaviors. Mobile work must validate on
  both, not just one.

## Phased Plan

### Phase 1 — Inventory & Spec (no code yet)

Walk the Swift codebase and extract a written specification of every piece
that must be reproduced. This document becomes the contract the web build
is measured against. Output is markdown, not code.

See `INVENTORY.md` for the running checklist.

### Phase 2 — Headless DSP Port

- Stack: Vite + TypeScript + AudioWorklet.
- No UI. Command-line / test harness only.
- Inputs: the same WAV fixtures used by the Swift regression suite.
- Success criterion: numeric output agrees with Swift to 2–3 decimal
  places, and all categorical outputs (peak picks, onset indices, tap
  decisions, peak counts) match exactly. Same bar Swift ↔ Python already
  meets.

Risk concentration is here. Until this matches, do not start Phase 3.

### Phase 3 — UI

- Framework: React + TypeScript (closest mental model to SwiftUI for the
  team; richest ecosystem for canvas visualization and Web Audio glue).
- Port one screen at a time, starting with the live tap-analysis view.
- Responsive layout: desktop-first, with tablet and phone as
  progressively constrained variants.

### Phase 4 — Persistence & PWA

- IndexedDB for session storage.
- `.guitartap` file read/write — must match Swift's binary format exactly.
- Service worker for offline operation.
- Microphone permission UX.
- Install-as-PWA polish.

## Key Technical Risks

1. **Sample rate is more abstracted than in Swift/Python.** In Swift and
   Python the input arrives at the microphone's native rate. The Web
   Audio API hides this: `getUserMedia` audio is automatically resampled
   by the browser to whatever rate the `AudioContext` is running at,
   which the browser chooses (typically the system output rate). Hints
   passed to `new AudioContext({ sampleRate })` or `getUserMedia({ audio:
   { sampleRate } })` may be silently ignored, especially on iOS Safari.
   `track.getSettings().sampleRate` reports what you actually got — which
   may already be a browser resample of the mic input.

   Implications:

   - Treat sample rate as a runtime value read from the live
     `AudioContext` / track (the way Swift and Python read it from the
     mic). Do not hardcode rates anywhere in the DSP.
   - Specify how cross-implementation WAV playback is handled: decode at
     the file's embedded rate via `decodeAudioData`, or resample to a
     canonical rate before DSP. This must be a documented choice, not
     accidental.
   - For live analysis, the input rate is out of the app's hands. As
     long as the DSP is rate-correct, categorical outputs (peaks,
     onsets, decisions) should still match — they depend on the spectrum
     shape, not bit-for-bit waveform equality. This is consistent with
     the parity bar.

2. **AudioWorklet on mobile.** Supported on both iOS Safari and Android
   Chrome, but with historical quirks around suspend/resume, permission
   gating, and audio-context unlock on user gesture. Behaviors differ
   between the two. Validate early on both.

3. **FFT numeric consistency (not bit-exactness).** Different FFT
   implementations diverge in the last few bits. The risk isn't those
   bits — it's when the divergence bubbles up into different peak picks
   or onset decisions, which would break categorical parity. Validate
   against the existing regression fixtures and treat any categorical
   disagreement as a defect.

4. **File System Access API is Chromium-only.** Available on desktop
   Chrome/Edge, not on Safari (desktop or mobile) and not on Firefox.
   `.guitartap` file save/load needs a portable fallback (downloads +
   `<input type="file">`) that works everywhere, with the File System
   Access API as an optional enhancement on Chromium.

## Open Questions (decide during Phase 1)

- What is Swift's capture sample rate — confirmed device-dependent
  (mic-native), but document the range actually seen in practice and
  whether any code path assumes a specific rate.
- Which FFT library does Swift use (Accelerate vDSP?), and can its exact
  numerics be reproduced in JS?
- Is the `.guitartap` file format already documented anywhere, or does it
  need to be reverse-engineered from the Swift writer?
- Does the Python implementation already solve any of these
  cross-implementation parity problems? If so, mine it for answers.
