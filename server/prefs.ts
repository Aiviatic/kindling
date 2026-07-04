import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** Small cross-run preferences file (currently just the last-used projects folder). */
export interface Prefs {
  lastProjectFolder?: string;
}

/** Where prefs live: `~/.kindling/prefs.json` (kept out of any project folder). */
export function prefsPath(): string {
  return join(homedir(), '.kindling', 'prefs.json');
}

/**
 * Recover the "where your projects go" folder from a composed projectDir. Configure always
 * composes `<folder>/<name>`, so the folder is the dir minus the trailing `/<name>` (either
 * separator). Returns null when the dir doesn't end with the name — nothing worth saving.
 * Pure — works on the UNexpanded value so a `~/My Projects` prefill round-trips verbatim.
 */
export function projectFolderOf(projectDir: string, projectName: string): string | null {
  for (const sep of ['/', '\\']) {
    const suffix = sep + projectName;
    if (projectDir.length > suffix.length && projectDir.endsWith(suffix)) {
      return projectDir.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * Read the last-used projects folder, or null when the file is absent/unreadable/malformed —
 * every failure degrades to "no prefill" (injectable reader for tests).
 */
export async function readLastProjectFolder(
  read: (path: string) => Promise<string> = (p) => readFile(p, 'utf8'),
  path: string = prefsPath(),
): Promise<string | null> {
  try {
    const parsed = JSON.parse(await read(path)) as { lastProjectFolder?: unknown };
    return typeof parsed.lastProjectFolder === 'string' && parsed.lastProjectFolder.length > 0
      ? parsed.lastProjectFolder
      : null;
  } catch {
    return null;
  }
}

/**
 * Persist the last-used projects folder. Best-effort: a write failure is swallowed — prefs are
 * a convenience, never allowed to fail a run (injectable writer for tests).
 */
export async function saveLastProjectFolder(
  folder: string,
  write: (path: string, contents: string) => Promise<void> = async (p, c) => {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, c, 'utf8');
  },
  path: string = prefsPath(),
): Promise<void> {
  try {
    await write(path, JSON.stringify({ lastProjectFolder: folder } satisfies Prefs, null, 2) + '\n');
  } catch {
    // best-effort — a failed save must never affect the install
  }
}
