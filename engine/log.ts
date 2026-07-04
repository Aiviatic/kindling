import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { KindlingEvent, StepId } from './contract';

// Where failure logs live: %LOCALAPPDATA%\kindling\logs on Windows, else ~/.kindling/logs.
export function defaultLogDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'kindling', 'logs');
  }
  return join(homedir(), '.kindling', 'logs');
}

export interface FailureLogEntry {
  step: StepId;
  error: string;
  events: readonly KindlingEvent[];
}

export interface WriteLogOptions {
  dir?: string;
  now?: () => string;
}

function render(entry: FailureLogEntry, timestamp: string): string {
  const lines: string[] = [
    `Kindling failure report`,
    `Generated: ${timestamp}`,
    `Failed step: ${entry.step}`,
    ``,
    `Error:`,
    entry.error,
    ``,
    `Event log:`,
    ...entry.events.map((e) => `  [${e.status}] ${e.step} - ${e.humanMessage}`),
    ``,
  ];
  return lines.join('\n');
}

/**
 * Writes a local, human-readable failure report and returns its path. Local-only (no network).
 * Deliberately does NOT include the config object, environment variables, or any credentials
 * (NFR7) — just the failed step, the error message, and the event log.
 */
export async function writeFailureLog(entry: FailureLogEntry, opts: WriteLogOptions = {}): Promise<string> {
  const dir = opts.dir ?? defaultLogDir();
  const timestamp = (opts.now ?? (() => new Date().toISOString()))();
  const safeStamp = timestamp.replace(/[:.]/g, '-');
  // Short random suffix so two failures in the same millisecond don't overwrite each other.
  const suffix = randomUUID().slice(0, 8);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `kindling-report-${safeStamp}-${suffix}.log`);
  await writeFile(path, render(entry, timestamp));
  return path;
}
