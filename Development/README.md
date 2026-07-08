# GuitarTap Web

Web port of the Swift GuitarTap app — third implementation alongside Swift
(canonical) and Python. See `PLAN.md` (overall plan), `INVENTORY.md` (the spec
extracted from Swift), `PHASE2-DSP-HARNESS.md` (the headless DSP test plan),
`PHASE3-UI.md` (the React UI & material-measurement build), and `PARITY-MAP.md`
(web ↔ Swift ↔ Python module map).

## Status

**See [STATUS.md](STATUS.md) for the current open-work list.** The app is
feature-complete through Phase 6 (everything but the 6-TEST test-suite
normalization); Phases 2–5 and the full comment/doc-parity review are done.
Per-phase detail (including the Phase 2 DSP gates) lives in the `PHASE*` docs.

## Run

Requires Node ≥ 22.

```sh
npm install
npm run dev       # Phase 3 UI — live spectrum (open the printed localhost URL)
npm test          # DSP gates (vitest, headless)
npm run build     # typecheck + production build
npm run typecheck # tsc --noEmit
```

## Deploy

`npm run build` emits a **static site** in `dist/` (no server code). The whole app
is bundled/minified into four files — this is expected:

```
dist/
├── index.html
├── spectrum-processor.js     ← AudioWorklet (served from the deploy root)
└── assets/
    ├── index-<hash>.js        ← the entire app
    └── index-<hash>.css
```

To deploy, copy the **contents of `dist/`** into the target folder, **including the
`assets/` subdirectory** (a flattened or partial upload that drops `assets/` →
blank page, since `index.html` can't load its bundle).

Requirements & gotchas:

- **HTTPS is mandatory.** `getUserMedia` (mic) + `AudioWorklet` only run in a secure
  context (`localhost` is exempt; any real domain must be HTTPS).
- **Subpath base.** Production is built for `dolcesfogato.com/guitar_tap/guitar_tap_web/`
  via `base` in `vite.config.ts` (dev stays at `/`). The AudioWorklet loads through
  `import.meta.env.BASE_URL`, so it resolves under the subpath too. Deploying to a
  **different** path → change that one `base` string and rebuild.
- **Upload all four files together** — a new `index.html` pointing at an old
  `assets/index-<hash>.js` (or vice-versa) 404s; the hashes must match.
- No SPA rewrite rules or special headers needed (single page, no routing, no
  `SharedArrayBuffer`/COOP-COEP).

## UI

React + Vite. The tested `src/dsp/` core runs on the main thread; a minimal
AudioWorklet (`public/spectrum-processor.js`) forwards mic chunks + RMS. The
live spectrum refreshes ~every 1.4 s (65536-pt FFT, matching the app); the level
meter updates per 1024-sample chunk. Full UI (tap detection, live peaks,
controls, measurement-type modes, results, persistence, export) is built — see
`PHASE3-UI.md` / `PHASE4-PERSISTENCE.md`.

## Layout

```
src/dsp/        pure DSP (no Web Audio / DOM) — fft, gatedFFT, signal, wav
test/           vitest specs, one per gate
test/fixtures/  WAVs + UMIK-1 calibration + parity-oracle.json (vendored)
tooling/        sync-oracle.sh (pull the canonical oracle; --check for CI)
```

## Parity oracle

Expected values live in `test/fixtures/parity-oracle.json`, generated from the
canonical Swift run and **vendored** here. Refresh / verify with:

```sh
./tooling/sync-oracle.sh          # pull latest canonical
./tooling/sync-oracle.sh --check  # CI: fail if drifted from canonical
```

The web build never needs the Swift or Python repos on disk. See
`PHASE2-DSP-HARNESS.md` §4 for the sync model.
