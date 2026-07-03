import { describe, it, expect, vi } from 'vitest';
import { EngineEmitter } from '../emitter';
import { Phase, StepId, Status } from '../contract';
import { provisionNodeUnix, nvmNodePath } from './node-unix';
import { pins } from '../pins';

const NVM_DIR = '/home/u/.nvm';

describe('nvmNodePath (pure)', () => {
  it('builds the absolute nvm node path, normalizing the v prefix', () => {
    expect(nvmNodePath(NVM_DIR, '24.16.0')).toBe('/home/u/.nvm/versions/node/v24.16.0/bin/node');
    expect(nvmNodePath(NVM_DIR, 'v24.16.0')).toBe('/home/u/.nvm/versions/node/v24.16.0/bin/node');
  });
});

function harness() {
  const emitter = new EngineEmitter();
  const installNvm = vi.fn().mockResolvedValue(undefined);
  const nvmInstallNode = vi.fn().mockResolvedValue(undefined);
  const base = {
    version: pins.node,
    nvmDir: NVM_DIR,
    emitter,
    installNvm,
    nvmInstallNode,
    nodeInstalled: vi.fn().mockResolvedValue(false), // default: not yet installed (hermetic)
    now: () => '2026-05-29T00:00:00.000Z',
  };
  const steps = () => emitter.events().filter((e) => e.step === StepId.ProvisionNode);
  return { emitter, installNvm, nvmInstallNode, base, steps };
}

describe('provisionNodeUnix', () => {
  it('reuses a system Node ≥ floor on Linux (Skipped, no install) — AC2', async () => {
    const h = harness();
    const result = await provisionNodeUnix({ ...h.base, alreadyOk: true, platform: 'linux' });
    expect(result).toEqual({ ok: true, nodeExe: null }); // null → launch uses system node on PATH
    expect(h.installNvm).not.toHaveBeenCalled();
    expect(h.nvmInstallNode).not.toHaveBeenCalled();
    expect(h.steps().map((e) => e.status)).toEqual([Status.Skipped]);
  });

  it('on macOS, installs the exact pin via nvm even if a system Node is OK (reproducibility, AC3)', async () => {
    const h = harness();
    const result = await provisionNodeUnix({ ...h.base, alreadyOk: true, platform: 'darwin' });
    expect(h.nvmInstallNode).toHaveBeenCalledWith(NVM_DIR, pins.node); // not reused
    expect(result.nodeExe).toBe(nvmNodePath(NVM_DIR, pins.node));
    expect(h.steps().map((e) => e.status)).toEqual([Status.Working, Status.Done]);
  });

  it('installs the pinned Node via nvm and returns its absolute path (AC1/AC3)', async () => {
    const h = harness();
    const result = await provisionNodeUnix(h.base);
    expect(h.installNvm).toHaveBeenCalledWith(NVM_DIR);
    expect(h.nvmInstallNode).toHaveBeenCalledWith(NVM_DIR, pins.node);
    expect(result.nodeExe).toBe(nvmNodePath(NVM_DIR, pins.node));
    expect(result.nodeExe).toContain(pins.node); // resolved version equals pins.node
    expect(h.steps().map((e) => e.status)).toEqual([Status.Working, Status.Done]);
    const provisionEvent = h.steps()[0];
    expect(provisionEvent.phase).toBe(Phase.Provision);
    expect(provisionEvent.step).toBe(StepId.ProvisionNode);
  });

  it('re-run idempotency: skips installing when the pinned node is already present (2.7)', async () => {
    const h = harness();
    const result = await provisionNodeUnix({
      ...h.base,
      nodeInstalled: vi.fn().mockResolvedValue(true),
    });
    expect(h.installNvm).not.toHaveBeenCalled();
    expect(h.nvmInstallNode).not.toHaveBeenCalled();
    expect(result.nodeExe).toBe(nvmNodePath(NVM_DIR, pins.node)); // returns the path, no reinstall
    expect(h.steps().map((e) => e.status)).toEqual([Status.Skipped]);
  });

  it('repairs a partial install: nodeInstalled=false → installs (not skipped-into-broken, 2.7)', async () => {
    const h = harness(); // base nodeInstalled resolves false
    await provisionNodeUnix(h.base);
    expect(h.nvmInstallNode).toHaveBeenCalledWith(NVM_DIR, pins.node); // reinstalled to repair
    expect(h.steps().map((e) => e.status)).toEqual([Status.Working, Status.Done]);
  });

  it('default idempotency check requires the EXACT pinned version (wrong version → reinstall, 2.7)', async () => {
    // No nodeInstalled injected → exercise the default, which runs the binary and matches stdout.
    const right = harness();
    await provisionNodeUnix({
      ...right.base,
      nodeInstalled: undefined,
      exec: vi.fn().mockResolvedValue({ code: 0, stdout: `v${pins.node}`, stderr: '' }),
    });
    expect(right.installNvm).not.toHaveBeenCalled(); // exact version present → skip
    expect(right.steps().map((e) => e.status)).toEqual([Status.Skipped]);

    const wrong = harness();
    await provisionNodeUnix({
      ...wrong.base,
      nodeInstalled: undefined,
      exec: vi.fn().mockResolvedValue({ code: 0, stdout: 'v20.0.0', stderr: '' }), // different version
    });
    expect(wrong.nvmInstallNode).toHaveBeenCalled(); // wrong version → reinstall the pin
  });

  it('emits Failed (NetworkLost) and rethrows when nvm install fails', async () => {
    const h = harness();
    h.installNvm.mockRejectedValue(new Error('curl: offline'));
    await expect(provisionNodeUnix(h.base)).rejects.toThrow(/offline/);
    const statuses = h.steps().map((e) => e.status);
    expect(statuses).toEqual([Status.Working, Status.Failed]);
    expect(h.steps().at(-1)?.errorCode).toBe('network.lost');
  });
});
