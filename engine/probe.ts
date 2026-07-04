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

// Present-and-version probe for an agent CLI bin (claude/codex) — the Windows-aware sibling of
// `probeVersion`. On Windows an `npm install -g` lays down a `claude.cmd` shim, and `exec` spawns
// with `shell:false`, which Node refuses to use for `.cmd`/`.bat`; a bare-bin probe would then
// always fail and wrongly report the CLI "absent". `cmd.exe` IS a real executable that spawns fine,
// so we run `cmd /c <bin> --version` to reach the shim. macOS/Linux keep the direct `<bin> --version`.
// "Present" is defined identically to `probeVersion`: exit 0 AND non-empty stdout-or-stderr; catch → null.
export async function probeCliVersion(
  exec: Exec,
  bin: string,
  isWindows: boolean,
): Promise<string | null> {
  try {
    const r = isWindows
      ? await exec('cmd', ['/c', bin, '--version'])
      : await exec(bin, ['--version']);
    const out = r.stdout.trim() || r.stderr.trim();
    return r.code === 0 && out ? out : null;
  } catch {
    return null;
  }
}
