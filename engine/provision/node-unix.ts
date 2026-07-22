import { randomUUID } from 'node:crypto';
import { exec as defaultExec, type ExecResult } from '../exec';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, ErrorCode, type Level } from '../contract';
import { stepMessages, provisionMessages } from '../messages';
import type { ProvisionResult } from './node-windows';

// nvm release the bootstrap pins to (AC: nvm-sh v0.40.x). Embedded so the install is reproducible.
export const NVM_VERSION = 'v0.40.3';

/** Absolute path to the nvm-installed node binary for a version. Pure. */
export function nvmNodePath(nvmDir: string, version: string): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  return `${nvmDir}/versions/node/${v}/bin/node`;
}

export interface ProvisionNodeUnixOptions {
  /** Pinned Node version (pins.node). */
  version: string;
  /** nvm install dir (default ~/.nvm). */
  nvmDir: string;
  emitter: EngineEmitter;
  /** From 2.1 detection: a system Node ≥ floor is already present. Honored only OFF macOS — on
   *  macOS we always install the exact pin via nvm so the workshop is reproducible (AC2 reuse is
   *  Linux-only; AC3 resolved-version-equals-pins.node). */
  alreadyOk?: boolean;
  /** Host platform — gates the reuse rule above. */
  platform?: NodeJS.Platform;
  /** Injectable side effects so tests run without network/a real shell. Defaults below are
   *  shell-based and UNVALIDATED until the dress rehearsal (macOS + Linux). */
  installNvm?: (nvmDir: string) => Promise<void>;
  nvmInstallNode?: (nvmDir: string, version: string) => Promise<void>;
  /** Idempotent re-run check (2.7): is the PINNED node already installed AND runnable? Default
   *  runs the resolved binary with --version. Verifying it RUNS (not just that a dir exists)
   *  means a partial/dirty prior install is repaired (re-installed), not skipped-into-broken. */
  nodeInstalled?: (nvmDir: string, version: string) => Promise<boolean>;
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  now?: () => string;
}

// nvm is a shell function, not an executable — so every default runs `bash -c` (a single binary
// + args, safe under exec's shell:false). Caller values are passed as POSITIONAL args ($1/$2),
// never interpolated into the script, so a path/version can't break out of the shell context.
// (NVM_VERSION is our own frozen constant, so it stays inline in the URL.)
function makeDefaults(exec: (cmd: string, args: string[]) => Promise<ExecResult>) {
  const run = async (script: string, args: string[], what: string): Promise<void> => {
    // `kindling` becomes $0; the rest are $1, $2, …
    const r = await exec('bash', ['-c', script, 'kindling', ...args]);
    if (r.code !== 0) throw new Error(`${what} failed (code ${r.code}): ${r.stderr.trim()}`);
  };
  return {
    // Install nvm only if it's not already present at $1 (idempotent).
    installNvm: (nvmDir: string): Promise<void> =>
      run(
        `export NVM_DIR="$1"; [ -s "$NVM_DIR/nvm.sh" ] || ` +
          `curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash`,
        [nvmDir],
        'nvm install',
      ),
    // Source nvm in the same shell, then install the pinned version. We do NOT touch `nvm alias
    // default` — clobbering the user's global default would break their other projects (FR4); the
    // launch step uses the absolute nodeExe path instead.
    nvmInstallNode: (nvmDir: string, version: string): Promise<void> =>
      run(
        `export NVM_DIR="$1"; . "$NVM_DIR/nvm.sh"; nvm install "$2"`,
        [nvmDir, version],
        'nvm install node',
      ),
  };
}

/**
 * Provision the pinned Node on macOS/Linux via nvm, returning the ABSOLUTE node path so the
 * launch step (2.6) never depends on a mutated PATH (the clean-runtime rule). A system Node ≥
 * floor is reused (Skipped, AC2). Emits provision.node events; Failed + rethrow on error.
 *
 * NOT WIRED INTO THE ENGINE (intentional): by the time the engine runs, kindling is already
 * running ON Node — the bootstrap (setup.sh) provisions it before launch; the engine's
 * ProvisionNode step only verifies. Kept as public API. If this is ever wired into a flow that
 * outlives the process, it must ALSO persist the shell-profile loader the way setup.sh does
 * (its "Added by Kindling" block) — an nvm install alone leaves nothing on the PATH of future
 * terminals (the 0.2.5 macOS bug).
 *
 * The real nvm install + same-shell source is validated at the dress rehearsal; here the shell
 * effects are injectable and the orchestration/events/skip/fail paths are unit-tested.
 */
export async function provisionNodeUnix(opts: ProvisionNodeUnixOptions): Promise<ProvisionResult> {
  const exec = opts.exec ?? defaultExec;
  const defaults = makeDefaults(exec);
  const installNvm = opts.installNvm ?? defaults.installNvm;
  const nvmInstallNode = opts.nvmInstallNode ?? defaults.nvmInstallNode;
  const nodeInstalled =
    opts.nodeInstalled ??
    (async (nvmDir: string, version: string): Promise<boolean> => {
      const want = version.startsWith('v') ? version : `v${version}`;
      try {
        const r = await exec(nvmNodePath(nvmDir, version), ['--version']);
        // Require it to RUN and report the EXACT pinned version — a missing/broken/wrong-version
        // binary at that path → not installed → (re)install repairs it.
        return r.code === 0 && r.stdout.trim() === want;
      } catch {
        return false;
      }
    });
  const now = opts.now ?? (() => new Date().toISOString());

  const emit = (
    status: Status,
    humanMessage: string,
    level: Level = 'info',
    errorCode?: ErrorCode,
  ): void => {
    opts.emitter.emit({
      id: randomUUID(),
      phase: Phase.Provision,
      step: StepId.ProvisionNode,
      status,
      humanMessage,
      level,
      timestamp: now(),
      errorCode,
    });
  };

  // Reuse a system Node only OFF macOS (AC2 Linux-only); on macOS always install the exact pin.
  if (opts.alreadyOk && opts.platform !== 'darwin') {
    emit(Status.Skipped, provisionMessages.nodePresent);
    return { ok: true, nodeExe: null }; // null → the launch uses the system `node` on PATH
  }

  // Idempotent re-run (2.7): the pinned nvm node is already installed AND runs → skip, don't
  // reinstall. (A partial/broken install fails this check → falls through to a repairing install.)
  if (await nodeInstalled(opts.nvmDir, opts.version)) {
    emit(Status.Skipped, provisionMessages.nodePresent);
    return { ok: true, nodeExe: nvmNodePath(opts.nvmDir, opts.version) };
  }

  emit(Status.Working, stepMessages[StepId.ProvisionNode]);
  try {
    await installNvm(opts.nvmDir);
    await nvmInstallNode(opts.nvmDir, opts.version);
  } catch (err) {
    emit(
      Status.Failed,
      'Setting up Node ran into a problem downloading or installing it. Check your connection, then press Retry.',
      'error',
      ErrorCode.NetworkLost,
    );
    throw err;
  }

  const nodeExe = nvmNodePath(opts.nvmDir, opts.version);
  emit(Status.Done, provisionMessages.nodePresent);
  return { ok: true, nodeExe };
}
