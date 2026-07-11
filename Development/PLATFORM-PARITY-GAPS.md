# Platform Parity Gaps — cross-platform behavior/UI differences to reconcile

Backlog of behavior/UI differences between **Swift** (canonical), **Python**, and the **web** that must be
reconciled across all three. These are NOT part of any single feature effort — they surface during run-reviews and
are collected here so they don't get lost.

**Status: open backlog — a SEPARATE cross-platform parity effort, to be done AFTER Phase 6** (these are not
test-normalization or 3c-consolidation work). Found during the 6-3c run-review (2026-07-12).

**How to resolve each (the decision framework):** read **Swift first** (then Python) and match it — never reason
from the web's current behavior, which is often the divergence. If the web/Python alternative is genuinely
*better*, it is not a web-only change: it's a cross-platform improvement designed once and applied to Swift +
Python + web together (get buy-in first). See the memory rule *"What does Swift do?"* + its corollary.

Maintain `@parity` tags + regenerate PARITY-MAP.md on any code change.

---

## OUT-1 — Phase-guidance-through-warmup (Swift + Python)

The material phase status strings the web shows — `capturingC` → "Rotate 90° and tap for C", redo →
"Ready for L/C/FLC tap — tap again", and the FLC prompt — are the **intended** canonical messages
(Swift `Control.swift:344-347` / Python `control.py:830-833` SET them), but they are **dead in Swift/Python**: the
phase-arm **restarts the warm-up** (`analyzerStartTime = Date()`, purposeful — it suppresses false triggers while
the plate is repositioned), and the detection loop then overwrites the message with "Initializing… (Ns)" →
"Tap the guitar…", so the user never sees them (confirmed on current Swift build 374 + run-review). Swift and
Python AGREE (no canonical inconsistency); the web was the outlier only because it has no warm-up to overwrite them.

**DECISION (user, run-review 2026-07-12) — Option B: make the phase guidance VISIBLE in all three** (rather than
hide it). A canonical detection-loop change: Swift + Python show the phase message *through* the phase-arm warm-up
(keeping the warm-up for false-trigger suppression); the **web is already conformant** (3c-C4 shows them, NOT
reverted). Requires a **Swift release**; the parity tests are updated **lock-step**. **Design-for-review before
editing canonical.**

**The full dead-string set the fix must make visible** (each set right before a warm-up restart that overwrites it):
- Accept L→C: `"Rotate 90° and tap for C"` (Swift Control:344 restart + :347 msg).
- Accept C→FLC: `"Set up for FLC tap, then tap"` — shows during the disarmed cooldown, but does the armed
  `capturingFlc` keep it or go generic? (verify; Swift Control:353 + :360 restart).
- Redo L / C / FLC: `"Ready for L/C/FLC tap — tap again"` (Swift Control:454/473/492 restart + :457/476/495 msg) —
  **confirmed on current Swift: goes to "Tap the guitar…"**.
- (Also the resume strings Control:278-282 "Ready for fL/L/C/FLC tap" if resume restarts warm-up — verify.)

---

## OUT-2 — Status-bar progress: bar missing + `sbProgress` text divergences

(a) **Progress bar is Swift-only.** Swift renders a visual tap/phase progress **bar**
(`ProgressView(value: tapProgress)`, Controls:420) in the bottom status bar; the **web shows only the text** and
**Python has neither** → add the bar to **Python + web**.

(b) **`sbProgress` TEXT diverges** from Swift (Controls:405-413, verified in the 3c-D run-review): the web GUITAR
branch shows a provisional `currentTapCount + (capturing ? 1 : 0)` — Swift shows raw `currentTapCount` (no +1); and
the web gates guitar on `numberOfTaps > 1` while Swift gates on `currentTapCount > 0`. (Plate/brace text matches
Swift; the two-branch structure IS canonical — Swift branches plate vs brace/guitar too.) Align the guitar text to
Swift (or, if the provisional +1 is judged better, apply to all three).

Cross-platform UI-parity item, independent of the statusMessage work.

---

## OUT-3 — Metrics "Bin Count" blank for plate/brace (web-only)

The Metrics panel shows a blank ("-") **Bin Count** for plate/brace in the web; Swift + Python show **32,768**.
Web-only: the App `metrics` useMemo gates `binCount: !material && captured ? captured.frequencies.length : null`,
so material → null. Fix = show the FFT bin count for material too (from the live/continuous FFT — `GUITAR_FFT_SIZE`
-based, the ~32,768 bins Swift/Python report). Swift/Python already correct.