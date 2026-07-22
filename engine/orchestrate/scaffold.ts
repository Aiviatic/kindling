import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exec } from '../exec';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, ErrorCode, type Level } from '../contract';
import { stepMessages, scaffoldMessages } from '../messages';

const MARKER = '.kindling.json';

// OS metadata files that don't make a directory "non-empty" from the user's perspective.
const OS_CRUFT = new Set(['.DS_Store', 'Thumbs.db']);

export type ScaffoldOutcome = 'created' | 'resumed' | 'skipped' | 'blocked';

export interface ScaffoldOptions {
  projectDir: string;
  projectName: string;
  emitter: EngineEmitter;
  /** Absolute path to the provisioned git (Epic 2); defaults to PATH lookup. */
  git?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

// A dir counts as "Kindling's own" (resumable, not a user project) if it holds only the
// marker, a .git directory, and/or OS metadata files.
function isTrivial(entry: string): boolean {
  return entry === MARKER || entry === '.git' || OS_CRUFT.has(entry);
}

export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldOutcome> {
  const git = opts.git ?? 'git';
  const now = opts.now ?? (() => new Date().toISOString());

  const emit = (
    status: Status,
    humanMessage: string,
    level: Level = 'info',
    errorCode?: ErrorCode,
  ): void => {
    opts.emitter.emit({
      id: randomUUID(),
      phase: Phase.Scaffold,
      step: StepId.ScaffoldGitInit,
      status,
      humanMessage,
      level,
      timestamp: now(),
      errorCode,
    });
  };

  // Emit Working, do the work, emit a terminal Done — or emit Failed and rethrow so the step
  // always reaches a terminal status (the Epic 3 UI folds events into a per-step state machine).
  const doInit = async (): Promise<void> => {
    emit(Status.Working, stepMessages[StepId.ScaffoldGitInit]);
    try {
      await mkdir(opts.projectDir, { recursive: true });
      await initRepo(git, opts);
    } catch (err) {
      emit(Status.Failed, scaffoldMessages.failed, 'error', ErrorCode.ExecFailed);
      throw err;
    }
    emit(Status.Done, scaffoldMessages.done);
  };

  const entries = await readDirSafe(opts.projectDir);

  if (entries !== null) {
    const hasMarker = entries.includes(MARKER);
    const foreign = entries.filter((e) => !isTrivial(e));

    // Pre-existing, non-Kindling project: refuse to touch it (FR9 safety).
    if (!hasMarker && foreign.length > 0) {
      emit(Status.Failed, scaffoldMessages.blocked, 'error', ErrorCode.ProjectConflict);
      return 'blocked';
    }
    // Already fully scaffolded by Kindling → idempotent skip.
    if (hasMarker && (await hasCommit(git, opts.projectDir))) {
      emit(Status.Skipped, scaffoldMessages.skipped);
      return 'skipped';
    }
    // Marker present (or trivially-empty dir) but no commit yet → (re)build the repo.
    await doInit();
    return hasMarker ? 'resumed' : 'created';
  }

  // Fresh: directory does not exist (mkdir happens inside doInit).
  await doInit();
  return 'created';
}

async function initRepo(git: string, opts: ScaffoldOptions): Promise<void> {
  try {
    await run(git, ['-C', opts.projectDir, 'init', '-b', 'main']);
  } catch {
    // `init -b` needs git ≥ 2.28 (2020). An older distro git (e.g. apt on an EOL Debian) still
    // works: plain init, then point HEAD at main before the first commit — same end state.
    await run(git, ['-C', opts.projectDir, 'init']);
    await run(git, ['-C', opts.projectDir, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  }
  await writeFile(
    join(opts.projectDir, MARKER),
    JSON.stringify({ scaffoldedBy: 'kindling', project: opts.projectName }, null, 2) + '\n',
  );
  await run(git, ['-C', opts.projectDir, 'add', '-A']);
  // This is Kindling's own initial commit: set identity inline (works without global git config),
  // and disable GPG signing + user hooks so a developer's global config can't break setup.
  await run(git, [
    '-C',
    opts.projectDir,
    '-c',
    'user.name=Kindling',
    '-c',
    'user.email=kindling@local',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=',
    'commit',
    '-m',
    'Initial commit',
  ]);
}

async function hasCommit(git: string, dir: string): Promise<boolean> {
  try {
    const r = await exec(git, ['-C', dir, 'rev-parse', '--verify', 'HEAD']);
    return r.code === 0;
  } catch {
    return false;
  }
}

async function run(git: string, args: string[]): Promise<void> {
  const r = await exec(git, args);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (code ${r.code}): ${r.stderr.trim()}`);
  }
}

// readdir that returns null when the directory does not exist (vs. throwing).
async function readDirSafe(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
