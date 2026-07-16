// @parity none — in-app release notes. Browser edition only: the Apple edition ships its
// notes through the App Store, and the open-source desktop edition publishes a PDF with each
// GitHub release. The browser edition has no update step at all — it is always the latest the
// moment it loads — so the notes for the running version belong inside the app. There is no
// cross-platform contract to mirror. Justified platform-only.
//
// Authored as TSX, not Markdown: the web renders its own help (see QuickStartGuide) and has no
// Markdown pipeline. Swift/Python write theirs in Markdown because it is convenient input for the
// PDF they ship; the web ships no PDF, so a Markdown source plus a converter would buy nothing.

/** One bullet in a release: an optional lead-in heading and the prose that follows it. */
export interface RNItem {
  /** Short heading for the change (e.g. "Ring-Out (Decay Time)"). Omit for a bare bullet. */
  title?: string
  body: string
}

/** A group of changes within one release — "New Features", "Improvements", "Bug Fixes". */
export interface RNGroup {
  heading: string
  items: RNItem[]
}

/** One released version. */
export interface RNRelease {
  /** Marketing version, e.g. "1.0.2". */
  version: string
  /** Build number — the git commit count at the release commit. Omit for the initial release. */
  build?: string
  /** What this release is measured against, e.g. "1.0.1". */
  since?: string
  /** Optional framing paragraph shown under the version header. */
  intro?: string
  groups: RNGroup[]
}

/**
 * The release history, newest first.
 *
 * The browser edition is always current, so these notes always describe the version the reader is
 * running — unlike the other editions, where a user can be sitting on an older build.
 */
