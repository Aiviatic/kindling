import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { exec as defaultExec, type ExecResult } from '../exec';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, ErrorCode, type Level } from '../contract';
import { stepMessages, provisionMessages } from '../messages';

export type NodeArch = 'x64' | 'arm64';

/** Official Node Windows .zip URL for a pinned version. Pure. */
export function nodeDistUrl(version: string, arch: NodeArch = 'x64'): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  return `https://nodejs.org/dist/${v}/node-${v}-win-${arch}.zip`;
}

/** Absolute path to node.exe inside the extracted distribution. Pure. */
export function nodeExePath(baseDir: string, version: string, arch: NodeArch = 'x64'): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  return join(baseDir, `node-${v}-win-${arch}`, 'node.exe');
}

export interface ProvisionNodeWindowsOptions {
  /** Pinned Node version (pins.node). */
  version: string;
  /** Install root, e.g. %LOCALAPPDATA%\kindling\node. */
  baseDir: string;
  arch?: NodeArch;
  emitter: EngineEmitter;
  /** From 2.1 detection: a Node ≥ floor is already present → skip the download. */
  alreadyOk?: boolean;
  /** Injectable so tests run without network/Windows. Defaults below are spike-validation-pending. */
  download?: (url: string, dest: string) => Promise<void>;
  extract?: (zip: string, destDir: string) => Promise<void>;
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  now?: () => string;
}

// Default download: global fetch → file. UNVALIDATED on real Windows (spike / rehearsal).
async function defaultDownload(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

export interface ProvisionResult {
  ok: boolean;
  /**
   * Absolute path to the provisioned node binary for the launch step (2.6) to invoke directly
   * (the clean-runtime rule — never rely on a mutated PATH). `null` means an existing system
   * Node was reused → the launch resolves `node` from PATH instead.
   */
  nodeExe: string | null;
}

/**
 * NOT WIRED INTO THE ENGINE (intentional): by the time the engine runs, kindling is already
 * running ON Node — the bootstrap (setup.ps1) provisions portable Node before launch; the
 * engine's ProvisionNode step only verifies. Kept as public API. If this is ever wired into a
 * flow that outlives the process, it must ALSO persist the Node dir to the USER-scope PATH the
 * way setup.ps1's Add-UserPath does — this function alone leaves nothing on the PATH of future
 * terminals (the same family as the 0.2.5 macOS bug).
 */
export async function provisionNodeWindows(opts: ProvisionNodeWindowsOptions): Promise<ProvisionResult> {
  const arch = opts.arch ?? 'x64';
  const exec = opts.exec ?? defaultExec;
  const download = opts.download ?? defaultDownload;
  // Default extract via Windows 10+ bsdtar (handles .zip); UNVALIDATED here.
  const extract =
    opts.extract ??
    (async (zip: string, destDir: string): Promise<void> => {
      const r = await exec('tar', ['-xf', zip, '-C', destDir]);
      if (r.code !== 0) throw new Error(`extract failed (code ${r.code}): ${r.stderr.trim()}`);
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

  if (opts.alreadyOk) {
    emit(Status.Skipped, provisionMessages.nodePresent);
    return { ok: true, nodeExe: null };
  }

  emit(Status.Working, stepMessages[StepId.ProvisionNode]);
  try {
    await mkdir(opts.baseDir, { recursive: true }); // download dest + extract dir must exist
    const url = nodeDistUrl(opts.version, arch);
    const zip = join(opts.baseDir, `node-${opts.version}-win-${arch}.zip`);
    await download(url, zip);
    await extract(zip, opts.baseDir);
  } catch (err) {
    emit(Status.Failed, 'Setting up Node ran into a problem downloading or unpacking it. Check your connection, then press Retry.', 'error', ErrorCode.NetworkLost);
    throw err;
  }

  const nodeExe = nodeExePath(opts.baseDir, opts.version, arch);
  emit(Status.Done, provisionMessages.nodePresent);
  return { ok: true, nodeExe };
}
