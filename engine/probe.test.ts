import { describe, it, expect, vi } from 'vitest';
import { probeVersion, probeCliVersion } from './probe';
import type { ExecResult } from './exec';

const ok = (out: string): ExecResult => ({ code: 0, stdout: out, stderr: '' });
const okStderr = (out: string): ExecResult => ({ code: 0, stdout: '', stderr: out });
const absent = (): ExecResult => ({ code: 1, stdout: '', stderr: 'not found' });

describe('probeVersion', () => {
  it('returns the trimmed version when `<cmd> --version` exits 0 with output', async () => {
    const exec = vi.fn(async () => ok('  v24.16.0\n'));
    expect(await probeVersion(exec, 'node')).toBe('v24.16.0');
    expect(exec).toHaveBeenCalledWith('node', ['--version']);
  });

  it('falls back to stderr when stdout is empty', async () => {
    const exec = vi.fn(async () => okStderr('git version 2.43.0'));
    expect(await probeVersion(exec, 'git')).toBe('git version 2.43.0');
  });

  it('returns null on non-zero exit', async () => {
    expect(await probeVersion(vi.fn(async () => absent()), 'node')).toBeNull();
  });

  it('returns null on exit 0 with empty output (no false present)', async () => {
    expect(await probeVersion(vi.fn(async () => ok('')), 'node')).toBeNull();
  });

  it('returns null when exec throws (unspawnable)', async () => {
    const exec = vi.fn(async () => {
      throw new Error('spawn ENOENT');
    });
    expect(await probeVersion(exec, 'node')).toBeNull();
  });
});

describe('probeCliVersion', () => {
  it('non-Windows: runs `<bin> --version` directly', async () => {
    const exec = vi.fn(async () => ok('1.2.3'));
    expect(await probeCliVersion(exec, 'claude', false)).toBe('1.2.3');
    expect(exec).toHaveBeenCalledWith('claude', ['--version']);
  });

  it('Windows: runs `cmd /c <bin> --version` so the .cmd shim is reachable', async () => {
    const exec = vi.fn(async () => ok('1.2.3'));
    expect(await probeCliVersion(exec, 'claude', true)).toBe('1.2.3');
    // cmd.exe is a real executable (spawns with shell:false); it runs the claude.cmd shim.
    expect(exec).toHaveBeenCalledWith('cmd', ['/c', 'claude', '--version']);
  });

  it('parses presence identically to probeVersion (stderr fallback) on Windows', async () => {
    const exec = vi.fn(async () => okStderr('1.2.3'));
    expect(await probeCliVersion(exec, 'codex', true)).toBe('1.2.3');
  });

  it('returns null on non-zero exit (absent) — both platforms', async () => {
    expect(await probeCliVersion(vi.fn(async () => absent()), 'claude', false)).toBeNull();
    expect(await probeCliVersion(vi.fn(async () => absent()), 'claude', true)).toBeNull();
  });

  it('returns null on exit 0 with empty output (no false present)', async () => {
    expect(await probeCliVersion(vi.fn(async () => ok('')), 'claude', true)).toBeNull();
  });

  it('returns null when exec throws', async () => {
    const exec = vi.fn(async () => {
      throw new Error('spawn ENOENT');
    });
    expect(await probeCliVersion(exec, 'claude', true)).toBeNull();
  });
});
