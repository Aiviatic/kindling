import { describe, it, expect } from 'vitest';
import { buildCompletionText } from './completion-message';

const fullSummary = JSON.stringify({
  schemaVersion: 5,
  success: true,
  projectDir: '/Users/ada/My Projects/My Project',
  framework: 'bmad',
  frameworkInfo: { label: 'BMad Method', version: '6.9.0', note: 'a stable, tested version' },
  node: { present: true, version: 'v24.16.0', satisfiesFloor: true },
  git: { present: true, version: 'git version 2.43.0' },
  cli: [
    { id: 'claude-code', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code', present: true },
    { id: 'codex', name: 'Codex', bin: 'codex', pkg: '@openai/codex', present: false },
  ],
});

describe('buildCompletionText', () => {
  it('confirms completion and recaps project, framework, present tools, and system', () => {
    const t = buildCompletionText(fullSummary);
    expect(t).toContain('All done. Your project is set up and ready.');
    expect(t).toContain('/Users/ada/My Projects/My Project');
    expect(t).toContain('BMad Method 6.9.0');
    expect(t).toContain('Claude Code'); // present tool listed
    expect(t).not.toContain('Codex'); // absent tool omitted
    expect(t).toContain('Node 24.16.0'); // leading 'v' stripped
    expect(t).toContain('Git 2.43.0'); // 'git version ' prefix stripped
    expect(t).toContain('You can close this terminal window whenever you like.');
    // ASCII only (renders the same on every terminal).
    // eslint-disable-next-line no-control-regex
    expect(t).toMatch(/^[\x00-\x7F]*$/);
  });

  it("omits the Framework row for 'No framework' (frameworkInfo null)", () => {
    const t = buildCompletionText(JSON.stringify({ projectDir: '/p', frameworkInfo: null, cli: [] }));
    expect(t).not.toContain('Framework');
    expect(t).toContain('All done. Your project is set up and ready.');
    expect(t).toContain('You can close this terminal window whenever you like.');
  });

  it('shows an OpenSpec framework row', () => {
    const t = buildCompletionText(
      JSON.stringify({ frameworkInfo: { label: 'OpenSpec', version: '1.5.0', note: 'x' }, cli: [] }),
    );
    expect(t).toContain('OpenSpec 1.5.0');
  });

  it('degrades to the bare confirmation on a malformed summary, using the fallback project dir', () => {
    const t = buildCompletionText('not json at all', '/fallback/proj');
    expect(t).toContain('All done. Your project is set up and ready.');
    expect(t).toContain('/fallback/proj');
    expect(t).toContain('You can close this terminal window whenever you like.');
  });
});
