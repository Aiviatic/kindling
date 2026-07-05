import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { buildWelcomeHtml, writeWelcomeHtml } from './welcome';

const data = {
  bmadVersion: '6.9.0',
  summaryJson: '{"schemaVersion":3,"success":true,"cli":[]}',
};

// A summary carrying a present CLI (drives the FR25 login line) and an absent one (drives the AC-8
// install-it-yourself notice). Serialized exactly as the engine emits it.
const summaryWith = (cli: unknown): string =>
  JSON.stringify({ schemaVersion: 3, success: true, cli });
const presentClaude = { id: 'claude-code', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code', present: true };
const absentCodex = { id: 'codex', name: 'Codex', bin: 'codex', pkg: '@openai/codex', present: false };

describe('buildWelcomeHtml', () => {
  it('is a self-contained page (no external assets) showing the versions table', () => {
    const html = buildWelcomeHtml(data);
    expect(html).toContain("You're ready");
    expect(html).toContain('6.9.0');
    expect(html).toContain('<table class="versions"');
    // Self-contained: no external <link>/<script src>.
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    // The copy-into-the-validation-page flow is gone.
    expect(html).not.toContain('id="copy"');
    expect(html).not.toContain('validation page');
  });

  it("framework 'none' omits the BMad row + /bmad-help; a legacy summary keeps them", () => {
    const none = buildWelcomeHtml({
      bmadVersion: '6.9.0',
      summaryJson: JSON.stringify({ schemaVersion: 4, success: true, cli: [], framework: 'none' }),
    });
    expect(none).not.toContain('BMad Method');
    expect(none).not.toContain('/bmad-help');
    expect(none).toContain('set up and ready for your tools');
    // A legacy summary (no framework) still shows BMad — backward compatible.
    expect(buildWelcomeHtml(data)).toContain('BMad Method');
  });

  it('shows Node / Git / CLI rows from the summary', () => {
    const html = buildWelcomeHtml({
      bmadVersion: '6.9.0',
      summaryJson: JSON.stringify({
        schemaVersion: 3,
        node: { version: '24.16.0' },
        git: { version: '2.43.0' },
        cli: [presentClaude],
      }),
    });
    expect(html).toMatch(/Node\.js/);
    expect(html).toContain('24.16.0');
    expect(html).toContain('2.43.0');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Installed');
  });

  it('HTML-escapes summary-derived values (e.g. a CLI name) so they cannot break out of the page', () => {
    const html = buildWelcomeHtml({
      bmadVersion: '6.9.0',
      summaryJson: JSON.stringify({
        schemaVersion: 3,
        cli: [{ id: 'x', name: '<script>x</script>', bin: 'x', pkg: 'x', present: true }],
      }),
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('renders the FR25 login line naming a present CLI command; omits it when none (Story 6.2)', () => {
    const withCli = buildWelcomeHtml({ bmadVersion: '6.9.0', summaryJson: summaryWith([presentClaude]) });
    expect(withCli).toContain('One last step');
    expect(withCli).toContain('<code>claude</code>');
    expect(withCli).toContain('log in');
    // No CLI requested → no login line.
    expect(buildWelcomeHtml(data)).not.toContain('One last step');
  });

  it('renders the AC-8 install-it-yourself notice (named, non-error) for an absent CLI (Story 6.2)', () => {
    const html = buildWelcomeHtml({ bmadVersion: '6.9.0', summaryJson: summaryWith([absentCodex]) });
    expect(html).toContain('didn’t finish installing');
    expect(html).toContain('<code>npm install -g @openai/codex</code>');
    // A present CLI shows the login line, not the install notice.
    const present = buildWelcomeHtml({ bmadVersion: '6.9.0', summaryJson: summaryWith([presentClaude]) });
    expect(present).not.toContain('didn’t finish installing');
  });

  it('malformed summaryJson yields no CLI guidance (defensive; Story 6.2)', () => {
    const html = buildWelcomeHtml({ bmadVersion: '6.9.0', summaryJson: 'not json' });
    expect(html).not.toContain('One last step');
    expect(html).not.toContain('didn’t finish installing');
  });

  // AC-6: static-page version-chip honesty for the latest path (mirrors the React Welcome).
  const summaryWithBmad = (installedVersion: string | null): string =>
    JSON.stringify({ schemaVersion: 3, success: true, cli: [], bmad: { installedVersion } });

  it('AC-6: an installedVersion differing from the pin shows the honest version + "updated to latest"', () => {
    const html = buildWelcomeHtml({ bmadVersion: '6.9.0', summaryJson: summaryWithBmad('6.10.0') });
    expect(html).toContain('<strong>6.10.0</strong> &middot; updated to latest');
    expect(html).not.toContain('a stable, tested version');
  });

  it('AC-6: an equal/null installedVersion keeps the pinned note', () => {
    const equal = buildWelcomeHtml({ bmadVersion: '6.9.0', summaryJson: summaryWithBmad('6.9.0') });
    expect(equal).toContain('<strong>6.9.0</strong> &middot; a stable, tested version');
    const none = buildWelcomeHtml({ bmadVersion: '6.9.0', summaryJson: summaryWithBmad(null) });
    expect(none).toContain('<strong>6.9.0</strong> &middot; a stable, tested version');
    // Malformed summary also falls back to the pinned note.
    expect(buildWelcomeHtml(data)).toContain('<strong>6.9.0</strong> &middot; a stable, tested version');
  });
});

describe('writeWelcomeHtml', () => {
  it('writes welcome.html into the given dir via the injected writer', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const path = await writeWelcomeHtml('/tmp/proj', data, write);
    // Build the expectation with join() too, so it holds on Windows (`\tmp\proj\welcome.html`)
    // as well as POSIX — writeWelcomeHtml returns an OS-native filesystem path.
    const expected = join('/tmp/proj', 'welcome.html');
    expect(path).toBe(expected);
    expect(write).toHaveBeenCalledOnce();
    const [writtenPath, contents] = write.mock.calls[0];
    expect(writtenPath).toBe(expected);
    expect(contents).toContain("You're ready");
  });
});
