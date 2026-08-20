#!/bin/bash
# check-release-ready.sh
#
# Refuses to run or build against a stale release identity. Mirrors the Python
# edition's src/guitar_tap/_release_guard.py and the Swift edition's
# Tooling/check-release-ready.sh — same rule, same two conditions.
#
# The rule: **any development after a release must roll the version number AND
# roll the release notes.** Until both are done the tree claims to be a release
# that has already shipped. The browser edition is the least forgiving of the
# three: there is no install step, so whatever is deployed IS what every visitor
# gets, immediately — a stale version in the About line is live the moment you
# copy dist/ up.
#
#   1. STALE VERSION — package.json "version" names a release already TAGGED in
#      git and HEAD has moved past that tag.
#   2. UN-ROLLED RELEASE NOTES — src/components/ReleaseNotes.tsx still has the
#      shipped release at the top of RELEASES. Unlike Swift/Python there are no
#      {{placeholders}} to freeze: the newest entry carries `build: __APP_BUILD__`,
#      which auto-binds to whatever is being built. That is a convenience during a
#      cycle and a trap after one — left alone, the shipped release's notes simply
#      re-render under the new build number. Rolling over means pinning that entry
#      to the literal build it shipped as and adding a new top entry.
#
# Both are gated on HEAD having moved past the last release, so at the tag itself
# nothing fires — rebuilding or redeploying the release you just cut is legitimate.
# They fire together on the first commit after a release and go quiet once the
# version is bumped and the notes rolled: once per release cycle, not once per run.
#
# Reports BOTH conditions in one run so they can be fixed in one pass.
#
# Skips silently when it cannot evaluate (no git, no tags). There is deliberately
# NO override: an escape hatch is used once under time pressure and then deployed
# from.
#
# Called by the predev / prebuild / prepreview npm scripts, so `npm run dev`,
# `npm run build` and `npm run preview` all refuse. `npm test` is deliberately NOT
# guarded — the version means nothing to the tests.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NOTES_REL="src/components/ReleaseNotes.tsx"
NOTES="$ROOT/$NOTES_REL"
PKG="$ROOT/package.json"

# Not a git work tree — nothing to compare a version against. `git rev-parse`
# rather than a .git directory test, so a git worktree (where .git is a file) is
# still covered.
git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || exit 0

LATEST_TAG="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null)" || exit 0
[ -n "$LATEST_TAG" ] || exit 0

# Nothing developed since the last release: nothing to roll yet.
AHEAD="$(git -C "$ROOT" rev-list --count "${LATEST_TAG}..HEAD" 2>/dev/null || echo 0)"
[ "${AHEAD:-0}" -gt 0 ] || exit 0

FAILURES=""

#===============================================
# 1. Stale version number.
#===============================================
VERSION="$(grep -m1 '"version"' "$PKG" | sed -E 's/.*"version" *: *"([^"]+)".*/\1/')"
if [ -z "$VERSION" ]; then
    FAILURES="${FAILURES}
\"version\" could not be read from package.json.
"
elif git -C "$ROOT" rev-parse -q --verify "refs/tags/$VERSION" >/dev/null 2>&1; then
    VERSION_AHEAD="$(git -C "$ROOT" rev-list --count "${VERSION}..HEAD" 2>/dev/null || echo 0)"
    if [ "${VERSION_AHEAD:-0}" -gt 0 ]; then
        FAILURES="${FAILURES}
STALE VERSION NUMBER

  package.json says $VERSION, which is already released (git tag
  '$VERSION' exists), but HEAD is $VERSION_AHEAD commit(s) newer.

  vite.config.ts stamps that straight into __APP_VERSION__, so this build
  would label newer code as the released $VERSION in the About line and at
  the top of the in-app release notes.

  FIX: bump \"version\" in package.json to the next release number.
       Tag the new version only at release time.
"
    fi
fi

#===============================================
# 2. Release notes never rolled over.
#===============================================
if [ ! -f "$NOTES" ]; then
    FAILURES="${FAILURES}
RELEASE NOTES MISSING

  $NOTES_REL could not be read, so the roll-over after $LATEST_TAG
  cannot be verified.
"
else
    # The newest entry is the first "version: '...'" after the RELEASES array.
    TOP_VERSION="$(sed -n '/export const RELEASES/,$p' "$NOTES" \
        | grep -m1 -E "^[[:space:]]*version: '" \
        | sed -E "s/.*version: '([^']+)'.*/\1/")"
    # `build: __APP_BUILD__` auto-binds to the build being made, so it belongs to
    # the in-progress release and nowhere else. A second occurrence means a
    # shipped entry was never pinned to the build it actually went out as.
    # Anchored to a whole property line: the prose above that property contains
    # the same words, and matching a bare substring counted the comment as a
    # second entry.
    AUTOBIND_COUNT="$(grep -cE '^[[:space:]]*build: __APP_BUILD__,?[[:space:]]*$' "$NOTES" | tr -d ' ')"

    if [ "$TOP_VERSION" = "$LATEST_TAG" ]; then
        FAILURES="${FAILURES}
RELEASE NOTES NOT ROLLED OVER after $LATEST_TAG

  $NOTES_REL still has $LATEST_TAG as the newest entry in RELEASES, and that
  entry carries 'build: __APP_BUILD__' — which binds to whatever is being
  built. Deploying now re-renders $LATEST_TAG's already-shipped notes under a
  new build number, and there is nowhere to describe what has changed since.

  FIX:
    1. Pin the $LATEST_TAG entry to the build it shipped as — replace
       'build: __APP_BUILD__' with the literal, e.g. build: '$(git -C "$ROOT" rev-list --count "$LATEST_TAG" 2>/dev/null)'.
    2. Add a new entry above it for the release in progress, with
       build: __APP_BUILD__ and since: '$LATEST_TAG'.
"
    elif [ "${AUTOBIND_COUNT:-0}" -gt 1 ]; then
        FAILURES="${FAILURES}
RELEASE NOTES: MORE THAN ONE ENTRY AUTO-BINDS ITS BUILD NUMBER

  'build: __APP_BUILD__' appears $AUTOBIND_COUNT times in $NOTES_REL. It binds
  to the build being made, so only the newest (in-progress) entry may use it;
  a shipped entry that still carries it silently re-labels itself on every
  build.

  FIX: pin every entry except the newest to the literal build number it
       shipped as — 'git rev-list --count <tag>' gives that number.
"
    fi
fi

[ -z "$FAILURES" ] && exit 0

BAR="======================================================================"
{
    echo "$BAR"
    echo "BLOCKED — this tree is not ready for development after a release."
    echo "$FAILURES"
    echo "$BAR"
} >&2
exit 1
