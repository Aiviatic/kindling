import { describe, it, expect } from 'vitest';
import { tokens } from './tokens';

describe('design tokens (SSOT)', () => {
  it('exposes the Bold Spark palette with whole-literal hex values', () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const [name, value] of Object.entries(tokens.color)) {
      expect(value, name).toMatch(hex);
    }
  });

  it('pins the AA-relevant tones DESIGN.md calls out', () => {
    // The accessible status WORD tones (busy→gold, failed→primary) and the success green.
    expect(tokens.color.accentGold).toBe('#ffc24a');
    expect(tokens.color.textPrimary).toBe('#fff6ee');
    expect(tokens.color.success).toBe('#4fd784');
    // text-muted exists but is RESTRICTED to placeholders/large text (documented in tokens.ts).
    expect(tokens.color.textMuted).toBe('#9a8170');
  });

  it('carries the flame signature gradient + the radius/spacing scales', () => {
    expect(tokens.gradient.flame).toContain('linear-gradient');
    expect(tokens.radius.xl).toBe('12px'); // buttons/cards
    expect(tokens.radius.full).toBe('999px'); // pills
    expect(tokens.space['4']).toBe('16px');
    expect(tokens.type.family).toContain('-apple-system');
  });

  it('is frozen-shaped (as const) — every color is a string', () => {
    expect(Object.values(tokens.color).every((v) => typeof v === 'string')).toBe(true);
  });
});
