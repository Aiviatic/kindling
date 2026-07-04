// Minimal fetch signature for the read-only prefs GET (injectable for tests).
type PrefsFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Load the last run's projects folder from the server (GET /prefs). Never throws — any failure
 * (no fetch in jsdom, network error, non-ok, malformed body) degrades to null, so Configure
 * simply falls back to the built-in default folder.
 */
export async function loadLastProjectFolder(fetchImpl?: PrefsFetch): Promise<string | null> {
  const doFetch: PrefsFetch | null =
    fetchImpl ?? (typeof fetch === 'function' ? (url) => fetch(url) : null);
  if (!doFetch) return null;
  try {
    const res = await doFetch('/prefs');
    if (!res.ok) return null;
    const data = (await res.json()) as { lastProjectFolder?: unknown } | null;
    return data && typeof data.lastProjectFolder === 'string' && data.lastProjectFolder.length > 0
      ? data.lastProjectFolder
      : null;
  } catch {
    return null;
  }
}
