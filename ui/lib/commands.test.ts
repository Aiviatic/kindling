import { describe, it, expect } from 'vitest';
import { StepId, type Config } from '../../engine/contract';
import { createCommands, type FetchLike } from './commands';
import { pins } from '../../engine/pins';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function recorder(): { calls: Call[]; fetch: FetchLike } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    return { ok: true, status: 202 };
  };
  return { calls, fetch };
}

const config: Config = {
  projectDir: '/tmp/proj',
  projectName: 'proj',
  ides: ['claude-code'],
  modules: ['bmm'],
  pins,
};

describe('createCommands', () => {
  it('POSTs /start with the config body and the X-Kindling CSRF header', async () => {
    const { calls, fetch } = recorder();
    await createCommands({ fetch }).start(config);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/start');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['X-Kindling']).toBe('1');
    expect(JSON.parse(calls[0].body!)).toEqual(config);
  });

  it('POSTs /cancel with no body', async () => {
    const { calls, fetch } = recorder();
    await createCommands({ fetch }).cancel();
    expect(calls[0].url).toBe('/cancel');
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers['X-Kindling']).toBe('1');
  });

  it('POSTs /retry with the step in the body', async () => {
    const { calls, fetch } = recorder();
    await createCommands({ fetch }).retry(StepId.InstallBmad);
    expect(calls[0].url).toBe('/retry');
    expect(calls[0].headers['X-Kindling']).toBe('1');
    expect(JSON.parse(calls[0].body!)).toEqual({ step: StepId.InstallBmad });
  });

  it('prefixes baseUrl when given', async () => {
    const { calls, fetch } = recorder();
    await createCommands({ fetch, baseUrl: 'http://127.0.0.1:5000' }).cancel();
    expect(calls[0].url).toBe('http://127.0.0.1:5000/cancel');
  });

  it('rejects when the server responds non-ok (so command failures surface)', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 403 });
    await expect(createCommands({ fetch }).cancel()).rejects.toThrow(/403/);
  });

  it('inspect POSTs /inspect with the CSRF header + { projectDir } and returns the parsed InspectResult', async () => {
    const calls: Call[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, ...init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ isKindlingProject: true, installedBmadVersion: '6.9.0' }),
      };
    };
    const result = await createCommands({ fetch }).inspect('/tmp/proj');
    expect(calls[0].url).toBe('/inspect');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['X-Kindling']).toBe('1');
    expect(JSON.parse(calls[0].body!)).toEqual({ projectDir: '/tmp/proj' });
    expect(result).toEqual({ isKindlingProject: true, installedBmadVersion: '6.9.0' });
  });

  it('inspect throws on a non-ok response (caller surfaces the neutral error state)', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 400 });
    await expect(createCommands({ fetch }).inspect('/p')).rejects.toThrow(/400/);
  });

  it('inspect coerces a malformed json body to the neutral result', async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ isKindlingProject: 'yes', installedBmadVersion: 42 }),
    });
    await expect(createCommands({ fetch }).inspect('/p')).resolves.toEqual({
      isKindlingProject: false,
      installedBmadVersion: null,
    });
  });
});
