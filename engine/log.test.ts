import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { writeFailureLog, defaultLogDir } from './log';
import { Phase, StepId, Status, type KindlingEvent } from './contract';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'kindling-log-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const events: KindlingEvent[] = [
  {
    id: '1',
    phase: Phase.Install,
    step: StepId.InstallFramework,
    status: Status.Failed,
    humanMessage: 'install failed',
    level: 'error',
    timestamp: '2026-05-29T00:00:00.000Z',
  },
];

describe('writeFailureLog', () => {
  it('writes a report file and returns its path', async () => {
    const path = await writeFailureLog(
      { step: StepId.InstallFramework, error: 'boom\n  at x', events },
      { dir: tmp, now: () => '2026-05-29T01:02:03.456Z' },
    );
    const entries = await readdir(tmp);
    expect(entries).toHaveLength(1);
    expect(path).toContain('kindling-report-');
    // Colons are stripped from the FILENAME (Windows forbids ':' in filenames). Assert on the
    // basename, not the full path — on Windows the dir legitimately contains a drive-letter colon
    // (C:\Users\...\Temp\...).
    expect(basename(path)).not.toContain(':');

    const body = await readFile(path, 'utf8');
    expect(body).toContain('Failed step: install.framework');
    expect(body).toContain('boom');
    expect(body).toContain('install failed'); // event humanMessage included
  });

  it('does not leak the process environment (no secrets)', async () => {
    process.env.KINDLING_TEST_SECRET = 'super-secret-value';
    try {
      const path = await writeFailureLog({ step: StepId.InstallFramework, error: 'e', events }, { dir: tmp });
      const body = await readFile(path, 'utf8');
      expect(body).not.toContain('super-secret-value');
    } finally {
      delete process.env.KINDLING_TEST_SECRET;
    }
  });

  it('defaultLogDir points under a kindling logs folder', () => {
    expect(defaultLogDir()).toMatch(/kindling[\\/]logs$/);
  });
});
