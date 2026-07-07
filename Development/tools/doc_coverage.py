#!/usr/bin/env python3
"""
doc_coverage.py — cross-platform documentation-coverage triage for the comment/doc review.

Purpose
-------
Answer, mechanically, "do the three platforms document the same symbols?" for each
`@parity` slug. It does NOT judge doc *depth* (prose quality) — a human read still owns
that — but it reliably catches the *missing-entirely* class of drift (e.g. WEB-MTC-1,
where the web component + its exports carried no TSDoc while Swift/Python were fully
documented). Run it after finishing a slug, and across finished slugs to back-audit.

What it counts
--------------
Per file it finds declared symbols and whether each carries a doc comment:
  - Swift:  func / init / var / let / struct / class / enum / protocol / subscript
            at type-or-top level (indent <= 4); documented = a `///` line above it.
  - Python: def / class (any level); documented = a docstring as the first body stmt.
  - TS/TSX: top-level export/const/function/interface/type/class; documented = a
            `/** ... */` TSDoc block above it (a plain `//` comment counts as
            "comment-only", NOT documented — the standard requires TSDoc).

Grouping
--------
Files are grouped by their FIRST `@parity <slug>` tag. Files hosting multiple slugs are
attributed to the first (symbol-level attribution is a known limitation — see the M3 note
in the review memory); such files are marked `[multi]`.

Output
------
A per-slug table (swift | python | web coverage) with a GAP flag when a platform lags,
followed by the undocumented symbol names for every flagged slug.

Usage
-----
    python3 Development/tools/doc_coverage.py                # all tagged files
    python3 Development/tools/doc_coverage.py view/          # slugs with this prefix
    python3 Development/tools/doc_coverage.py --list-undoc   # dump undoc names for ALL slugs
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Repo roots (absolute — this review spans three sibling repos).
SWIFT_ROOT = Path("/Users/dws/src/GuitarTap")
PYTHON_ROOT = Path("/Users/dws/src/guitar_tap")
WEB_ROOT = Path("/Users/dws/src/GuitarTapWeb/src")

PARITY_RE = re.compile(r"@parity\s+([a-z0-9][a-z0-9/_-]*)")


@dataclass
class FileReport:
    lang: str
    path: Path
    slug: str
    multi: bool
    # Coverage is measured on the PUBLIC/EXPORTED surface (criterion 1). Internal helpers
    # (Swift private, Python _name, TS non-export) are counted separately and are parity-OK
    # to leave light (criterion 2), so they don't drive the gate.
    total: int = 0          # public/exported symbols
    documented: int = 0     # of those, with a doc comment
    internal_undoc: list[str] = field(default_factory=list)  # informational only
    undoc: list[str] = field(default_factory=list)           # public + undocumented (the gate)

    @property
    def pct(self) -> float:
        return 100.0 * self.documented / self.total if self.total else 100.0


# --------------------------------------------------------------------------- #
# Language analyzers
# --------------------------------------------------------------------------- #

SWIFT_DECL = re.compile(
    r"^(?P<indent>\s*)"
    r"(?:@[\w()]+\s+)*"
    r"(?:(?:public|internal|private|fileprivate|open|final|static|class|mutating|"
    r"override|convenience|required|lazy|weak|unowned|dynamic)\s+)*"
    r"(?P<kind>func|init|var|let|struct|class|enum|protocol|subscript)\b"
    r"(?:\s+(?P<name>\w+))?"
)


# Property wrappers = UI-state plumbing, conventionally undocumented (excluded from the
# denominator so they don't cry wolf). Plain `let`/`var` inputs still count.
SWIFT_WRAPPERS = (
    "@State", "@StateObject", "@ObservedObject", "@EnvironmentObject", "@Environment",
    "@Binding", "@FocusState", "@AppStorage", "@SceneStorage", "@Published",
    "@GestureState", "@Namespace", "@FetchRequest", "@ScaledMetric",
)


def _is_private_swift(line: str) -> bool:
    # `private(set)` is publicly readable → treat as public for doc purposes.
    return bool(re.search(r"\b(private|fileprivate)\b(?!\(set\))", line))


def analyze_swift(text: str):
    lines = text.splitlines()
    total = documented = 0
    undoc: list[str] = []
    internal: list[str] = []
    # Many view files carry a `/// # Type` banner at the very top, detached from the
    # `struct`/`class` by the file-header `//` + `import`. DocC treats it as the type's
    # doc; credit the file's first top-level type for it.
    top_banner = any(l.strip().startswith("///") for l in lines[:20])
    first_type_credited = False
    # Track members of a `private`/`fileprivate` type via brace depth — their members
    # are internal even though the member line itself has no access keyword.
    brace = 0
    private_open = None  # brace level at which the nearest private type opened
    priv_re = re.compile(
        r"^\s*(?:@[\w()]+\s+)*(?:(?:public|internal|open|final|static)\s+)*"
        r"(?:private|fileprivate)\s+(?:final\s+)?(?:struct|class|enum|actor)\b"
    )
    for i, line in enumerate(lines):
        if private_open is None and priv_re.match(line):
            private_open = brace
        in_private = private_open is not None
        # Update running brace depth AFTER checking this line's role.
        brace += line.count("{") - line.count("}")
        if private_open is not None and brace <= private_open:
            private_open = None

        m = SWIFT_DECL.match(line)
        if not m:
            continue
        if len(m.group("indent")) > 4:  # skip locals inside function bodies
            continue
        name = m.group("name") or f"{m.group('kind')}@{i+1}"
        if name == "body" and m.group("kind") == "var":
            continue
        prev = lines[i - 1].strip() if i > 0 else ""
        if any(w in line for w in SWIFT_WRAPPERS) or any(prev.startswith(w) for w in SWIFT_WRAPPERS):
            continue
        # Documented if a /// line sits above (past attribute + #if/#else/#endif lines).
        j = i - 1
        while j >= 0:
            s = lines[j].strip()
            if s.startswith("@") or s.startswith("#if") or s.startswith("#else") or s.startswith("#endif"):
                j -= 1
                continue
            if s == "":
                if j < i - 1:
                    break
                j -= 1
                continue
            break
        has_doc = j >= 0 and lines[j].strip().startswith("///")
        # Credit the first top-level type against a file-top banner.
        if not has_doc and top_banner and not first_type_credited \
                and len(m.group("indent")) == 0 \
                and m.group("kind") in ("struct", "class", "enum", "protocol"):
            has_doc = True
            first_type_credited = True
        if _is_private_swift(line) or in_private:  # internal — informational only
            if not has_doc:
                internal.append(name)
            continue
        total += 1
        if has_doc:
            documented += 1
        else:
            undoc.append(name)
    return total, documented, undoc, internal


PY_DEF = re.compile(r"^(?P<indent>\s*)(?:async\s+)?(?P<kind>def|class)\s+(?P<name>\w+)")


def analyze_python(text: str):
    lines = text.splitlines()
    total = documented = 0
    undoc: list[str] = []
    internal: list[str] = []
    priv_class_indent = None  # indent of the nearest enclosing `class _Private:`
    for i, line in enumerate(lines):
        m = PY_DEF.match(line)
        if not m:
            continue
        indent = len(m.group("indent"))
        name = m.group("name")
        # Track private (underscore) class scope: its members are internal.
        if priv_class_indent is not None and indent <= priv_class_indent:
            priv_class_indent = None
        if m.group("kind") == "class" and name.startswith("_"):
            priv_class_indent = indent
        in_priv_class = priv_class_indent is not None and indent > priv_class_indent
        if name.startswith("__") and name.endswith("__"):  # dunders: trivial/conventional
            continue
        # Property setters/deleters conventionally share the getter's docstring — skip.
        prev = lines[i - 1].strip() if i > 0 else ""
        if re.match(r"@\w+\.(setter|deleter)\b", prev):
            continue
        # Skip a possibly multi-line signature: advance until parens/brackets close
        # AND the line ends with `:`. Then the docstring is the first body line.
        depth = 0
        sig_end = i
        for k in range(i, min(i + 60, len(lines))):
            code = lines[k].split("#", 1)[0]  # ignore trailing comments (brackets, colon)
            depth += code.count("(") + code.count("[") - code.count(")") - code.count("]")
            if depth <= 0 and code.rstrip().endswith(":"):
                sig_end = k
                break
        body = None
        for k in range(sig_end + 1, min(sig_end + 20, len(lines))):
            if lines[k].strip() == "":
                continue
            body = lines[k].strip()
            break
        has_doc = bool(body and re.match(r'^[rRbBuU]{0,2}("""|\'\'\'|"|\')', body))
        if name.startswith("_") or in_priv_class:  # internal helper — informational only
            if not has_doc:
                internal.append(name)
            continue
        total += 1
        if has_doc:
            documented += 1
        else:
            undoc.append(name)
    return total, documented, undoc, internal


