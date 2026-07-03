import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment by default (engine/server/cli). UI component tests opt into
    // jsdom per-file via a `// @vitest-environment jsdom` comment (Epic 3).
    environment: 'node',
    // @testing-library/jest-dom matchers (toBeInTheDocument, etc.) for ui/ component tests.
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    // __integration__ holds opt-in, network/real-install tests — run via `npm run test:e2e`,
    // kept out of the fast/offline default suite (and CI).
    exclude: ['node_modules/**', 'dist/**', 'engine/__integration__/**'],
  },
});
