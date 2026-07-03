import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

// SSOT-guard selectors (architecture Implementation Patterns):
//  - Phase/StepId vocabulary (e.g. "provision.node") is defined only in engine/contract.ts.
//  - Hardcoded hex colors are banned in ui/ — colors come from ui/tokens.* (Epic 3).
// Each guard covers BOTH string Literals and TemplateElement chunks, so `provision.node`
// and `\`provision.node\`` (and `'#fff'` / `\`#fff\``) are caught.
// The hex pattern is anchored to a *whole* literal (`^#...$`) to avoid false positives on
// strings that merely contain a `#hhhh` substring (e.g. "issue #12345"); the design system
// uses CSS custom properties / tokens, so inline hex in TS/TSX should always be a whole value.
const PHASE_STEP_RE = '/^(provision|scaffold|install|finalize)\\.[a-z-]+$/';
const HEX_RE = '/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/';
const PHASE_STEP_MSG =
  'Phase/StepId string literals must be imported from engine/contract.ts (SSOT), not written raw.';
const HEX_MSG = 'No hardcoded hex colors in ui/ — use the design tokens in ui/tokens.* instead.';
const phaseStepGuards = [
  { selector: `Literal[value=${PHASE_STEP_RE}]`, message: PHASE_STEP_MSG },
  { selector: `TemplateElement[value.raw=${PHASE_STEP_RE}]`, message: PHASE_STEP_MSG },
];
const hexGuards = [
  { selector: `Literal[value=${HEX_RE}]`, message: HEX_MSG },
  { selector: `TemplateElement[value.raw=${HEX_RE}]`, message: HEX_MSG },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/.gitkeep',
      // Non-project directories (BMad runtime, planning artifacts, generated assets).
      '_bmad/**',
      '_bmad-output/**',
      '.claude/**',
      '.agents/**',
      'docs/**',
      'design-artifacts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Global SSOT guard: no raw phase/step string literals anywhere...
  {
    files: ['**/*.{ts,tsx,js}'],
    rules: {
      'no-restricted-syntax': ['error', ...phaseStepGuards],
      // Honor the leading-underscore "intentionally unused" convention (tsc already does).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ...except in the contract itself, which is the single source of truth.
  {
    files: ['engine/contract.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // UI: keep the phase/step guard AND ban hardcoded hex colors.
  // (ui/tokens.ts overrides this below — it's the SSOT that defines the hex values.)
  {
    files: ['ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-syntax': ['error', ...phaseStepGuards, ...hexGuards],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ui/tokens.ts is the design-system SSOT: it legitimately *holds* the hex literals the
  // no-hardcoded-hex guard bans elsewhere in ui/. Keep the phase/step guard, drop the hex one.
  {
    files: ['ui/tokens.ts', 'ui/tokens.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...phaseStepGuards] },
  },

  // Node side globals.
  {
    files: ['engine/**', 'server/**', 'cli/**', 'bin/**', 'functions/**', 'bootstrap/**', 'scripts/**', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
