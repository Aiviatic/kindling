import { describe, it, expect } from 'vitest';
import { getMethod, DEFAULT_METHOD } from './registry';

describe('method registry', () => {
  it('resolves bmad and none by id', () => {
    expect(getMethod('bmad').id).toBe('bmad');
    expect(getMethod('none').id).toBe('none');
  });

  it('falls back to the default for an absent or unknown id', () => {
    expect(getMethod(undefined).id).toBe(DEFAULT_METHOD);
    expect(getMethod('nope').id).toBe(DEFAULT_METHOD);
  });
});