TS_DECL = re.compile(
    r"^(?P<indent>\s*)"
    r"(?:export\s+)?(?:default\s+)?(?:abstract\s+)?"
    r"(?P<kind>function|const|let|var|interface|type|class|enum)\s+"
    r"(?P<name>\w+)"
)


def analyze_ts(text: str):
    lines = text.splitlines()
    total = documented = 0
    undoc: list[str] = []
    internal: list[str] = []
    for i, line in enumerate(lines):
        m = TS_DECL.match(line)
        if not m:
            continue
        if len(m.group("indent")) > 0:  # top-level only (component/module exports)
            continue
        name = m.group("name")
        exported = line.lstrip().startswith("export")
        # Walk upward skipping // line comments (incl. @parity) and blanks.
        j = i - 1
        has_tsdoc = False
        has_line_comment = False
        while j >= 0:
            s = lines[j].strip()
            if s == "":
                j -= 1
                continue
            if s.startswith("//"):
                has_line_comment = True
                j -= 1
                continue
            if s.endswith("*/"):
                has_tsdoc = True
            break
        if not exported:  # module-internal const/fn — informational only
            if not has_tsdoc:
                internal.append(name + (" (//-only)" if has_line_comment else ""))
            continue
        total += 1
        if has_tsdoc:
            documented += 1
        else:
            undoc.append(name + (" (//-only)" if has_line_comment else ""))
    return total, documented, undoc, internal


