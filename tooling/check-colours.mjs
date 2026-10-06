#!/usr/bin/env node
// check-colours.mjs
//
// Refuses to run or build when a colour is written outside the palette. Mirrors the Swift
// edition's Tooling/check-colours.sh and the Python edition's src/guitar_tap/_colour_guard.py —
// same rule.
//
// The rule: every colour the app draws is a role in src/presentation/palette.ts, with its own
// light and dark value; CSS uses only the --c-… custom properties the palette sets. A hex or
// numeric rgb() literal, or a named colour, anywhere else in the .ts / .tsx sources or the
// stylesheets does not follow the Appearance setting and differs from the Swift and Python
// editions. Comment lines are skipped.
//
// Called by the predev / prebuild / prepreview npm scripts, beside check-release-ready.sh.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PALETTE = join('src', 'presentation', 'palette.ts')
const NAMED = 'red|green|blue|gray|grey|orange|yellow|purple|white|black|cyan|magenta|pink|brown'
const PATTERNS = {
  hex: /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{2})?)?\b/,
  rgb: /rgba?\(\s*\d/,
  named: new RegExp(`(?:\\bcolor|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|fillStyle|strokeStyle)\\s*[:=]\\s*['"]?(?:${NAMED})\\b`, 'i'),
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|css)$/.test(name) ? [path] : []
  })
}

const found = []
for (const path of sourceFiles(join(ROOT, 'src'))) {
  const rel = relative(ROOT, path)
  if (rel === PALETTE) continue
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    const text = line.trim()
    if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return
    for (const [kind, pattern] of Object.entries(PATTERNS)) {
      if (pattern.test(line)) found.push(`${rel}:${i + 1} [${kind}] ${text}`)
    }
  })
}

if (found.length) {
  console.error('BLOCKED — a colour is written outside the palette (src/presentation/palette.ts):')
  for (const line of found) console.error(`  ${line}`)
  process.exit(1)
}
