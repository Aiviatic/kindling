import { randomUUID } from 'node:crypto';
import type { EngineEmitter } from './emitter';
import { Phase, StepId, Status, ErrorCode, type Config, type EngineCommands, type Level } from './contract';
import { scaffold as defaultScaffold, type ScaffoldOptions, type ScaffoldOutcome } from './orchestrate/scaffold';
import { runBmadInstall as defaultRunBmadInstall, type BmadInstallOptions, type BmadInstallResult } from './orchestrate/bmad-install';
import { installAgentCli as defaultInstallAgentCli, eligibleAgentClis, type AgentCliOptions, type AgentCliResult } from './orchestrate/agent-cli';
import { npxCliPath, npmCliPath } from './orchestrate/launch';
import { runSelfCheck as defaultRunSelfCheck, type SelfCheckOptions } from './self-check';
import { detectDependencies as defaultDetect, type DetectOptions, type DependencyState } from './provision/detect';
import { provisionGitUnix as defaultProvisionGit, type ProvisionGitUnixOptions, type ProvisionGitResult } from './provision/git-unix';
import { provisionMessages } from './messages';
import type { ValidationSummary } from './validation-summary';
import { writeFailureLog as defaultWriteFailureLog, type FailureLogEntry } from './log';
import { expandTilde } from './expand-tilde';

// Injectable step implementations so the orchestration logic is unit-testable without real
// git/npx/shell. Defaults are the real engine functions.
export interface EngineDeps {
  detect: (opts: DetectOptions) => Promise<DependencyState>;
  provisionGit: (opts: ProvisionGitUnixOptions) => Promise<ProvisionGitResult>;
  scaffold: (opts: ScaffoldOptions) => Promise<ScaffoldOutcome>;
  runBmadInstall: (opts: BmadInstallOptions) => Promise<BmadInstallResult>;
  installAgentCli: (opts: AgentCliOptions) => Promise<AgentCliResult>;
  runSelfCheck: (opts: SelfCheckOptions) => Promise<ValidationSummary>;
  writeFailureLog: (entry: FailureLogEntry) => Promise<string>;
  /** Host platform — selects the Git provisioning step id (xcode-clt on macOS, else git). */
  platform: NodeJS.Platform;
}

const defaultDeps: EngineDeps = {
  detect: defaultDetect,
  provisionGit: defaultProvisionGit,
  scaffold: defaultScaffold,
  runBmadInstall: defaultRunBmadInstall,
  installAgentCli: defaultInstallAgentCli,
  runSelfCheck: defaultRunSelfCheck,
  writeFailureLog: (entry) => defaultWriteFailureLog(entry),
  platform: process.platform,
};

interface Step {
  id: StepId;
  run: () => Promise<boolean>; // emits its own events; returns success
}

export interface EngineRunResult {
  ok: boolean;
  failedStep: StepId | null;
  summary: ValidationSummary | null;
  logPath: string | null;
}

/**
 * Orchestrates the full step sequence — provision Node (verify) → provision Git/Xcode →
 * scaffold → install → install-agent-cli (optional, non-fatal) → self-check — tracking which
 * steps completed so retry() can resume without re-running done steps. On a step failure it
 * writes the on-disk failure report (the
 * step itself already emitted its Failed event) and stops. The bootstrap provisions Node before
 * launch; Git/Xcode is provisioned here so the browser shows the never-frozen progress.
 */
export class Engine implements EngineCommands<EngineRunResult> {
  private readonly config: Config;
  private readonly deps: EngineDeps;
  private readonly completed = new Set<StepId>();
  private cancelled = false;
  private running = false;

  // Outputs threaded between steps.
  private scaffoldCreated = false;
  private bmadInstalled = false;
  private lastSummary: ValidationSummary | null = null;

  private readonly steps: Step[];

