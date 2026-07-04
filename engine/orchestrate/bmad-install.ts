import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exec as defaultExec, type ExecResult } from '../exec';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, ErrorCode, type Level, type Config } from '../contract';
import { stepMessages, errorMessages, installMessages } from '../messages';
import { composeInstallArgs } from './flags';

// Default "is BMad already installed here?" check — a `_bmad` DIRECTORY under the project (the
// marker `bmad-method install` writes). Require it to be a directory, not just any fs entry, so
// a stray `_bmad` file/symlink from another tool can't trigger a spurious --action update.
export async function defaultBmadInstalled(projectDir: string): Promise<boolean> {
  try {
    return (await stat(join(projectDir, '_bmad'))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Result of an install attempt.
 *
 * Failure contract: a **non-zero exit** resolves with `{ ok: false }` (the caller must check
 * `.ok`); a **spawn error** (e.g. npx not found) emits `Failed` then *throws*. Either way a
 * terminal `Failed` event is emitted exactly once. (Note: `scaffold()` throws on a non-zero
 * exit — the orchestrator story must reconcile these two error models; see deferred-work.md.)
 *
 * Version target (Story 7.1 / FR27): `config.bmadTarget` selects the npx package tag. `'pinned'`
 * (default) is byte-for-byte the historical behavior — `bmad-method@<pins.bmad>` with
 * `--action install` (fresh) vs `--action update` (existing `_bmad`, Story 2.7). `'latest'` is the
 * explicit opt-in update variant — `bmad-method@latest` with `--action update` FORCED regardless of
 * the `_bmad`-present detection. `bmadVersion` in the result is the resolved TAG (`<pins.bmad>` or
 * the literal `'latest'`); the concrete version `@latest` resolves to is picked up by the
 * self-check's manifest read (FR26), not here.
 */
export interface BmadInstallResult {
  ok: boolean;
  bmadVersion: string;
}

export interface BmadInstallOptions {
  config: Config;
  emitter: EngineEmitter;
  /** Injectable subprocess runner (tests pass a fake; never runs a real install). */
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  /**
   * Command used to invoke npx. Default 'npx' (macOS/Linux dev). On Windows this must be
   * the provisioned `node` + npm-cli.js (Epic 2) since `npx.cmd` can't spawn with shell:false
   * — see deferred-work.md.
   */
  npxCommand?: string;
  /**
   * Args prepended to the exec argv, before the `bmad-method@<tag>` spec. Default `[]`. On Windows
   * `npxCommand` is the provisioned `node` and this carries `[npxCliPath(node)]`, so the effective
   * invocation is `node npx-cli.js bmad-method@<tag> …` — the shell:false-safe equivalent of the
   * bare `npx.cmd` shim (which spawn can't find by bare name on Windows). Empty on macOS/Linux.
   */
  npxPrefixArgs?: string[];
  /**
   * Idempotent re-run (2.7): is BMad already installed in this project? When true, the install
   * runs with `--action update` (update in place) instead of a fresh install. Default detects a
   * `_bmad` dir under config.projectDir; injectable for tests.
   */
  bmadAlreadyInstalled?: (projectDir: string) => Promise<boolean>;
  now?: () => string;
}

// Runs `npx bmad-method@<pin> install …` with composed flags, emitting install.bmad events.
// Never reports success on failure (FR10): non-zero exit or spawn error → Failed.
export async function runBmadInstall(opts: BmadInstallOptions): Promise<BmadInstallResult> {
  const exec = opts.exec ?? defaultExec;
  const npx = opts.npxCommand ?? 'npx';
  const now = opts.now ?? (() => new Date().toISOString());
  // Version target (7.1): default 'pinned'. 'latest' resolves the tag to `latest` and forces an
  // update; 'pinned' keeps the historical `<pins.bmad>` tag + install/update-by-detection behavior.
  const bmadTarget = opts.config.bmadTarget ?? 'pinned';
  const versionTag = bmadTarget === 'latest' ? 'latest' : opts.config.pins.bmad;

  const emit = (
    status: Status,
    humanMessage: string,
    level: Level = 'info',
    errorCode?: ErrorCode,
  ): void => {
    opts.emitter.emit({
      id: randomUUID(),
      phase: Phase.Install,
      step: StepId.InstallBmad,
      status,
      humanMessage,
      level,
      timestamp: now(),
      errorCode,
    });
  };

  emit(Status.Working, stepMessages[StepId.InstallBmad]);

  // Fail fast with a clear message if the cohort BMad version was never frozen (don't ship a
  // cryptic `npx bmad-method@0.0.0-TODO` 404). Pinned-target concern only — `latest` never
  // contains TODO.
  if (bmadTarget === 'pinned' && versionTag.includes('TODO')) {
    emit(Status.Failed, installMessages.notPinned, 'error', ErrorCode.BmadInstallFailed);
    return { ok: false, bmadVersion: versionTag };
  }

  let result: ExecResult;
  try {
    // Action selection: the `latest` opt-in FORCES `--action update` (you're deliberately moving
    // off the frozen pin). The default `pinned` path keeps 2.7 re-run idempotency: if BMad is
    // already installed here, update in place rather than a fresh install that would error/duplicate.
    let action: 'install' | 'update';
    if (bmadTarget === 'latest') {
      action = 'update';
    } else {
      const alreadyInstalled = opts.bmadAlreadyInstalled ?? defaultBmadInstalled;
      action = (await alreadyInstalled(opts.config.projectDir)) ? 'update' : 'install';
    }
    // Compose inside the try so a composition error (e.g. comma in a module name) still
    // reaches a terminal Failed event.
    // On Windows npxPrefixArgs is `[npxCliPath(node)]` and npx is the provisioned node, so the
    // effective invocation is `node npx-cli.js bmad-method@<tag> …` (shell:false-safe). Empty elsewhere.
    const args = [
      ...(opts.npxPrefixArgs ?? []),
      `bmad-method@${versionTag}`,
      ...composeInstallArgs(opts.config, action),
    ];
    result = await exec(npx, args);
  } catch (err) {
    // spawn error (e.g. npx not found) or composition error — surface a terminal failure with the
    // real error message appended (so a Windows ENOENT isn't a blank "details below"), then rethrow.
    const detail = err instanceof Error ? err.message : String(err);
    emit(
      Status.Failed,
      `${errorMessages[ErrorCode.BmadInstallFailed]} (${detail})`,
      'error',
      ErrorCode.BmadInstallFailed,
    );
    throw err;
  }

  if (result.code !== 0) {
    // Surface a truncated tail of the child's stderr (fall back to stdout) so the failure carries
    // the actual npx/bmad error instead of a generic message with nothing behind it.
    const raw = (result.stderr.trim() ? result.stderr : result.stdout).trim();
    const detail = raw.slice(-600).trim();
    const humanMessage = detail
      ? `${errorMessages[ErrorCode.BmadInstallFailed]}\n\nDetails:\n${detail}`
      : errorMessages[ErrorCode.BmadInstallFailed];
    emit(Status.Failed, humanMessage, 'error', ErrorCode.BmadInstallFailed);
    return { ok: false, bmadVersion: versionTag };
  }

  emit(Status.Done, installMessages.done(versionTag));
  return { ok: true, bmadVersion: versionTag };
}
