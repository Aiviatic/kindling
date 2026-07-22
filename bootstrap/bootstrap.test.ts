import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pins } from '../engine/pins';
import { NVM_VERSION } from '../engine/provision/node-unix';
import { npxCliPath } from '../engine/orchestrate/launch';

// The bootstrap scripts are shell artifacts validated for real at the dress rehearsal; here we
// assert their CONTENT (the AC-required flags/flow/guidance) and — critically — that the pinned
// versions embedded in shell match the engine SSOT, so they can't silently drift.
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const setupSh = read('./setup.sh');
const setupPs1 = read('./setup.ps1');
const kindlingCmd = read('./kindling.cmd');

describe('bootstrap/kindling.cmd (Windows entry — AC2)', () => {
  it('is a self-fetching one-file entry: fetches setup.ps1 over HTTPS and runs it (irm | iex)', () => {
    expect(kindlingCmd).toMatch(/powershell/i);
    expect(kindlingCmd).toContain('-ExecutionPolicy Bypass');
    expect(kindlingCmd).toContain('-NoProfile'); // mandatory guard
    // Self-fetching (mirrors mac's `curl … | bash`): no sibling files travel with the download.
    expect(kindlingCmd).toMatch(/irm\s+https:\/\/\S*setup\.ps1\s*\|\s*iex/i);
    // Assert on the COMMAND, not the REM comments (which mention the old `%~dp0`/`-File` form).
    const cmdCode = kindlingCmd.split('\n').filter((l) => !/^\s*REM\b/i.test(l)).join('\n');
    expect(cmdCode).not.toContain('%~dp0'); // no dependence on files next to the downloaded .cmd
    expect(cmdCode).not.toMatch(/-File\b/); // uses -Command … iex, not -File <sibling>
  });
});