  constructor(
    config: Config,
    private readonly emitter: EngineEmitter,
    deps: Partial<EngineDeps> = {},
  ) {
    // Expand a leading `~` (the UI default is `~/kindling-project`) once, up front, so every step —
    // scaffold, install, self-check — works with a real path instead of a literal `~` folder.
    this.config = { ...config, projectDir: expandTilde(config.projectDir) };
    this.deps = { ...defaultDeps, ...deps };
    // Git provisioning surfaces on the xcode-clt step on macOS (the un-silenceable dialog), the
    // git step elsewhere — so a Retry targets the right row.
    const gitStepId =
      this.deps.platform === 'darwin' ? StepId.ProvisionXcodeClt : StepId.ProvisionGit;
    this.steps = [
      {
        // Node was provisioned by the bootstrap (kindling is running on it). Verify it actually
        // meets the floor before showing a green row — a sub-floor Node shows honestly (Failed)
        // instead of a false Skipped that would only surface as a confusing self-check failure.
        id: StepId.ProvisionNode,
        run: async () => {
          const state = await this.deps.detect({}); // probe only; we drive the row ourselves
          if (state.node.present && state.node.satisfiesFloor) {
            this.emit(StepId.ProvisionNode, Status.Skipped, provisionMessages.nodePresent);
            return true;
          }
          this.emit(StepId.ProvisionNode, Status.Failed, provisionMessages.nodeQueued, 'error', ErrorCode.ExecFailed);
          return false;
        },
      },
      {
        // Git/Xcode CLT runs IN the engine so the browser shows the never-frozen progress (the
        // ~5-min macOS dialog). On Windows, Git is provisioned by the bootstrap (PortableGit) —
        // probe + reflect it (Failed if the bootstrap didn't lay it down, rather than a cryptic
        // scaffold crash later).
        id: gitStepId,
        run: async () => {
          const state = await this.deps.detect({}); // probe only; no emitter (we drive the rows)
          if (this.deps.platform === 'win32') {
            if (state.git.present) {
              this.emit(gitStepId, Status.Skipped, provisionMessages.gitPresent);
              return true;
            }
            this.emit(gitStepId, Status.Failed, provisionMessages.gitInstallFailed, 'error', ErrorCode.ExecFailed);
            return false;
          }
          const result = await this.deps.provisionGit({
            platform: this.deps.platform,
            emitter: this.emitter,
            alreadyOk: state.git.present,
          });
          return result.ok;
        },
      },
      {
        id: StepId.ScaffoldGitInit,
        run: async () => {
          const outcome = await this.deps.scaffold({
            projectDir: this.config.projectDir,
            projectName: this.config.projectName,
            emitter: this.emitter,
          });
          this.scaffoldCreated = outcome !== 'blocked';
          return outcome !== 'blocked';
        },
      },
      {
        id: StepId.InstallMethod,
        run: async () => {
          // Windows: `npx` is a `.cmd` shim that spawn(shell:false) can't find by bare name → ENOENT.
          // The engine runs on the provisioned node (process.execPath), with npx-cli.js beside it, so
          // invoke `node npx-cli.js …` instead. macOS/Linux keep the bare-`npx` default untouched.
          const result = await this.deps.runBmadInstall({
            config: this.config,
            emitter: this.emitter,
            ...(this.deps.platform === 'win32'
              ? { npxCommand: process.execPath, npxPrefixArgs: [npxCliPath(process.execPath)] }
              : {}),
          });
          this.bmadInstalled = result.ok;
          return result.ok;
        },
      },
      {
        // Optional agent-CLI install (Story 6.1). NON-fatal by design: it awaits the step but
        // returns `true` UNCONDITIONALLY, so an individual CLI-install failure never invalidates
        // the successful BMad install — the run still reaches self-check / Welcome. The failure is
        // surfaced only as a Failed event (ErrorCode.AgentCliInstallFailed) for the error surface /
        // Story 6.2 UI. The row is retryable via engine.retry(StepId.InstallAgentCli) — but note a
        // future "Retry install" affordance must ALSO re-run self-check to refresh the Welcome's
        // CLI-presence guidance (retry() skips the already-completed self-check). See deferred-work.md.
        id: StepId.InstallAgentCli,
        run: async () => {
          // Non-fatal: the step returns true unconditionally. The install RESULT is intentionally
          // not stored — the self-check re-derives CLI presence by probing (Story 6.2), so the
          // presence report is robust to a mid-run failure regardless of this step's outcome.
          // Windows: same `.cmd`-shim problem as BMad — `npm` can't spawn by bare name (shell:false),
          // so route through `node npm-cli.js …`. macOS/Linux keep the bare-`npm` default.
          await this.deps.installAgentCli({
            config: this.config,
            emitter: this.emitter,
            // Windows: the idempotent-skip probe must go through `cmd /c <bin> --version` so the
            // installed `claude.cmd` shim is detected (Node won't spawn `.cmd` with shell:false).
            isWindows: this.deps.platform === 'win32',
            ...(this.deps.platform === 'win32'
              ? { npmCommand: process.execPath, npmPrefixArgs: [npmCliPath(process.execPath)] }
              : {}),
          });
          return true;
        },
      },
      {
        id: StepId.FinalizeSelfCheck,
        run: async () => {
          const summary = await this.deps.runSelfCheck({
            scaffoldCreated: this.scaffoldCreated,
            bmadInstalled: this.bmadInstalled,
            // Where the BMad manifest lives — self-check reads the ACTUAL installed version (FR26).
            projectDir: this.config.projectDir,
            // Thread the requested eligible CLI descriptors (SSOT accessor over config.installCli)
            // the same way scaffold/bmad outcomes are threaded — self-check probes each for presence.
            agentClis: eligibleAgentClis(this.config.installCli),
            emitter: this.emitter,
          });
          this.lastSummary = summary;
          return summary.success;
        },
      },
    ];
  }

