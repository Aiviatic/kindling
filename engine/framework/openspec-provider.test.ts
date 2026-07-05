import { describe, it, expect, vi } from 'vitest';
import { openspecProvider, openspecTools, OPENSPEC_VERSION } from './openspec-provider';
import { EngineEmitter } from '../emitter';
import { Status, ErrorCode, type KindlingEvent } from '../contract';
import type { Config } from '../contract';
import type { ExecResult } from '../exec';

const config = (over: Partial<Config> = {}): Config => ({
  projectDir: '/tmp/kindling-openspec-test',
  projectName: 'proj',
  ides: ['claude-code'],
  modules: [],
  pins: { node: '24', bmad: '6.9.0', kindling: '0.0.0' },
  framework: 'openspec',
  ...over,
});

const ok = async (_cmd: string, _args: string[]): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' });

function collect(emitter: EngineEmitter): KindlingEvent[] {
  const events: KindlingEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

describe('openspecTools (id mapping)', () => {
  it("maps Kindling ids to OpenSpec's --tools ids (claude-code → claude)", () => {
    expect(openspecTools(['claude-code', 'codex', 'cursor'])).toBe('claude,codex,cursor');
  });
  it('drops unsupported ids and de-dupes', () => {
    expect(openspecTools(['claude-code', 'goose', 'adal', 'claude-code'])).toBe('claude');
  });
  it('falls back to "none" when nothing maps', () => {
    expect(openspecTools(['goose', 'adal'])).toBe('none');
    expect(openspecTools([])).toBe('none');
  });
});

describe('openspecProvider', () => {
  it('runs the pinned npx init with --ignore-scripts + mapped tools, emits working→done', async () => {
    const exec = vi.fn(ok);
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const r = await openspecProvider.install({
      config: config({ ides: ['claude-code', 'codex'] }),
      emitter,
      exec,
      runner: { command: 'npx', prefixArgs: [] },
    });
    expect(r).toEqual({ ok: true, version: OPENSPEC_VERSION });
    const [cmd, args] = exec.mock.calls[0];
    expect(cmd).toBe('npx');
    expect(args[0]).toBe('--ignore-scripts'); // supply-chain: no lifecycle scripts on the dep tree
    expect(args[1]).toBe(`@fission-ai/openspec@${OPENSPEC_VERSION}`);
    expect(args).toContain('init');
    expect(args).toContain('/tmp/kindling-openspec-test');
    expect(args[args.indexOf('--tools') + 1]).toBe('claude,codex');
    expect(args).toContain('--force');
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
  });

  it('threads the Windows runner (node + npx-cli.js) as the exec argv prefix', async () => {
    const exec = vi.fn(ok);
    await openspecProvider.install({
      config: config(),
      emitter: new EngineEmitter(),
      exec,
      runner: { command: '/node', prefixArgs: ['/npx-cli.js'] },
    });
    const [cmd, args] = exec.mock.calls[0];
    expect(cmd).toBe('/node');
    expect(args[0]).toBe('/npx-cli.js');
    expect(args[1]).toBe('--ignore-scripts');
    expect(args[2]).toBe(`@fission-ai/openspec@${OPENSPEC_VERSION}`);
  });

  it('returns ok:false and emits a Failed FrameworkInstallFailed on a non-zero exit', async () => {
    const exec = vi.fn(async (): Promise<ExecResult> => ({ code: 1, stdout: '', stderr: 'boom' }));
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const r = await openspecProvider.install({
      config: config(),
      emitter,
      exec,
      runner: { command: 'npx', prefixArgs: [] },
    });
    expect(r).toEqual({ ok: false });
    const failed = events.find((e) => e.status === Status.Failed);
    expect(failed?.errorCode).toBe(ErrorCode.FrameworkInstallFailed);
    expect(failed?.humanMessage).toContain('boom');
  });

  it('summaryFacts reports the pinned OpenSpec version', async () => {
    const facts = await openspecProvider.summaryFacts({ projectDir: '/x', pins: config().pins });
    expect(facts).toEqual({ label: 'OpenSpec', version: OPENSPEC_VERSION, note: 'a stable, tested version' });
  });
});