// eslint-disable-next-line react-refresh/only-export-components -- static release content; kept with the component rather than in its own data module
export const RELEASES: RNRelease[] = [
  {
    version: '1.0.2',
    // The git commit count at the release commit — the same number vite.config.ts stamps into
    // the app (`git rev-list --count HEAD`), so the notes and the About line always agree.
    build: '112',
    since: '1.0.1',
    intro:
      'The browser edition has caught up with the macOS/iOS and desktop editions: ring-out measurement, the full Analysis Results panel, in-app help, live material spectra, phone support, and the same tap detection the other editions use. Everything below is new since the first release.',
    groups: [
      {
        heading: 'New Features',
        items: [
          {
            title: 'Ring-Out (Decay Time)',
            body: 'Guitar Tap now measures ring-out — how long the tap tone takes to decay — and shows it alongside the peaks, both live and on saved measurements. It is rated as well, so you can see at a glance whether an instrument’s sustain is where you would expect it.',
          },
          {
            title: 'Analysis Results',
            body: 'The full Analysis Results panel is here: every peak as a card with its frequency, magnitude, Q factor and identified mode, along with the guitar summary. Peaks can be selected and deselected, modes reassigned by hand, and Re-analyze returns everything to the automatic result.',
          },
          {
            title: 'Material (Plate & Brace) Measurements',
            body: 'The chart now shows the live signal while you tap a plate or brace, instead of waiting for the phase to complete. The Analysis Results panel fills in as you tap: the Long / Cross / (FLC) rows appear immediately as dashed placeholders and complete as each phase finishes, with the calculated properties appearing once the whole measurement is done. Each phase averages its taps and locates the peak from the averaged spectrum, matching the other editions.',
          },
          {
            title: 'Spectrum Chart',
            body: 'A live crosshair reads out frequency and magnitude wherever you point. The Peak Min threshold is drawn on the chart as a dashed line, so you can see exactly which peaks it is keeping. Bin Count is now shown with the analysis metrics.',
          },
          {
            title: 'iPhone & Installed App',
            body: 'Guitar Tap can be installed to your home screen and used as an app. On iPhone, portrait puts the controls in a bottom sheet and landscape uses a left rail with the Results panel sliding in over the spectrum, so the chart keeps its full width.',
          },
          {
            title: 'Export All / Import',
            body: 'Export All writes every saved measurement to a single file and Import brings a set back in — the way to move measurements between browsers, which cannot otherwise share storage.',
          },
          {
            title: 'In-App Help',
            body: 'A Quick Start guide is now built into the app, covering each control and the measurement workflows. These release notes are part of it.',
          },
          {
            title: 'Open Source',
            body: 'The browser edition is open source. See the README and LICENSE in the repository.',
          },
        ],
      },
      {
        heading: 'Improvements',
        items: [
          {
            title: 'Tap Detection',
            body: 'Plate and brace measurements now detect taps relative to the measured noise floor rather than against a fixed threshold, with hysteresis to reject bounce — the same detector the macOS/iOS and desktop editions use. In a noisy room a fixed threshold could miss every tap; this tracks the room. Guitar measurements gained the same hysteresis.',
          },
          {
            title: 'Status & Progress',
            body: 'A progress bar now tracks a multi-tap or multi-phase measurement, appearing with the first tap and staying until the sequence is done. Plate and brace measurements show the phase guidance — "Tap the plate along the long axis", and so on. The status line stays quiet during the brief warm-up at start-up rather than reporting a state that is not yet meaningful.',
          },
          {
            title: 'Tap Sequence Controls',
            body: 'Cancel restarts the tap sequence rather than leaving it half-finished, and New Tap is available whenever a measurement is not actively being captured, so you can always start a fresh one. The Taps (multi-tap comparison) toggle is enabled and disabled in place instead of appearing and disappearing.',
          },
          {
            title: 'Display',
            body: 'The display frequency range is remembered per measurement type, so guitar, plate and brace each keep their own view. Mode colours now match the other editions exactly.',
          },
          {
            title: 'Recording',
            body: 'Dump Capture Audio previously wrote both a WAV for every tap and a continuous recording of the whole session. It now writes only the continuous session recording, which already contains every approved tap in capture order — the per-tap files were redundant. In the browser, captured audio downloads to your Downloads folder.',
          },
          {
            title: 'Saving',
            body: 'Saving a measurement now requires a name, so every measurement is identifiable at a glance in the list and in exports. The Save button stays disabled until you enter one; notes remain optional.',
          },
          {
            title: 'Exporting',
            body: 'Exported and downloaded file names are now consistent with the macOS and desktop editions, and names with accented or non-Latin characters (for example Ramírez) are preserved correctly instead of being stripped.',
          },
          {
            title: 'Microphone Calibration',
            body: 'Calibration files are parsed the same way as the other editions, including the reference-SPL and sensitivity-factor precedence, so a calibrated microphone reads the same level everywhere.',
          },
        ],
      },
      {
        heading: 'Bug Fixes',
        items: [
          {
            body: 'Loading a saved measurement always warned that it “was recorded with a different calibration”, even when the microphone and calibration in use were exactly the ones it was recorded with. The check never looked at the calibration you currently have loaded, so every calibrated measurement raised the warning. It now warns only when something genuinely differs.',
          },
          {
            body: 'The spectrum chart and the exported image and PDF report showed the wrong peaks. Every detected peak was dotted rather than the ones your annotation setting selects, and the report’s Detected Peaks summary listed the lowest-frequency peaks instead of the selected ones — leaving out selected peaks that sit outside the plotted frequency range. The chart, the image and the report now all show exactly the selected peaks, matching the App Store and open-source editions.',
          },
          {
            body: 'Playing a measurement from a file did not detect taps the same way a live measurement does — it used a fixed threshold rather than tracking the noise floor. File playback now behaves exactly like a live measurement, which also means a recording needs a short lead-in before its first tap (see the Quick Start guide).',
          },
          {
            body: 'Re-analyze disabled itself after a single press, and was never offered for a measurement you had captured rather than loaded. It is now available for any completed guitar measurement, and stays available.',
          },
          {
            body: 'The microphone could silently stop delivering audio — most often because another tab or app took it — and Guitar Tap would sit there appearing to listen while receiving nothing. It now detects this and restarts the input automatically.',
          },
          {
            body: 'A saved plate or brace measurement always recorded one tap, however many you actually took. The measurement itself was correct — each phase still averaged all of its taps — but the tap count shown in Measurement Details and in the PDF report was wrong, and stayed wrong when the measurement was re-loaded. Guitar measurements were unaffected.',
          },
          {
            body: 'The ⋯ menu on a saved measurement could be cut off by the bottom of the browser window, putting Delete out of reach. It only happened once the list grew long enough to put rows near the bottom. The menu now measures itself and opens upwards when there isn’t room below.',
          },
          {
            body: 'Exported PDF reports were far larger than they needed to be — around 3.5 MB for a plate report. The spectrum image was being stored uncompressed. The same report is now about 0.18 MB, with no loss of quality.',
          },
          {
            body: 'Starting a New Tap after loading a saved measurement kept the loaded measurement’s name in the Save dialog, and left its “recorded with a different setup” warning on screen. New Tap now clears both, on guitar and material measurements alike.',
          },
          { body: 'The phone-only Results button appeared on desktop layouts.' },
          { body: 'Changing the number of taps mid-setup did not refresh the on-screen prompt.' },
          { body: 'The dark-mode curve colour on the material chart was wrong.' },
          { body: 'An Overall Quality of “Good” was shown in yellow instead of blue, and “Very Good” was hard to tell from “Excellent”, in both the Analysis Results panel and the PDF report.' },
          { body: 'The FLC tap could be captured before the plate had stopped ringing from the previous phase.' },
        ],
      },
    ],
  },
  {
    version: '1.0.1',
    groups: [
      {
        heading: 'First Release',
        items: [{ body: 'First public release of the browser edition of Guitar Tap.' }],
      },
    ],
  },
]

/** Renders the Release Notes modal from {@link RELEASES}. Mirrors the Quick Start Guide's shell
 *  and reuses its styles, so the two Help panels look and behave the same. */
export function ReleaseNotes({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-overlay" role="dialog" aria-label="Release Notes" onClick={onClose}>
      <div className="settings-modal qs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Release Notes</h2>
          <div className="set-head-buttons">
            <button className="btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
        <div className="qs-scroll">
          {RELEASES.map((rel) => (
            <section key={rel.version} className="qs-section">
              <h3 className="qs-h">
                Version {rel.version}
                {rel.build && ` · Build ${rel.build}`}
              </h3>
              {rel.since && <div className="rn-since">What’s new since {rel.since}</div>}
              {rel.intro && <p className="qs-intro">{rel.intro}</p>}
              {rel.groups.map((g) => (
                <div key={g.heading} className="rn-group">
                  <div className="rn-group-h">{g.heading}</div>
                  {g.items.map((it, i) => (
                    <div key={i} className="qs-row">
                      <div className="qs-row-main">
                        {it.title && <div className="qs-row-title">{it.title}</div>}
                        <div className="qs-row-body">{it.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}