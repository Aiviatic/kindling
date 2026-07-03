// The lead-capture endpoint URL is config-driven (hosting is deferred, AR17). It comes from a
// build-time env var; when unset the opt-in degrades gracefully to a no-op (no error, never
// blocks the Welcome). Read defensively so non-Vite test runs don't throw on import.meta.env.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;

export const OPTIN_ENDPOINT: string = env?.VITE_OPTIN_ENDPOINT ?? '';
