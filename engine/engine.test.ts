import { describe, it, expect, vi } from 'vitest';
import { Engine, type EngineDeps } from './engine';
import { EngineEmitter } from './emitter';
import { Phase, StepId, Status, type Config, type KindlingEvent } from './contract';
import type { ValidationSummary } from './validation-summary';
import type { SelfCheckOptions } from './self-check';
import type { FailureLogEntry } from './log';
import { npxCliPath, npmCliPath } from './orchestrate/launch';
import type { FrameworkContext } from './framework/provider';
import type { AgentCliOptions } from './orchestrate/agent-cli';

function config(): Config {
  return {
    projectDir: '/tmp/proj',
    projectName: 'proj',
    ides: ['claude-code'],
    modules: ['bmm'],
    pins: { node: '24.16.0', bmad: '6.1.2', kindling: '0.0.0' },
  };
}

const greenSummary: ValidationSummary = {
  schemaVersion: 3,
  kindlingVersion: '0.0.0',
  os: 'linux',
  arch: 'x64',
  osVersion: '6.0.0',
  projectDir: '/tmp/proj',
  framework: 'bmad',
  frameworkInfo: { label: 'BMad Method', version: '6.1.2', note: 'a stable, tested version' },
  node: { present: true, version: 'v24.16.0', satisfiesFloor: true },
  git: { present: true, version: 'git version 2.43.0' },
  bmad: { pinnedVersion: '6.1.2', installed: true, installedVersion: '6.1.2' },
  scaffold: { created: true },
  cli: [],
  success: true,
  generatedAt: '2026-05-29T00:00:00.000Z',
};

// All-pass fakes; tests override individual deps to inject failures.
function deps(over: Partial<EngineDeps> = {}): Partial<EngineDeps> {
  return {
    detect: vi.fn(async () => ({
      node: { present: true, version: 'v24.16.0', satisfiesFloor: true },
      git: { present: true, version: 'git version 2.43.0' },
    })),
    provisionGit: vi.fn(async () => ({ ok: true })),
    platform: 'linux',
    scaffold: vi.fn(async () => 'created' as const),
    installFramework: vi.fn(async () => ({ ok: true, version: '6.1.2' })),
    installAgentCli: vi.fn(async () => ({ ok: true, installed: [], skipped: [], failed: [] })),
    runSelfCheck: vi.fn(async () => greenSummary),
    writeFailureLog: vi.fn(async () => '/tmp/.kindling/logs/report.log'),
    ...over,
  };
}

