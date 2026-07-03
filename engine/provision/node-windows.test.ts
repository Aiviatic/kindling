import { describe, it, expect, vi } from 'vitest';
import { nodeDistUrl, nodeExePath, provisionNodeWindows } from './node-windows';
import { EngineEmitter } from '../emitter';
import { Status, StepId, type KindlingEvent } from '../contract';

function collect(emitter: EngineEmitter): KindlingEvent[] {
  const events: KindlingEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

describe('nodeDistUrl / nodeExePath (pure)', () => {
  it('builds the official Windows zip URL (version normalized, arch)', () => {
    expect(nodeDistUrl('24.16.0')).toBe('https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip');
    expect(nodeDistUrl('v24.16.0', 'arm64')).toBe(
      'https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-arm64.zip',
    );
  });

  it('resolves node.exe inside the extracted dist folder', () => {
    expect(nodeExePath('C:\\app\\node', '24.16.0')).toContain('node-v24.16.0-win-x64');
    expect(nodeExePath('C:\\app\\node', '24.16.0')).toMatch(/node\.exe$/);
  });
});

describe('provisionNodeWindows (orchestration, injected download/extract)', () => {
  it('skips the download when Node is already present (alreadyOk)', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const download = vi.fn(async () => {});
    const extract = vi.fn(async () => {});

    const result = await provisionNodeWindows({
      version: '24.16.0',
      baseDir: '/tmp/node',
      emitter,
      alreadyOk: true,
      download,
      extract,
    });

    expect(result).toEqual({ ok: true, nodeExe: null });
    expect(download).not.toHaveBeenCalled();
    expect(events.map((e) => e.status)).toEqual([Status.Skipped]);
  });

  it('downloads + extracts and returns the node.exe path, emitting Working→Done', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const download = vi.fn(async () => {});
    const extract = vi.fn(async () => {});

    const result = await provisionNodeWindows({
      version: '24.16.0',
      baseDir: '/tmp/node',
      emitter,
      download,
      extract,
    });

    expect(download).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.nodeExe).toMatch(/node-v24\.16\.0-win-x64.*node\.exe$/);
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
    expect(events.every((e) => e.step === StepId.ProvisionNode)).toBe(true);
  });

  it('emits a terminal Failed and rethrows when download fails', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const download = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      provisionNodeWindows({ version: '24.16.0', baseDir: '/tmp/node', emitter, download, extract: vi.fn(async () => {}) }),
    ).rejects.toThrow(/network down/);
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Failed]);
  });
});
