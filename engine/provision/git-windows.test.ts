import { describe, it, expect, vi } from 'vitest';
import { provisionGitWindows, PORTABLE_GIT_SHA256, PORTABLE_GIT_URL } from './git-windows';
import { EngineEmitter } from '../emitter';
import { Status, StepId, ErrorCode, type KindlingEvent } from '../contract';
import type { ExecResult } from '../exec';

function collect(emitter: EngineEmitter): KindlingEvent[] {
  const events: KindlingEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

const okRun = async (_script: string): Promise<ExecResult> => ({
  code: 0,
  stdout: 'KINDLING_GIT_CMD=C:\\Users\\ada\\AppData\\Local\\kindling\\git\\cmd\r\n',
  stderr: '',
});

describe('provisionGitWindows', () => {
  it('emits Working then Done and returns the parsed git cmd dir on success', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const run = vi.fn(okRun);
    const result = await provisionGitWindows({ emitter, run });

    expect(result).toEqual({ ok: true, gitCmdDir: 'C:\\Users\\ada\\AppData\\Local\\kindling\\git\\cmd' });
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
    expect(events.every((e) => e.step === StepId.ProvisionGit)).toBe(true);
    // The script it runs is the pinned, integrity-checked PortableGit provisioner.
    const script = run.mock.calls[0][0];
    expect(script).toContain(PORTABLE_GIT_URL);
    expect(script).toContain(PORTABLE_GIT_SHA256);
  });

  it('emits a Failed ExecFailed and returns ok:false (with detail) on a non-zero exit', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const run = vi.fn(async (): Promise<ExecResult> => ({ code: 1, stdout: '', stderr: 'integrity check failed' }));
    const result = await provisionGitWindows({ emitter, run });

    expect(result).toEqual({ ok: false });
    const failed = events.find((e) => e.status === Status.Failed);
    expect(failed?.errorCode).toBe(ErrorCode.ExecFailed);
    expect(failed?.humanMessage).toContain('integrity check failed');
  });

  it('returns ok:false and emits Failed when the runner throws (e.g. powershell missing)', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const run = vi.fn(async () => {
      throw new Error('ENOENT powershell');
    });
    const result = await provisionGitWindows({ emitter, run });

    expect(result.ok).toBe(false);
    expect(events.some((e) => e.status === Status.Failed && e.errorCode === ErrorCode.ExecFailed)).toBe(true);
  });

  it('succeeds even if stdout lacks the marker (gitCmdDir just undefined)', async () => {
    const run = vi.fn(async (): Promise<ExecResult> => ({ code: 0, stdout: 'done', stderr: '' }));
    const result = await provisionGitWindows({ emitter: new EngineEmitter(), run });
    expect(result).toEqual({ ok: true, gitCmdDir: undefined });
  });
});
