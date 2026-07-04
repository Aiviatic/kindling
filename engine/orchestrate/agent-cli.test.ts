import { describe, it, expect, vi } from 'vitest';
import { installAgentCli } from './agent-cli';
import { EngineEmitter } from '../emitter';
import { Status, StepId, ErrorCode, type KindlingEvent, type Config } from '../contract';
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

const ABSENT: ExecResult = { code: 1, stdout: '', stderr: '' }; // probe → not present
const INSTALL_OK: ExecResult = { code: 0, stdout: '', stderr: '' };
const INSTALL_FAIL: ExecResult = { code: 1, stdout: '', stderr: 'npm ERR!' };

// A probe call is `exec(<bin>, ['--version'])`; anything else is the install call.
const isProbe = (args: string[]): boolean => args[0] === '--version';

// exec fake: reports every CLI absent (so installs run), then returns `installResult` for installs.
function execFake(installResult: ExecResult = INSTALL_OK) {
  return vi.fn(async (_cmd: string, args: string[]) => (isProbe(args) ? ABSENT : installResult));
}

// Only the actual `npm install -g …` calls (filters out the `--version` probes).
function installCalls(exec: ReturnType<typeof execFake>): string[][] {
  return exec.mock.calls.filter(([, args]) => !isProbe(args)).map(([, args]) => args);
}

