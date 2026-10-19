// @parity none — a Vitest reporter; Swift's and Python's runners list skipped tests themselves.
// Lists each skipped test and why at the end of the run, as the Swift and Python runs do: the summary
// alone gives only a count.
import path from 'node:path'
import type { Reporter, TestModule } from 'vitest/node'

export default class SkippedReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const lines: string[] = []
    for (const module of testModules) {
      for (const test of module.children.allTests('skipped')) {
        const result = test.result()
        const note = result.state === 'skipped' ? result.note : undefined
        lines.push(`  ${path.relative(process.cwd(), module.moduleId)} › ${test.fullName}${note ? ` — ${note}` : ''}`)
      }
    }
    if (lines.length === 0) return
    console.log(`Skipped (${lines.length}):\n${lines.join('\n')}`)
  }
}
