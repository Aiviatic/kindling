import { pins } from '../../engine/pins';
import { OPTIN_ENDPOINT } from '../config/optin';

export interface OptInInput {
  email: string;
  /** Optional identity fields (FR-20) — never required. */
  firstName?: string;
  lastName?: string;
  /** Optional rough location (FR-20) — city + state, never required. */
  city?: string;
  state?: string;
}

/** Consent-first payload posted to the lead-capture endpoint (the server stamps the timestamp). */
export interface OptInPayload {
  email: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  consent: true;
  /** Install attribution (FR — who installed): the cohort's pinned BMad version. */
  attribution: { bmad: string };
}

export type OptInResult = 'sent' | 'skipped' | 'error';

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean }>;

export interface SubmitOptInDeps {
  endpoint?: string;
  fetchImpl?: FetchLike;
}

/**
 * Consent-first opt-in (FR-19/20). Returns a result; **never throws** so the Welcome can stay
 * calm:
 *  - no email → 'skipped' (nothing to capture; skipping is always valid)
 *  - no endpoint configured (hosting deferred) → 'skipped' (graceful no-op, no error)
 *  - posted ok → 'sent'; network/HTTP failure → 'error' (the UI still acks gently)
 */
export async function submitOptIn(
  input: OptInInput,
  deps: SubmitOptInDeps = {},
): Promise<OptInResult> {
  const email = input.email.trim();
  if (!email) return 'skipped';
  const endpoint = deps.endpoint ?? OPTIN_ENDPOINT;
  if (!endpoint) return 'skipped';

  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  const city = input.city?.trim();
  const state = input.state?.trim();
  const payload: OptInPayload = {
    email,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    consent: true,
    attribution: { bmad: pins.bmad },
  };

  try {
    const doFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok ? 'sent' : 'error';
  } catch {
    return 'error';
  }
}
