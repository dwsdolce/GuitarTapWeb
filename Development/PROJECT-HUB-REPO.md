# Project hub repo — one home for project docs + cross-repo bug tracking

**Status:** 📋 IDEA — captured 2026-07-16. No action yet; needs a spec. (STATUS.md item 6.)

## The idea

Create a **new GitHub repo whose sole purpose is project documents + cross-repo information**, and use
its **Issues as the single cross-repo bug tracker.**

## Two problems it solves

1. **The docs are split.** `Development/` (STATUS + every spec) lives in the **web** repo, while
   `PARITY-MAP.md` / `parity-index.json` / `TEST-COVERAGE.md` + the parity tooling live in canonical
   **GuitarTap**. Neither location is right — these describe **all three** editions.
2. **Bugs are cross-repo.** The audio watchdog (STATUS item 5) is one bug in three codebases; the
   buffer-size one (item 4) is a Swift defect currently tracked in the web repo.

**Enabler:** the Swift code is going open source → the public/private asymmetry disappears (GuitarTap
is private today, the other two public), so the hub can be public, cross-repo issue refs resolve for
everyone, and the community can see/file.

## Tracking rules already settled

- One bug = **one issue with platform labels** (`swift`/`python`/`web`/`all-three`) — never one issue
  per repo (three issues for one bug drift apart).
- Commits in any repo reference it cross-repo (`refs owner/repo#N`).
- A **`needs-verification`** label encodes the standing rule that nothing is done until the USER runs it.
- Meaty analyses stay as **detail docs in the repo**; the issue is the addressable index (today our
  commit messages are essays precisely because there is nothing to reference).

## Open questions for the spec

- Where the parity **tooling** lives (it scans all three repos).
- Whether generated artifacts (map / index / coverage) are committed there.
- Migration + whether doc history is preserved; relative links between docs (move them together).
- Whether per-repo Issues stay as community intake (`guitar_tap` already has a real 2024 public report)
  or redirect.
- Naming.

**Until it exists:** markdown STATUS continues; items 4 + 5 migrate to Issues once the hub is up.