// The Validation Summary: the structured, copyable proof a successful install produces (FR21).
// The Epic 4 Validation Page checks this client-side against the cohort's expected pin.
// Bump SCHEMA_VERSION on any field change.

// v2 (Story 6.2): added the non-blocking `cli` presence field (FR24). A v1 summary pasted into a
// v2 Validation Page reads as `malformed` (the cohort is a single frozen build, so this is safe).
// v3 (Story 7.1): added `bmad.installedVersion` — the ACTUAL on-disk BMad version read from the
// manifest (FR26), distinct from the requested `bmad.pinnedVersion`. Same single-frozen-build
// safety: a v2 summary pasted into a v3 Validation Page reads as `malformed`.
// v4 (method providers): added `method` (the chosen method id, e.g. 'bmad'|'none'); `success` now
// gates on the method INSTALL step succeeding, not on BMad specifically (so "No framework" can pass).
export const SCHEMA_VERSION = 4;

/** Node runtime floor (BMad's hard requirement). */
export const NODE_FLOOR_MAJOR = 20;

/**
 * Presence of one requested agent CLI in the final self-check (FR24). Self-describing — it carries
 * `name`/`bin`/`pkg` so the browser Validation Page and both Welcome renderers render copy WITHOUT
 * re-importing the engine's `AGENT_CLI_TABLE`. `pkg` lets the "install-it-yourself" notice (AC-8)
 * show the exact `npm install -g <pkg>` command for an absent CLI. NON-blocking: this never feeds
 * `success` (AC-6). Empty list when no CLI was requested (present for schema stability).
 */
export interface CliPresence {
  id: string;
  name: string;
  bin: string;
  pkg: string;
  present: boolean;
}

export interface ValidationSummary {
  schemaVersion: number;
  kindlingVersion: string;
  os: string;
  arch: string;
  osVersion: string;
  /** The project directory the setup targeted — surfaced on the Welcome screen as "where is my project". */
  projectDir: string;
  /** The chosen project method id (`config.method`, default 'bmad'; 'none' = no framework). */
  method: string;
  node: { present: boolean; version: string | null; satisfiesFloor: boolean };
  git: { present: boolean; version: string | null };
  /**
   * BMad-specific facts. `pinnedVersion` = the REQUESTED cohort pin (`pins.bmad`); `installed` =
   * BMad is on disk (only true when the method IS bmad and it installed); `installedVersion` (FR26)
   * = the ACTUAL version read from the manifest — `null` when the manifest is absent/unreadable
   * (honest "couldn't read disk reality", never a false pin). For a non-bmad method `installed`
   * is false. The consumers gate BMad-specific UI on `method === 'bmad'` / `bmad.installed`.
   */
  bmad: { pinnedVersion: string; installed: boolean; installedVersion: string | null };
  scaffold: { created: boolean };
  /** Requested agent CLIs + their presence (FR24). NON-blocking — never part of `success`. */
  cli: CliPresence[];
  success: boolean;
  generatedAt: string;
}

export interface ValidationFacts {
  kindlingVersion: string;
  os: string;
  arch: string;
  osVersion: string;
  projectDir: string;
  /** Chosen method id (drives `summary.method`). */
  method: string;
  /** The method INSTALL step succeeded — the gate for `success` (for 'none' this is trivially true). */
  methodInstalled: boolean;
  node: { present: boolean; version: string | null; satisfiesFloor: boolean };
  git: { present: boolean; version: string | null };
  bmad: { pinnedVersion: string; installed: boolean; installedVersion: string | null };
  scaffold: { created: boolean };
  cli: CliPresence[];
  generatedAt: string;
}

// Pure. `success` is a strict AND of the real checks — no false green (FR21 / SM-C1). The `cli`
// field is DELIBERATELY excluded from `success` (FR24 / AC-6): a CLI that didn't install is
// reported but never flips the verdict.
export function buildValidationSummary(facts: ValidationFacts): ValidationSummary {
  const success =
    facts.node.present &&
    facts.node.satisfiesFloor &&
    facts.git.present &&
    facts.methodInstalled &&
    facts.scaffold.created;

  return {
    schemaVersion: SCHEMA_VERSION,
    kindlingVersion: facts.kindlingVersion,
    os: facts.os,
    arch: facts.arch,
    osVersion: facts.osVersion,
    projectDir: facts.projectDir,
    method: facts.method,
    node: facts.node,
    git: facts.git,
    bmad: facts.bmad,
    scaffold: facts.scaffold,
    cli: facts.cli,
    success,
    generatedAt: facts.generatedAt,
  };
}

/**
 * Runtime shape guard for one `cli` element. The Validation Page parses an UNTRUSTED pasted string
 * whose `cli` can be any JSON (e.g. an adversarial `"cli":[null]`) — `looksLikeSummary` never
 * inspects `cli` element shape — so the presence helpers below must not assume it. Dropping a
 * malformed element (rather than throwing) keeps the public page and the Welcome render resilient.
 */
export function isCliPresence(c: unknown): c is CliPresence {
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof (c as CliPresence).name === 'string' &&
    typeof (c as CliPresence).bin === 'string' &&
    typeof (c as CliPresence).pkg === 'string' &&
    typeof (c as CliPresence).present === 'boolean'
  );
}

/**
 * The requested CLIs that ARE present after the run — drives the FR25 login guidance ("run `claude`
 * and log in"). Pure + shared so the React Welcome and the static welcome.html render identical copy
 * from one source. Tolerant of a missing/legacy `cli` field or a malformed element (returns []/skips).
 */
export function cliLoginGuidance(summary: Pick<ValidationSummary, 'cli'>): CliPresence[] {
  return (summary.cli ?? []).filter(isCliPresence).filter((c) => c.present);
}

/**
 * The requested CLIs that are ABSENT after the run — drives the calm, non-blocking "didn't finish
 * installing — here's the one line to install it, then log in" notice (AC-8). Order-robust: derived
 * from the summary's actual presence, not the transient step row. Skips malformed elements.
 */
export function cliMissing(summary: Pick<ValidationSummary, 'cli'>): CliPresence[] {
  return (summary.cli ?? []).filter(isCliPresence).filter((c) => !c.present);
}

/**
 * The honest BMad version chip (Story 7.2 / FR26). Pure + shared so the React Welcome and the static
 * welcome.html render identical copy from ONE source. When the summary carries an `installedVersion`
 * (7.1's manifest read) that is a non-empty string DIFFERING from the pinned fallback, the run was an
 * update-to-latest, so the pinned "a stable, tested version" chip would be a false statement; show
 * the real installed version + "updated to latest". Otherwise (absent/null/equal, the default run,
 * unchanged) fall back to the pinned chip. Never blank, never a crash. Node-free (browser-safe).
 */
export function bmadVersionLabel(
  summary: { bmad?: { installedVersion?: string | null } } | null | undefined,
  pinnedFallback: string,
): { version: string; note: string } {
  const installed = summary?.bmad?.installedVersion;
  if (typeof installed === 'string' && installed.length > 0 && installed !== pinnedFallback) {
    return { version: installed, note: 'updated to latest' };
  }
  return { version: pinnedFallback, note: 'a stable, tested version' };
}

/**
 * Parse a major version from version strings: `v24.16.0`, `24.16.0`, `v20.0`, `v20`,
 * `git version 2.43.0.windows.1`, `v24.0.0-nightly…`. Null if no leading integer is found.
 */
export function parseMajor(version: string | null): number | null {
  if (!version) return null;
  const m = /(\d+)(?:\.\d+){0,2}/.exec(version);
  return m ? Number(m[1]) : null;
}
