import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Expand a leading `~` (or `~/…` / `~\…`) to the user's home directory; other paths pass through
 * unchanged. `~` is a shell convenience the OS filesystem APIs do NOT expand — and the UI's default
 * project dir is `~/kindling-project` — so we expand it before any mkdir/git/npx uses the path, or
 * the project would land in a literal `~` folder under the process cwd.
 */
export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}
