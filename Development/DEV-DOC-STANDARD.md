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
- **Never reference `Development/` planning docs from source** (INVENTORY.md, THEME-SPEC,
  PLAN.md, VIEWS_STRUCTURE.md, etc.). Those are transient and can be deleted/moved, leaving a
  dangling reference (and they break DocC/typedoc link resolution). If a fact matters to
  understand the code, **inline it**; otherwise drop the pointer. Shipped/published docs (the
  user manual, `Documentation/Manual/…`) and stable external URLs are fine.

## Doc-correctness gates (build the docs, don't just count them)
`doc_coverage.py` checks docs *exist*; it does **not** check they're *correct*. Building the docs
is the authoritative correctness check — run these and require a clean result:
- **Swift** — Xcode "Build Documentation" (DocC). Catches unresolved ``symbol`` links + missing/
  duplicate/stale `- Parameter`s. **Backtick rule:** ``double backticks`` only for a real,
  resolvable (non-`private`) Swift symbol; `single backticks` for `private` members, foreign
  (Python) names, and code expressions — else DocC emits a broken-link warning.
- **Web** — `npx typedoc` (config in `typedoc.json`, `emit: none`). Catches broken `{@link}`s.
  Genuinely-internal types go in `intentionallyNotExported`.
- **Python** — no doc build/linker; its cross-refs are human-verified prose.

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

## Doc-parity — the measurable "done" definition
The goal of this review is that **all three platforms carry the same level of detail**. That is
not "100% of symbols documented" (the Depth rule says skip trivial code) — it is **parity**:
the same *meaningful* symbols are documented to equivalent depth across the three files. A slug
is **doc-parity ✓** only when all of the following hold:

1. **Public / exported API is documented on every platform.** Every exported symbol has a doc
   comment: Swift `///`, Python docstring, web **TSDoc `/** */`** (a plain `//` comment does
   **not** satisfy the web bar). "Exported" = a `struct`/`class`/`func`/`enum` or top-level
   `let`/`var` that is not `private` (Swift); a module-level `def`/`class` or public method
   (Python); an `export`ed symbol (web). The primary view component, its props/interfaces, and
   its exported constants **always** count as public.
2. **Private/internal helpers are at parity, not necessarily documented.** A `private` Swift
   subview (`headerRow`), a `_helper` (Python), or a non-exported function (web) may stay light
   — but if one platform documents its counterpart, the other two should too. Don't document a
   trivial helper on one platform while leaving the mirror bare.
3. **Conceptual content matches** (see "Shared vs. native") — same algorithm/why/formulas.
4. **No stale/inaccurate comments** remain (see "Accuracy").

### Mechanical gate: `Development/tools/doc_coverage.py`
Run it per slug and to back-audit finished slugs. It reports, per `@parity` slug, the
`documented / total` symbol coverage for each platform and flags cross-platform gaps.

    python3 Development/tools/doc_coverage.py            # all slugs
    python3 Development/tools/doc_coverage.py view/      # a prefix
    python3 Development/tools/doc_coverage.py --list-undoc   # dump every unddocumented name

**How to read it (it catches *missing*, not *depth*):**
- A **web `0/N`** row is the strongest real signal — exported symbols with no TSDoc (the
  WEB-MTC-1 pattern). Fix these to reach criterion 1.
- **Swift/Python percentages below 100% are often conventional, not gaps** — SwiftUI `body`
  and property-wrapped state are already excluded, but private view-helpers (`dataRow`) and Qt
  property accessors (`set_f_min`) still count and are usually fine to leave light *as long as
  the three are at parity* (criterion 2). Use the undoc list to judge, don't chase the number.
- The tool cannot judge prose depth or conceptual match — the human read still owns criteria
  3–4. The tool's job is to guarantee we never *silently* ship a slug with a whole platform
  undocumented.

A slug's doc-parity status is tracked in `REVIEW-TRACKER.md` (Doc-parity audit section).

## Per-group checklist (all three, every group)
Actually **read and verify comments in all three files** — not just the web, and not by
assuming the oracle implies the comments are fine (the oracle checks *values*, not prose):
1. **Swift** — confirm the `///` docs + comments match the code (canonical; fix if drifted).
2. **Python** — read the docstrings/comments; confirm accurate and consistent with Swift; fix drift.
3. **Web** — enrich to the fuller TSDoc standard; fix drift.

Mark a repo's tracker column ✓ **only when its comments have actually been read and verified**.
A group is done only when all three present columns are ✓. Pause between groups so the reviewer
can stop at a clean boundary.