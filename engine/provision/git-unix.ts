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

/** Thrown when no supported Linux package manager exists — surfaced with its own copy (the
 *  generic "may need permission" message would misdiagnose a Fedora/Arch box as a sudo problem). */
export class NoPackageManagerError extends Error {
  constructor(tried: string[]) {
    super(`no supported package manager found (tried ${tried.join(', ')})`);
    this.name = 'NoPackageManagerError';
  }
}

// Non-interactive `git` install per package manager. First present binary wins — detection by
// probing `<bin> --version` (exec rejects on ENOENT), never by guessing the distro name.
const LINUX_PACKAGE_MANAGERS: ReadonlyArray<{ bin: string; installArgs: string[] }> = [
  { bin: 'apt-get', installArgs: ['apt-get', 'install', '-y', 'git'] }, // Debian/Ubuntu (primary)
  { bin: 'dnf', installArgs: ['dnf', 'install', '-y', 'git'] }, // Fedora/RHEL
  { bin: 'pacman', installArgs: ['pacman', '-S', '--noconfirm', 'git'] }, // Arch
  { bin: 'zypper', installArgs: ['zypper', '--non-interactive', 'install', 'git'] }, // openSUSE
];

function makeDefaults(exec: (cmd: string, args: string[]) => Promise<ExecResult>) {
  return {
    triggerXcodeInstall: async (): Promise<void> => {
      // `xcode-select --install` returns non-zero if the tools are already installed; that's not
      // an error for us (the alreadyOk guard covers the present case, and the poll confirms).
      await exec('xcode-select', ['--install']);
    },
    checkXcode: async (): Promise<boolean> => (await exec('xcode-select', ['-p'])).code === 0,
    installLinuxGit: async (): Promise<void> => {
      // Find the distro's package manager, then install. `sudo -n` is non-interactive: with no
      // cached creds it fails fast (clear error) instead of hanging on a password prompt we
      // can't answer (exec's stdin is /dev/null).
      let manager: (typeof LINUX_PACKAGE_MANAGERS)[number] | null = null;
      for (const m of LINUX_PACKAGE_MANAGERS) {
        // Any exit code means the binary exists; only a spawn error (ENOENT) means it doesn't.
        const present = await exec(m.bin, ['--version']).then(
          () => true,
          () => false,
        );
        if (present) {
          manager = m;
          break;
        }
      }
      if (!manager) throw new NoPackageManagerError(LINUX_PACKAGE_MANAGERS.map((m) => m.bin));
      const r = await exec('sudo', ['-n', ...manager.installArgs]);
      if (r.code !== 0) {
        throw new Error(`${manager.bin} install git failed (code ${r.code}): ${r.stderr.trim()}`);
      }
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
    // Distinguish "this distro's package manager isn't supported" from an install/permission
    // failure — the generic copy implies a sudo problem, which misleads a Fedora/Arch user.
    const message =
      err instanceof NoPackageManagerError
        ? provisionMessages.gitInstallNoPackageManager
        : provisionMessages.gitInstallFailed;
    emit(Status.Failed, message, 'error', ErrorCode.ExecFailed);
    throw err;
  }
  emit(Status.Done, provisionMessages.gitInstalled);
  return { ok: true };
}
