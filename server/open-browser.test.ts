import { describe, it, expect, vi } from 'vitest';
import { openBrowser } from './open-browser';
import type { ExecResult } from '../engine/exec';

const ok: ExecResult = { code: 0, stdout: '', stderr: '' };

describe('openBrowser', () => {
  it('uses the platform-appropriate open command', async () => {
    const exec = vi.fn(async (_c: string, _a: string[]) => ok);

    await openBrowser('http://127.0.0.1:1234/', { exec, platform: 'darwin' });
    expect(exec.mock.calls[0][0]).toBe('open');

    await openBrowser('http://127.0.0.1:1234/', { exec, platform: 'linux' });
    expect(exec.mock.calls[1][0]).toBe('xdg-open');

    await openBrowser('http://127.0.0.1:1234/', { exec, platform: 'win32' });
    expect(exec.mock.calls[2][0]).toBe('cmd');
    expect(exec.mock.calls[2][1]).toContain('start');
  });

  it('returns true on exit 0', async () => {
    expect(await openBrowser('http://x/', { exec: async () => ok, platform: 'linux' })).toBe(true);
  });

  it('never throws — returns false when the open command fails', async () => {
    const exec = async (): Promise<ExecResult> => {
      throw new Error('no such command');
    };
    expect(await openBrowser('http://x/', { exec, platform: 'linux' })).toBe(false);
  });
});
