import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { composeLaunchCommand, npxCliPath } from './launch';
import { pins } from '../pins';

describe('composeLaunchCommand', () => {
  it('uses npx on PATH when Node is already available (nvm same-shell / reused system Node)', () => {
    expect(composeLaunchCommand({ nodeExe: null, kindlingVersion: pins.kindling })).toEqual({
      cmd: 'npx',
      args: ['-y', `@aiviatic/kindling@${pins.kindling}`],
    });
  });

  it('invokes the absolute provisioned node + npx CLI (Windows portable — no PATH reliance)', () => {
    const nodeExe = join('/tmp/kindling/node', 'node-v24.16.0-win-x64', 'node.exe');
    const cmd = composeLaunchCommand({ nodeExe, kindlingVersion: pins.kindling });
    expect(cmd.cmd).toBe(nodeExe);
    expect(cmd.args[0]).toBe(npxCliPath(nodeExe));
    expect(cmd.args[0]).toBe(join(dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npx-cli.js'));
    expect(cmd.args.slice(1)).toEqual(['-y', `@aiviatic/kindling@${pins.kindling}`]);
  });
});
