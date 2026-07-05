import { randomUUID } from 'node:crypto';
import { Phase, StepId, Status } from '../contract';
import type { FrameworkProvider, FrameworkContext, FrameworkInstallResult, FrameworkSummary } from './provider';

/**
 * The "No framework" framework: installs nothing. The project is just the scaffolded folder + git and
 * whatever AI-tool CLIs the user opted into (those run in the system section). Emits a single Done
 * on the install.framework step so the project section honestly shows the choice, then succeeds.
 */
export const noneProvider: FrameworkProvider = {
  id: 'none',
  label: 'No framework',
  async install(ctx: FrameworkContext): Promise<FrameworkInstallResult> {
    ctx.emitter.emit({
      id: randomUUID(),
      phase: Phase.Install,
      step: StepId.InstallFramework,
      status: Status.Done,
      humanMessage: 'No framework selected. Your project is a clean starting point.',
      level: 'info',
      timestamp: new Date().toISOString(),
    });
    return { ok: true };
  },
  // No framework ⇒ no versions-table row.
  async summaryFacts(): Promise<FrameworkSummary | null> {
    return null;
  },
};
