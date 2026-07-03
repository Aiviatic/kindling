import { randomUUID } from 'node:crypto';
import { exec as defaultExec, type ExecResult } from '../exec';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, ErrorCode, type Level } from '../contract';
import { stepMessages, provisionMessages } from '../messages';

export interface ProvisionGitUnixOptions {
  platform: NodeJS.Platform;
  emitter: EngineEmitter;
  /** From 2.1 detection: Git is already present → reuse it (Skipped). */
  alreadyOk?: boolean;
  // Injectable side effects (real shell run is rehearsal-bound; tests inject these):
  /** macOS: trigger the Xcode Command Line Tools install (opens the system dialog). */
  triggerXcodeInstall?: () => Promise<void>;
  /** macOS: true once `xcode-select -p` resolves (CLT — hence Git — installed). */
  checkXcode?: () => Promise<boolean>;
  /** Linux: install Git via the distro package manager (apt primary). */
  installLinuxGit?: () => Promise<void>;
  /** Poll cadence + cap for the Xcode wait (injected so tests don't actually wait). */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  now?: () => string;
}

export interface ProvisionGitResult {
  ok: boolean;
}

function makeDefaults(exec: (cmd: string, args: string[]) => Promise<ExecResult>) {
  return {
    triggerXcodeInstall: async (): Promise<void> => {
      // `xcode-select --install` returns non-zero if the tools are already installed; that's not
      // an error for us (the alreadyOk guard covers the present case, and the poll confirms).
      await exec('xcode-select', ['--install']);
    },
    checkXcode: async (): Promise<boolean> => (await exec('xcode-select', ['-p'])).code === 0,
    installLinuxGit: async (): Promise<void> => {
      // apt primary (Debian/Ubuntu — the best-effort Linux target). `sudo -n` is non-interactive:
      // with no cached creds it fails fast (clear error) instead of hanging on a password prompt
      // we can't answer (exec's stdin is /dev/null). Real run rehearsal-bound.
      const r = await exec('sudo', ['-n', 'apt-get', 'install', '-y', 'git']);
      if (r.code !== 0) throw new Error(`apt-get install git failed (code ${r.code}): ${r.stderr.trim()}`);
    },
  };
}

/**
 * Provision Git on macOS (via the Xcode Command Line Tools) or Linux (via apt). macOS triggers
 * the CLT install early and POLLS `xcode-select -p`, emitting a Working event on every tick so the
 * un-silenceable Apple dialog never looks frozen (AC1/AC2). Git already present → Skipped (AC).
 *
 * The real `xcode-select`/apt run is validated at the dress rehearsal; here the shell effects +
 * the clock are injected and the orchestration/poll/events/skip/fail paths are unit-tested.
 */
export async function provisionGitUnix(opts: ProvisionGitUnixOptions): Promise<ProvisionGitResult> {
  const exec = opts.exec ?? defaultExec;
  const d = makeDefaults(exec);
  const triggerXcodeInstall = opts.triggerXcodeInstall ?? d.triggerXcodeInstall;
  const checkXcode = opts.checkXcode ?? d.checkXcode;
  const installLinuxGit = opts.installLinuxGit ?? d.installLinuxGit;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollIntervalMs = opts.pollIntervalMs ?? 3000;
  const maxPolls = opts.maxPolls ?? 200; // ~10 min at 3s — the dialog can be slow; never frozen
  const now = opts.now ?? (() => new Date().toISOString());
  const isMac = opts.platform === 'darwin';
  const step = isMac ? StepId.ProvisionXcodeClt : StepId.ProvisionGit;

  const emit = (
    status: Status,
    humanMessage: string,
    level: Level = 'info',
    errorCode?: ErrorCode,
  ): void => {
    opts.emitter.emit({
      id: randomUUID(),
      phase: Phase.Provision,
      step,
      status,
      humanMessage,
      level,
      timestamp: now(),
      errorCode,
    });
  };

  if (opts.alreadyOk) {
    // On macOS the row is the Xcode-CLT step, so use CLT-flavored copy (not "Git is installed").
    emit(Status.Skipped, isMac ? provisionMessages.xcodeDone : provisionMessages.gitPresent);
    return { ok: true };
  }

  if (isMac) {
    emit(Status.Working, stepMessages[StepId.ProvisionXcodeClt]); // the "dialog popped up, ~5 min" copy
    try {
      await triggerXcodeInstall();
    } catch (err) {
      emit(Status.Failed, provisionMessages.xcodeInstallFailed, 'error', ErrorCode.ExecFailed);
      throw err;
    }
    // Poll until the CLT resolve — emitting Working each tick so the UI never looks frozen.
    for (let i = 0; i < maxPolls; i++) {
      if (await checkXcode()) {
        emit(Status.Done, provisionMessages.xcodeDone);
        return { ok: true };
      }
      emit(Status.Working, provisionMessages.xcodeWaiting);
      if (i < maxPolls - 1) await sleep(pollIntervalMs); // no wasted wait before the timeout
    }
    // Soft timeout — not a throw; the dialog may still be open, so Retry re-polls.
    emit(Status.Failed, provisionMessages.xcodeTimeout, 'error', ErrorCode.ExecFailed);
    return { ok: false };
  }

  // Linux: install via the distro package manager.
  emit(Status.Working, stepMessages[StepId.ProvisionGit]);
  try {
    await installLinuxGit();
  } catch (err) {
    emit(Status.Failed, provisionMessages.gitInstallFailed, 'error', ErrorCode.ExecFailed);
    throw err;
  }
  emit(Status.Done, provisionMessages.gitInstalled);
  return { ok: true };
}
