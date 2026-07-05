import { describe, it, expect, vi } from 'vitest';
import { noneProvider } from './none-provider';
import { EngineEmitter } from '../emitter';
import { StepId, Status, type Config, type KindlingEvent } from '../contract';
import type { ExecResult } from '../exec';

const config: Config = {
  projectDir: '/tmp/proj',
  projectName: 'proj',
  ides: ['claude-code'],
  modules: [],
  framework: 'none',
  pins: { node: '24', bmad: '6.9.0', kindling: '0.0.0' },
};

describe('noneProvider', () => {
  it('installs nothing, emits a Done on install.framework, and succeeds without touching exec', async () => {
    const emitter = new EngineEmitter();
    const seen: KindlingEvent[] = [];
    emitter.on((e) => seen.push(e));
    const exec = vi.fn(async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' }));

    const r = await noneProvider.install({
      config,
      emitter,
      exec,
      runner: { command: 'npx', prefixArgs: [] },
    });

    expect(r).toEqual({ ok: true });
    expect(exec).not.toHaveBeenCalled(); // nothing installed
    const done = seen.find((e) => e.step === StepId.InstallFramework && e.status === Status.Done);
    expect(done).toBeDefined();
  });
});
