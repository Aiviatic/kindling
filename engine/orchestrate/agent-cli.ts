import { randomUUID } from 'node:crypto';
import { exec as defaultExec, type ExecResult } from '../exec';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, ErrorCode, type Level, type Config } from '../contract';
import { agentCliMessages } from '../messages';
import { probeVersion } from '../probe';

/**
 * Explicit id → npm package table. The scope guard: only these two picked-tool ids are eligible
 * for an agent-CLI install; every other `--tools` id (vscode, cursor, …) is ignored and stays
 * skill-files-only. Kept explicit and in one place so the mapping — and the DELIBERATE unpinned
 * (latest) package spelling — is one edit to change / verify against the registry.
 *
 * `[DECISION]` Unpinned (latest): everywhere else Kindling pins, but the agent CLIs are the
 * deliberate exception — they self-update, and pinning would strand cohort users on a stale
 * binary. So the pkg strings carry NO `@version`; `exec(npm, ['install','-g', pkg])` installs
 * latest.
 */
export const AGENT_CLI_TABLE: Record<string, { pkg: string; bin: string; name: string }> = {
  'claude-code': { pkg: '@anthropic-ai/claude-code', bin: 'claude', name: 'Claude Code' },
  codex: { pkg: '@openai/codex', bin: 'codex', name: 'Codex' },
};

/** A resolved, eligible agent-CLI descriptor (the id folded into its table row). */
export interface AgentCliDescriptor {
  id: string;
  pkg: string;
  bin: string;
  name: string;
}

/**
 * SSOT accessor: map the requested `installCli` ids to their eligible descriptors, applying the
 * same scope guard + de-dupe as `installAgentCli`. The single source both the install step AND the
 * self-check (Story 6.2) read, so the id→{pkg,bin,name} mapping is never hard-coded twice. A
 * non-eligible id (vscode, cursor, …) is dropped; an empty/absent list yields `[]`.
 */
export function eligibleAgentClis(installCli: string[] | undefined): AgentCliDescriptor[] {
  return [...new Set((installCli ?? []).filter((id) => id in AGENT_CLI_TABLE))].map((id) => ({
    id,
    ...AGENT_CLI_TABLE[id],
  }));
}

/**
 * Outcome of the install-agent-cli step. `ok` reflects only that the step RAN TO COMPLETION —
 * it is INDEPENDENT of individual install failures (which land in `failed`). This is the step's
 * defining property versus every other engine step: it is NON-FATAL, so the engine reaches the
 * self-check / Welcome even if a CLI failed to install (AC-3). The failed ids are surfaced solely
 * as `Failed` events (keyed by ErrorCode.AgentCliInstallFailed) for the error surface / Story 6.2.
 */
export interface AgentCliResult {
  ok: boolean;
  installed: string[];
  skipped: string[];
  failed: string[];
}

export interface AgentCliOptions {
  config: Config;
  emitter: EngineEmitter;
  /** Injectable subprocess runner (tests pass a fake; NEVER runs a real npm install). */
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  /**
   * Command used to invoke npm. Default 'npm' (macOS/Linux dev). On Windows this must be the
   * provisioned `node` + npm-cli.js (Epic 2) since `npm.cmd` can't spawn with shell:false — the
   * same absolute-node strategy `launch.ts` uses via `npxCliPath` (the npm equivalent is
   * `<dir>/node_modules/npm/bin/npm-cli.js`). Not over-plumbed in 6.1: like bmad-install's
   * `npxCommand`, the seam defaults to 'npm' and the rehearsal / Story 6.2 plugs the abs path in.
   */
  npmCommand?: string;
  /**
   * Resolve an agent CLI's bin name to a spawnable form before the idempotent-skip probe. Default:
   * identity. On Windows a global `npm install -g` writes a `claude.cmd`/`.ps1` shim (not a bare
   * `claude` executable), and `exec` uses `shell:false` — so a bare bin can't be spawned there and
   * `probeVersion` would wrongly report "absent" and reinstall on every run. This seam is the probe
   * equivalent of `npmCommand`: the Epic-2 Windows wiring / dress rehearsal plugs the resolved shim
   * path in here. Not over-plumbed in 6.1 (defaults to identity, exactly as `npmCommand` defaults
   * to 'npm'). See deferred-work.md → agent-CLI Windows resolution.
   */
  resolveBin?: (bin: string) => string;
  now?: () => string;
}

