import type { ExecResult } from './exec';

export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;

// Shared "is this tool present, and what version?" probe. SSOT for the "present" definition:
// the tool counts as present only if `<cmd> --version` exits 0 AND prints non-empty output
// (stderr used as a fallback for tools that print there). Returns null when absent/unspawnable.
export async function probeVersion(exec: Exec, cmd: string): Promise<string | null> {
  try {
    const r = await exec(cmd, ['--version']);
    const out = r.stdout.trim() || r.stderr.trim();
    return r.code === 0 && out ? out : null;
  } catch {
    return null;
  }
}
