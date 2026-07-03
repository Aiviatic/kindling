import { describe, it, expect, vi } from 'vitest';
import { EngineEmitter } from '../emitter';
import { StepId, Status } from '../contract';
import { provisionGitUnix } from './git-unix';

function harness(platform: NodeJS.Platform) {
  const emitter = new EngineEmitter();
  const base = {
    platform,
    emitter,
    sleep: vi.fn().mockResolvedValue(undefined),
    pollIntervalMs: 1,
    now: () => '2026-05-29T00:00:00.000Z',
  };
  const events = (step: StepId) => emitter.events().filter((e) => e.step === step);
  return { emitter, base, events };
}

describe('provisionGitUnix — macOS (Xcode CLT)', () => {
  it('skips when Git is already present (CLT installed)', async () => {
    const h = harness('darwin');
    const triggerXcodeInstall = vi.fn();
    const res = await provisionGitUnix({ ...h.base, alreadyOk: true, triggerXcodeInstall });
    expect(res.ok).toBe(true);
    expect(triggerXcodeInstall).not.toHaveBeenCalled();
    expect(h.events(StepId.ProvisionXcodeClt).map((e) => e.status)).toEqual([Status.Skipped]);
  });

  it('triggers the install then polls until resolved, emitting Working each tick (never frozen)', async () => {
    const h = harness('darwin');
    const triggerXcodeInstall = vi.fn().mockResolvedValue(undefined);
    const checkXcode = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await provisionGitUnix({ ...h.base, triggerXcodeInstall, checkXcode });
    expect(res.ok).toBe(true);
    expect(triggerXcodeInstall).toHaveBeenCalledOnce();
    const statuses = h.events(StepId.ProvisionXcodeClt).map((e) => e.status);
    expect(statuses[0]).toBe(Status.Working); // the "dialog popped up" copy
    expect(statuses).toContain(Status.Working); // a poll-tick reassurance
    expect(statuses.at(-1)).toBe(Status.Done);
    expect(h.base.sleep).toHaveBeenCalled(); // it actually waited between polls
  });

  it('soft-fails (no throw) on timeout so Retry can re-poll a still-open dialog', async () => {
    const h = harness('darwin');
    const res = await provisionGitUnix({
      ...h.base,
      maxPolls: 2,
      triggerXcodeInstall: vi.fn().mockResolvedValue(undefined),
      checkXcode: vi.fn().mockResolvedValue(false), // never resolves
    });
    expect(res.ok).toBe(false);
    const last = h.events(StepId.ProvisionXcodeClt).at(-1);
    expect(last?.status).toBe(Status.Failed);
    expect(last?.errorCode).toBe('exec.failed');
  });

  it('rethrows if triggering the install itself fails', async () => {
    const h = harness('darwin');
    await expect(
      provisionGitUnix({
        ...h.base,
        triggerXcodeInstall: vi.fn().mockRejectedValue(new Error('xcode-select boom')),
        checkXcode: vi.fn(),
      }),
    ).rejects.toThrow(/boom/);
    expect(h.events(StepId.ProvisionXcodeClt).at(-1)?.status).toBe(Status.Failed);
  });
});

describe('provisionGitUnix — Linux (apt)', () => {
  it('installs Git via the distro package manager', async () => {
    const h = harness('linux');
    const installLinuxGit = vi.fn().mockResolvedValue(undefined);
    const res = await provisionGitUnix({ ...h.base, installLinuxGit });
    expect(res.ok).toBe(true);
    expect(installLinuxGit).toHaveBeenCalledOnce();
    expect(h.events(StepId.ProvisionGit).map((e) => e.status)).toEqual([Status.Working, Status.Done]);
  });

  it('skips when Git is already present', async () => {
    const h = harness('linux');
    const res = await provisionGitUnix({ ...h.base, alreadyOk: true, installLinuxGit: vi.fn() });
    expect(res.ok).toBe(true);
    expect(h.events(StepId.ProvisionGit).map((e) => e.status)).toEqual([Status.Skipped]);
  });

  it('emits Failed and rethrows when apt fails', async () => {
    const h = harness('linux');
    await expect(
      provisionGitUnix({ ...h.base, installLinuxGit: vi.fn().mockRejectedValue(new Error('apt boom')) }),
    ).rejects.toThrow(/apt boom/);
    expect(h.events(StepId.ProvisionGit).at(-1)?.status).toBe(Status.Failed);
  });
});
