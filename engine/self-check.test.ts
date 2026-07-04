import { describe, it, expect } from 'vitest';
import { runSelfCheck } from './self-check';
import { EngineEmitter } from './emitter';
import { Status, StepId, type KindlingEvent } from './contract';
import type { ExecResult } from './exec';
import { pins } from './pins';

function collect(emitter: EngineEmitter): KindlingEvent[] {
  const events: KindlingEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

// Fake exec that answers `<bin> --version` from a map (node/git and any CLI bin, e.g. claude/codex).
function fakeExec(versions: Record<string, string | undefined>) {
  return async (cmd: string, _args: string[]): Promise<ExecResult> => {
    const v = versions[cmd];
    return v ? { code: 0, stdout: v, stderr: '' } : { code: 1, stdout: '', stderr: 'not found' };
  };
}

const platform = { os: 'linux', arch: 'x64', osVersion: '6.0.0' };

const claudeDescriptor = {
  id: 'claude-code',
  pkg: '@anthropic-ai/claude-code',
  bin: 'claude',
  name: 'Claude Code',
};

describe('runSelfCheck', () => {
  it('emits done and returns a green summary when everything passes', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);

    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter,
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0' }),
      platform,
    });

    expect(summary.success).toBe(true);
    expect(summary.node.satisfiesFloor).toBe(true);
    expect(summary.git.present).toBe(true);
    expect(summary.projectDir).toBe('/tmp/proj'); // opts.projectDir threaded into the summary
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
    expect(events.every((e) => e.step === StepId.FinalizeSelfCheck)).toBe(true);
  });

  it('emits failed and success=false when Node is below the floor (no false green)', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);

    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter,
      exec: fakeExec({ node: 'v18.20.0', git: 'git version 2.43.0' }),
      platform,
    });

    expect(summary.success).toBe(false);
    expect(summary.node.satisfiesFloor).toBe(false);
    expect(summary.node.version).toBe('v18.20.0');
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Failed]);
  });

  it('marks Node absent (present:false) when the node probe fails, and fails the run', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);

    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter,
      exec: fakeExec({ git: 'git version 2.43.0' }), // node missing → probe code 1
      platform,
    });

    expect(summary.node.present).toBe(false);
    expect(summary.node.version).toBeNull();
    expect(summary.node.satisfiesFloor).toBe(false);
    expect(summary.success).toBe(false);
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Failed]);
  });

  it('treats exit-0 with empty output as absent (no false green)', async () => {
    const emptyExec = async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' });
    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter: new EngineEmitter(),
      exec: emptyExec,
      platform,
    });
    expect(summary.node.present).toBe(false);
    expect(summary.git.present).toBe(false);
    expect(summary.success).toBe(false);
  });

  it('reports a requested CLI as present when its probe succeeds (Story 6.2)', async () => {
    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter: new EngineEmitter(),
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0', claude: '1.2.3' }),
      agentClis: [claudeDescriptor],
      platform,
    });
    expect(summary.cli).toEqual([
      { id: 'claude-code', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code', present: true },
    ]);
    expect(summary.success).toBe(true);
  });

  it('reports a requested CLI as absent — and stays green (non-blocking, AC-6)', async () => {
    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter: new EngineEmitter(),
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0' }), // claude probe → not found
      agentClis: [claudeDescriptor],
      platform,
    });
    expect(summary.cli[0].present).toBe(false);
    expect(summary.success).toBe(true); // an absent CLI must NOT flip the verdict
  });

  it('probes the CLI through cmd.exe on Windows so the .cmd shim is detected (Story 6.2)', async () => {
    // On Windows the installed CLI is a `claude.cmd` shim that Node won't spawn with shell:false;
    // the self-check must run `cmd /c claude --version` (probeCliVersion) to reach it. A bare-bin
    // probe would wrongly report the CLI absent even after a successful `npm install -g`.
    const calls: Array<[string, string[]]> = [];
    const exec = async (cmd: string, args: string[]): Promise<ExecResult> => {
      calls.push([cmd, args]);
      if (cmd === 'node') return { code: 0, stdout: 'v24.16.0', stderr: '' };
      if (cmd === 'git') return { code: 0, stdout: 'git version 2.43.0', stderr: '' };
      // The claude probe arrives as `cmd /c claude --version` on Windows — resolve it as present.
      if (cmd === 'cmd' && args[0] === '/c' && args[1] === 'claude') {
        return { code: 0, stdout: '1.2.3', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'not found' };
    };

    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter: new EngineEmitter(),
      exec,
      agentClis: [claudeDescriptor],
      platform: { os: 'win32', arch: 'x64', osVersion: '10.0.0' },
    });

    expect(summary.cli[0].present).toBe(true); // detected via the cmd /c shim probe
    expect(calls).toContainEqual(['cmd', ['/c', 'claude', '--version']]);
  });

  it('emits cli: [] when no CLI was requested (schema stability; Story 6.2)', async () => {
    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter: new EngineEmitter(),
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0' }),
      platform,
    });
    expect(summary.cli).toEqual([]);
  });

  it('reports the injected installed BMad version + keeps pinnedVersion as the requested pin (FR26)', async () => {
    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      emitter: new EngineEmitter(),
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0' }),
      readInstalledBmadVersion: async () => '6.9.0',
      platform,
    });
    expect(summary.bmad.installedVersion).toBe('6.9.0'); // disk reality
    expect(summary.bmad.pinnedVersion).toBe(pins.bmad); // still the REQUESTED pin, not the read version
    expect(summary.success).toBe(true);
  });

  it('reports installedVersion: null when the manifest is unreadable — and stays green (non-blocking)', async () => {
    // A drifted/null installed version does NOT gate success here; the honesty gate lands on the
    // Validation Page (Story 7.1 / AC-2).
    const summary = await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/tmp/proj',
      emitter: new EngineEmitter(),
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0' }),
      readInstalledBmadVersion: async () => null,
      platform,
    });
    expect(summary.bmad.installedVersion).toBeNull();
    expect(summary.success).toBe(true);
  });

  it('passes projectDir to the injected reader', async () => {
    let seen: string | undefined;
    await runSelfCheck({
      scaffoldCreated: true,
      bmadInstalled: true,
      projectDir: '/some/project',
      emitter: new EngineEmitter(),
      exec: fakeExec({ node: 'v24.16.0', git: 'git version 2.43.0' }),
      readInstalledBmadVersion: async (dir) => {
        seen = dir;
        return null;
      },
      platform,
    });
    expect(seen).toBe('/some/project');
  });

  it('reflects an absent git and a not-installed bmad in the summary', async () => {
    const summary = await runSelfCheck({
      scaffoldCreated: false,
      bmadInstalled: false,
      projectDir: '/tmp/proj',
      readInstalledBmadVersion: async () => null,
      emitter: new EngineEmitter(),
      exec: fakeExec({ node: 'v24.16.0' }), // git missing
      platform,
    });

    expect(summary.git.present).toBe(false);
    expect(summary.bmad.installed).toBe(false);
    expect(summary.scaffold.created).toBe(false);
    expect(summary.success).toBe(false);
  });
});
