import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs a command as (cmd, args[]) — NEVER a shell string (no `shell: true`) — capturing
// stdout/stderr and the exit code. Callers pass absolute paths to provisioned runtimes.
// This is the only subprocess entry point in the engine (architecture: AR16 / Process Patterns).
export function exec(cmd: string, args: string[] = []): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    // shell:false — args-array only (no string-shell entry point).
    // stdin 'ignore' so a child that would read stdin gets EOF immediately (prevents hangs);
    // windowsHide suppresses a console-window flash on Windows.
    // NOTE: spawning Windows .cmd/.bat (e.g. npm/npx) requires shell:true — the install step
    // (Story 1.5) is the first caller to hit that; the Windows invocation strategy is decided
    // there (see deferred-work.md). For now exec runs real executables by absolute path.
    const child = spawn(cmd, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