/**
 * Optionally installs the picked agent's CLI (Claude Code / Codex) globally at latest, AFTER the
 * BMad install and BEFORE the self-check. Mirrors `bmad-install.ts` (injectable `exec`/`now`, an
 * `npmCommand` seam) but with the opposite failure contract:
 *
 *   - **Idempotent skip** (AC-2): probe `<bin> --version` first; if present, emit `Skipped` and do
 *     not re-install. The install is machine-global (`npm -g`), so a second run / other project
 *     simply skips — which is what makes repeated runs and multiple projects safe.
 *   - **Scope guard** (AC-4): only ids in AGENT_CLI_TABLE install; others are ignored.
 *   - **NON-fatal failure** (AC-3): a non-zero exit OR a caught spawn error emits ONE `Failed`
 *     event (with the manual-install fallback) and CONTINUES to the next CLI — it NEVER throws.
 *     A CLI-install failure must not invalidate the successful BMad install.
 *
 * Returns `{ ok: true, ... }` whenever the step ran to completion, regardless of individual
 * failures — the engine step returns `true` unconditionally off the back of this.
 */
export async function installAgentCli(opts: AgentCliOptions): Promise<AgentCliResult> {
  const exec = opts.exec ?? defaultExec;
  const npm = opts.npmCommand ?? 'npm';
  const resolveBin = opts.resolveBin ?? ((bin: string) => bin);
  const now = opts.now ?? (() => new Date().toISOString());

  const emit = (
    status: Status,
    humanMessage: string,
    level: Level = 'info',
    errorCode?: ErrorCode,
  ): void => {
    opts.emitter.emit({
      id: randomUUID(),
      phase: Phase.Install,
      step: StepId.InstallAgentCli,
      status,
      humanMessage,
      level,
      timestamp: now(),
      errorCode,
    });
  };

  const installed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  // Scope guard: keep only eligible ids (AC-4), de-duped so a repeated id can't double-install.
  // Empty/absent installCli ⇒ no eligible ids ⇒ no events, no exec — a silent no-op unchanged.
  const eligible = eligibleAgentClis(opts.config.installCli);

  for (const { id, pkg, bin, name } of eligible) {

    // Idempotent skip: already present anywhere on the machine → don't reinstall (AC-2). Probe via
    // the resolveBin seam so the Windows shim (claude.cmd) is reachable once wired (see JSDoc).
    if ((await probeVersion(exec, resolveBin(bin))) !== null) {
      emit(Status.Skipped, agentCliMessages.skipped(name));
      skipped.push(id);
      continue;
    }

    emit(Status.Working, agentCliMessages.working(name));

    // Non-fatal: capture BOTH the non-zero-exit and the spawn-error paths, emit a single Failed
    // event including the manual-install fallback, and continue to the next CLI (never throw).
    const failMessage = `${agentCliMessages.failed(name)} ${agentCliMessages.manualInstall(pkg)}`;
    try {
      const result = await exec(npm, ['install', '-g', pkg]); // NO @version — latest (deliberate)
      if (result.code === 0) {
        emit(Status.Done, agentCliMessages.done(name));
        installed.push(id);
      } else {
        emit(Status.Failed, failMessage, 'error', ErrorCode.AgentCliInstallFailed);
        failed.push(id);
      }
    } catch {
      emit(Status.Failed, failMessage, 'error', ErrorCode.AgentCliInstallFailed);
      failed.push(id);
    }
  }

  // ok = "the step ran to completion", INDEPENDENT of individual failures (AC-3).
  return { ok: true, installed, skipped, failed };
}
