#!/usr/bin/env node
// Generate ui/public/platform-codes.yaml from the PINNED bmad-method's `install --list-tools`.
//
// Run on every pins.bmad bump:   npm run gen:platform-codes
//
// Why derived-from-the-pin (not "latest"): Kindling installs `bmad-method@<pins.bmad>`, so the
// picker must offer exactly the tools THAT version accepts — otherwise a user picks an id the
// pinned install can't honor and `--tools <id>` fails. Pulling "latest" would also break cohort
// reproducibility (home == workshop, NFR-3). The output is committed so the app and the test
// suite never depend on the network at build/CI time; regenerate deliberately when the pin moves.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pinsPath = join(root, 'engine', 'pins.ts');
const outPath = join(root, 'ui', 'public', 'platform-codes.yaml');

// SSOT: read the BMad pin straight from engine/pins.ts.
const pin = readFileSync(pinsPath, 'utf8').match(/bmad:\s*'([^']+)'/)?.[1];
if (!pin) {
  console.error('gen-platform-codes: could not read pins.bmad from engine/pins.ts');
  process.exit(1);
}

console.error(`gen-platform-codes: fetching tool list from bmad-method@${pin} …`);
let out;
try {
  out = execFileSync('npx', ['-y', `bmad-method@${pin}`, 'install', '--list-tools'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'], // stream npm/CLI notices to our stderr
    shell: process.platform === 'win32', // resolve npx.cmd on Windows
  });
} catch {
  console.error(`gen-platform-codes: \`npx bmad-method@${pin} install --list-tools\` failed`);
  process.exit(1);
}

// Parse the fixed-column table. Rows sit between the `----` divider and the next blank line; each
// row is: optional `*` (recommended) + id + name + target dir, columns separated by 2+ spaces
// (ids never contain spaces, so a 2+-space split preserves multi-word names like "IBM Bob").
const lines = out.split('\n');
const divider = lines.findIndex((l) => /^\s*-{3,}/.test(l));
if (divider === -1) {
  console.error('gen-platform-codes: unexpected --list-tools output (no table divider)');
  process.exit(1);
}

const tools = [];
for (let i = divider + 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) break; // blank line ends the table
  const trimmed = line.trimStart();
  const recommended = trimmed.startsWith('*');
  const cols = (recommended ? trimmed.slice(1) : trimmed).trim().split(/\s{2,}/);
  const [id, name] = cols;
  if (cols.length < 2 || !/^[a-z0-9-]+$/.test(id)) continue; // skip stray/legend lines
  tools.push({ id, name, recommended });
}

if (tools.length === 0) {
  console.error('gen-platform-codes: parsed 0 tools — aborting to avoid clobbering the catalog');
  process.exit(1);
}

// Recommended first (matches the picker's collapsed view); order within each group is verbatim.
const ordered = [...tools.filter((t) => t.recommended), ...tools.filter((t) => !t.recommended)];

const yamlStr = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; // quote names defensively

const header = `# GENERATED — do not edit by hand. Regenerate on every pins.bmad bump:
#   npm run gen:platform-codes
#
# IDE / tool catalog for Kindling's IDE Picker (Story 3.4).
# SOURCE OF TRUTH: the \`id\` values are the exact \`--tools\` IDs accepted by
# \`bmad-method@${pin} install\`, captured verbatim from \`install --list-tools\`. A wrong id
# fails the install, so this file is DERIVED from the pin (engine/pins.ts), never hand-listed.
# \`recommended: true\` marks the IDs BMad stars (*). The UI shows recommended first; the rest
# are reachable via "show all". If missing/unreadable, the UI falls back to a built-in list.
`;

const body = ordered
  .map((t) => `  - { id: ${t.id}, name: ${yamlStr(t.name)}${t.recommended ? ', recommended: true' : ''} }`)
  .join('\n');

writeFileSync(outPath, `${header}ides:\n${body}\n`);
console.error(`gen-platform-codes: wrote ${ordered.length} tools to ui/public/platform-codes.yaml (pin ${pin}).`);
