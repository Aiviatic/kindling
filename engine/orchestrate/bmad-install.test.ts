import { describe, it, expect, vi } from 'vitest';
import { runBmadInstall } from './bmad-install';
import { EngineEmitter } from '../emitter';
import { Status, StepId, type KindlingEvent, type Config } from '../contract';
import type { ExecResult } from '../exec';

function config(overrides: Partial<Config> = {}): Config {
  return {
    projectDir: '/tmp/proj',
    projectName: 'proj',
    ides: ['claude-code'],
    modules: ['bmm'],
    pins: { node: '24.16.0', bmad: '6.1.2', kindling: '0.0.0' },
    ...overrides,
  };
}

function collect(emitter: EngineEmitter): KindlingEvent[] {
  const events: KindlingEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

const ok: ExecResult = { code: 0, stdout: '', stderr: '' };
const fail: ExecResult = { code: 1, stdout: '', stderr: 'boom' };

describe('runBmadInstall', () => {
  it('invokes npx with the pinned package + composed flags, emits working→done, returns ok', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);

    const result = await runBmadInstall({ config: config(), emitter, exec });

    expect(exec).toHaveBeenCalledOnce();
    const [cmd, args] = exec.mock.calls[0];
    expect(cmd).toBe('npx');
    expect(args[0]).toBe('bmad-method@6.1.2'); // the version pin IS the npx package spec
    expect(args).toContain('install');
    expect(args).not.toContain('--pin'); // not a version flag on the real CLI
    expect(args).not.toContain('--action'); // fresh project (default detect → false)
    expect(result).toEqual({ ok: true, bmadVersion: '6.1.2' });
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
    expect(events.every((e) => e.step === StepId.InstallBmad)).toBe(true);
  });

  it('re-run on an already-installed project uses --action update (2.7 idempotency)', async () => {
    const emitter = new EngineEmitter();
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);
    await runBmadInstall({
      config: config(),
      emitter,
      exec,
      bmadAlreadyInstalled: async () => true, // existing _bmad → update in place
    });
    const [, args] = exec.mock.calls[0];
    expect(args).toContain('--action');
    expect(args[args.indexOf('--action') + 1]).toBe('update');
  });

  it('latest target: uses bmad-method@latest + forces --action update even when _bmad is absent (7.1 / FR27)', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);

    const result = await runBmadInstall({
      config: config({ bmadTarget: 'latest' }),
      emitter,
      exec,
      // Force-update is unconditional for latest: even a "not installed" detection updates.
      bmadAlreadyInstalled: async () => false,
    });

    const [, args] = exec.mock.calls[0];
    expect(args[0]).toBe('bmad-method@latest'); // the @latest tag, NOT the pin
    expect(args).not.toContain('bmad-method@6.1.2');
    expect(args).toContain('--action');
    expect(args[args.indexOf('--action') + 1]).toBe('update'); // forced update
    expect(result).toEqual({ ok: true, bmadVersion: 'latest' });
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
  });

  it('default (absent bmadTarget) fresh install argv is byte-identical to today (NFR3 reproducibility)', async () => {
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);
    await runBmadInstall({ config: config(), emitter: new EngineEmitter(), exec, bmadAlreadyInstalled: async () => false });
    const [cmd, args] = exec.mock.calls[0];
    expect(cmd).toBe('npx');
    expect(args[0]).toBe('bmad-method@6.1.2'); // the pin, never @latest
    expect(args).toContain('install');
    expect(args).not.toContain('--action'); // fresh → no forced update
  });

  it('default (absent bmadTarget) pinned repair argv is byte-identical to today (@pin + --action update)', async () => {
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);
    await runBmadInstall({ config: config(), emitter: new EngineEmitter(), exec, bmadAlreadyInstalled: async () => true });
    const [, args] = exec.mock.calls[0];
    expect(args[0]).toBe('bmad-method@6.1.2'); // still the pin
    expect(args).toContain('--action');
    expect(args[args.indexOf('--action') + 1]).toBe('update');
  });

  it('explicit pinned target behaves exactly like the default (fresh → install, no @latest)', async () => {
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);
    await runBmadInstall({ config: config({ bmadTarget: 'pinned' }), emitter: new EngineEmitter(), exec, bmadAlreadyInstalled: async () => false });
    const [, args] = exec.mock.calls[0];
    expect(args[0]).toBe('bmad-method@6.1.2');
    expect(args).not.toContain('--action');
  });

  it('latest target SKIPS the pinned-only TODO guard — a TODO pin still updates to @latest (7.1)', async () => {
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);
    const result = await runBmadInstall({
      config: config({ pins: { node: '24.16.0', bmad: '0.0.0-TODO', kindling: '0.0.0' }, bmadTarget: 'latest' }),
      emitter: new EngineEmitter(),
      exec,
      bmadAlreadyInstalled: async () => false,
    });
    // The notPinned guard is pinned-only, so a TODO pin must NOT short-circuit the latest path.
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][1][0]).toBe('bmad-method@latest');
    expect(result).toEqual({ ok: true, bmadVersion: 'latest' });
  });

  it('reports failure (no success) on a non-zero exit', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);

    const result = await runBmadInstall({ config: config(), emitter, exec: async () => fail });

    expect(result.ok).toBe(false);
    const statuses = events.map((e) => e.status);
    expect(statuses).toEqual([Status.Working, Status.Failed]);
    expect(statuses).not.toContain(Status.Done);
    expect(statuses.filter((s) => s === Status.Failed)).toHaveLength(1);
  });

  it('fails fast with a clear message (no exec) when the BMad pin is still a TODO placeholder', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);

    const result = await runBmadInstall({
      config: config({ pins: { node: '24.16.0', bmad: '0.0.0-TODO', kindling: '0.0.0' } }),
      emitter,
      exec,
    });

    expect(result.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Failed]);
  });

  it('emits a terminal failed event and rethrows on a spawn error', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = async () => {
      throw new Error('spawn npx ENOENT');
    };

    await expect(runBmadInstall({ config: config(), emitter, exec })).rejects.toThrow(/ENOENT/);
    const statuses = events.map((e) => e.status);
    expect(statuses[0]).toBe(Status.Working);
    expect(statuses[statuses.length - 1]).toBe(Status.Failed);
  });

  it('honors a custom npxCommand (Epic 2 Windows seam)', async () => {
    const exec = vi.fn(async (_cmd: string, _args: string[]) => ok);
    await runBmadInstall({ config: config(), emitter: new EngineEmitter(), exec, npxCommand: '/abs/node' });
    expect(exec.mock.calls[0][0]).toBe('/abs/node');
  });
});
