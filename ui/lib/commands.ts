import type { Config, StepId, InspectResult } from '../../engine/contract';

// Minimal fetch signature we depend on (injectable for tests). `json?()` is OPTIONAL — the real
// global `fetch` Response has it (so `inspect` can read the body), but the existing fire-and-forget
// command fakes return only `{ ok, status }` and still conform (non-breaking widening — Story 7.2).
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

export interface CommandsOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetch?: FetchLike;
  /** Server origin; default '' (same-origin, relative paths). */
  baseUrl?: string;
}

export interface UiCommands {
  start(config: Config): Promise<void>;
  cancel(): Promise<void>;
  retry(step: StepId): Promise<void>;
  /** Render-ack: the Welcome screen rendered → the host may exit the ephemeral server (3.7). */
  ack(): Promise<void>;
  /**
   * Configure-time probe (Story 7.2): ask the server whether `projectDir` already holds a Kindling
   * `_bmad` (and its installed version). Reads the JSON body (unlike the fire-and-forget commands).
   * Throws on a non-ok response so the caller can surface the neutral "couldn't check" state.
   */
  inspect(projectDir: string): Promise<InspectResult>;
}

// Tolerant shape-guard: coerce an untrusted parsed body to InspectResult (booleans/strings only);
// anything malformed degrades to the neutral result rather than propagating junk into the UI.
function toInspectResult(data: unknown): InspectResult {
  if (data && typeof data === 'object') {
    const d = data as { isKindlingProject?: unknown; installedBmadVersion?: unknown };
    return {
      isKindlingProject: d.isKindlingProject === true,
      installedBmadVersion:
        typeof d.installedBmadVersion === 'string' ? d.installedBmadVersion : null,
    };
  }
  return { isKindlingProject: false, installedBmadVersion: null };
}

// The server requires the `X-Kindling: 1` header on command POSTs (CSRF guard, 3.1 review):
// a cross-origin page can reach 127.0.0.1 but can't set a custom header without a blocked
// preflight. Same-origin UI sends it freely.
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Kindling': '1',
};

/** Command senders for the local server (POST /start|/cancel|/retry). */
export function createCommands(opts: CommandsOptions = {}): UiCommands {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const base = opts.baseUrl ?? '';
  const post = async (path: string, body?: unknown): Promise<void> => {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: HEADERS,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // The server returns 202 on accept; a non-ok (403 CSRF / 400 / 413) must surface so the
    // caller can react rather than silently assuming the command landed.
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  };
  return {
    start: (config) => post('/start', config),
    cancel: () => post('/cancel'),
    retry: (step) => post('/retry', { step }),
    ack: () => post('/ack'),
    inspect: async (projectDir) => {
      const res = await doFetch(`${base}/inspect`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ projectDir }),
      });
      if (!res.ok) throw new Error(`POST /inspect failed: ${res.status}`);
      const data = res.json ? await res.json() : null;
      return toInspectResult(data);
    },
  };
}
