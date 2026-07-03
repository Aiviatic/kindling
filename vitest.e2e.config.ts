import { defineConfig } from 'vitest/config';

// Opt-in integration suite: real network installs (e.g. `npx bmad-method@<pin> install`).
// Run explicitly via `npm run test:e2e`. NOT part of the default offline `npm test` / CI.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['engine/__integration__/**/*.e2e.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
