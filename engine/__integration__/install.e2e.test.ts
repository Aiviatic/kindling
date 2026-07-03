import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../engine';
import { EngineEmitter } from '../emitter';
import { pins } from '../pins';

// OPT-IN integration test (network + real install). Run via `npm run test:e2e`.
// Excluded from the default offline suite (see vitest.config.ts). Validates the full
// cohort-critical engine path on the host OS: scaffold → real `npx bmad-method@<pin> install`
// → self-check → green Validation Summary. (Does NOT cover Windows/macOS provisioning shell.)
describe('engine install — real bmad-method (opt-in)', () => {
  it('scaffolds, installs the pinned BMad, and self-checks green', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kindling-e2e-'));
    const projectDir = join(root, 'demo-project');
    try {
      const emitter = new EngineEmitter();
      emitter.on((e) => console.log(`  [${e.status}] ${e.step} — ${e.humanMessage}`));

      const engine = new Engine(
        { projectDir, projectName: 'demo-project', ides: ['claude-code'], modules: ['bmm'], pins },
        emitter,
      );
      const result = await engine.start();

      expect(result.ok).toBe(true);
      expect(result.failedStep).toBeNull();
      expect(result.summary?.success).toBe(true);
      expect(result.summary?.bmad).toEqual({ pinnedVersion: pins.bmad, installed: true });
      expect(result.summary?.node.satisfiesFloor).toBe(true);

      const entries = await readdir(projectDir);
      expect(entries).toContain('.git');
      expect(entries).toContain('_bmad'); // a real BMad install landed
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
