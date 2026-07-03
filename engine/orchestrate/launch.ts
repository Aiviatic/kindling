import { dirname, join } from 'node:path';

export interface LaunchRuntime {
  /** Absolute path to the provisioned node binary, or null to use `node`/`npx` on PATH
   *  (a reused system Node, or nvm sourced same-shell). See ProvisionResult.nodeExe. */
  nodeExe: string | null;
  /** Pinned Kindling version (pins.kindling). */
  kindlingVersion: string;
}

export interface LaunchCommand {
  cmd: string;
  args: string[];
}

/** Path to npx's CLI script beside a provisioned node binary (the npm bundled with the dist). */
export function npxCliPath(nodeExe: string): string {
  return join(dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npx-cli.js');
}

/**
 * Compose the command to launch Kindling once Node is provisioned (Story 2.6). The clean-runtime
 * rule (AR6): never depend on a freshly-mutated PATH —
 *  - `nodeExe === null` → Node is already on PATH (nvm sourced same-shell, or a reused system
 *    Node) → plain `npx -y @aiviatic/kindling@<pin>`.
 *  - `nodeExe` set (Windows portable, absolute) → invoke npx's CLI through that exact node binary,
 *    so the launch works without the portable Node ever being on PATH.
 * Pure — the bootstrap (or a future Windows launcher) spawns the returned command.
 */
export function composeLaunchCommand({ nodeExe, kindlingVersion }: LaunchRuntime): LaunchCommand {
  const spec = `@aiviatic/kindling@${kindlingVersion}`;
  if (nodeExe === null) {
    return { cmd: 'npx', args: ['-y', spec] };
  }
  return { cmd: nodeExe, args: [npxCliPath(nodeExe), '-y', spec] };
}
