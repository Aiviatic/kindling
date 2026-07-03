// Registers @testing-library/jest-dom matchers (toBeInTheDocument, toHaveClass, …) on
// vitest's expect, and tears down the DOM between tests. Harmless for node-env tests
// (the matchers just extend the registry; cleanup() no-ops with nothing rendered).
// This file is also in tsconfig's program so the `vitest` Assertion augmentation is
// visible to ui/ component tests at typecheck time.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// We don't run with `globals: true`, so Testing Library's automatic afterEach cleanup
// isn't wired up — register it ourselves, or rendered trees accumulate across tests.
afterEach(() => {
  cleanup();
});
