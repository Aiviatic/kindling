import { describe, it, expect } from 'vitest';
import {
  buildValidationSummary,
  cliLoginGuidance,
  cliMissing,
  parseMajor,
  SCHEMA_VERSION,
  type CliPresence,
  type ValidationFacts,
} from './validation-summary';

function facts(overrides: Partial<ValidationFacts> = {}): ValidationFacts {
  return {
    kindlingVersion: '0.0.0',
    os: 'darwin',
    arch: 'arm64',
    osVersion: '24.0.0',
    projectDir: '/Users/ada/projects/my-app',
    framework: 'bmad',
    frameworkInfo: { label: 'BMad Method', version: '6.1.2', note: 'a stable, tested version' },
    frameworkInstalled: true,
    node: { present: true, version: 'v24.16.0', satisfiesFloor: true },
    git: { present: true, version: 'git version 2.43.0' },
    bmad: { pinnedVersion: '6.1.2', installed: true, installedVersion: '6.1.2' },
    scaffold: { created: true },
    cli: [],
    generatedAt: '2026-05-29T00:00:00.000Z',
    ...overrides,
  };
}

const claude: CliPresence = {
  id: 'claude-code',
  name: 'Claude Code',
  bin: 'claude',
  pkg: '@anthropic-ai/claude-code',
  present: true,
};

describe('buildValidationSummary', () => {
  it('produces a full schema object and success=true when all checks pass', () => {
    const s = buildValidationSummary(facts());
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(5); // v5 — added `frameworkInfo` (per-framework Welcome row)
    expect(s.frameworkInfo).toEqual({ label: 'BMad Method', version: '6.1.2', note: 'a stable, tested version' });
    expect(s.success).toBe(true);
    expect(s.projectDir).toBe('/Users/ada/projects/my-app'); // threaded through to the summary
    // every schema field present
    expect(Object.keys(s).sort()).toEqual(
      [
        'arch',
        'bmad',
        'cli',
        'generatedAt',
        'git',
        'kindlingVersion',
        'framework',
        'frameworkInfo',
        'node',
        'os',
        'projectDir',
        'scaffold',
        'schemaVersion',
        'success',
        'osVersion',
      ].sort(),
    );
  });

  it('threads bmad.installedVersion through, and it never affects success (FR26 / 7.1)', () => {
    // A drifted install (installedVersion !== pinnedVersion) is still a green summary — the
    // honesty gate lands on the Validation Page, not inside buildValidationSummary (AC-2).
    const drifted = buildValidationSummary(
      facts({ bmad: { pinnedVersion: '6.9.0', installed: true, installedVersion: '6.8.0' } }),
    );
    expect(drifted.bmad.installedVersion).toBe('6.8.0');
    expect(drifted.success).toBe(true);
    // A null installedVersion (unreadable manifest) is reported as-is and still non-blocking here.
    const nullVersion = buildValidationSummary(
      facts({ bmad: { pinnedVersion: '6.9.0', installed: true, installedVersion: null } }),
    );
    expect(nullVersion.bmad.installedVersion).toBeNull();
    expect(nullVersion.success).toBe(true);
  });

  it('carries the cli presence field through, and it never affects success (FR24 / AC-6)', () => {
    const absent = buildValidationSummary(facts({ cli: [{ ...claude, present: false }] }));
    expect(absent.cli).toEqual([{ ...claude, present: false }]);
    expect(absent.success).toBe(true); // an absent CLI is NON-blocking — the green stays green
    expect(buildValidationSummary(facts({ cli: [] })).cli).toEqual([]);
  });

  it('cliLoginGuidance returns present CLIs; cliMissing returns absent ones', () => {
    const summary = buildValidationSummary(
      facts({ cli: [claude, { id: 'codex', name: 'Codex', bin: 'codex', pkg: '@openai/codex', present: false }] }),
    );
    expect(cliLoginGuidance(summary).map((c) => c.id)).toEqual(['claude-code']);
    expect(cliMissing(summary).map((c) => c.id)).toEqual(['codex']);
    expect(cliLoginGuidance({ cli: [] })).toEqual([]);
    expect(cliMissing({ cli: [] })).toEqual([]);
  });

  it('cli helpers skip a malformed element (adversarial paste) instead of throwing', () => {
    // The Validation Page parses untrusted JSON — a `cli:[null]` / partial element must not crash.
    const cli = [null, claude, { bogus: 1 }] as unknown as CliPresence[];
    expect(cliLoginGuidance({ cli }).map((c) => c.id)).toEqual(['claude-code']);
    expect(cliMissing({ cli })).toEqual([]);
  });

  it.each([
    ['node below floor', facts({ node: { present: true, version: 'v18.0.0', satisfiesFloor: false } })],
    ['node absent', facts({ node: { present: false, version: null, satisfiesFloor: false } })],
    ['git absent', facts({ git: { present: false, version: null } })],
    ['the framework install did not succeed', facts({ frameworkInstalled: false })],
    ['scaffold not created', facts({ scaffold: { created: false } })],
  ])('success=false when %s (no false green)', (_label, f) => {
    expect(buildValidationSummary(f).success).toBe(false);
  });
});

describe('parseMajor', () => {
  it('parses major from version strings, null when unparseable', () => {
    expect(parseMajor('v24.16.0')).toBe(24);
    expect(parseMajor('git version 2.43.0')).toBe(2);
    expect(parseMajor('git version 2.43.0.windows.1')).toBe(2);
    expect(parseMajor('v20')).toBe(20); // two-/one-component versions
    expect(parseMajor('v20.0')).toBe(20);
    expect(parseMajor('v24.0.0-nightly20260529')).toBe(24); // pre-release suffix tolerated
    expect(parseMajor(null)).toBeNull();
    expect(parseMajor('weird')).toBeNull();
  });
});
