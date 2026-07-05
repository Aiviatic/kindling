import { runBmadInstall } from '../orchestrate/bmad-install';
import type { FrameworkProvider, FrameworkContext, FrameworkInstallResult } from './provider';

/**
 * The default framework: installs BMad via `npx bmad-method@<pin> install …`. This is a thin adapter
 * over `runBmadInstall` — the install logic, flag composition, and their tests stay in
 * orchestrate/bmad-install.ts. The context's `runner` becomes runBmadInstall's npx wiring (the
 * Windows node + npx-cli.js shim, or the plain `npx` default on macOS/Linux).
 */
export const bmadProvider: FrameworkProvider = {
  id: 'bmad',
  label: 'BMad Method',
  async install(ctx: FrameworkContext): Promise<FrameworkInstallResult> {
    const result = await runBmadInstall({
      config: ctx.config,
      emitter: ctx.emitter,
      exec: ctx.exec,
      npxCommand: ctx.runner.command,
      npxPrefixArgs: ctx.runner.prefixArgs,
    });
    return { ok: result.ok, version: result.bmadVersion };
  },
};
