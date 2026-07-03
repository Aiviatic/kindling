import type { Config } from '../contract';

// Composes the `bmad-method install` argument array from the user's config.
// Pure (no I/O) so the exact flag contract is unit-testable and changeable in one place.
//
// [ASSUMPTION] Flag spelling/multiplicity follows the PRD's documented contract
// (--directory, --modules, --tools, --pin, --yes, --set k=v). The exact `bmad-method` CLI
// must be verified when the cohort `pins.bmad` version is frozen (currently a TODO).
export type InstallAction = 'install' | 'update';

/**
 * Compose the `bmad-method install` argv. `action` (2.7) selects a fresh install vs a re-run:
 * on a project that already has a BMad install, pass `--action update` so the re-run updates in
 * place rather than erroring/duplicating; a fresh project omits it (defaults to install).
 */
export function composeInstallArgs(config: Config, action: InstallAction = 'install'): string[] {
  // Values are joined CSV for --modules/--tools, so a value containing a comma would split
  // into extra tokens. Reject it (defense-in-depth; the UI shouldn't allow it either).
  for (const value of [...config.modules, ...config.ides]) {
    if (value.includes(',')) {
      throw new Error(`module/IDE value may not contain a comma: "${value}"`);
    }
  }

  const args = ['install', '--yes', '--directory', config.projectDir];

  // Re-run on an existing install → update in place (verified flag: --action install|update).
  if (action === 'update') {
    args.push('--action', 'update');
  }

  if (config.modules.length > 0) {
    args.push('--modules', config.modules.join(','));
  }
  // NOTE: --tools is required by bmad-method for fresh non-interactive (--yes) installs; the
  // UI's IDE picker guarantees a non-empty selection before Start.
  if (config.ides.length > 0) {
    args.push('--tools', config.ides.join(','));
  }
  // The BMad *version* is pinned via the npx package spec (`bmad-method@<version>` in
  // bmad-install.ts) — verified against the bmad-method 6.9.0 CLI. The `--pin CODE=TAG` flag
  // is for pinning individual module tags (not the core version), so it is NOT emitted here.

  if (config.set) {
    // [ASSUMPTION] bmad-method splits `--set key=value` on the FIRST `=`, and `--pin` ordering
    // (appended after --modules/--tools) is positional-agnostic. Verify both when the real CLI
    // is pinned (pins.bmad TODO); composition is isolated here so spelling changes touch one file.
    for (const [key, value] of Object.entries(config.set)) {
      args.push('--set', `${key}=${value}`);
    }
  }
  return args;
}
