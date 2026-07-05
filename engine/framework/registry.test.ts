import { describe, it, expect } from 'vitest';
import { getFramework, DEFAULT_FRAMEWORK } from './registry';

describe('framework registry', () => {
  it('resolves bmad and none by id', () => {
    expect(getFramework('bmad').id).toBe('bmad');
    expect(getFramework('none').id).toBe('none');
  });

  it('falls back to the default for an absent or unknown id', () => {
    expect(getFramework(undefined).id).toBe(DEFAULT_FRAMEWORK);
    expect(getFramework('nope').id).toBe(DEFAULT_FRAMEWORK);
  });
});