describe('installAgentCli', () => {
  it('installs claude-code at latest → Working→Done, argv install -g @anthropic-ai/claude-code (no @version)', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = execFake();

    const result = await installAgentCli({ config: config({ installCli: ['claude-code'] }), emitter, exec });

    const calls = installCalls(exec);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['install', '-g', '@anthropic-ai/claude-code']);
    // Deliberate exception: latest, NOT pinned — the package token carries no `@<version>` suffix.
    expect(calls[0][2]).toBe('@anthropic-ai/claude-code');
    expect(calls[0].some((tok) => /@anthropic-ai\/claude-code@/.test(tok))).toBe(false);

    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
    expect(events.every((e) => e.step === StepId.InstallAgentCli)).toBe(true);
    expect(result).toEqual({ ok: true, installed: ['claude-code'], skipped: [], failed: [] });
  });

  it('skips an already-present CLI (probeVersion resolves) → Skipped, no install exec', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    // Probe resolves (present); install would be a separate call we assert never happens.
    const exec = vi.fn(async (_cmd: string, args: string[]) =>
      isProbe(args) ? { code: 0, stdout: '1.2.3', stderr: '' } : INSTALL_OK,
    );

    const result = await installAgentCli({ config: config({ installCli: ['claude-code'] }), emitter, exec });

    expect(installCalls(exec)).toHaveLength(0); // no install
    expect(events.map((e) => e.status)).toEqual([Status.Skipped]);
    expect(result).toEqual({ ok: true, installed: [], skipped: ['claude-code'], failed: [] });
  });

  it('non-zero install exit → exactly one Failed (AgentCliInstallFailed); does not throw, run proceeds', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = execFake(INSTALL_FAIL);

    const result = await installAgentCli({ config: config({ installCli: ['claude-code'] }), emitter, exec });

    const statuses = events.map((e) => e.status);
    expect(statuses).toEqual([Status.Working, Status.Failed]);
    expect(statuses.filter((s) => s === Status.Failed)).toHaveLength(1);
    const failed = events.find((e) => e.status === Status.Failed)!;
    expect(failed.errorCode).toBe(ErrorCode.AgentCliInstallFailed);
    expect(failed.humanMessage).toContain('npm install -g @anthropic-ai/claude-code'); // manual fallback
    expect(failed.humanMessage).toContain('npm ERR!'); // the real child stderr is surfaced too
    // ok reflects "ran to completion", independent of the individual failure (non-fatal).
    expect(result).toEqual({ ok: true, installed: [], skipped: [], failed: ['claude-code'] });
  });

  it('spawn error (exec rejects) → Failed emitted, does NOT throw', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (isProbe(args)) return ABSENT; // probe resolves absent (probeVersion swallows anyway)
      throw new Error('spawn npm ENOENT');
    });

    const result = await installAgentCli({ config: config({ installCli: ['claude-code'] }), emitter, exec });

    const statuses = events.map((e) => e.status);
    expect(statuses).toEqual([Status.Working, Status.Failed]);
    const failed = events.find((e) => e.status === Status.Failed)!;
    expect(failed.errorCode).toBe(ErrorCode.AgentCliInstallFailed);
    expect(failed.humanMessage).toContain('spawn npm ENOENT'); // spawn error surfaced, not blank
    expect(result.failed).toEqual(['claude-code']);
  });

  it('scope guard: only claude-code / codex are eligible — vscode & cursor never reach exec', async () => {
    const emitter = new EngineEmitter();
    const exec = execFake();

    const result = await installAgentCli({
      config: config({ installCli: ['claude-code', 'vscode', 'cursor'] }),
      emitter,
      exec,
    });

    const calls = installCalls(exec);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['install', '-g', '@anthropic-ai/claude-code']);
    expect(result.installed).toEqual(['claude-code']);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('both selected → installs @anthropic-ai/claude-code AND @openai/codex', async () => {
    const emitter = new EngineEmitter();
    const exec = execFake();

    const result = await installAgentCli({
      config: config({ installCli: ['claude-code', 'codex'] }),
      emitter,
      exec,
    });

    const pkgs = installCalls(exec).map((args) => args[2]);
    expect(pkgs).toEqual(['@anthropic-ai/claude-code', '@openai/codex']);
    expect(result.installed).toEqual(['claude-code', 'codex']);
  });

  it('no eligible selection (empty) → no-op: no exec, no events', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = execFake();

    const result = await installAgentCli({ config: config({ installCli: [] }), emitter, exec });

    expect(exec).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(result).toEqual({ ok: true, installed: [], skipped: [], failed: [] });
  });

  it('absent installCli → no-op: no exec, no events', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const exec = execFake();

    const result = await installAgentCli({ config: config(), emitter, exec });

    expect(exec).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('honors a custom npmCommand (Windows absolute-node seam)', async () => {
    const exec = execFake();
    await installAgentCli({
      config: config({ installCli: ['claude-code'] }),
      emitter: new EngineEmitter(),
      exec,
      npmCommand: '/abs/node',
    });
    const installCall = exec.mock.calls.find(([, args]) => !isProbe(args))!;
    expect(installCall[0]).toBe('/abs/node');
  });

  it('threads npmPrefixArgs before the install args (Windows node npm-cli.js wiring)', async () => {
    const exec = execFake();
    await installAgentCli({
      config: config({ installCli: ['claude-code'] }),
      emitter: new EngineEmitter(),
      exec,
      npmCommand: '/abs/node',
      npmPrefixArgs: ['/abs/node_modules/npm/bin/npm-cli.js'],
    });
    const installCall = exec.mock.calls.find(([, args]) => !isProbe(args))!;
    expect(installCall[0]).toBe('/abs/node');
    // Prefix (npm-cli.js) comes first, THEN the unchanged `install -g <pkg>`.
    expect(installCall[1]).toEqual([
      '/abs/node_modules/npm/bin/npm-cli.js',
      'install',
      '-g',
      '@anthropic-ai/claude-code',
    ]);
  });

  it('probes through the resolveBin seam (Windows shim resolution)', async () => {
    const exec = execFake();
    await installAgentCli({
      config: config({ installCli: ['claude-code'] }),
      emitter: new EngineEmitter(),
      exec,
      resolveBin: (bin) => `/abs/${bin}.cmd`,
    });
    // The idempotent-skip probe must spawn the RESOLVED bin, not the bare name (else the skip
    // silently fails on Windows where `claude` is really `claude.cmd`).
    const probeCall = exec.mock.calls.find(([, args]) => isProbe(args))!;
    expect(probeCall[0]).toBe('/abs/claude.cmd');
  });

  it('de-dupes a repeated id — installs once', async () => {
    const exec = execFake();
    const result = await installAgentCli({
      config: config({ installCli: ['claude-code', 'claude-code'] }),
      emitter: new EngineEmitter(),
      exec,
    });
    expect(installCalls(exec)).toHaveLength(1);
    expect(result.installed).toEqual(['claude-code']);
  });

  it('mixed outcome in one run — one skipped, one failed — composes result + events in order', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    // claude present (probe resolves) → Skipped; codex absent → install → fails.
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (isProbe(args)) return cmd === 'claude' ? { code: 0, stdout: '1.0.0', stderr: '' } : ABSENT;
      return INSTALL_FAIL; // only codex reaches the install call
    });

    const result = await installAgentCli({
      config: config({ installCli: ['claude-code', 'codex'] }),
      emitter,
      exec,
    });

    expect(result).toEqual({ ok: true, installed: [], skipped: ['claude-code'], failed: ['codex'] });
    expect(events.map((e) => e.status)).toEqual([Status.Skipped, Status.Working, Status.Failed]);
    expect(installCalls(exec)).toEqual([['install', '-g', '@openai/codex']]);
  });
});
