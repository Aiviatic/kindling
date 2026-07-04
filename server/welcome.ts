import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cliLoginGuidance,
  cliMissing,
  bmadVersionLabel,
  type CliPresence,
  type ValidationSummary,
} from '../engine/validation-summary';

export interface WelcomeData {
  /** Pinned BMad version — the fallback for the versions table's BMad row. */
  bmadVersion: string;
  /** The engine's Validation Summary JSON (already serialized) — the table reads versions from it. */
  summaryJson: string;
}

// "BMad" as a link to the BMAD-METHOD repo (mirrors the React <BmadLink>). `label` lets a caller
// link a longer phrase like "BMad Method". Opens in a new tab.
const BMAD_URL = 'https://docs.bmad-method.org/';
function bmadLink(label = 'BMad'): string {
  return `<a href="${BMAD_URL}" target="_blank" rel="noreferrer">${label}</a>`;
}

// HTML-escape for safe interpolation into the static page (the summary is machine-generated,
// but escape defensively so no value can break out of the text/attribute context).
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Join a list of already-escaped fragments with English separators (", ", " or " / " and ").
function joinHuman(parts: string[], last: string): string {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ` ${last} ` + parts[parts.length - 1];
}

// Derive the FR25 login line + the AC-8 install-it-yourself notice from the embedded summary's
// `cli` presence (the SAME pure helpers the React Welcome uses, so the copy is identical). Returns
// escaped HTML fragments; empty string when the summary has no CLI info (line simply omitted).
function cliGuidanceHtml(summaryJson: string): string {
  let cli: CliPresence[];
  try {
    const parsed = JSON.parse(summaryJson) as Pick<ValidationSummary, 'cli'>;
    cli = Array.isArray(parsed.cli) ? parsed.cli : [];
  } catch {
    return '';
  }
  const present = cliLoginGuidance({ cli });
  const missing = cliMissing({ cli });
  let html = '';
  if (present.length > 0) {
    const cmds = joinHuman(
      present.map((c) => `<code>${esc(c.bin)}</code>`),
      'or',
    );
    html += `  <p class="cli-guidance"><b>One last step:</b> open a terminal, run ${cmds}, and log in, then you're all set.</p>\n`;
  }
  if (missing.length > 0) {
    const cmds = joinHuman(
      missing.map((c) => `<code>npm install -g ${esc(c.pkg)}</code>`),
      'and',
    );
    html += `  <p class="cli-guidance">Your AI assistant didn’t finish installing. Your project is still ready. To install it yourself, run ${cmds}, then start it and log in.</p>\n`;
  }
  return html;
}

/**
 * Build the self-contained static Welcome page. It has NO external assets and embeds the
 * Validation Summary inline, so it keeps rendering on refresh after the ephemeral server has
 * exited (FR-12). Pure — returns the HTML string.
 */
// Read the honest version chip (Story 7.2 / AC-6) from the embedded summary. A latest run reports
// the ACTUAL installed version + "updated to latest"; the default pinned run (absent/null/equal
// installedVersion) keeps `bmadVersion` + "a stable, tested version". Tolerant of malformed JSON.
function versionChip(summaryJson: string, pinnedFallback: string): { version: string; note: string } {
  try {
    const parsed = JSON.parse(summaryJson) as { bmad?: { installedVersion?: string | null } };
    return bmadVersionLabel(parsed, pinnedFallback);
  } catch {
    return bmadVersionLabel(null, pinnedFallback);
  }
}

