import { describe, it, expect } from 'vitest';
import { pins } from './pins';

describe('pins manifest', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(pins)).toBe(true);
  });

  it('has a concrete BMad version pinned (no TODO placeholder)', () => {
    // Guards against shipping an unfrozen pin — runBmadInstall fails fast on a TODO pin.
    expect(pins.bmad).not.toMatch(/TODO/i);
    expect(pins.bmad).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('pins a Node version that meets the runtime floor', () => {
    expect(pins.node).toMatch(/^\d+\.\d+\.\d+/);
  });
});
