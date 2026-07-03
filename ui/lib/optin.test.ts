import { describe, it, expect, vi } from 'vitest';
import { submitOptIn } from './optin';
import { pins } from '../../engine/pins';

interface Call {
  url: string;
  body: string;
}
function recorder(ok = true) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    return { ok };
  });
  return { calls, fetchImpl };
}

const ENDPOINT = 'https://kindling.aiviatic.com/opt-in';

describe('submitOptIn (consent-first, never throws)', () => {
  it('skips with no fetch when no email is given (skipping is always valid)', async () => {
    const { fetchImpl } = recorder();
    expect(await submitOptIn({ email: '   ' }, { endpoint: ENDPOINT, fetchImpl })).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips gracefully (no error, no fetch) when the endpoint is unconfigured (hosting deferred)', async () => {
    const { fetchImpl } = recorder();
    expect(await submitOptIn({ email: 'a@b.com' }, { endpoint: '', fetchImpl })).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts a consent-first payload with attribution + optional location', async () => {
    const { calls, fetchImpl } = recorder(true);
    const result = await submitOptIn(
      { email: ' a@b.com ', location: ' Berlin ' },
      { endpoint: ENDPOINT, fetchImpl },
    );
    expect(result).toBe('sent');
    expect(calls[0].url).toBe(ENDPOINT);
    expect(JSON.parse(calls[0].body)).toEqual({
      email: 'a@b.com',
      location: 'Berlin',
      consent: true,
      attribution: { bmad: pins.bmad },
    });
  });

  it('omits location when blank', async () => {
    const { calls, fetchImpl } = recorder(true);
    await submitOptIn({ email: 'a@b.com', location: '  ' }, { endpoint: ENDPOINT, fetchImpl });
    expect(JSON.parse(calls[0].body).location).toBeUndefined();
  });

  it('returns error (never throws) on a non-ok response or a network failure', async () => {
    const notOk = recorder(false);
    expect(await submitOptIn({ email: 'a@b.com' }, { endpoint: ENDPOINT, fetchImpl: notOk.fetchImpl })).toBe('error');
    const throwing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await submitOptIn({ email: 'a@b.com' }, { endpoint: ENDPOINT, fetchImpl: throwing })).toBe('error');
  });
});
