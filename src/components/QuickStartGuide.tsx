// In-app Quick Start Guide — the web port of Swift HelpView / Python HelpDialog
// (window title "Quick Start Guide"). Same sectioned content, with the platform-specific
// bits adapted for the browser: "Click" (not "Tap"), the toolbar Help button (no menu bar),
// no keyboard shortcuts, and the always-live crosshair documented. The full online reference
// is the separate User Manual (Help menu → User Manual).
// @parity view/help

import {
  TapIcon,
  PauseIcon,
  CancelIcon,
  UndoIcon,
  AutoDbIcon,
  EyeIcon,
  SaveIcon,
  ClipboardIcon,
  BarChartIcon,
  GearIcon,
  BookIcon,
  FilePlayIcon,
  WaveformIcon,
  WrenchIcon,
  MusicIcon,
  LayersIcon,
  BraceIcon,
  SlidersIcon,
  LightbulbIcon,
  BookOpenIcon,
  CrosshairIcon,
  TagIcon,
  EllipsisIcon,
  SearchIcon,
  GaugeIcon,
  RefreshIcon,
} from './icons'

// Icon registry — keys used by the section/row data below. The control glyphs (tap, pause, cancel,
// autoDb, eye, save, clipboard, barChart, filePlay, gear, book) are the SAME components rendered on
// the toolbars, so the guide's icons match what the user sees on each control.
const ICONS = {
  tap: TapIcon,
  pause: PauseIcon,
  cancel: CancelIcon,
  undo: UndoIcon,
  autoDb: AutoDbIcon,
  eye: EyeIcon,
  save: SaveIcon,
  clipboard: ClipboardIcon,
  barChart: BarChartIcon,
  gear: GearIcon,
  book: BookIcon,
  filePlay: FilePlayIcon,
  waveform: WaveformIcon,
  wrench: WrenchIcon,
  music: MusicIcon,
  layers: LayersIcon,
  brace: BraceIcon,
  sliders: SlidersIcon,
  lightbulb: LightbulbIcon,
  bookOpen: BookOpenIcon,
  crosshair: CrosshairIcon,
  tag: TagIcon,
  ellipsis: EllipsisIcon,
  search: SearchIcon,
  gauge: GaugeIcon,
  refresh: RefreshIcon,
} as const
type IconKey = keyof typeof ICONS

export interface QSRow {
  title?: string
  body: string
  icon?: IconKey
}
export interface QSSection {
  title: string
  intro?: string
  icon?: IconKey
  rows: QSRow[]
}

