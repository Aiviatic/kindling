import { exec as defaultExec, type ExecResult } from '../engine/exec';

export interface OpenBrowserOptions {
  exec?: (cmd: string, args: string[]) => Promise<ExecResult>;
  platform?: NodeJS.Platform;
}

// Best-effort: opens `url` in the default browser. NEVER throws; returns whether the open
// command launched. The printed/returned URL is the real contract (FR5 — auto-open is decoration).
export async function openBrowser(url: string, opts: OpenBrowserOptions = {}): Promise<boolean> {
  const exec = opts.exec ?? defaultExec;
  const platform = opts.platform ?? process.platform;

  // `cmd.exe` is a real executable (spawns fine with shell:false); `start` is its builtin, and
  // its first quoted arg is the window title (empty here).
  const [cmd, args]: [string, string[]] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  try {
    const r = await exec(cmd, args);
    return r.code === 0;
  } catch {
    return false;
  }
}
