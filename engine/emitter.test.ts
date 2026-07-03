import { describe, it, expect, vi } from 'vitest';
import { EngineEmitter } from './emitter';
import { Phase, StepId, Status, type KindlingEvent } from './contract';

function makeEvent(overrides: Partial<KindlingEvent> = {}): KindlingEvent {
  return {
    id: '1',
    phase: Phase.Provision,
    step: StepId.ProvisionNode,
    status: Status.Working,
    humanMessage: 'msg',
    level: 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('EngineEmitter', () => {
  it('delivers events to listeners in emission order', () => {
    const emitter = new EngineEmitter();
    const seen: string[] = [];
    emitter.on((ev) => seen.push(ev.id));
    emitter.emit(makeEvent({ id: 'a' }));
    emitter.emit(makeEvent({ id: 'b' }));
    expect(seen).toEqual(['a', 'b']);
  });

  it('is append-only and exposes the full log in order', () => {
    const emitter = new EngineEmitter();
    emitter.emit(makeEvent({ id: 'a' }));
    emitter.emit(makeEvent({ id: 'b' }));
    emitter.emit(makeEvent({ id: 'c' }));
    expect(emitter.events().map((ev) => ev.id)).toEqual(['a', 'b', 'c']);
  });

  it('freezes emitted events so they cannot be mutated', () => {
    const emitter = new EngineEmitter();
    emitter.emit(makeEvent({ id: 'a', status: Status.Working }));
    const ev = emitter.events()[0];
    expect(Object.isFrozen(ev)).toBe(true);
    expect(() => {
      (ev as KindlingEvent).status = Status.Done;
    }).toThrow();
  });

  it('unsubscribing stops further delivery', () => {
    const emitter = new EngineEmitter();
    const listener = vi.fn();
    const off = emitter.on(listener);
    off();
    emitter.emit(makeEvent());
    expect(listener).not.toHaveBeenCalled();
  });
});
