import { describe, expect, it } from 'vitest';
import { loadLastProjectFolder } from './prefs';

describe('loadLastProjectFolder', () => {
  it('returns the folder from GET /prefs', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ lastProjectFolder: '~/My Projects' }),
    });
    await expect(loadLastProjectFolder(fetchImpl)).resolves.toBe('~/My Projects');
  });

  it.each([
    ['non-ok response', async () => ({ ok: false, json: async () => ({}) })],
    ['rejected fetch', () => Promise.reject(new Error('down'))],
    ['null body', async () => ({ ok: true, json: async () => null })],
    ['missing field', async () => ({ ok: true, json: async () => ({}) })],
    ['empty string', async () => ({ ok: true, json: async () => ({ lastProjectFolder: '' }) })],
    ['non-string', async () => ({ ok: true, json: async () => ({ lastProjectFolder: 5 }) })],
  ])('degrades to null on %s (never throws)', async (_label, fetchImpl) => {
    await expect(
      loadLastProjectFolder(fetchImpl as Parameters<typeof loadLastProjectFolder>[0]),
    ).resolves.toBeNull();
  });
});
