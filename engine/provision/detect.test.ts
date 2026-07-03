import { describe, it, expect } from 'vitest';
import { detectDependencies } from './detect';
import { EngineEmitter } from '../emitter';
import { Status, StepId, type KindlingEvent } from '../contract';
import type { ExecResult } from '../exec';

function fakeExec(versions: { node?: string; git?: string }) {
  // Match by basename so path overrides (e.g. /usr/local/bin/node) resolve like the bare name.
  return async (cmd: string, _args: string[]): Promise<ExecResult> => {
    const base = cmd.split(/[\\/]/).pop() ?? cmd;
    const v = base === 'node' ? versions.node : base === 'git' ? versions.git : undefined;
    return v ? { code: 0, stdout: v, stderr: '' } : { code: 1, stdout: '', stderr: 'not found' };
  };
}

function collect(emitter: EngineEmitter): KindlingEvent[] {
  const events: KindlingEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

describe('detectDependencies', () => {
  it('marks node (>= floor) and git present as reuse → Skipped', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const state = await detectDependencies({
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0' }),
      emitter,
    });

    expect(state.node).toEqual({ present: true, version: 'v24.16.0', satisfiesFloor: true });
    expect(state.git).toEqual({ present: true, version: 'git version 2.43.0' });
    const byStep = Object.fromEntries(events.map((e) => [e.step, e.status]));
    expect(byStep[StepId.ProvisionNode]).toBe(Status.Skipped);
    expect(byStep[StepId.ProvisionGit]).toBe(Status.Skipped);
  });

  it('flags an old Node (below floor) for install → Queued', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const state = await detectDependencies({
      exec: fakeExec({ node: 'v18.20.0', git: 'git version 2.43.0' }),
      emitter,
    });

    expect(state.node.present).toBe(true);
    expect(state.node.satisfiesFloor).toBe(false);
    const nodeEvent = events.find((e) => e.step === StepId.ProvisionNode);
    expect(nodeEvent?.status).toBe(Status.Queued);
  });

  it('flags absent node and git for install (present:false → Queued)', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const state = await detectDependencies({ exec: fakeExec({}), emitter });

    expect(state.node.present).toBe(false);
    expect(state.node.version).toBeNull();
    expect(state.git.present).toBe(false);
    expect(events.map((e) => e.status)).toEqual([Status.Queued, Status.Queued]);
  });

  it('returns state without an emitter (no events required)', async () => {
    const state = await detectDependencies({ exec: fakeExec({ node: 'v24.0.0' }) });
    expect(state.node.satisfiesFloor).toBe(true);
    expect(state.git.present).toBe(false);
  });

  it('computes satisfiesFloor:false for a below-floor Node even without an emitter', async () => {
    const state = await detectDependencies({ exec: fakeExec({ node: 'v18.20.0' }) });
    expect(state.node.present).toBe(true);
    expect(state.node.satisfiesFloor).toBe(false);
  });

  it('resolves a provisioned binary passed by absolute path', async () => {
    const state = await detectDependencies({
      exec: fakeExec({ node: 'v24.16.0' }),
      node: '/opt/kindling/node/bin/node',
    });
    expect(state.node.present).toBe(true);
    expect(state.node.satisfiesFloor).toBe(true);
  });
});
