import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from './scaffold';
import { exec } from '../exec';
import { EngineEmitter } from '../emitter';
import { Status, StepId, type KindlingEvent } from '../contract';

async function hasHeadCommit(dir: string): Promise<boolean> {
  const r = await exec('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD']);
  return r.code === 0;
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'kindling-scaffold-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function collect(emitter: EngineEmitter): KindlingEvent[] {
  const events: KindlingEvent[] = [];
  emitter.on((e) => events.push(e));
  return events;
}

describe('scaffold', () => {
  it('creates a new project: dir + git repo + first commit + marker, with events', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const projectDir = join(tmp, 'my-project');

    const outcome = await scaffold({ projectDir, projectName: 'my-project', emitter });

    expect(outcome).toBe('created');
    const entries = await readdir(projectDir);
    expect(entries).toContain('.git');
    expect(entries).toContain('.kindling.json');
    const marker = JSON.parse(await readFile(join(projectDir, '.kindling.json'), 'utf8'));
    expect(marker.scaffoldedBy).toBe('kindling');
    expect(await hasHeadCommit(projectDir)).toBe(true); // an initial commit was actually made
    // events: working → done on the scaffold step
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
    expect(events.every((e) => e.step === StepId.ScaffoldGitInit)).toBe(true);
  });

  it('is idempotent: re-running an already-scaffolded project is skipped', async () => {
    const projectDir = join(tmp, 'proj');
    await scaffold({ projectDir, projectName: 'proj', emitter: new EngineEmitter() });

    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const outcome = await scaffold({ projectDir, projectName: 'proj', emitter });

    expect(outcome).toBe('skipped');
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe(Status.Skipped);
  });

  it('blocks (no changes) when the target holds pre-existing non-Kindling files', async () => {
    const projectDir = join(tmp, 'mine');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'notes.txt'), 'my stuff');

    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const outcome = await scaffold({ projectDir, projectName: 'mine', emitter });

    expect(outcome).toBe('blocked');
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe(Status.Failed);
    // no destructive action: no git repo created
    const entries = await readdir(projectDir);
    expect(entries).not.toContain('.git');
    expect(entries).toContain('notes.txt');
  });

  it("resumes Kindling's own incomplete scaffold (marker present, no commit)", async () => {
    const projectDir = join(tmp, 'partial');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, '.kindling.json'), JSON.stringify({ scaffoldedBy: 'kindling' }));

    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const outcome = await scaffold({ projectDir, projectName: 'partial', emitter });

    expect(outcome).toBe('resumed');
    const entries = await readdir(projectDir);
    expect(entries).toContain('.git');
    expect(await hasHeadCommit(projectDir)).toBe(true); // resume completed the commit
    expect(events.map((e) => e.status)).toEqual([Status.Working, Status.Done]);
  });

  it('treats a folder containing only OS cruft (.DS_Store) as empty, not blocked', async () => {
    const projectDir = join(tmp, 'macfolder');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, '.DS_Store'), '');

    const outcome = await scaffold({ projectDir, projectName: 'macfolder', emitter: new EngineEmitter() });
    expect(outcome).toBe('created');
    expect(await hasHeadCommit(projectDir)).toBe(true);
  });

  // POSIX-only: the fake-old-git wrapper is a `#!/bin/sh` script, which Windows can't spawn
  // (ENOENT). The fallback itself is platform-independent TS, exercised on the macOS/Ubuntu CI legs.
  it.skipIf(process.platform === 'win32')(
    'falls back to plain init + symbolic-ref on old git (< 2.28, no `init -b`) and still lands on main',
    async () => {
    // A wrapper that mimics git < 2.28 — `init -b` is an unknown switch — and delegates
    // everything else to the real git, so the fallback path actually executes.
    const oldGit = join(tmp, 'old-git');
    await writeFile(
      oldGit,
      '#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "-b" ]; then echo "error: unknown switch \\`b\'" >&2; exit 129; fi\ndone\nexec git "$@"\n',
      { mode: 0o755 },
    );
    const emitter = new EngineEmitter();
    const projectDir = join(tmp, 'old-git-project');

    const outcome = await scaffold({ projectDir, projectName: 'old-git-project', emitter, git: oldGit });

    expect(outcome).toBe('created');
    expect(await hasHeadCommit(projectDir)).toBe(true);
    const branch = await exec('git', ['-C', projectDir, 'symbolic-ref', '--short', 'HEAD']);
    expect(branch.stdout.trim()).toBe('main'); // the fallback produced the same end state
    },
  );

  it('emits a terminal failed event (no dangling working) when git is unavailable', async () => {
    const emitter = new EngineEmitter();
    const events = collect(emitter);
    const projectDir = join(tmp, 'fail');

    await expect(
      scaffold({ projectDir, projectName: 'fail', emitter, git: join(tmp, 'no-such-git-binary') }),
    ).rejects.toBeTruthy();

    const statuses = events.map((e) => e.status);
    expect(statuses[0]).toBe(Status.Working);
    expect(statuses[statuses.length - 1]).toBe(Status.Failed); // step reaches a terminal state
  });
});
