# Guitar Tap (Web)

Tap-tone spectrum analysis for luthiers, running entirely in the browser. Tap a
guitar, tonewood plate, or brace; Guitar Tap captures the sound, runs a
high-resolution FFT, and reveals the resonant peaks and material properties that
guide bracing, mass distribution, and plate thickness — the methodology from
*Contemporary Acoustic Guitar Design and Build* by Trevor Gore and Gerard Gilet.

**▶ Live app: <https://www.dolcesfogato.com/guitar_tap/guitar_tap_web/>**

This is the **web edition** of Guitar Tap. It is a long-term parallel port of the
native **Swift** app ([GuitarTap], the canonical reference for both algorithm and
UX) and the **Python** desktop app ([guitar_tap], the mirror). All three are kept
at numeric/behavioural parity (see [Parity](#parity) below).

Everything runs client-side: the DSP happens in the browser, and your saved
measurement library lives in the browser's IndexedDB — no server, no accounts, no
tracking. It installs as a Progressive Web App for an app window, offline use, and
durable storage.

## Features

- **Guitar mode** — identify Air (Helmholtz), Top, Back and other body resonances,
  each labelled with frequency, pitch, and Q, plus the tap-tone ratio and ring-out.
- **Plate mode** — Young's modulus (along/across grain), speed of sound, specific
  modulus, radiation ratio, a quality grade, and a Gore target thickness.
- **Brace mode** — fast single-tap stiffness, speed of sound, specific modulus.
- Live spectrum with automatic tap capture, multi-tap averaging, calibration
  (UMIK-1), comparison overlays, PDF/image/`.guitartap` export, and a saved library.
- Installable PWA; keyboard, mouse, touch, and iPhone/iPad layouts.

## Tech stack

- **[Vite]** + **React 18** + **TypeScript** (strict).
- Pure DSP in `src/dsp` (no DOM/audio), unit-tested against a shared **oracle**.
- Live audio via an **AudioWorklet** (`public/spectrum-processor.js`).
- Library persistence in **IndexedDB**; files in the `.guitartap` JSON format.
- **[vite-plugin-pwa]** (Workbox) for the installable/offline app.
- **[Vitest]** for the test suite.

## Project structure

```
src/
  dsp/           Pure DSP core — FFT, gated capture, peak finding, classify,
                 material properties, pitch, calibration. No DOM/audio; oracle-tested.
  audio/         AudioWorklet-driven engine: mic capture, tap detection, playback.
  components/    React UI — spectrum chart, peak cards, panels, sheets, settings.
  measurement/   .guitartap read/write + the IndexedDB library store.
  presentation/  Rendering/export helpers (PDF report, spectrum image, mode colours).
  hooks/ format/ Small shared utilities.
  App.tsx        Top-level app: toolbar, live view, results, state.
public/
  spectrum-processor.js   AudioWorklet (microphone → FFT frames).
  icons/                  PWA + favicon assets.
test/            Vitest oracle-driven parity tests (g0–g11 + regressions).
  fixtures/parity-oracle.json   Expected values, generated from the Swift reference.
tooling/sync-oracle.sh          Maintainer script: refresh the vendored oracle.
Development/     Design & planning docs (PLAN, PHASE*, PARITY-MAP, WEB-UI-GUIDELINES…).
```

## Getting started

Prerequisites: **Node.js ≥ 20** (the repo's `.nvmrc` pins v26.3.1) and **git**.

```bash
git clone https://github.com/dwsdolce/GuitarTapWeb.git
cd GuitarTapWeb
npm install          # or `npm ci` for an exact, lockfile-pinned install

npm run dev          # start the dev server (http://localhost:5173)
npm test             # run the Vitest parity suite
npm run typecheck    # strict TypeScript check (no emit)
```

Grant microphone permission when prompted — audio is analysed locally and never
leaves the browser.

## Build

```bash
npm run build        # tsc --noEmit && vite build  →  dist/
npm run preview      # serve the production build locally to smoke-test it
```

`npm run build` type-checks, then emits a static, self-contained site to `dist/`
(HTML, JS/CSS bundle, the AudioWorklet, PWA manifest, and service worker).

The **version/build string** shown in the app (`Web 1.0.1 (NNN)`) comes from
`package.json` `version` plus the git commit count (`git rev-list --count HEAD`) —
the same scheme as the Swift and Python editions, computed at build time in
`vite.config.ts`.

## Deploy

The output in `dist/` is a plain static site — host it on any static web server
or CDN. Two things matter:

1. **Base path.** The production build is configured for the subpath
   `/guitar_tap/guitar_tap_web/` (see `base` in `vite.config.ts`). Upload the
   contents of `dist/` to that path on your server. **If you deploy to a different
   host or path, change `base`** and rebuild, or asset and AudioWorklet URLs will
   404.
2. **HTTPS.** A secure context is required for the service worker (PWA/offline),
   microphone access, and installability. `localhost` is exempt for local testing;
   any real deployment must be served over HTTPS.

Deploy is therefore: `npm run build`, then copy `dist/**` to the HTTPS host at the
configured base path. The service worker uses `autoUpdate`, so a returning visitor
picks up the new build on their next visit. The PWA is installable from the browser
(Chrome/Edge: install icon in the address bar; Safari iOS: Share → Add to Home
Screen; Safari macOS: File → Add to Dock).

## Parity

Behaviour is pinned to the canonical Swift app, not to this code:

- **Numeric** outputs match to 2–3 decimal places; **categorical** outputs match
  exactly; `.guitartap` files round-trip across all three editions.
- The contract is the **oracle** (`test/fixtures/parity-oracle.json`), which is
  **committed to this repository** — so the test suite is self-contained and needs
  nothing else to run. It is generated from the canonical Swift build by the
  maintainer (`tooling/sync-oracle.sh`), and the Vitest suite (`test/g*.test.ts`)
  checks every DSP result against it.
- Each mirrored module carries a `@parity` slug the maintainer uses to keep the
  Swift, Python, and web implementations in step.

When an algorithm changes, it is designed once and applied to Swift, Python, and web
together, with the oracle regenerated.

## Documentation

- **User manual** (shared across editions): <https://www.dolcesfogato.com/guitar_tap/manual/>
- **In-app Quick Start**: the Help menu inside the app.
- **Design & planning docs**: the [`Development/`](Development/) directory
  (`PLAN.md`, the `PHASE*` writeups, `PARITY-MAP.md`, `WEB-UI-GUIDELINES.md`, …).

## Related projects

- **[GuitarTap]** — native app for iPhone, iPad, and Mac (Swift; the canonical reference).
- **[guitar_tap]** — open-source desktop app for Windows, macOS, and Linux (Python).

## Contributing

Issues and pull requests are welcome. Before opening a PR, please run
`npm test` and `npm run typecheck`. Because this is a parity port, changes to DSP
or behaviour must preserve the oracle contract. If you're proposing an intentional
behaviour change, please open an issue first so it can be coordinated across all
three editions and the oracle is regenerated by the maintainer.

## License

Copyright © 2026 Dolce Sfogato (David Smith).

GNU General Public License v3.0, matching the [guitar_tap] project. See the
[LICENSE](LICENSE) file.

[GuitarTap]: https://apps.apple.com/app/guitar-tap/id6759410596
[guitar_tap]: https://github.com/dwsdolce/guitar_tap
[Vite]: https://vitejs.dev/
[vite-plugin-pwa]: https://vite-pwa-org.netlify.app/
[Vitest]: https://vitest.dev/