describe('bootstrap/setup.sh (macOS/Linux entry — AC1)', () => {
  it('is a safe bash script that provisions then launches Kindling', () => {
    expect(setupSh.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(setupSh).toContain('set -euo pipefail');
    // Self-contained for the curl|bash delivery path (no sourcing — BASH_SOURCE is empty there).
    expect(setupSh).toMatch(/node_ok\(\)/);
    expect(setupSh).toMatch(/have_cmd\(\)/);
    expect(setupSh).not.toContain('lib/common.sh');
    // Suspends BOTH -e and -u around sourcing nvm.sh — under `set -e` alone, sourcing can kill
    // the script silently on a machine with no prior node (verified against a blank $HOME).
    expect(setupSh).toMatch(/set \+eu/);
    // …and restores them. Anchored: an unanchored /set -eu/ would vacuously match the script's
    // opening `set -euo pipefail` and never catch a deleted restore.
    expect(setupSh).toMatch(/^\s*set -eu$/m);
    expect(setupSh).toMatch(/have_cmd nvm/); // verifies nvm actually loaded after sourcing
    expect(setupSh).toMatch(/nvm install/); // provisions Node via nvm
    expect(setupSh).toMatch(/npx -y "@aiviatic\/kindling@/); // launches Kindling
    // The terminal the install line was pasted into predates the PATH change — the user must be
    // told to open a NEW terminal, or npm/claude look "not installed" in that very window.
    expect(setupSh).toMatch(/NODE_PROVISIONED_THIS_RUN/);
    expect(setupSh).toMatch(/NEW terminal/);
  });

  it('persists the nvm loader into the shell profile itself (fresh Macs have NO ~/.zshrc, and nvm\'s installer only appends to an existing file)', () => {
    expect(setupSh).toMatch(/shell_profile\(\)/); // picks the profile for the user's login shell
    expect(setupSh).toMatch(/\.zshrc/); // zsh (macOS default) is covered
    expect(setupSh).toContain('touch "$PROFILE_FILE"'); // creates the profile when missing
    // Appends the loader idempotently, keyed on OUR marker — a stale/foreign '/nvm.sh' mention
    // in the profile must not suppress the append (it would leave a broken loader winning).
    expect(setupSh).toMatch(/grep -q 'Added by Kindling' "\$PROFILE_FILE"/);
    expect(setupSh).toContain('# Added by Kindling');
    // Bare-home Linux: chains ~/.profile → .bashrc (as /etc/skel does) so LOGIN shells (ssh,
    // console) get the loader too — .bashrc alone only covers GUI (interactive non-login) shells.
    expect(setupSh).toMatch(/\[ ! -f "\$HOME\/\.profile" \] && \[ ! -f "\$HOME\/\.bash_profile" \]/);
    expect(setupSh).toMatch(/login shells read this file, not \.bashrc/);
    // The loader must run BEFORE the nvm-already-installed short-circuit, so a re-run after a
    // profile-less first install still repairs the profile (nvm.sh exists → installer is skipped).
    const profileIdx = setupSh.indexOf('touch "$PROFILE_FILE"');
    const nvmSkipIdx = setupSh.indexOf('if [ ! -s "$NVM_DIR/nvm.sh" ]');
    expect(profileIdx).toBeGreaterThan(0);
    expect(profileIdx).toBeLessThan(nvmSkipIdx);
  });

  it('covers the fringe shells honestly: fish gets a direct PATH entry, Alpine gets a warning', () => {
    // fish never reads the POSIX profile and nvm has no fish support — the pinned Node's bin dir
    // goes straight into config.fish (best-effort, marker-guarded).
    expect(setupSh).toMatch(/config\.fish/);
    expect(setupSh).toMatch(/set -gx PATH/);
    // Alpine/musl has no prebuilt Node — warn up front rather than let a source-compile failure
    // masquerade as a network problem.
    expect(setupSh).toMatch(/\/etc\/alpine-release/);
  });

  it('does NOT provision Git — that moved to the engine/browser (Option C)', () => {
    expect(setupSh).not.toMatch(/xcode-select/);
    expect(setupSh).not.toMatch(/apt-get/);
  });
});

describe('bootstrap/setup.ps1 (Windows — AC3 guidance)', () => {
  it('explains SmartScreen + exec-policy as expected/safe/reversible', () => {
    expect(setupPs1).toMatch(/SmartScreen/);
    expect(setupPs1).toMatch(/Run anyway/);
    expect(setupPs1).toMatch(/reversible/i);
    expect(setupPs1).toMatch(/npx -y "@aiviatic\/kindling@/); // launches Kindling
  });

  it('launches via the absolute provisioned node when portable (clean-runtime, 2.6)', () => {
    expect(setupPs1).toMatch(/\$NodeExe/);
    expect(setupPs1).toMatch(/\$LASTEXITCODE -ne 0/); // native-exit failure handling
    // Parity guard: the PS npx-cli layout must match the TS composer's npxCliPath (no drift).
    const tail = npxCliPath('X/node.exe').split(/[\\/]/).slice(1).join('\\'); // node_modules\npm\bin\npx-cli.js
    expect(setupPs1).toContain(tail);
  });

  it('persists the portable Node dir to the USER-scope PATH (regression guard for the macOS bug family)', () => {
    // "Installs fine but PATH never persisted" is exactly what bit macOS — pin the Windows
    // mechanism: Add-UserPath must exist, write user-scope via SetEnvironmentVariable (never
    // setx, which truncates at 1024 chars), prune stale version-suffixed Node dirs, and be
    // CALLED with the provisioned Node dir.
    expect(setupPs1).toMatch(/function Add-UserPath/);
    expect(setupPs1).toMatch(/SetEnvironmentVariable\('Path', \$new, 'User'\)/);
    expect(setupPs1).not.toMatch(/\bsetx\b/i);
    expect(setupPs1).toMatch(/StartsWith\("\$nodeRoot\\"/); // stale pinned-Node dirs pruned
    expect(setupPs1).toMatch(/if \(\$NodeExe\) \{ Add-UserPath \(Split-Path \$NodeExe\) \}/);
  });

  it('is self-contained for the `irm | iex` delivery — helpers inlined, no on-disk dot-source', () => {
    // Run via `irm … | iex`, setup.ps1 is NOT a file on disk, so there is no $PSScriptRoot and it
    // cannot dot-source a sibling. The helpers must be inlined (mirrors setup.sh's inline helpers).
    // Assert on the CODE, not the `#` comments (which mention $PSScriptRoot/lib to explain the change).
    const ps1Code = setupPs1.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(ps1Code).not.toContain('$PSScriptRoot'); // no dot-source of a sibling
    expect(ps1Code).not.toMatch(/lib[\\/]common\.ps1/);
    expect(setupPs1).toMatch(/function Say/); // helpers inlined (defined in this file)
    expect(setupPs1).toMatch(/function Test-NodeOk/); // the inlined helper the flow calls
  });
});

describe('pinned versions match the engine SSOT (no drift)', () => {
  it('setup.sh embeds pins.node, pins.kindling, and the nvm version', () => {
    expect(setupSh).toContain(`KINDLING_NODE_VERSION="${pins.node}"`);
    expect(setupSh).toContain(`KINDLING_VERSION="${pins.kindling}"`);
    expect(setupSh).toContain(`NVM_VERSION="${NVM_VERSION}"`);
  });

  it('setup.ps1 embeds pins.node + pins.kindling', () => {
    expect(setupPs1).toContain(`$KindlingNodeVersion = '${pins.node}'`);
    expect(setupPs1).toContain(`$KindlingVersion     = '${pins.kindling}'`);
  });
});