// Build the "what's installed" table from the embedded summary (mirrors the React Welcome table).
function versionsTableHtml(summaryJson: string, pinnedFallback: string): string {
  let node: { version: string | null } | undefined;
  let git: { version: string | null } | undefined;
  let cli: CliPresence[] = [];
  let projectDir: string | undefined;
  try {
    const p = JSON.parse(summaryJson) as {
      node?: { version: string | null };
      git?: { version: string | null };
      cli?: CliPresence[];
      projectDir?: unknown;
    };
    node = p.node;
    git = p.git;
    cli = Array.isArray(p.cli) ? p.cli : [];
    projectDir = typeof p.projectDir === 'string' ? p.projectDir : undefined;
  } catch {
    // Malformed summary: still show the BMad row (versionChip falls back to the pin).
  }
  const chip = versionChip(summaryJson, pinnedFallback);
  const rows: string[] = [];
  if (projectDir) rows.push(`<tr><th scope="row">Project folder</th><td>${esc(projectDir)}</td></tr>`);
  if (node) rows.push(`<tr><th scope="row">Node.js</th><td>${esc(node.version ?? 'Installed')}</td></tr>`);
  if (git) rows.push(`<tr><th scope="row">Git</th><td>${esc(git.version ?? 'Installed')}</td></tr>`);
  rows.push(
    `<tr><th scope="row">${bmadLink('BMad Method')}</th><td><strong>${esc(chip.version)}</strong> &middot; ${esc(chip.note)}</td></tr>`,
  );
  for (const c of cli) {
    rows.push(
      `<tr><th scope="row">${esc(c.name)}</th><td>${c.present ? '&#10003; Installed' : 'Not installed'}</td></tr>`,
    );
  }
  return `  <table class="versions">\n    <caption>Here's what's set up on your computer</caption>\n    <tbody>\n${rows
    .map((r) => '      ' + r)
    .join('\n')}\n    </tbody>\n  </table>\n`;
}

/**
 * Build the self-contained static Welcome page. NO external assets, so it keeps rendering on refresh
 * after the ephemeral server has exited (FR-12). Shows the versions table + the CLI login step.
 * Pure — returns the HTML string.
 */
export function buildWelcomeHtml(data: WelcomeData): string {
  const versionsTable = versionsTableHtml(data.summaryJson, data.bmadVersion);
  const cliGuidance = cliGuidanceHtml(data.summaryJson);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Kindling: You're ready</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#1b1410; color:#fff6ee;
    font-family:-apple-system,"Segoe UI Variable","Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { max-width:640px; padding:48px 32px; }
  h1 { font-size:34px; font-weight:900; letter-spacing:-.02em; margin:0 0 8px; }
  .eyebrow { font-size:12px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
    color:#ffc24a; margin:0; }
  .lede { font-size:20px; color:#d6b9a3; }
  a { color:#ff6a1f; }
  .cli-guidance { color:#d6b9a3; }
  code { background:#34271e; border:1px solid #5a3c20; border-radius:6px; padding:1px 6px;
    color:#ffc24a; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  table.versions { width:100%; border-collapse:collapse; margin:24px 0; text-align:left; }
  .versions caption { text-align:left; color:#d6b9a3; font-weight:700; margin-bottom:8px; }
  .versions th, .versions td { padding:8px 12px; border-bottom:1px solid #463429; }
  .versions th { font-weight:700; color:#d6b9a3; }
  .versions td { color:#fff6ee; }
</style>
</head>
<body>
<main>
  <p class="eyebrow">All set</p>
  <h1>You're ready &#128293;</h1>
  <p class="lede">Your project is set up with ${bmadLink()} and your tools. Open it in your editor to start building, and close this browser tab whenever you like.</p>
${versionsTable}${cliGuidance}  <p class="cli-guidance">Once you're in, just describe what you want to build. You can also type <code>/bmad-help</code> to see what ${bmadLink()} can do.</p>
  <p class="cli-guidance">Want another project later? Run Kindling again. It remembers where your projects go.</p>
  <p><a href="https://aiviatic.com" target="_blank" rel="noreferrer">Join an Aiviatic workshop</a>, totally optional.</p>
</main>
</body>
</html>
`;
}

/** Write the self-contained Welcome page to `dir/welcome.html` (injectable writer for tests). */
export async function writeWelcomeHtml(
  dir: string,
  data: WelcomeData,
  write: (path: string, contents: string) => Promise<void> = (p, c) => writeFile(p, c, 'utf8'),
): Promise<string> {
  const path = join(dir, 'welcome.html');
  await write(path, buildWelcomeHtml(data));
  return path;
}
