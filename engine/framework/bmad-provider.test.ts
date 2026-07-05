import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bmadProvider } from './bmad-provider';
import { EngineEmitter } from '../emitter';
import type { Config } from '../contract';
import type { ExecResult } from '../exec';

const config: Config = {
  projectDir: '/tmp/kindling-provider-test',
  projectName: 'proj',
  ides: ['claude-code'],
  modules: ['bmm'],
  pins: { node: '24', bmad: '6.9.0', kindling: '0.0.0' },
};

const ok = async (_cmd: string, _args: string[]): Promise<ExecResult> => ({
  code: 0,
  stdout: '',
  stderr: '',
});

describe('bmadProvider', () => {
  it('runs the pinned npx install and returns { ok, version }', async () => {
    const exec = vi.fn(ok);
    const r = await bmadProvider.install({
      config,
      emitter: new EngineEmitter(),
      exec,
      runner: { command: 'npx', prefixArgs: [] },
    });
    expect(r).toEqual({ ok: true, version: '6.9.0' });
    const [cmd, args] = exec.mock.calls[0];
    expect(cmd).toBe('npx');
    expect(args[0]).toBe('--ignore-scripts'); // supply-chain: no lifecycle scripts on the dep tree
    expect(args[1]).toBe('bmad-method@6.9.0');
    expect(args).toContain('install');
  });

  it('threads the Windows runner (node + npx-cli.js) as the exec argv prefix', async () => {
    const exec = vi.fn(ok);
    await bmadProvider.install({
      config,
      emitter: new EngineEmitter(),
      exec,
      runner: { command: '/node', prefixArgs: ['/npx-cli.js'] },
    });
    const [cmd, args] = exec.mock.calls[0];
    expect(cmd).toBe('/node');
    expect(args[0]).toBe('/npx-cli.js');
    expect(args[1]).toBe('--ignore-scripts');
    expect(args[2]).toBe('bmad-method@6.9.0');
  });

  it('returns ok:false on a non-zero install exit', async () => {
    const exec = vi.fn(
      async (_cmd: string, _args: string[]): Promise<ExecResult> => ({ code: 1, stdout: '', stderr: 'boom' }),
    );
    const r = await bmadProvider.install({
      config,
      emitter: new EngineEmitter(),
      exec,
      runner: { command: 'npx', prefixArgs: [] },
    });
    expect(r.ok).toBe(false);
  });
});

describe('bmadProvider.summaryFacts (honest version chip)', () => {
  it('falls back to the pinned version + stable note when no manifest is on disk', async () => {
    const facts = await bmadProvider.summaryFacts({ projectDir: '/nonexistent/kindling-none', pins: config.pins });
    expect(facts).toEqual({ label: 'BMad Method', version: config.pins.bmad, note: 'a stable, tested version' });
  });

  it('reports the ACTUAL installed version + "updated to latest" when the manifest differs from the pin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kindling-bmad-'));
    try {
      await mkdir(join(dir, '_bmad', '_config'), { recursive: true });
      await writeFile(join(dir, '_bmad', '_config', 'manifest.yaml'), 'installation:\n  version: 6.10.0\n');
      const facts = await bmadProvider.summaryFacts({ projectDir: dir, pins: config.pins });
      expect(facts).toEqual({ label: 'BMad Method', version: '6.10.0', note: 'updated to latest' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
