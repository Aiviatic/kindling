import { randomUUID } from 'node:crypto';
import { Phase, StepId, Status, ErrorCode, type Level } from '../contract';
import type { FrameworkProvider, FrameworkContext, FrameworkInstallResult, FrameworkSummary } from './provider';

/** Pinned OpenSpec version (reproducibility, like the BMad pin). Bump deliberately. */
export const OPENSPEC_VERSION = '1.5.0';
const PACKAGE = '@fission-ai/openspec';

/**
 * OpenSpec's `--tools` ids differ from Kindling's IDE ids (which are BMad's `--tools` ids), so map
 * the selected tools to OpenSpec's names. Selected tools not in this map are dropped (OpenSpec just
 * won't configure them); an empty result becomes `none`. See docs/install-architecture-design.md
 * on decoupling the tools catalog.
 */
const TOOL_MAP: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
  'github-copilot': 'github-copilot',
  windsurf: 'windsurf',
  gemini: 'gemini',
  cline: 'cline',
  auggie: 'auggie',
  codebuddy: 'codebuddy',
  kiro: 'kiro',
  junie: 'junie',
  qwen: 'qwen',
  roo: 'roocode',
  trae: 'trae',
  crush: 'crush',
  opencode: 'opencode',
};

export function openspecTools(ides: string[]): string {
  const mapped = [...new Set(ides.map((id) => TOOL_MAP[id]).filter((t): t is string => Boolean(t)))];
  return mapped.length > 0 ? mapped.join(',') : 'none';
}

/**
 * The OpenSpec framework: scaffolds spec-driven structure via `npx @fission-ai/openspec init …`.
 * Pinned + `--ignore-scripts` (same supply-chain posture as the BMad install). `init` is fully
 * non-interactive with `--tools <list> --force`. OpenSpec has no modules, so `config.modules` is
 * unused; the folder + tool configs are all it writes.
 */
export const openspecProvider: FrameworkProvider = {
  id: 'openspec',
  label: 'OpenSpec',
  async install(ctx: FrameworkContext): Promise<FrameworkInstallResult> {
    const emit = (status: Status, humanMessage: string, level: Level = 'info', errorCode?: ErrorCode): void => {
      ctx.emitter.emit({
        id: randomUUID(),
        phase: Phase.Install,
        step: StepId.InstallFramework,
        status,
        humanMessage,
        level,
        timestamp: new Date().toISOString(),
        errorCode,
      });
    };
    emit(Status.Working, 'Setting up OpenSpec in your project.');
    const args = [
      ...ctx.runner.prefixArgs,
      '--ignore-scripts',
      `${PACKAGE}@${OPENSPEC_VERSION}`,
      'init',
      ctx.config.projectDir,
      '--tools',
      openspecTools(ctx.config.ides),
      '--force',
    ];
    let result;
    try {
      result = await ctx.exec(ctx.runner.command, args);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      emit(Status.Failed, `OpenSpec didn’t finish installing. (${detail})`, 'error', ErrorCode.FrameworkInstallFailed);
      throw err;
    }
    if (result.code !== 0) {
      const raw = (result.stderr.trim() ? result.stderr : result.stdout).trim().slice(-600).trim();
      const humanMessage = raw
        ? `OpenSpec didn’t finish installing.\n\nDetails:\n${raw}`
        : 'OpenSpec didn’t finish installing.';
      emit(Status.Failed, humanMessage, 'error', ErrorCode.FrameworkInstallFailed);
      return { ok: false };
    }
    emit(Status.Done, `OpenSpec ${OPENSPEC_VERSION} installed.`);
    return { ok: true, version: OPENSPEC_VERSION };
  },
  async summaryFacts(): Promise<FrameworkSummary | null> {
    return { label: 'OpenSpec', version: OPENSPEC_VERSION, note: 'a stable, tested version' };
  },
};
