import type { Config, Pins } from '../../engine/contract';

export interface ModuleOption {
  /** Exact `--modules` id (bmad-method). */
  id: string;
  name: string;
  description: string;
  recommended: boolean;
}

// User-facing BMad module choices (a curated subset of the installed modules). bmm is the
// default/recommended core; the rest are opt-in. ids are exact `--modules` values.
export const MODULE_OPTIONS: ModuleOption[] = [
  { id: 'bmm', name: 'BMad Method', description: 'The core planning + dev workflow.', recommended: true },
  { id: 'bmb', name: 'BMad Builder', description: 'Build your own agents & workflows.', recommended: false },
  { id: 'cis', name: 'Creative Studio', description: 'Brainstorming & ideation tools.', recommended: false },
];

export const DEFAULT_IDE = 'claude-code';
export const DEFAULT_MODULES = ['bmm'];
export const DEFAULT_PROJECT_NAME = 'kindling-project';
export const DEFAULT_PROJECT_DIR = '~/kindling-project';

/**
 * Smart-default Config so the user can reach Start without touching anything (FR-14): a sane
 * project dir/name, Claude Code selected, the BMad Method module. Pins come from the SSOT.
 */
export function defaultConfig(pins: Pins): Config {
  return {
    projectDir: DEFAULT_PROJECT_DIR,
    projectName: DEFAULT_PROJECT_NAME,
    ides: [DEFAULT_IDE],
    modules: [...DEFAULT_MODULES],
    pins,
    // Deliberately NO `bmadTarget` (Story 7.2) — absent keeps the default run pinned + the composed
    // Config byte-identical to today; Configure owns the opt-in (mirrors 6.2 leaving `installCli` out).
  };
}
