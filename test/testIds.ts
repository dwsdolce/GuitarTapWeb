// @parity none — a test helper of the web's: readable fixed UUIDs for test data
//
import type { Uuid } from '../src/measurement/newId'

// A fixed, readable UUID for test data: testId(1) is 00000000-0000-0000-0000-000000000001. Every id is a
// UUID — the file reader refuses any other — so a test's made-up ids are written in this form.
export const testId = (n: number): Uuid =>
  `00000000-0000-0000-0000-${n.toString(16).toUpperCase().padStart(12, '0')}` as Uuid