// Content ported from the canonical source (Swift HelpView / Python HelpDialog), adapted for
// the web: the desktop menu bar + keyboard shortcuts become the two toolbars (the web has no
// shortcuts), the iPhone-only and "Re-analyze Peaks" notes are dropped (no web equivalent),
// the selection-reset control is the "Auto" button, and the always-live crosshair is documented.
export const QUICK_START_SECTIONS: QSSection[] = [
  {
    title: 'What Guitar Tap Does',
    icon: 'waveform',
    intro:
      "Guitar Tap uses your device's microphone to capture the brief ring-out after you tap a guitar or wood sample. A 65,536-point FFT (approximately 0.67 Hz resolution) reveals the resonant peaks that carry information about structural modes and material stiffness.",
    rows: [
      { title: 'Guitar mode', body: 'Classify resonant modes of a completed instrument.' },
      { title: 'Plate mode', body: "Measure Young's modulus and quality of a raw tonewood plate." },
      { title: 'Brace mode', body: "Measure Young's modulus and quality of a brace strip (single longitudinal tap)." },
    ],
  },
  {
    title: 'First-Time Setup',
    icon: 'wrench',
    rows: [
      {
        title: 'Grant Microphone Access',
        body: 'The first time you open the app your browser asks for microphone permission. Without it the analyzer cannot run.',
      },
      {
        title: 'Select Audio Input',
        body: 'Open Settings. The Audio Input & Calibration section appears at the top. Choose your microphone or audio interface here. If you have a calibration file for your measurement mic, import it in this section too.',
      },
      {
        title: 'Choose a Measurement Type',
        body: 'In Settings, the Measurement Type section is directly below Audio Input. Pick Generic Guitar (the default, with broad ranges that work for any guitar), Classical, Flamenco, Acoustic / Steel String, Material (Plate), or Material (Brace). The right choice determines which mode-frequency ranges are used and which measurements are calculated.',
      },
      {
        title: 'Advanced Settings',
        body: 'Display range, analysis range, and FFT processing options are grouped under the Advanced section at the bottom of Settings. These rarely need changing after initial setup — expand the section by clicking the Advanced row.',
      },
      {
        title: 'Quiet Environment',
        body: 'Background noise raises the noise floor. A quiet workbench with the device resting on a folded cloth a few centimetres from the tap point gives the most repeatable results.',
      },
    ],
  },
  {
    title: 'Guitar Mode',
    icon: 'music',
    rows: [
      {
        title: 'Overview',
        body: 'Guitar mode identifies the key structural resonances of a completed body: Air (Helmholtz cavity resonance), Top (main top-plate resonance), Back, Dipole, Ring Mode, and Upper Modes.',
      },
      {
        title: 'Step 1 — Configure',
        body: 'In Settings choose the guitar type in the Measurement Type section. Generic Guitar (the default) uses broad ranges that work for any guitar; Classical, Flamenco, and Acoustic / Steel String use narrower calibrated windows shown in the same section. The Show Unknown Modes toggle is in the Advanced section.',
      },
      {
        title: 'Step 2 — Position the Microphone',
        body: 'The spectrum updates in real time as soon as the app opens. Set the device microphone 5–15 cm from the guitar, aimed at the sound hole or tap point.',
      },
      {
        title: 'Step 3 — New Tap',
        body: 'Click the New Tap button to arm the detector, then give the guitar top (or back, side, etc.) a firm knuckle rap. The spectrum freezes automatically when a tap is detected.',
      },
      {
        title: 'Step 4 — Inspect Peaks',
        body: 'Coloured markers label each resonant peak with its mode, frequency, and pitch. In guitar mode, one peak per mode is auto-selected based on the strongest peak in each frequency range, working lowest-to-highest so overlapping ranges resolve in favour of the lower mode. Click a peak label to toggle its selection. Use the Annotations button to cycle through All / Selected / None label modes. In the Results panel, the Auto button resets selections back to automatic if you have made manual changes.',
      },
      {
        title: 'Step 5 — Read the Results',
        body: 'The results panel shows the peak list with frequency, magnitude, Q factor, bandwidth, and pitch. Decay time (ring-out in seconds) and Tap Tone Ratio (Top ÷ Air) are shown when applicable. Typical top/air ratios range from 1.8 to 2.4 for quality instruments.',
      },
      {
        title: 'Multi-Tap Averaging',
        body: 'Setting the tap count to 2–10 averages multiple taps together, reducing noise from finger squeaks and ambient sounds. Progress is shown in the status bar. Use Pause between taps to let the ring-out decay.',
      },
      {
        title: 'Multi-Tap Comparison',
        body: "After a multi-tap guitar sequence (2–10 taps), the Results panel header shows a Taps button. Click it to switch to Multi-Tap Comparison view: the chart overlays each individual tap's spectrum in a distinct colour alongside the averaged spectrum, and the Results panel shows an Air / Top / Back frequency table with one row per tap plus a final Averaged row. Click the button again to return to the normal averaged view. The per-tap data is saved with the measurement and reloads correctly — the Taps button reappears whenever a measurement with multi-tap data is loaded.",
      },
      {
        title: 'Overriding Mode Classification',
        body: 'If a peak is labelled Unknown, or misclassified, click it in the Results list and assign the correct mode manually. Your override is saved with the measurement.',
      },
      {
        title: 'Step 6 — Save',
        body: 'Click Save. Enter a measurement name (e.g. "Martin D-28" or "Ramirez 1075") and any notes. The measurement is stored with all peaks, the spectrum snapshot, and a chart image.',
      },
    ],
  },
  {
    title: 'Plate Mode',
    icon: 'layers',
    rows: [
      {
        title: 'Overview',
        body: "Plate material mode measures the stiffness of a rectangular tonewood sample using three free-free beam bending taps: Longitudinal (along grain), Cross-grain, and optionally FLC (diagonal/torsional). From the tap frequencies it derives Young's modulus, speed of sound, specific modulus, radiation ratio, and a quality rating.",
      },
      {
        title: 'Prepare the Sample',
        body: 'Cut or plane a rectangular blank. Measure length (along grain), width (cross grain), thickness, and mass precisely — accuracy here directly affects the calculated moduli. A kitchen scale accurate to 0.1 g is adequate for most samples.',
      },
      {
        title: 'Enter Dimensions in Settings',
        body: 'Open Settings → Measurement Type → Material. Enter Length (along grain), Width (cross grain), Thickness, and Mass. The app instantly shows the calculated density so you can catch data-entry errors before tapping.',
      },
      {
        title: 'Suspension Technique',
        body: 'Hold the plate at one point 22% from one end along the dimension being measured, positioned near one edge in the other dimension (not on that dimension’s nodal line). This damps the unwanted resonance while approximating the free-free boundary condition. The other hand taps.',
      },
      {
        title: 'Tap 1 — Longitudinal',
        body: 'With the grain running left–right, hold the plate at one point 22% from one end along the length, near one long edge (not at the width nodal line — this damps the cross-grain resonance). Tap center. Click New Tap and follow the on-screen prompt "Capturing Longitudinal". The app selects the strongest peak as the longitudinal frequency.',
      },
      {
        title: 'Tap 2 — Cross-Grain',
        body: 'Rotate the plate 90° so the grain runs front–back. Hold at one point 22% from one end along the width, near one short edge (not at the length nodal line — this damps the longitudinal resonance). Tap center. The app prompts "Capturing Cross-Grain" automatically after the longitudinal tap is accepted.',
      },
      {
        title: 'Tap 3 — FLC (Optional)',
        body: 'Enable Measure FLC in Settings. Hold the plate at the midpoint of one long edge and tap near the opposite corner (~22% from both the end and the side). This adds a shear modulus measurement used in the Gore target-thickness calculation. Omitting it over-estimates target thickness by roughly 5–7%.',
      },
      {
        title: 'Reading the Results',
        body: 'After all taps, view Results to see: E_L / E_C — Young’s modulus along and across grain (GPa); c_L / c_C — speed of sound in each direction (m/s); Specific modulus E/ρ — the primary quality metric (GPa per g/cm³); Radiation ratio — sound radiation efficiency; Cross/Long ratio — anisotropy (spruce: typically 0.04–0.08); Quality rating — Excellent / Very Good / Good / Fair / Poor (spruce scale); and Gore target thickness — the recommended finished plate thickness for a guitar of your specified body dimensions (requires FLC or uses an approximation).',
      },
      {
        title: 'Spruce Quality Scale',
        body: 'Specific modulus (longitudinal): ≥ 25 → Excellent (Master grade); ≥ 22 → Very Good (AAA); ≥ 19 → Good (AA); ≥ 16 → Fair (A); < 16 → Poor.',
      },
      {
        title: 'Gore Target Thickness',
        body: 'Enter the finished guitar body length and lower bout width in Settings (Material section). Choose the plate stiffness preset: Steel String Top (f_vs 75), Steel String Back (55), Classical (50), or Custom. The result is the plate thickness that hits the preset vibrational stiffness after bracing is factored in — a direct implementation of Gore Equation 4.5-7.',
      },
    ],
  },
  {
    title: 'Brace Mode',
    icon: 'brace',
    rows: [
      {
        title: 'Overview',
        body: 'Brace mode is a fast single-tap variant of Plate mode designed for brace strips. Only a longitudinal tap is needed; cross-grain and FLC are skipped.',
      },
      {
        title: 'Brace Orientation',
        body: 'In Settings → Brace Dimensions, Height is the dimension in the tap direction (the brace standing upright on the bench). This is the t value in the stiffness formula. Length is along the grain.',
      },
      {
        title: 'Technique',
        body: 'Hold the brace at one point 22% from one end along the length, near one edge in the width direction (not on the width nodal line). Tap the top face at the center. The same one-point hold technique as Plate mode. Because braces are small and stiff, their tap resonance is much quieter than a plate or guitar body — the app uses an adaptive noise-floor threshold for brace tap detection and always picks the strongest peak.',
      },
      {
        title: 'Results',
        body: 'E_L, c_L, specific modulus, and a spruce quality rating are reported. No cross-grain or Gore thickness calculation is available in Brace mode.',
      },
    ],
  },
  {
    title: 'Controls Reference',
    icon: 'tap',
    rows: [
      {
        title: 'New Tap',
        icon: 'tap',
        body: 'Arms the detector for the next tap (or begins a plate measurement sequence). A green indicator shows when a tap has been registered.',
      },
      {
        title: 'Pause / Resume • Accept (plate/brace review)',
        icon: 'pause',
        body: 'Pause temporarily suspends tap detection while keeping the spectrum live — use it to let the ring-out decay between taps in a multi-tap sequence, or to reposition a plate or brace before continuing. Resume re-arms the detector. In plate and brace mode, after each phase is captured the spectrum freezes for review; while in a review state the button changes to Accept. Click Accept to confirm the captured spectrum and advance to the next phase (or complete the measurement if it was the last phase).',
      },
      {
        title: 'Cancel • Redo (plate/brace review)',
        icon: 'cancel',
        body: "Cancel aborts the current measurement sequence and discards all partial data. In plate and brace mode, while reviewing a captured phase the button changes to Redo. Click Redo to discard only the current phase's data and re-capture it — earlier phases are preserved. The detector re-arms immediately so you can tap again without clicking New Tap.",
      },
      {
        title: 'Crosshair',
        icon: 'crosshair',
        body: 'Move the pointer over the chart and a crosshair follows it, reading out the frequency and magnitude under the cursor. On a frozen spectrum it snaps to the nearest FFT bin; when comparing measurements or viewing material overlays it locks onto the nearest curve and takes that curve’s colour. With a mouse, trackpad, or pen the crosshair is always live and pressing-and-dragging pans. On a touchscreen, a Crosshair button appears on the toolbar (between Auto dB and Annotations) that switches a one-finger drag between moving the crosshair and panning.',
      },
      {
        title: 'Analysis Results',
        icon: 'waveform',
        body: 'The Analysis Results panel shows the peak list, decay time, plate properties, quality rating, and (for Plate mode) the Gore target thickness. It also contains Export Spectrum and Export PDF Report buttons. The panel is to the right of the chart on a wide window and below it on a narrow one.',
      },
      {
        title: 'Re-analyze',
        icon: 'refresh',
        body: 'Shown next to the microphone name when a saved measurement is loaded. Re-runs peak detection on the stored spectrum using the current analysis settings — useful for trying a different Peak Min, analysis range, or guitar type on a saved measurement without re-tapping. Enabled only while a loaded measurement is shown.',
      },
      {
        title: 'Auto dB',
        icon: 'autoDb',
        body: 'Scales the magnitude axis to fit the current signal. Click it after each measurement to keep peaks visible.',
      },
      {
        title: 'Annotations',
        icon: 'eye',
        body: 'Cycles through three label modes: All peaks annotated, Selected peaks only, or None.',
      },
      {
        title: 'Peak Labels',
        icon: 'tag',
        body: 'Drag any peak label to reposition it and avoid overlaps. To reset an individual label: right-click it and choose "Reset Position". To reset all labels at once: right-click the chart area (not a label) and choose "Reset Labels".',
      },
      {
        title: 'Play File',
        icon: 'filePlay',
        body: "Click the Play File button in the toolbar to feed a WAV or audio file through the FFT pipeline instead of the microphone. The file's tap is analysed exactly as a live microphone tap — tap detection fires automatically, peaks are found, and results appear in the panel. The chart title shows the filename while the file plays. After playback the microphone restarts automatically.",
      },
      {
        title: 'Save',
        icon: 'save',
        body: 'Saves the current measurement — enabled only when the spectrum is frozen and peaks have been detected. Enter a measurement name and optional notes.',
      },
      {
        title: 'Measurements',
        icon: 'clipboard',
        body: "Lists all saved measurements. Double-click a row to load the measurement into the main view — the measurements window closes automatically after loading. Click a row's ⋯ button or right-click it to access: Load into View, View Details, Edit Name & Notes, Export Measurement (saves the .guitartap file), Export Spectrum (saves the chart image), Export PDF Report, or Delete. Use Import Measurement to load a .guitartap file from disk or another device. Use Export All to save your whole library to a single .guitartap file — for backing it up or moving the complete set of measurements to another platform or another browser. This backup matters on the web because the browser can clear the library (on iOS, roughly 7 days after last use); installing the app (Add to Home Screen / Add to Dock) makes storage durable, and an Export All file is the portable backup. Re-import it with Import Measurement. Use Compare to enter multi-select mode and overlay 2–5 saved guitar measurements on the main chart for side-by-side comparison. The measurement name and notes can also be edited from the Edit button in the Measurement Details dialog.",
      },
      {
        title: 'Compare Measurements',
        icon: 'layers',
        body: 'In the Measurements list, click Compare to enter selection mode. Select 2–5 saved guitar measurements (plate and brace measurements cannot be compared). Click Compare Selected to overlay all selected spectra on the main chart as colour-coded curves with a legend. The chart, cursor, zoom, and pan all work normally. Press New Tap to exit comparison and return to single-measurement mode. While comparing: Annotations is disabled; Threshold and Peak Min sliders are disabled. Export Spectrum produces an overlay image with all curves, their colours, and a legend. Export PDF Report generates a comparison report showing the spectrum image and an Air / Top / Back peak frequency table for each spectrum. Save stores the entire comparison as a single record in the Measurements list — it can be reloaded later to restore the overlay view exactly as it was, and can itself be exported as a PDF or spectrum image from the list.',
      },
      {
        title: 'Metrics',
        icon: 'barChart',
        body: 'Shows FFT engine statistics: frame rate, bin width (Hz/bin), sample rate, and buffer size.',
      },
      {
        title: 'Toolbar',
        icon: 'sliders',
        body: 'All commands live on the two toolbars at the top of the window — the web app has no menu bar and no keyboard shortcuts. The upper (app) toolbar has Play File, Auto dB, Annotations, Save, Measurements, Metrics, Settings, and Help (Quick Start Guide / User Manual); on a touchscreen a Crosshair toggle also appears between Auto dB and Annotations. The lower (tap-control) toolbar has the Taps stepper, the Threshold and Peak Min sliders, and the New Tap, Pause/Resume, and Cancel buttons. Save and Export actions are disabled until a measurement is complete.',
      },
      {
        title: 'User Manual (online)',
        icon: 'book',
        body: 'For a complete reference — every measurement mode walked through in detail, full settings and controls reference, troubleshooting, glossary, and file-format specs — see the User Manual, hosted at dolcesfogato.com. Open it from Help → User Manual in the toolbar, or from Settings → About & Help. It opens in a new browser tab.',
      },
      {
        title: 'Chart Options (⋯)',
        icon: 'ellipsis',
        body: 'The ellipsis (⋯) button in the top-right corner of the spectrum opens the Chart Options menu. From here you can reset either or both axes to the values you last saved in Settings ("Reset to Saved"), or restore the factory defaults ("Reset to Defaults"). If peak labels have been dragged from their auto-positions, "Reset Labels" moves them back. Right-clicking the chart opens the same menu.',
      },
      {
        title: 'Zoom & Pan',
        icon: 'search',
        body: 'Scroll over the chart to zoom — the axis depends on where the pointer is: over the plot area it zooms both axes; over the frequency axis (bottom) it zooms frequency only; over the magnitude axis (left) it zooms magnitude only. Drag to pan the same way. Modifier keys: Shift+Scroll — pan frequency; Alt+Scroll — pan magnitude; Cmd/Ctrl+Scroll — zoom both axes. To reset the axes, click the ⋯ Chart Options button (top-right) or right-click anywhere inside the chart.',
      },
    ],
  },
  {
    title: 'Tap Controls',
    icon: 'sliders',
    rows: [
      {
        title: 'Taps (stepper)',
        icon: 'tap',
        body: 'How many taps to average together (1–10). Averaging reduces noise from tap-position variability and ambient sound. Values of 3–5 are a good starting point for material work.',
      },
      {
        title: 'Threshold (slider)',
        icon: 'gauge',
        body: 'The signal level that triggers tap detection. If taps are being missed, move the slider left (lower). If ambient noise triggers false detections, move it right (higher). Displayed in dB. In Plate and Brace mode the threshold is relative — it sets the headroom above an adaptive noise floor estimate, so the trigger adapts to the ambient noise level.',
      },
      {
        title: 'Peak Min (slider)',
        icon: 'sliders',
        body: 'Minimum magnitude a spectral peak must reach to be annotated on the spectrum chart. In guitar mode, a peak must also clear this threshold to be reported; adjusting it on a frozen spectrum re-runs peak finding and updates auto-selections (or carries forward manual selections if you have changed them). In brace/plate mode, the tap capture uses its own adaptive noise floor — Peak Min only affects what is visible on the chart, not which peaks are selected. Move the slider left to show quieter peaks; right to suppress noise. Displayed in dB.',
      },
      {
        title: 'Reset arrows',
        icon: 'undo',
        body: 'Each slider has a small reset button that resets it to the factory default value.',
      },
    ],
  },
  {
    title: 'Settings Reference',
    icon: 'gear',
    rows: [
      {
        title: 'Audio Input & Calibration',
        body: 'Shown at the top of Settings. Select your microphone or audio interface here. Import a frequency-response calibration file (.txt/.cal) to compensate for microphone coloration; calibrations are automatically associated with each device. Audio input and calibration changes take effect immediately and are not affected by Cancel.',
      },
      {
        title: 'Measurement Type',
        body: 'Shown below Audio Input. Choose Generic Guitar (the default), Classical Guitar, Flamenco, Acoustic/Steel String, Material (Plate), or Material (Brace). Determines which mode frequency windows are applied and which calculations appear in Results.',
      },
      {
        title: 'Advanced (collapsed section)',
        body: 'Click the Advanced row to expand Display Settings, Analysis Settings, and FFT Processing. These options rarely need changing after initial setup.',
      },
      {
        title: 'Show Unknown Modes',
        body: 'Guitar mode only — found in Advanced → Analysis Settings. When off, peaks outside the known mode frequency windows are hidden, reducing clutter.',
      },
      {
        title: 'Display Frequency Range',
        body: 'Advanced → Display Settings. Sets the horizontal zoom of the spectrum chart. Narrow the range to zoom in on a region of interest. Use Save Current View to persist the current pan/zoom as the default.',
      },
      {
        title: 'Display Magnitude Range',
        body: 'Advanced → Display Settings. Sets the vertical scale (dB). Use Auto dB in the main view for a quick fit, or set explicit Min/Max here.',
      },
      {
        title: 'Analysis Frequency Range',
        body: 'Advanced → Analysis Settings. Peaks outside this window are ignored during detection. Narrow it to exclude spurious low-frequency rumble or high-frequency noise.',
      },
      {
        title: 'Peak Min',
        body: 'Advanced → Analysis Settings. Sets the minimum magnitude (dB) for a peak to be annotated on the spectrum chart. In guitar mode this also gates which peaks are reported; adjusting it on a frozen spectrum re-runs peak finding and updates selections. In brace/plate mode it only affects what is annotated on the live chart. Typical useful range: −60 to −40 dB.',
      },
    ],
  },
  {
    title: 'Tips & Technique',
    icon: 'lightbulb',
    rows: [
      {
        title: 'Tap Technique',
        body: 'Use a short, crisp knuckle, fingertip tap, or a bouncy ball on a stick. A slow, pressing contact excites fewer overtones and produces a cleaner fundamental. Avoid tapping near the edges — aim for the centre of the plate or brace in Plate and Brace modes and near the bridge area for guitar-body mode surveys.',
      },
      {
        title: 'Consistent Mic Position',
        body: 'Keep the microphone at the same distance and angle between measurements for the most comparable magnitude values. Frequency readings are position-independent, but relative magnitudes are not.',
      },
      {
        title: 'Damping Check with Decay Time',
        body: 'The decay time (ring-out) appears in Results. A longer decay on the top plate typically correlates with lower internal damping — desirable in a soundboard. Compare braced vs. unbraced sections this way.',
      },
      {
        title: 'Air Mode for Setup',
        body: 'The Helmholtz air resonance is easily produced by holding the assembled body near the microphone and clapping your palm over the sound hole. It does not require tapping the wood itself.',
      },
      {
        title: 'Comparing Guitar Measurements',
        body: 'Save a measurement for each build stage or measurement name with a descriptive label. Use the Measurements list Compare button to overlay 2–5 saved guitar measurements as colour-coded spectra on the main chart — ideal for tracking how bracing or finishing changes the resonant modes over time.',
      },
      {
        title: 'PDF Reports',
        body: 'Each saved measurement can generate a PDF report containing the spectrum chart, peak table, and analysis summary. Open Measurements, select a measurement, then use the PDF export button. Saved comparison records generate a comparison PDF showing the overlay spectrum and an Air / Top / Back frequency table for each spectrum. A comparison PDF can also be exported directly from the main view while a live comparison is active, using Export PDF Report in the Analysis Results panel.',
      },
    ],
  },
  {
    title: 'Glossary',
    icon: 'bookOpen',
    rows: [
      {
        title: 'Air (Helmholtz) mode',
        body: 'The resonance of the air mass in the sound hole, analogous to blowing across a bottle. Typically 80–110 Hz for classical guitar.',
      },
      {
        title: 'Top / Back mode',
        body: 'The fundamental bending resonance of the top or back plate. The relationship between these and the Air mode strongly influences the low-frequency response of the instrument.',
      },
      {
        title: 'Q Factor',
        body: 'Sharpness of a resonance peak. Q = frequency ÷ −3 dB bandwidth. A higher Q means lower internal damping and a longer, purer ring-out.',
      },
      {
        title: 'Specific Modulus (E/ρ)',
        body: "Young's modulus divided by density. The single best predictor of tonewood quality because it determines how fast sound travels through the wood relative to its weight. Higher is better for soundboards.",
      },
      {
        title: "Young's Modulus (E)",
        body: 'A measure of how stiff the wood is along a given direction. E_L is along the grain; E_C is across. Reported in GPa.',
      },
      {
        title: 'Speed of Sound (c)',
        body: 'How fast longitudinal sound waves travel through the wood: c = √(E/ρ). Sitka spruce averages approximately 5500 m/s along the grain.',
      },
      {
        title: 'Radiation Ratio (R)',
        body: 'Sound radiation efficiency: R = c/ρ. A higher value means the plate radiates sound more efficiently for its weight.',
      },
      {
        title: 'Cross/Long Ratio',
        body: 'E_C ÷ E_L. A measure of wood anisotropy. For spruce guitar tops this typically falls between 0.04 and 0.08; lower values indicate stronger grain structure.',
      },
      {
        title: 'Tap Tone Ratio',
        body: 'Top mode frequency ÷ Air mode frequency. A rough structural quality indicator for assembled guitars; values between 1.8 and 2.4 are typical for well-made instruments.',
      },
      {
        title: 'Gore Target Thickness',
        body: 'A plate thickness prediction based on Gore Equation 4.5-7, derived from E_L, E_C, shear modulus G_LC, the wood density, and the guitar body dimensions. It targets a specified vibrational stiffness (f_vs) preset.',
      },
      {
        title: 'FLC Tap',
        body: 'A diagonal-mode tap that excites the torsional resonance of the plate. Used to calculate the shear modulus G_LC for the Gore thickness formula. Hold the plate at the midpoint of one long edge and tap near the opposite corner (~22% from both the end and the side).',
      },
      {
        title: 'Free-Free Beam',
        body: 'The boundary condition assumed by the tap-tone formula. The plate ends are unsupported (free), which is approximated by holding the sample at one nodal point (22% from one end along the dimension being measured). The formula constant 22.37 comes from the first mode shape of a free-free Euler–Bernoulli beam.',
      },
      {
        title: 'FFT (Fast Fourier Transform)',
        body: 'The algorithm that converts a time-domain audio signal into a frequency-domain spectrum. Guitar Tap uses a 65,536-point windowed FFT (Hann window) giving a frequency resolution of approximately 0.67 Hz per bin at a 44.1 kHz sample rate.',
      },
    ],
  },
]

export function QuickStartGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-overlay" role="dialog" aria-label="Quick Start Guide" onClick={onClose}>
      <div className="settings-modal qs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-head">
          <h2>Quick Start Guide</h2>
          <div className="set-head-buttons">
            <button className="btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
        <div className="qs-scroll">
          {QUICK_START_SECTIONS.map((s) => {
            const SecIcon = s.icon ? ICONS[s.icon] : null
            return (
              <section key={s.title} className="qs-section">
                <h3 className="qs-h">
                  {SecIcon && (
                    <span className="qs-h-icon">
                      <SecIcon />
                    </span>
                  )}
                  {s.title}
                </h3>
                {s.intro && <p className="qs-intro">{s.intro}</p>}
                {s.rows.map((r, i) => {
                  const RowIcon = r.icon ? ICONS[r.icon] : null
                  return (
                    <div key={i} className={`qs-row${RowIcon ? ' has-icon' : ''}`}>
                      {RowIcon && (
                        <span className="qs-row-icon">
                          <RowIcon />
                        </span>
                      )}
                      <div className="qs-row-main">
                        {r.title && <div className="qs-row-title">{r.title}</div>}
                        <div className="qs-row-body">{r.body}</div>
                      </div>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}