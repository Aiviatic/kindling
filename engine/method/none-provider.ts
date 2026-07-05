import { randomUUID } from 'node:crypto';
import { Phase, StepId, Status } from '../contract';
import type { MethodProvider, MethodContext, MethodInstallResult } from './provider';

/**
 * The "No framework" method: installs nothing. The project is just the scaffolded folder + git and
 * whatever AI-tool CLIs the user opted into (those run in the system section). Emits a single Done
 * on the install.method step so the project section honestly shows the choice, then succeeds.
 */
export const noneProvider: MethodProvider = {
  id: 'none',
  label: 'No framework',
  async install(ctx: MethodContext): Promise<MethodInstallResult> {
    ctx.emitter.emit({
      id: randomUUID(),
      phase: Phase.Install,
      step: StepId.InstallMethod,
      status: Status.Done,
      humanMessage: 'No framework selected — your project is a clean starting point.',
      level: 'info',
      timestamp: new Date().toISOString(),
    });
    return { ok: true };
  },
};
