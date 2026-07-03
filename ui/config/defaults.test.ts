import { describe, it, expect } from 'vitest';
import { defaultConfig, DEFAULT_IDE, DEFAULT_MODULES } from './defaults';
import { pins } from '../../engine/pins';

describe('defaultConfig', () => {
  it('produces a smart-default Config so Start is reachable untouched (FR-14)', () => {
    const c = defaultConfig(pins);
    expect(c.ides).toEqual([DEFAULT_IDE]); // at least one tool → --tools non-empty
    expect(c.modules).toEqual(DEFAULT_MODULES); // bmm
    expect(c.projectDir).toBeTruthy();
    expect(c.projectName).toBeTruthy();
    expect(c.pins).toBe(pins); // SSOT pins, not copied/mutated
  });

  it('returns a fresh modules array (not shared) so edits do not mutate the default', () => {
    const a = defaultConfig(pins);
    a.modules.push('bmb');
    expect(defaultConfig(pins).modules).toEqual(DEFAULT_MODULES);
  });
});
