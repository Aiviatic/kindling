import { describe, it, expect } from 'vitest';
import {
  parseIdeCatalog,
  loadIdeCatalog,
  FALLBACK_IDES,
  DEGRADED_MESSAGE,
} from './ide-catalog';

const GOOD = `
ides:
  - { id: claude-code, name: Claude Code, recommended: true }
  - { id: cursor, name: Cursor }
`;

function fetchOk(body: string) {
  return async () => ({ ok: true, text: async () => body });
}

describe('parseIdeCatalog', () => {
  it('parses a valid catalog and defaults recommended to false', () => {
    const ides = parseIdeCatalog(GOOD);
    expect(ides).toEqual([
      { id: 'claude-code', name: 'Claude Code', recommended: true },
      { id: 'cursor', name: 'Cursor', recommended: false },
    ]);
  });

  it('throws on an empty or missing ides list', () => {
    expect(() => parseIdeCatalog('ides: []')).toThrow();
    expect(() => parseIdeCatalog('nope: 1')).toThrow();
  });

  it('throws when an entry lacks a string id/name', () => {
    expect(() => parseIdeCatalog('ides:\n  - { name: No Id }')).toThrow();
  });
});

describe('loadIdeCatalog (graceful degradation, never throws)', () => {
  it('returns the parsed catalog when the fetch succeeds', async () => {
    const cat = await loadIdeCatalog(fetchOk(GOOD));
    expect(cat.degraded).toBe(false);
    expect(cat.ides.map((i) => i.id)).toEqual(['claude-code', 'cursor']);
  });

  it('falls back when the response is not ok', async () => {
    const cat = await loadIdeCatalog(async () => ({ ok: false, text: async () => '' }));
    expect(cat.degraded).toBe(true);
    expect(cat.ides).toEqual(FALLBACK_IDES);
    expect(cat.message).toBe(DEGRADED_MESSAGE);
  });

  it('falls back when the YAML is corrupt', async () => {
    const cat = await loadIdeCatalog(fetchOk('ides:\n  - { broken'));
    expect(cat.degraded).toBe(true);
    expect(cat.ides).toEqual(FALLBACK_IDES);
  });

  it('falls back when fetch rejects (offline)', async () => {
    const cat = await loadIdeCatalog(async () => {
      throw new Error('offline');
    });
    expect(cat.degraded).toBe(true);
    expect(cat.ides).toEqual(FALLBACK_IDES);
  });
});
