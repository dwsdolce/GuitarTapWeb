// Focused lint: React Hooks correctness only (dependency arrays + rules-of-hooks) plus a
// Vite fast-refresh sanity rule. tsc (`npm run typecheck` / `build`) already covers types,
// unused vars, etc., so we deliberately do NOT enable the broad typescript-eslint rule sets —
// this keeps the signal on the one thing tsc can't see: stale/missing hook dependencies.
// Run with `npm run lint`. Not wired into the build gate. Added 2026-07-11.
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'dev-dist/', 'coverage/', 'public/'] },
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Defined (not for style enforcement) so the one existing `as any` disable directive — the
      // browser goog-constraints escape hatch in realtimeFFTAnalyzer — resolves instead of erroring
      // as an unknown rule. There is exactly one `any` in src and it is disabled, so this adds no noise.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)