describe('Engine orchestration', () => {
  it('runs all steps in order and returns a green summary; no failure log', async () => {
    const d = deps();
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();

    expect(result.ok).toBe(true);
    expect(result.summary?.success).toBe(true);
    expect(d.scaffold).toHaveBeenCalledOnce();
    expect(d.installFramework).toHaveBeenCalledOnce();
    expect(d.runSelfCheck).toHaveBeenCalledOnce();
    expect(d.writeFailureLog).not.toHaveBeenCalled();
  });

  it('runs engine-driven provisioning first: Node-present row + Git provisioned, before scaffold (Option C)', async () => {
    const emitter = new EngineEmitter();
    const events: { step: StepId; status: Status }[] = [];
    emitter.on((e) => events.push({ step: e.step, status: e.status }));
    const d = deps({ detect: vi.fn(async () => ({ node: { present: true, version: 'v24.16.0', satisfiesFloor: true }, git: { present: false, version: null } })) });
    const engine = new Engine(config(), emitter, d);
    await engine.start();

    expect(d.detect).toHaveBeenCalled();
    expect(d.provisionGit).toHaveBeenCalledWith(expect.objectContaining({ platform: 'linux', alreadyOk: false }));
    // Node acknowledged present; provisioning happens before scaffold.
    expect(events.some((e) => e.step === StepId.ProvisionNode && e.status === Status.Skipped)).toBe(true);
  });

  it('a Git provisioning failure stops the run and is retryable on its step (Option C)', async () => {
    const d = deps({ provisionGit: vi.fn(async () => ({ ok: false })) }); // e.g. Xcode poll timeout
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(StepId.ProvisionGit); // linux → git step
    expect(d.scaffold).not.toHaveBeenCalled(); // never reached scaffold

    // Retry the git step → succeeds → completes.
    (d.provisionGit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const retried = await engine.retry(StepId.ProvisionGit);
    expect(retried.ok).toBe(true);
  });

  it('on macOS the Git step is the xcode-clt step id (the dialog row)', async () => {
    const d = deps({ platform: 'darwin', provisionGit: vi.fn(async () => ({ ok: false })) });
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();
    expect(result.failedStep).toBe(StepId.ProvisionXcodeClt);
  });

  it('fails honestly at the Node step if the bootstrapped Node is below the floor (not a false green)', async () => {
    const d = deps({
      detect: vi.fn(async () => ({ node: { present: true, version: 'v18.0.0', satisfiesFloor: false }, git: { present: true, version: 'git 2.43' } })),
    });
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();
    expect(result.failedStep).toBe(StepId.ProvisionNode);
    expect(d.provisionGit).not.toHaveBeenCalled();
  });

  it('Windows: reflects bootstrap-provisioned Git (Skipped if present, Failed if the spike did not run)', async () => {
    const present = deps({ platform: 'win32' }); // default detect → git present
    expect((await new Engine(config(), new EngineEmitter(), present).start()).ok).toBe(true);
    expect(present.provisionGit).not.toHaveBeenCalled(); // engine doesn't run unix git on win

    const missing = deps({
      platform: 'win32',
      detect: vi.fn(async () => ({ node: { present: true, version: 'v24.16.0', satisfiesFloor: true }, git: { present: false, version: null } })),
    });
    const result = await new Engine(config(), new EngineEmitter(), missing).start();
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(StepId.ProvisionGit);
  });

  it('Windows: threads the node + npx-cli.js runner to the framework install (no bare npx.cmd)', async () => {
    const installFramework = vi.fn(async (_ctx: FrameworkContext) => ({ ok: true, version: '6.1.2' }));
    const engine = new Engine(config(), new EngineEmitter(), deps({ platform: 'win32', installFramework }));
    await engine.start();

    expect(installFramework).toHaveBeenCalledOnce();
    const ctx = installFramework.mock.calls[0][0];
    expect(ctx.runner.command).toBe(process.execPath);
    expect(ctx.runner.prefixArgs).toEqual([npxCliPath(process.execPath)]);
  });

  it('Windows: routes the agent-CLI install through node + npm-cli.js (no bare npm.cmd)', async () => {
    const installAgentCli = vi.fn(async (_opts: AgentCliOptions) => ({ ok: true, installed: [], skipped: [], failed: [] }));
    const engine = new Engine(config(), new EngineEmitter(), deps({ platform: 'win32', installAgentCli }));
    await engine.start();

    expect(installAgentCli).toHaveBeenCalledOnce();
    const opts = installAgentCli.mock.calls[0][0];
    expect(opts.npmCommand).toBe(process.execPath);
    expect(opts.npmPrefixArgs).toEqual([npmCliPath(process.execPath)]);
    // Windows also routes the idempotent-skip probe through `cmd /c <bin> --version`.
    expect(opts.isWindows).toBe(true);
  });

  it('non-Windows: uses the plain npx runner + passes no npm Windows wiring (macOS/Linux unchanged)', async () => {
    const installFramework = vi.fn(async (_ctx: FrameworkContext) => ({ ok: true, version: '6.1.2' }));
    const installAgentCli = vi.fn(async (_opts: AgentCliOptions) => ({ ok: true, installed: [], skipped: [], failed: [] }));
    const engine = new Engine(config(), new EngineEmitter(), deps({ platform: 'linux', installFramework, installAgentCli }));
    await engine.start();

    const ctx = installFramework.mock.calls[0][0];
    expect(ctx.runner.command).toBe('npx');
    expect(ctx.runner.prefixArgs).toEqual([]);
    const cliOpts = installAgentCli.mock.calls[0][0];
    expect(cliOpts.npmCommand).toBeUndefined();
    expect(cliOpts.npmPrefixArgs).toBeUndefined();
    expect(cliOpts.isWindows).toBe(false); // direct `<bin> --version` probe on macOS/Linux
  });

  it('stops at a failing step, writes the failure log, and does not run later steps', async () => {
    const d = deps({ installFramework: vi.fn(async () => ({ ok: false, version: '6.1.2' })) });
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(StepId.InstallFramework);
    expect(d.writeFailureLog).toHaveBeenCalledOnce();
    expect(d.runSelfCheck).not.toHaveBeenCalled(); // later step skipped
  });

  it('retry resumes from the failed step and skips already-completed steps', async () => {
    const scaffold = vi.fn(async () => 'created' as const);
    let installAttempt = 0;
    const installFramework = vi.fn(async () => {
      installAttempt += 1;
      return { ok: installAttempt > 1, version: '6.1.2' }; // fail first, succeed on retry
    });
    const runSelfCheck = vi.fn(async () => greenSummary);
    const engine = new Engine(config(), new EngineEmitter(), deps({ scaffold, installFramework, runSelfCheck }));

    const first = await engine.start();
    expect(first.ok).toBe(false);
    expect(first.failedStep).toBe(StepId.InstallFramework);
    expect(scaffold).toHaveBeenCalledOnce();

    const retried = await engine.retry(StepId.InstallFramework);
    expect(retried.ok).toBe(true);
    expect(retried.summary?.success).toBe(true);
    expect(scaffold).toHaveBeenCalledOnce(); // NOT re-run (already completed)
    expect(installFramework).toHaveBeenCalledTimes(2);
    expect(runSelfCheck).toHaveBeenCalledOnce();
  });

  it('a NON-fatal agent-CLI failure still reaches self-check and returns ok (Story 6.1)', async () => {
    // The step emits its own Failed event but the engine step returns true unconditionally, so
    // the run proceeds to self-check and succeeds — a CLI failure must not fail the whole run.
    const installAgentCli = vi.fn(async (opts: { emitter: EngineEmitter }) => {
      opts.emitter.emit({
        id: 'cli-fail',
        phase: Phase.Install,
        step: StepId.InstallAgentCli,
        status: Status.Failed,
        humanMessage: 'cli install failed',
        level: 'error',
        timestamp: '2026-07-02T00:00:00.000Z',
      });
      return { ok: true, installed: [], skipped: [], failed: ['claude-code'] };
    });
    const runSelfCheck = vi.fn(async () => greenSummary);
    const d = deps({ installAgentCli, runSelfCheck });
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();

    expect(result.ok).toBe(true); // non-fatal: whole run still succeeds
    expect(installAgentCli).toHaveBeenCalledOnce();
    expect(runSelfCheck).toHaveBeenCalledOnce(); // reached self-check despite the CLI failure
    expect(d.writeFailureLog).not.toHaveBeenCalled(); // no failure log for a non-fatal step
  });

  it('engine.retry(InstallAgentCli) re-runs just the CLI step; the completed self-check is skipped (Story 6.1)', async () => {
    const installAgentCli = vi.fn(async () => ({ ok: true, installed: ['claude-code'], skipped: [], failed: [] }));
    const runSelfCheck = vi.fn(async () => greenSummary);
    const engine = new Engine(config(), new EngineEmitter(), deps({ installAgentCli, runSelfCheck }));

    const first = await engine.start();
    expect(first.ok).toBe(true);
    expect(installAgentCli).toHaveBeenCalledOnce();
    expect(runSelfCheck).toHaveBeenCalledOnce();

    // A Story-6.2 "Retry install" re-attempts only this row; already-completed self-check is skipped.
    const retried = await engine.retry(StepId.InstallAgentCli);
    expect(retried.ok).toBe(true);
    expect(installAgentCli).toHaveBeenCalledTimes(2); // re-run
    expect(runSelfCheck).toHaveBeenCalledOnce(); // NOT re-run (already completed)
  });

  it('retry of a STILL-failing agent-CLI install stays non-fatal (ok:true) and re-emits Failed (Story 6.1)', async () => {
    // Retry is best-effort: even if the CLI fails AGAIN, the run stays ok — the failure surfaces
    // only as a Failed event (a Story-6.2 UI reads events, not `ok`, for per-CLI status).
    let attempt = 0;
    const installAgentCli = vi.fn(async (opts: { emitter: EngineEmitter }) => {
      attempt++;
      opts.emitter.emit({
        id: `cli-fail-${attempt}`,
        phase: Phase.Install,
        step: StepId.InstallAgentCli,
        status: Status.Failed,
        humanMessage: 'cli install failed',
        level: 'error',
        timestamp: '2026-07-02T00:00:00.000Z',
      });
      return { ok: true, installed: [], skipped: [], failed: ['claude-code'] };
    });
    const runSelfCheck = vi.fn(async () => greenSummary);
    const emitter = new EngineEmitter();
    const events: KindlingEvent[] = [];
    emitter.on((e) => events.push(e));
    const engine = new Engine(config(), emitter, deps({ installAgentCli, runSelfCheck }));

    expect((await engine.start()).ok).toBe(true);
    expect((await engine.retry(StepId.InstallAgentCli)).ok).toBe(true); // still non-fatal on repeat
    expect(installAgentCli).toHaveBeenCalledTimes(2);
    expect(runSelfCheck).toHaveBeenCalledOnce(); // self-check not re-run
    const failedCli = events.filter((e) => e.step === StepId.InstallAgentCli && e.status === Status.Failed);
    expect(failedCli).toHaveLength(2); // original + retry, both surfaced
  });

  it('threads the requested eligible CLI descriptors to runSelfCheck (Story 6.2)', async () => {
    const runSelfCheck = vi.fn(async (_opts: SelfCheckOptions) => greenSummary);
    const cfg: Config = { ...config(), installCli: ['claude-code', 'vscode'] }; // vscode is scope-guarded out
    const engine = new Engine(cfg, new EngineEmitter(), deps({ runSelfCheck }));
    await engine.start();

    expect(runSelfCheck).toHaveBeenCalledOnce();
    const opts = runSelfCheck.mock.calls[0][0];
    expect(opts.agentClis).toEqual([
      { id: 'claude-code', pkg: '@anthropic-ai/claude-code', bin: 'claude', name: 'Claude Code' },
    ]);
    // projectDir is threaded so the self-check can read the manifest's installed version (Story 7.1 / FR26).
    expect(opts.projectDir).toBe(cfg.projectDir);
  });

  it('threads an empty descriptor list when no CLI was requested (Story 6.2)', async () => {
    const runSelfCheck = vi.fn(async (_opts: SelfCheckOptions) => greenSummary);
    const engine = new Engine(config(), new EngineEmitter(), deps({ runSelfCheck })); // config() has no installCli
    await engine.start();
    expect(runSelfCheck.mock.calls[0][0].agentClis).toEqual([]);
  });

  it('treats a blocked scaffold as a failure (no install)', async () => {
    const d = deps({ scaffold: vi.fn(async () => 'blocked' as const) });
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(StepId.ScaffoldGitInit);
    expect(d.installFramework).not.toHaveBeenCalled();
  });

  it('writes a failure log and stops when a step throws', async () => {
    const d = deps({
      scaffold: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const engine = new Engine(config(), new EngineEmitter(), d);
    const result = await engine.start();

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(StepId.ScaffoldGitInit);
    expect(d.writeFailureLog).toHaveBeenCalledOnce();
  });

  it('is single-flight: an overlapping run is rejected', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const scaffold = vi.fn(async () => {
      await gate;
      return 'created' as const;
    });
    const engine = new Engine(config(), new EngineEmitter(), deps({ scaffold }));
    const first = engine.start();
    await expect(engine.start()).rejects.toThrow(/already running/);
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it('retry of an already-completed step re-runs it', async () => {
    const scaffold = vi.fn(async () => 'created' as const);
    const engine = new Engine(config(), new EngineEmitter(), deps({ scaffold }));
    await engine.start();
    expect(scaffold).toHaveBeenCalledOnce();
    await engine.retry(StepId.ScaffoldGitInit);
    expect(scaffold).toHaveBeenCalledTimes(2); // cleared from completed, re-run
  });

  it('passes the failure event log (including the Failed event) to writeFailureLog', async () => {
    let captured: FailureLogEntry | undefined;
    const failingInstall = vi.fn(async (ctx: FrameworkContext) => {
      ctx.emitter.emit({
        id: 'x',
        phase: Phase.Install,
        step: StepId.InstallFramework,
        status: Status.Failed,
        humanMessage: 'install failed',
        level: 'error',
        timestamp: '2026-05-29T00:00:00.000Z',
      });
      return { ok: false, version: '6.1.2' };
    });
    const writeFailureLog = vi.fn(async (entry: FailureLogEntry) => {
      captured = entry;
      return '/tmp/report.log';
    });
    const engine = new Engine(
      config(),
      new EngineEmitter(),
      deps({ installFramework: failingInstall, writeFailureLog }),
    );
    await engine.start();

    expect(captured?.step).toBe(StepId.InstallFramework);
    expect(captured?.events.some((e) => e.status === Status.Failed)).toBe(true);
  });
});
