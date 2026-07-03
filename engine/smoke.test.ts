import { describe, it, expect } from 'vitest';
import { pins, StepId } from './index';

// Trivial test so the toolchain (Vitest) runs green, plus a light barrel sanity check.
describe('scaffold smoke', () => {
  it('runs the test toolchain', () => {
    expect(1 + 1).toBe(2);
  });

  it('exposes the engine contract barrel', () => {
    expect(typeof pins.kindling).toBe('string');
    expect(Object.keys(StepId).length).toBeGreaterThan(0);
  });
});
