import type { ValidationSummary } from '../engine/validation-summary';

/**
 * Terminal message printed when the user quits from a pre-start screen (nothing was installed).
 * The cancel counterpart to buildCompletionText, so the terminal confirms the cancel instead of
 * exiting silently. Matches the browser Stopped screen's "canceled" wording.
 */
export const CANCELED_TEXT =
  '\nSetup canceled. Nothing was installed.\n\nYou can close this terminal window whenever you like.';

// Tidy a raw version string for the terminal: "v24.16.0" -> "24.16.0", "git version 2.43.0" -> "2.43.0".
function cleanVersion(v: string): string {
  return v.replace(/^git version\s+/i, '').replace(/^v/, '').trim();
}

/**
 * The plain-text summary the CLI prints to the terminal right before it exits on a successful run.
 * A user who already closed the browser tab still gets confirmation + a recap of what was set up
 * (project, framework, tools, and the system pieces). Pure and defensive: a malformed or absent
 * summary degrades to the bare confirmation line and never throws. ASCII only, so it renders the
 * same on every terminal (including Windows).
 */
export function buildCompletionText(summaryJson: string, fallbackProjectDir?: string): string {
  let s: Partial<ValidationSummary> = {};
  try {
    s = JSON.parse(summaryJson) as Partial<ValidationSummary>;
  } catch {
    // leave s empty -> minimal message
  }

  const rows: [string, string][] = [];
  const projectDir = (typeof s.projectDir === 'string' && s.projectDir) || fallbackProjectDir;
  if (projectDir) rows.push(['Project', projectDir]);

  const fw = s.frameworkInfo;
  if (fw && typeof fw.label === 'string' && typeof fw.version === 'string') {
    rows.push(['Framework', `${fw.label} ${fw.version}`]);
  }

  const tools = (Array.isArray(s.cli) ? s.cli : [])
    .filter((c) => c && c.present && typeof c.name === 'string')
    .map((c) => c.name);
  if (tools.length > 0) rows.push(['Tools', tools.join(', ')]);

  const sys: string[] = [];
  if (s.node?.version) sys.push(`Node ${cleanVersion(s.node.version)}`);
  if (s.git?.version) sys.push(`Git ${cleanVersion(s.git.version)}`);
  if (sys.length > 0) rows.push(['System', sys.join(', ')]);

  const lines: string[] = ['', 'All done. Your project is set up and ready.', ''];
  if (rows.length > 0) {
    const pad = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) lines.push(`  ${k.padEnd(pad)}   ${v}`);
    lines.push('');
  }
  lines.push('You can close this terminal window whenever you like.');
  return lines.join('\n');
}
