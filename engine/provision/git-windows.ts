import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { exec as defaultExec, type ExecResult } from '../exec';
import type { EngineEmitter } from '../emitter';
import { Phase, StepId, Status, ErrorCode, type Level } from '../contract';
import { provisionMessages } from '../messages';

// Pinned portable Git for Windows. Unlike MinGit (the old, minimal build), PortableGit includes
// Git Bash (bin\bash.exe) — which Claude Code (desktop AND CLI) require on Windows. Bump the version
// URL and the SHA-256 together; the digest is published on each git-for-windows release asset.
export const PORTABLE_GIT_URL =
  'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.2/PortableGit-2.55.0.2-64-bit.7z.exe';
export const PORTABLE_GIT_SHA256 = 'b20d42da3afa228e9fa6174480de820282667e799440d655e308f700dfa0d0df';

// The PowerShell provisioner, run AFTER the user clicks Start (not in the bootstrap), so the ~55 MB
// download only happens on consent. Idempotent: it reuses an already-extracted PortableGit, and it
// replaces an older bash-less MinGit (detected by the missing bin\bash.exe). It persists git.exe on
// the User PATH and sets CLAUDE_CODE_GIT_BASH_PATH so Claude Code finds Git Bash. Verified on the
// headless Win11 VM. Prints `KINDLING_GIT_CMD=<dir>` as its last line so the engine can add git to
// its own process PATH for the scaffold step's `git init`.
export const GIT_PROVISION_PS = `$ErrorActionPreference='Stop'
try {
  $gitRoot = Join-Path $env:LOCALAPPDATA 'kindling\\git'
  $gitCmd  = Join-Path $gitRoot 'cmd'
  $gitBash = Join-Path $gitRoot 'bin\\bash.exe'
  if (-not (Test-Path $gitBash)) {
    $ProgressPreference='SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $url='${PORTABLE_GIT_URL}'
    $sha='${PORTABLE_GIT_SHA256}'
    $sfx=Join-Path $env:LOCALAPPDATA 'kindling\\portablegit.7z.exe'
    New-Item -ItemType Directory -Force -Path (Split-Path $sfx) | Out-Null
    Remove-Item $gitRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $gitRoot | Out-Null
    Invoke-WebRequest -Uri $url -OutFile $sfx -UseBasicParsing
    $actual=(Get-FileHash -Path $sfx -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $sha) { throw "Git download failed its integrity check (expected $sha, got $actual)." }
    $p=Start-Process -FilePath $sfx -ArgumentList @('-y',"-o$gitRoot") -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0) { throw "Git extraction failed (exit $($p.ExitCode))." }
    Remove-Item $sfx -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $gitBash)) { throw "Git was set up but bash.exe wasn't found at $gitBash." }
  }
  $cur=[Environment]::GetEnvironmentVariable('Path','User')
  $parts=@(($cur -split ';') | Where-Object { $_ -ne '' })
  if ($parts -notcontains $gitCmd) { [Environment]::SetEnvironmentVariable('Path', ((@($gitCmd)+$parts) -join ';'), 'User') }
  [Environment]::SetEnvironmentVariable('CLAUDE_CODE_GIT_BASH_PATH', $gitBash, 'User')
  Write-Output "KINDLING_GIT_CMD=$gitCmd"
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;

// Run the provisioner via Windows PowerShell, passing the script as -EncodedCommand (base64 of the
// UTF-16LE source) so there's no quoting/escaping to get wrong and nothing to ship as a separate file.
function defaultRun(script: string): Promise<ExecResult> {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return defaultExec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
}

export interface ProvisionGitWindowsOptions {
  emitter: EngineEmitter;
  /** Injectable runner (tests fake it); default spawns Windows PowerShell with the provisioner. */
  run?: (script: string) => Promise<ExecResult>;
  now?: () => string;
}

export interface ProvisionGitWindowsResult {
  ok: boolean;
  /** The provisioned git `cmd\\` dir, so the caller can put it on THIS process's PATH. */
  gitCmdDir?: string;
}

/**
 * Provision portable Git (incl. Git Bash) on Windows, emitting Working/Done/Failed on the Git step so
 * the browser shows honest progress during the download. The heavy lifting (download, SHA verify,
 * self-extractor, User-PATH + CLAUDE_CODE_GIT_BASH_PATH) is done by the bundled PowerShell script.
 */
export async function provisionGitWindows(opts: ProvisionGitWindowsOptions): Promise<ProvisionGitWindowsResult> {
  const run = opts.run ?? defaultRun;
  const now = opts.now ?? (() => new Date().toISOString());
  const emit = (status: Status, humanMessage: string, level: Level = 'info', errorCode?: ErrorCode): void => {
    opts.emitter.emit({
      id: randomUUID(),
      phase: Phase.Provision,
      step: StepId.ProvisionGit,
      status,
      humanMessage,
      level,
      timestamp: now(),
      errorCode,
    });
  };

  emit(Status.Working, provisionMessages.gitSettingUpWindows);
  let result: ExecResult;
  try {
    result = await run(GIT_PROVISION_PS);
  } catch {
    emit(Status.Failed, provisionMessages.gitInstallFailed, 'error', ErrorCode.ExecFailed);
    return { ok: false };
  }
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).slice(-400).trim();
    emit(
      Status.Failed,
      detail ? `${provisionMessages.gitInstallFailed}\n\n${detail}` : provisionMessages.gitInstallFailed,
      'error',
      ErrorCode.ExecFailed,
    );
    return { ok: false };
  }
  const match = /KINDLING_GIT_CMD=(.+)/.exec(result.stdout);
  emit(Status.Done, provisionMessages.gitInstalled);
  return { ok: true, gitCmdDir: match ? match[1].trim() : undefined };
}
