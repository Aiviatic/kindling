import { describe, it, expect, vi } from 'vitest';
import { Phase, Status, StepId, type KindlingEvent } from '../../engine/contract';
import { subscribeEvents, type EventSourceLike } from './events';

class FakeEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {}
  close() {
    this.closed = true;
  }
  emit(data: string) {
    this.onmessage?.({ data });
  }
  fail() {
    this.onerror?.(new Error('stream dropped'));
  }
}

const sample: KindlingEvent = {
  id: 'e1',
  phase: Phase.Install,
  step: StepId.InstallFramework,
  status: Status.Working,
  pct: 25,
  humanMessage: 'Installing BMad…',
  level: 'info',
  timestamp: '2026-05-29T00:00:00.000Z',
};

function setup() {
  let source!: FakeEventSource;
  const onEvent = vi.fn();
  const unsub = subscribeEvents(onEvent, {
    url: '/events',
    EventSourceCtor: (u) => (source = new FakeEventSource(u)),
  });
  return { source, onEvent, unsub };
}

describe('subscribeEvents', () => {
  it('parses each data-only frame into a KindlingEvent and forwards it', () => {
    const { source, onEvent } = setup();
    expect(source.url).toBe('/events');
    source.emit(JSON.stringify(sample));
    expect(onEvent).toHaveBeenCalledWith(sample);
  });

  it('ignores a malformed frame without throwing or killing the stream', () => {
    const { source, onEvent } = setup();
    expect(() => source.emit('not json {')).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    // stream still live: a good frame after a bad one is still delivered
    source.emit(JSON.stringify(sample));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe closes the connection', () => {
    const { source, unsub } = setup();
    expect(source.closed).toBe(false);
    unsub();
    expect(source.closed).toBe(true);
  });

  it('invokes onError when the stream errors (the 3.6 connection-lost seam)', () => {
    let source!: FakeEventSource;
    const onError = vi.fn();
    subscribeEvents(vi.fn(), {
      EventSourceCtor: (u) => (source = new FakeEventSource(u)),
      onError,
    });
    source.fail();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