# --------------------------------------------------------------------------- #
# File discovery
# --------------------------------------------------------------------------- #

def first_slug(text: str) -> tuple[str | None, bool]:
    slugs = PARITY_RE.findall(text)
    if not slugs:
        return None, False
    return slugs[0], len(set(slugs)) > 1


def scan(root: Path, glob: str, lang: str) -> list[FileReport]:
    reports: list[FileReport] = []
    skip_parts = {"node_modules", ".git", "dist", "build", ".venv", "venv"}
    for path in root.rglob(glob):
        if any(p in skip_parts for p in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        slug, multi = first_slug(text)
        if slug is None:
            continue
        rep = FileReport(lang=lang, path=path, slug=slug, multi=multi)
        if lang == "swift":
            rep.total, rep.documented, rep.undoc, rep.internal_undoc = analyze_swift(text)
        elif lang == "python":
            rep.total, rep.documented, rep.undoc, rep.internal_undoc = analyze_python(text)
        else:
            rep.total, rep.documented, rep.undoc, rep.internal_undoc = analyze_ts(text)
        reports.append(rep)
    return reports


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #

def cell(reps: list[FileReport]) -> str:
    if not reps:
        return "        —        "
    total = sum(r.total for r in reps)
    doc = sum(r.documented for r in reps)
    pct = 100.0 * doc / total if total else 100.0
    tag = "*" if any(r.multi for r in reps) else " "
    return f"{doc:>3}/{total:<3} ({pct:3.0f}%){tag}   "


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    prefix = args[0] if args else ""
    list_all = "--list-undoc" in flags

    all_reports = (
        scan(SWIFT_ROOT, "*.swift", "swift")
        + scan(PYTHON_ROOT, "*.py", "python")
        + scan(WEB_ROOT, "*.ts", "web")
        + scan(WEB_ROOT, "*.tsx", "web")
    )

    slugs: dict[str, dict[str, list[FileReport]]] = {}
    for r in all_reports:
        if not r.slug.startswith(prefix):
            continue
        slugs.setdefault(r.slug, {"swift": [], "python": [], "web": []})[r.lang].append(r)

    print(f"\nDoc-coverage triage  ({prefix or 'all slugs'})")
    print("  documented / total of the PUBLIC/EXPORTED surface (criterion 1; TS=% with TSDoc).")
    print("  Internal helpers (Swift private / Python _name / TS non-export) are excluded from")
    print("  the gate — see --list-undoc for them. * = a file hosts >1 slug.\n")
    print(f"  {'SLUG':<28} {'SWIFT':<17}{'PYTHON':<17}{'WEB':<17} GAP")
    print("  " + "-" * 80)

    flagged: list[str] = []
    for slug in sorted(slugs):
        by = slugs[slug]
        pcts = []
        for lang in ("swift", "python", "web"):
            reps = by[lang]
            if reps and sum(r.total for r in reps):
                pcts.append(100.0 * sum(r.documented for r in reps) / sum(r.total for r in reps))
        gap = ""
        if pcts:
            lo, hi = min(pcts), max(pcts)
            if lo < 90 or (hi - lo) >= 20:
                gap = "◄ GAP"
                flagged.append(slug)
        row = (f"  {slug:<28} "
               f"{cell(by['swift'])}{cell(by['python'])}{cell(by['web'])} {gap}")
        print(row)

    # Undocumented-symbol detail for flagged slugs (or all, with --list-undoc).
    detail_slugs = sorted(slugs) if list_all else flagged
    if detail_slugs:
        print("\n  Undocumented symbols" + (" (all)" if list_all else " (flagged slugs)") + ":")
        for slug in detail_slugs:
            by = slugs[slug]
            for lang in ("swift", "python", "web"):
                for r in by[lang]:
                    if r.undoc:
                        rel = r.path.name
                        print(f"    [{lang:<6}] {slug} · {rel}: {', '.join(r.undoc)}")

    print(f"\n  {len(slugs)} slug(s); {len(flagged)} flagged.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())