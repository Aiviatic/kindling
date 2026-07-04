import { load, JSON_SCHEMA } from 'js-yaml';

export interface IdeOption {
  /** Exact `--tools` id accepted by bmad-method (see public/platform-codes.yaml). */
  id: string;
  name: string;
  recommended: boolean;
}

export interface IdeCatalog {
  ides: IdeOption[];
  /** True when the real catalog couldn't be read and we fell back (FR-15 degradation). */
  degraded: boolean;
  /** Plain-language note shown when degraded; undefined otherwise. */
  message?: string;
}

// Built-in fallback if public/platform-codes.yaml is missing/unreadable/corrupt. A short list
// of well-known IDs (still valid `--tools` values) so the user can always reach Start. The
// recommended flags mirror Kindling's curated set (KINDLING_RECOMMENDED in the generator).
export const FALLBACK_IDES: IdeOption[] = [
  { id: 'claude-code', name: 'Claude Code', recommended: true },
  { id: 'codex', name: 'Codex', recommended: true },
  { id: 'cursor', name: 'Cursor', recommended: false },
  { id: 'github-copilot', name: 'GitHub Copilot', recommended: false },
];

export const DEGRADED_MESSAGE =
  "We couldn't read the IDE list right now, you can still continue with the default and set your IDE later.";

// Parse + validate the catalog YAML. Throws on anything that isn't a non-empty list of
// {id, name} entries, so loadIdeCatalog can fall back. Pure (no I/O).
export function parseIdeCatalog(yamlText: string): IdeOption[] {
  // JSON_SCHEMA keeps scalars as plain strings/numbers/bools (no Date coercion of unquoted
  // values) and admits no custom/executable tags — a data file should only carry strings.
  const doc = load(yamlText, { schema: JSON_SCHEMA }) as unknown;
  const raw = (doc as { ides?: unknown } | null)?.ides;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('platform-codes.yaml: missing or empty `ides` list');
  }
  const ides: IdeOption[] = raw.map((entry, i) => {
    const e = entry as { id?: unknown; name?: unknown; recommended?: unknown };
    if (typeof e?.id !== 'string' || typeof e?.name !== 'string') {
      throw new Error(`platform-codes.yaml: entry ${i} needs string id + name`);
    }
    return { id: e.id, name: e.name, recommended: e.recommended === true };
  });
  return ides;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Load the IDE catalog from the served YAML, degrading gracefully on any failure (network,
 * 404, bad YAML, wrong shape) to a built-in list + a plain-language message. Never throws.
 */
export async function loadIdeCatalog(
  fetchImpl: FetchLike = (url) => fetch(url),
  url = '/platform-codes.yaml',
): Promise<IdeCatalog> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`fetch ${url} → not ok`);
    return { ides: parseIdeCatalog(await res.text()), degraded: false };
  } catch {
    return { ides: FALLBACK_IDES, degraded: true, message: DEGRADED_MESSAGE };
  }
}
