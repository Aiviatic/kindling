// SSOT for Kindling's engine vocabulary and type contract.
//
// This is the ONLY module permitted to contain raw phase/step string literals — the
// ESLint guard exempts this file. Everything else imports the enums/types from here.
//
// Note: the event type is named `KindlingEvent` (not `Event`) to avoid shadowing the DOM
// `Event` global when the UI imports from this contract.

export const Phase = {
  Provision: 'provision',
  Scaffold: 'scaffold',
  Install: 'install',
  Finalize: 'finalize',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const StepId = {
  ProvisionNode: 'provision.node',
  ProvisionGit: 'provision.git',
  ProvisionXcodeClt: 'provision.xcode-clt',
  ScaffoldGitInit: 'scaffold.git-init',
  InstallBmad: 'install.bmad',
  InstallAgentCli: 'install.agent-cli',
  FinalizeSelfCheck: 'finalize.self-check',
} as const;
export type StepId = (typeof StepId)[keyof typeof StepId];

/**
 * Steps whose `Failed` must NOT fail the overall run (SSOT — "which steps are non-fatal" belongs
 * next to the step vocabulary). The optional agent-CLI install (Story 6.1) is non-fatal by design:
 * the engine step returns `true` unconditionally, so a CLI that didn't install still reaches the
 * self-check / Welcome. `ui/state/reducer.ts` `deriveOverall` respects this set so a non-fatal
 * `Failed` never yields `overall: 'failed'` (Story 6.2 / AC-8). Future non-fatal steps just join it.
 */
export const NON_FATAL_STEPS: ReadonlySet<StepId> = new Set([StepId.InstallAgentCli]);

export const Status = {
  Queued: 'queued',
  Working: 'working',
  Done: 'done',
  Skipped: 'skipped',
  Failed: 'failed',
} as const;
export type Status = (typeof Status)[keyof typeof Status];

export type Level = 'info' | 'warn' | 'error';

/** Stable error codes for failure copy (see engine/messages.ts → recoveryGuidance). */
export const ErrorCode = {
  ExecFailed: 'exec.failed',
  NetworkLost: 'network.lost',
  BmadInstallFailed: 'install.bmad-failed',
  // Optional agent-CLI install (Story 6.1) — NON-fatal: keyed here so a failed CLI install
  // surfaces recovery guidance without invalidating the successful BMad install.
  AgentCliInstallFailed: 'install.agent-cli-failed',
  // Windows bootstrap blocks — emitted by the Epic-2 Windows shell (FR-7).
  ExecPolicyBlocked: 'exec.policy-blocked',
  SmartScreenBlocked: 'exec.smartscreen-blocked',
  // The target folder holds a pre-existing, non-Kindling project (FR-9) — ask, don't overwrite.
  ProjectConflict: 'scaffold.project-conflict',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Append-only progress event emitted by the engine. Frontends render these; never compose copy.
 * INVARIANT: every field is a primitive — keep it so, so the emitter's shallow freeze fully locks it.
 */
export interface KindlingEvent {
  id: string;
  phase: Phase;
  step: StepId;
  status: Status;
  pct?: number;
  humanMessage: string;
  level: Level;
  timestamp: string;
  /** Set on a Failed event to key the UI's recovery guidance (engine/messages.ts). */
  errorCode?: ErrorCode;
  /** Set on the final self-check Done event: the Validation Summary as JSON (FR — the text the
   *  user copies into the Validation Page). A primitive string, preserving the all-primitive
   *  event invariant. */
  summaryJson?: string;
}

/** Frozen version pins — see engine/pins.ts. */
export interface Pins {
  node: string;
  bmad: string;
  kindling: string;
}

/** Flat, serializable config the frontend submits to the engine. */
export interface Config {
  projectDir: string;
  projectName: string;
  /** Selected IDE/tool codes → `--tools`. */
  ides: string[];
  /** Selected BMad modules → `--modules`. */
  modules: string[];
  /**
   * Picked tool ids the user opted to install an agent CLI for (Story 6.1). Only `claude-code`
   * and `codex` are eligible (id→package table in orchestrate/agent-cli.ts); any other id is
   * ignored. Absent/empty ⇒ the install-agent-cli step is a no-op. Story 6.2's Configure UI
   * populates this (default-on for whichever of claude-code/codex is selected).
   */
  installCli?: string[];
  /**
   * BMad version target for the install step (Story 7.1 / FR27). Absent ⇒ `'pinned'`: install the
   * frozen cohort pin (`pins.bmad`) — the reproducible default every fresh install and repair
   * re-run uses. `'latest'` is the explicit opt-in that installs `bmad-method@latest` with a FORCED
   * `--action update` (moves the user off the frozen workshop version). Story 7.2's Configure UI
   * populates this (default off / pinned); 7.1 only defines + honors it. Flat + serializable, like
   * `installCli` (Story 6.1).
   */
  bmadTarget?: 'pinned' | 'latest';
  /** Escape-hatch overrides → repeated `--set <key>=<value>` (FR10). */
  set?: Record<string, string>;
  pins: Pins;
}

/**
 * Result of the `POST /inspect` probe (Story 7.2 / FR26/FR27): the filesystem facts the browser
 * cannot read itself. `isKindlingProject` = a `_bmad` DIRECTORY exists under the chosen project dir
 * (reuses `defaultBmadInstalled`); `installedBmadVersion` = the ACTUAL manifest version (7.1's
 * `readInstalledBmadVersion`) or `null` when the manifest is absent/unreadable. Plain, serializable
 * browser↔server contract — sibling to `Config`/`KindlingEvent`, so both `server/server.ts` and
 * `ui/lib/commands.ts` import ONE type with no cross-layer (UI→server) import.
 */
export interface InspectResult {
  isKindlingProject: boolean;
  installedBmadVersion: string | null;
}

/**
 * Command interface the engine implements. Generic over the run result `R` (defaults to
 * `void`) so a concrete engine can return a richer result (e.g. the run outcome + summary)
 * without the contract depending on the engine module.
 */
export interface EngineCommands<R = void> {
  start(config: Config): R | Promise<R>;
  cancel(): void;
  retry(step: StepId): R | Promise<R>;
}