  start(config?: Config): Promise<EngineRunResult> {
    void config; // config is fixed at construction; param kept for the EngineCommands contract
    return this.runFrom(0);
  }

  // Re-runs from `step` forward, skipping other completed steps. The named step is always
  // re-executed (cleared from `completed`). Returns a structured result for an unknown step
  // rather than throwing, so callers handle one shape.
  retry(step: StepId): Promise<EngineRunResult> {
    const idx = this.steps.findIndex((s) => s.id === step);
    if (idx < 0) {
      return Promise.resolve({ ok: false, failedStep: step, summary: this.lastSummary, logPath: null });
    }
    this.cancelled = false;
    this.completed.delete(step);
    return this.runFrom(idx);
  }

  cancel(): void {
    this.cancelled = true;
  }

  // Emit a provision-phase event the engine authors directly (the Node row; the Windows
  // git-present row). Step orchestrators emit their own events.
  private emit(
    step: StepId,
    status: Status,
    humanMessage: string,
    level: Level = 'info',
    errorCode?: ErrorCode,
  ): void {
    this.emitter.emit({
      id: randomUUID(),
      phase: Phase.Provision,
      step,
      status,
      humanMessage,
      level,
      timestamp: new Date().toISOString(),
      errorCode,
    });
  }

  private async runFrom(startIdx: number): Promise<EngineRunResult> {
    // Single-flight: the engine mutates shared state, so overlapping runs are a programming error.
    if (this.running) throw new Error('Engine is already running');
    this.running = true;
    try {
      for (let i = startIdx; i < this.steps.length; i++) {
        const step = this.steps[i];
        if (this.completed.has(step.id)) continue; // resume: skip already-done steps
        if (this.cancelled) {
          return { ok: false, failedStep: null, summary: this.lastSummary, logPath: null };
        }

        let ok: boolean;
        try {
          ok = await step.run();
        } catch (err) {
          const logPath = await this.fail(step.id, err);
          return { ok: false, failedStep: step.id, summary: this.lastSummary, logPath };
        }

        // Re-check cancellation after the (awaited) step so a mid-step cancel doesn't commit state.
        if (this.cancelled) {
          return { ok: false, failedStep: null, summary: this.lastSummary, logPath: null };
        }

        if (!ok) {
          const logPath = await this.fail(step.id, new Error(`Step ${step.id} did not succeed`));
          return { ok: false, failedStep: step.id, summary: this.lastSummary, logPath };
        }
        this.completed.add(step.id);
      }
      return { ok: true, failedStep: null, summary: this.lastSummary, logPath: null };
    } finally {
      this.running = false;
    }
  }

  // Writes the failure report; a log-write error must not mask the underlying step failure,
  // so it degrades to logPath: null rather than rejecting the run.
  private async fail(step: StepId, err: unknown): Promise<string | null> {
    const error =
      err instanceof Error
        ? (err.stack ?? err.message)
        : err !== null && typeof err === 'object'
          ? JSON.stringify(err)
          : String(err);
    try {
      return await this.deps.writeFailureLog({ step, error, events: this.emitter.events() });
    } catch {
      return null;
    }
  }
}
