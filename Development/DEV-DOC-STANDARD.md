# Developer-Doc & Comment Standard

Conventions for the cross-repo comment/doc review:
- **Task 1** — comment accuracy, consistency, and cross-reference; migrate the
  canonical explanatory comments from Swift to Python/web.
- **Task 2** — developer API docs (not the user help/manual, which is handled
  separately).

Driven by the `@parity` groups. Progress is tracked in `REVIEW-TRACKER.md`.

## Canonical source
Swift **GuitarTap** is canonical. Its `///` DocC comments are the reference for doc
*content*. Verify Swift is accurate first, then bring Python and web into line.

## Per-language doc format (generator-friendly)
- **Swift** — `///` DocC: type/file `# Title` + `## Algorithm Overview`, and
  `- Parameter` / `- Returns`. Already established; the job is to verify accuracy.
- **Python** — module + class + method **docstrings** mirroring the Swift doc text,
  using `- Parameter:` / `- Returns:` lines and a closing `Mirrors Swift <Symbol>.`
- **Web (TS)** — **TSDoc** `/** */`: a **class/module-level block** carrying the
  shared conceptual content (Algorithm Overview + formulas), plus `@param` /
  `@returns` on each method. **Fuller detail** — see the reference file
  `src/dsp/pitch.ts`.

## Shared vs. native
The conceptual content — what it does, why, the algorithm, the formulas — reads the
**same across all three** (translated idiomatically). Only types and language idiom
are native. Numbers and formulas must match the code and the oracle.

## Cross-references
- Keep each file's `@parity <slug>` tag (the machine cross-reference).
- Doc/comment prose names the counterpart: "mirrors Swift `<Symbol>`".
- Fix stale references (e.g. a moved doc path such as `INVENTORY.md` →
  `Development/INVENTORY.md`).

## Depth
Scale with the code: rich for algorithmic/DSP core (overview + formulas + params);
light for thin, obvious code — don't bloat trivial getters or one-line wrappers.

## Platform differences are allowed
A platform may omit methods it doesn't use (e.g. web `pitch.ts` has no
`pitchRange` / `formattedNote` / `isInTune`). That's not a gap — don't add unused code.

## Accuracy
Comments must match the current code; fix drift as found. If something looks like a
real **behavioural** discrepancy (not just a stale comment), flag it for separate
review rather than silently "fixing" a comment to match possibly-wrong code.

## Granularity note
`@parity` tags are **file-level**, but comments live at the **symbol** level. Use the
map only to pair files; review per-symbol within. A file hosting several slugs (e.g.
`TapToneAnalyzer+SpectrumCapture.swift`) is reviewed once, covering each slug's symbols.

## Per-group checklist (all three, every group)
Actually **read and verify comments in all three files** — not just the web, and not by
assuming the oracle implies the comments are fine (the oracle checks *values*, not prose):
1. **Swift** — confirm the `///` docs + comments match the code (canonical; fix if drifted).
2. **Python** — read the docstrings/comments; confirm accurate and consistent with Swift; fix drift.
3. **Web** — enrich to the fuller TSDoc standard; fix drift.

Mark a repo's tracker column ✓ **only when its comments have actually been read and verified**.
A group is done only when all three present columns are ✓. Pause between groups so the reviewer
can stop at a clean boundary.