import { describe, it, expect } from 'vitest';
import { composeInstallArgs } from './flags';
import type { Config } from '../contract';

function config(overrides: Partial<Config> = {}): Config {
  return {
    projectDir: '/tmp/proj',
    projectName: 'proj',
    ides: [],
    modules: [],
    pins: { node: '24.16.0', bmad: '6.1.2', kindling: '0.0.0' },
    ...overrides,
  };
}

describe('composeInstallArgs', () => {
  it('always includes install --yes --directory (version pin is the npx package spec, not a flag)', () => {
    expect(composeInstallArgs(config())).toEqual(['install', '--yes', '--directory', '/tmp/proj']);
  });

  it('does not emit a --pin flag (verified against the real bmad-method 6.9.0 CLI)', () => {
    expect(composeInstallArgs(config({ modules: ['bmm'], ides: ['claude-code'] }))).not.toContain('--pin');
  });

  it('omits --action for a fresh install, adds --action update on a re-run (2.7)', () => {
    expect(composeInstallArgs(config())).not.toContain('--action');
    const updateArgs = composeInstallArgs(config(), 'update');
    expect(updateArgs).toContain('--action');
    expect(updateArgs[updateArgs.indexOf('--action') + 1]).toBe('update');
  });

  it('adds --modules and --tools as CSV when present', () => {
    const args = composeInstallArgs(config({ modules: ['bmm', 'cis'], ides: ['claude-code', 'vscode'] }));
    expect(args).toContain('--modules');
    expect(args[args.indexOf('--modules') + 1]).toBe('bmm,cis');
    expect(args).toContain('--tools');
    expect(args[args.indexOf('--tools') + 1]).toBe('claude-code,vscode');
  });

  it('omits --modules/--tools when empty', () => {
    const args = composeInstallArgs(config());
    expect(args).not.toContain('--modules');
    expect(args).not.toContain('--tools');
  });

  it('passes the --set escape hatch as repeated key=value', () => {
    const args = composeInstallArgs(config({ set: { 'bmm.foo': 'bar', 'core.x': 'y' } }));
    expect(args.filter((a) => a === '--set')).toHaveLength(2);
    expect(args).toContain('bmm.foo=bar');
    expect(args).toContain('core.x=y');
  });

  it('rejects a module/IDE value containing a comma', () => {
    expect(() => composeInstallArgs(config({ modules: ['bmm,evil'] }))).toThrow(/comma/);
    expect(() => composeInstallArgs(config({ ides: ['code,bad'] }))).toThrow(/comma/);
  });
});
