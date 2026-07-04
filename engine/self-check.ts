import { release } from 'node:os';
import { randomUUID } from 'node:crypto';
import { exec as defaultExec, type ExecResult } from './exec';
import { probeVersion, probeCliVersion } from './probe';
import { readInstalledBmadVersion as defaultReadInstalledBmadVersion } from './bmad-manifest';
import type { EngineEmitter } from './emitter';
import { Phase, StepId, Status, ErrorCode, type Level } from './contract';
import { pins } from './pins';
import { stepMessages, selfCheckMessages } from './messages';
import {
  buildValidationSummary,
  parseMajor,
  NODE_FLOOR_MAJOR,
  type ValidationSummary,
  type CliPresence,
} from './validation-summary';
import type { AgentCliDescriptor } from './orchestrate/agent-cli';

export interface SelfCheckOptions {
  /** Outcomes threaded from prior steps (Stories 1.4 / 1.5). */
  scaffoldCreated: boolean;
  bmadInstalled: boolean;
  /** Project directory — where the BMad manifest lives (`<projectDir>/_bmad/_config/manifest.yaml`). */
  projectDir: string;
  emitter: EngineEmitter;
  /** Provisioned binaries (Epic 2); default PATH lookup. */
  node?: string;
  git?: string;
  /**
   * The requested eligible agent CLIs (Story 6.2), threaded from the engine's install-agent-cli
   * step. Each is probed for presence and reported in the summary's non-blocking `cli` field.
   * Absent/empty ⇒ `cli: []`.
   */
  agentClis?: AgentCliDescriptor[];
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  now?: () => string;
  /**
   * Read the ACTUAL installed BMad version from the project manifest (FR26). Injectable so unit
   * tests never touch a real fs/manifest (mirrors the `bmadAlreadyInstalled`/`exec` seams).
   * Default: the node-side `readInstalledBmadVersion` helper. Returns `null` on any read/parse
   * failure — reported as `bmad.installedVersion: null`, never a false pin.
   */
  readInstalledBmadVersion?: (projectDir: string) => Promise<string | null>;
  /** Platform facts (injectable for tests); default the running process. */
  platform?: { os: string; arch: string; osVersion: string };
}

// Verifies Node ≥ floor, Git present, scaffold + BMad done; emits finalize.self-check and
// returns the Validation Summary. `success` is strict — a "green" summary means a real setup.
export async function runSelfCheck(opts: SelfCheckOptions): Promise<ValidationSummary> {
  const exec = opts.exec ?? defaultExec;
  const now = opts.now ?? (() => new Date().toISOString());
  const readInstalledBmadVersion =
    opts.readInstalledBmadVersion ?? defaultReadInstalledBmadVersion;
  const platform = opts.platform ?? {
    os: process.platform,
    arch: process.arch,
    osVersion: release(),
  };

  const emit = (
    status: Status,
    humanMessage: string,
    level: Level = 'info',
    errorCode?: ErrorCode,
    summaryJson?: string,
  ): void => {
    opts.emitter.emit({
      id: randomUUID(),
      phase: Phase.Finalize,
      step: StepId.FinalizeSelfCheck,
      status,
      humanMessage,
      level,
      timestamp: now(),
      errorCode,
      summaryJson,
    });
  };

  // Stamp the summary once so generatedAt doesn't drift across the probe awaits / events.
  const generatedAt = now();

  emit(Status.Working, stepMessages[StepId.FinalizeSelfCheck]);

  const nodeVersion = await probeVersion(exec, opts.node ?? 'node');
  const gitVersion = await probeVersion(exec, opts.git ?? 'git');
  const nodeMajor = parseMajor(nodeVersion);

  // Probe each requested eligible CLI for presence. Node/git use `probeVersion`; the agent CLIs use
  // `probeCliVersion`, which on Windows runs `cmd /c <bin> --version` so the `claude.cmd` shim (which
  // Node won't spawn with shell:false) is reachable — a bare-bin probe there would wrongly report
  // "absent". Non-blocking (AC-6): the result feeds only the `cli` field, never `success`.
  const isWindows = platform.os === 'win32';
  const cli: CliPresence[] = [];
  for (const c of opts.agentClis ?? []) {
    const present = (await probeCliVersion(exec, c.bin, isWindows)) !== null;
    cli.push({ id: c.id, name: c.name, bin: c.bin, pkg: c.pkg, present });
  }

  // Read disk reality (FR26): the ACTUAL installed BMad version from the manifest. `null` on any
  // absent/unreadable/unparseable manifest — reported honestly, never gated into `success` here.
  const installedVersion = await readInstalledBmadVersion(opts.projectDir);

  const summary = buildValidationSummary({
    kindlingVersion: pins.kindling,
    os: platform.os,
    arch: platform.arch,
    osVersion: platform.osVersion,
    node: {
      present: nodeVersion !== null,
      version: nodeVersion,
      satisfiesFloor: nodeMajor !== null && nodeMajor >= NODE_FLOOR_MAJOR,
    },
    git: { present: gitVersion !== null, version: gitVersion },
    bmad: { pinnedVersion: pins.bmad, installed: opts.bmadInstalled, installedVersion },
    scaffold: { created: opts.scaffoldCreated },
    cli,
    generatedAt,
  });

  if (summary.success) {
    // Carry the Validation Summary JSON on the success event so the Welcome screen can offer a
    // one-click copy (the exact text the Validation Page expects).
    emit(Status.Done, selfCheckMessages.done, 'info', undefined, JSON.stringify(summary));
  } else {
    emit(Status.Failed, selfCheckMessages.failed, 'error', ErrorCode.ExecFailed);
  }

  return summary;
}
