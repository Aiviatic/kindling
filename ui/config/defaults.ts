import type { Config, Pins } from '../../engine/contract';

export interface ModuleOption {
  /** Exact `--modules` id (bmad-method). */
  id: string;
  name: string;
  description: string;
  recommended: boolean;
}

// User-facing BMad module choices (a curated subset of the installed modules). bmm + cis are the
// default/recommended set; the rest are opt-in. ids are exact `--modules` values. Order matters
// (it's the display order): Creative Studio sits above BMad Builder.
export const MODULE_OPTIONS: ModuleOption[] = [
  { id: 'bmm', name: 'BMad Method', description: 'The core planning and dev workflow.', recommended: true },
  { id: 'cis', name: 'Creative Studio', description: 'Brainstorming and ideation tools.', recommended: true },
  { id: 'bmb', name: 'BMad Builder', description: 'Build your own agents and workflows.', recommended: false },
];

export const DEFAULT_IDE = 'claude-code';
export const DEFAULT_MODULES = ['bmm', 'cis'];
// Plain, friendly defaults for non-technical users: a "My Projects" folder holding "My Project".
export const DEFAULT_PROJECT_NAME = 'My Project';
export const DEFAULT_PROJECT_FOLDER = '~/My Projects';
export const DEFAULT_PROJECT_DIR = `${DEFAULT_PROJECT_FOLDER}/${DEFAULT_PROJECT_NAME}`;

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
