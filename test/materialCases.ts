// Reading a material case file (plate.json, brace.json): samples, and the shared tolerance.
import { readFileSync } from 'node:fs'
import { MaterialDimensions, type Dimensions } from '../src/dsp/material'

export type Row = Record<string, unknown>

export function load(name: string): Row {
  return JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')) as Row
}

export function dimensions(row: Row): MaterialDimensions {
  return new MaterialDimensions(row.sample as Dimensions)
}

/** `|actual − expected| ≤ relative·|expected| + absolute`, from the file's `tolerance`. */
export function close(actual: number, expected: number, data: Row): boolean {
  const tol = data.tolerance as { relative: number; absolute: number }
  return Math.abs(actual - expected) <= tol.relative * Math.abs(expected) + tol.absolute
}
