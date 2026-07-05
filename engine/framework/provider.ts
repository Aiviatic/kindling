import type { EngineEmitter } from '../emitter';
import type { ExecResult } from '../exec';
import type { Config } from '../contract';

// A pluggable project "framework" (BMad today; a bare "none" and alternatives later). The engine's
// install step drives whichever provider the config selects, so BMad is no longer hardwired.
// See docs/install-architecture-design.md. Phase 1 defines only what the install step needs; the
// Welcome/-inspect surface (detectExisting/summaryFacts/welcomeGuidance) is a later phase.

export interface FrameworkContext {
  config: Config;
  emitter: EngineEmitter;
  /** Injectable subprocess runner (tests fake it; production uses the engine's default exec). */
  exec: (cmd: string, args: string[]) => Promise<ExecResult>;
  /**
   * How to invoke the package runner (npx). macOS/Linux: `{ command: 'npx', prefixArgs: [] }`.
   * Windows: the provisioned node + npx-cli.js, since a bare `npx.cmd` can't spawn with shell:false.
   */
  runner: { command: string; prefixArgs: string[] };
}

export interface FrameworkInstallResult {
  ok: boolean;
  /** Resolved version tag/label (the BMad pin, or undefined for a framework with no version). */
  version?: string;
}

export interface FrameworkProvider {
  /** Stable id used by `config.framework` and the registry (e.g. 'bmad', 'none'). */
  id: string;
  /** User-facing name (e.g. "BMad Method"). */
  label: string;
  /** Run the install, emitting Working/Done/Failed on the install.framework step. */
  install(ctx: FrameworkContext): Promise<FrameworkInstallResult>;
}
