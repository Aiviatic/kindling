import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandTilde } from './expand-tilde';

describe('expandTilde', () => {
  it('expands a bare ~ to the home directory', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  it('expands ~/… (posix) and ~\\… (windows) to under home', () => {
    expect(expandTilde('~/kindling-project')).toBe(join(homedir(), 'kindling-project'));
    expect(expandTilde('~\\kindling-project')).toBe(join(homedir(), 'kindling-project'));
  });

  it('leaves absolute and relative paths untouched', () => {
    expect(expandTilde('/tmp/x')).toBe('/tmp/x');
    expect(expandTilde('./x')).toBe('./x');
    expect(expandTilde('x')).toBe('x');
  });

  it('does NOT expand a ~ that is not a leading home reference (e.g. ~user or mid-path)', () => {
    expect(expandTilde('~user/x')).toBe('~user/x');
    expect(expandTilde('/a/~/b')).toBe('/a/~/b');
  });
});
