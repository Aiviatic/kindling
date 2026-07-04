import { describe, it, expect, vi } from 'vitest';
import { EngineEmitter } from '../engine/emitter';
import { Phase, StepId, Status, type Config, type KindlingEvent } from '../engine/contract';
import { runServerMode } from './server-mode';
import type { RunningServer, StartServerOptions } from '../server/server';

const config: Config = {
  projectDir: '/tmp/proj',
  projectName: 'proj',
  ides: ['claude-code'],
  modules: ['bmm'],
  pins: { node: '24', bmad: '6.9.0', kindling: '0.0.0' },
};

function summaryEvent(): KindlingEvent {
  return {
    id: 'done',
    phase: Phase.Finalize,
    step: StepId.FinalizeSelfCheck,
    status: Status.Done,
    humanMessage: 'ready',
    level: 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
    summaryJson: '{"schemaVersion":3,"success":true,"cli":[]}',
  };
}

function harness() {
  const emitter = new EngineEmitter();
  let captured: StartServerOptions | undefined;
  const server: RunningServer = {
    server: {} as never,
    url: 'http://127.0.0.1:5000/',
    port: 5000,
    close: vi.fn().mockResolvedValue(undefined),
  };
  const engine = {
    start: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    retry: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    startServer: vi.fn(async (opts: StartServerOptions) => {
      captured = opts;
      return server;
    }),
    openBrowser: vi.fn(),
    writeWelcome: vi.fn().mockResolvedValue('/tmp/proj/welcome.html'),
    engineFactory: vi.fn(() => engine),
    exit: vi.fn(),
    write: vi.fn(),
    uiDir: '/dist/ui',
    // Prefs seams faked so no test touches the real ~/.kindling/prefs.json.
    readLastProjectFolder: vi.fn(async () => null as string | null),
    saveLastProjectFolder: vi.fn(async () => {}),
  };
  return { emitter, server, engine, deps, opts: () => captured! };
}

describe('runServerMode', () => {
  it('opens the browser and serves the built UI', async () => {
    const { emitter, deps, opts } = harness();
    await runServerMode(emitter, deps);
    expect(deps.openBrowser).toHaveBeenCalledWith('http://127.0.0.1:5000/', expect.anything());
    expect(opts().uiDir).toBe('/dist/ui');
  });

  it('builds the engine from the POSTed config on /start and drives cancel/retry', async () => {
    const { emitter, engine, deps, opts } = harness();
    await runServerMode(emitter, deps);
    void opts().commands.start(config);
    expect(deps.engineFactory).toHaveBeenCalledWith(config, emitter);
    expect(engine.start).toHaveBeenCalledWith(config);
    opts().commands.cancel();
    expect(engine.cancel).toHaveBeenCalled();
    void opts().commands.retry(StepId.InstallMethod);
    expect(engine.retry).toHaveBeenCalledWith(StepId.InstallMethod);
  });

  it('on render-ack writes the static welcome.html, closes the server, and exits (success only)', async () => {
    const { emitter, server, deps, opts } = harness();
    await runServerMode(emitter, deps);
    void opts().commands.start(config); // sets lastConfig
    emitter.emit(summaryEvent()); // the success summary is in the backlog

    await opts().onWelcomeAck?.();
    // microtask for the async finish()
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.writeWelcome).toHaveBeenCalledWith('/tmp/proj', {
      bmadVersion: '6.9.0',
      summaryJson: '{"schemaVersion":3,"success":true,"cli":[]}',
    });
    expect(server.close).toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('expands a leading ~ in projectDir so writeWelcome gets a real path (regression: default dir crash)', async () => {
    const { emitter, deps, opts } = harness();
    await runServerMode(emitter, deps);
    void opts().commands.start({ ...config, projectDir: '~/kindling-project' }); // the UI default
    emitter.emit(summaryEvent());
    await opts().onWelcomeAck?.();
    await new Promise((r) => setTimeout(r, 0));
    const dir = vi.mocked(deps.writeWelcome).mock.calls[0]?.[0];
    expect(dir).not.toMatch(/^~/); // NOT the literal '~/…' (which would ENOENT and crash finish())
    expect(dir).toMatch(/[\\/]kindling-project$/);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('onQuit tears down the server and exits(0) without running an install', async () => {
    const { emitter, server, deps, opts } = harness();
    await runServerMode(emitter, deps);
    opts().onQuit?.();
    await new Promise((r) => setTimeout(r, 0)); // let the async close().then(exit) settle
    expect(server.close).toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.engineFactory).not.toHaveBeenCalled(); // nothing was installed
  });

  it('saves the UNexpanded projects folder on /start and wires GET /prefs to the read seam', async () => {
    const { emitter, deps, opts } = harness();
    await runServerMode(emitter, deps);
    void opts().commands.start({ ...config, projectDir: '~/My Projects/proj' });
    // Saved as typed (with the ~), so the next run's prefill round-trips verbatim.
    expect(deps.saveLastProjectFolder).toHaveBeenCalledWith('~/My Projects');
    await expect(opts().getLastProjectFolder?.()).resolves.toBeNull();
    expect(deps.readLastProjectFolder).toHaveBeenCalled();
  });

  it('does not save prefs when projectDir does not end with the project name', async () => {
    const { emitter, deps, opts } = harness();
    await runServerMode(emitter, deps);
    void opts().commands.start({ ...config, projectDir: '/somewhere/else' });
    expect(deps.saveLastProjectFolder).not.toHaveBeenCalled();
  });

  it('wires commands.inspect from the injected bmadAlreadyInstalled + readInstalledBmadVersion (no real fs)', async () => {
    const { emitter, deps, opts } = harness();
    const bmadAlreadyInstalled = vi.fn(async (dir: string) => dir === '/has');
    const readInstalledBmadVersion = vi.fn(async (dir: string) => (dir === '/has' ? '6.9.0' : null));
    await runServerMode(emitter, { ...deps, bmadAlreadyInstalled, readInstalledBmadVersion });

    // both fakes hit → detected + version
    await expect(opts().commands.inspect!('/has')).resolves.toEqual({
      isKindlingProject: true,
      installedBmadVersion: '6.9.0',
    });
    // neither → neutral
    await expect(opts().commands.inspect!('/empty')).resolves.toEqual({
      isKindlingProject: false,
      installedBmadVersion: null,
    });
  });

  it('inspect reports { true, null } when the dir is present but the manifest is unreadable', async () => {
    const { emitter, deps, opts } = harness();
    const bmadAlreadyInstalled = vi.fn(async () => true);
    const readInstalledBmadVersion = vi.fn(async () => null); // drifted/unreadable manifest
    await runServerMode(emitter, { ...deps, bmadAlreadyInstalled, readInstalledBmadVersion });
    await expect(opts().commands.inspect!('/drifted')).resolves.toEqual({
      isKindlingProject: true,
      installedBmadVersion: null,
    });
  });

  it('is one-shot — a second render-ack does not write/close/exit again', async () => {
    const { emitter, server, deps, opts } = harness();
    await runServerMode(emitter, deps);
    void opts().commands.start(config);
    emitter.emit(summaryEvent());
    await opts().onWelcomeAck?.();
    await opts().onWelcomeAck?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });
});
