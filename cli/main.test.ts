import { describe, it, expect } from 'vitest';
import { run, selectMode } from './main';
import { Phase, StepId, Status, type KindlingEvent } from '../engine/contract';

function ev(id: string): KindlingEvent {
  return {
    id,
    phase: Phase.Provision,
    step: StepId.ProvisionNode,
    status: Status.Working,
    humanMessage: 'msg',
    level: 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
  };
}

describe('cli mode selection', () => {
  it('maps flags to modes (none → server)', () => {
    expect(selectMode(['--json'])).toBe('json');
    expect(selectMode(['--verbose'])).toBe('verbose');
    expect(selectMode([])).toBe('server');
  });
});

describe('--json sink', () => {
  it('emits one parseable JSON line per event, in order', () => {
    const lines: string[] = [];
    const { emitter } = run(['--json'], (l) => lines.push(l));
    emitter.emit(ev('a'));
    emitter.emit(ev('b'));
    const parsed = lines.map((l) => JSON.parse(l) as KindlingEvent);
    expect(parsed.map((p) => p.id)).toEqual(['a', 'b']);
    expect(parsed[0].step).toBe(StepId.ProvisionNode);
    expect(parsed[0].status).toBe(Status.Working);
  });
});

describe('--verbose sink', () => {
  it('renders plain human-readable lines', () => {
    const lines: string[] = [];
    const { emitter } = run(['--verbose'], (l) => lines.push(l));
    emitter.emit(ev('a'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('msg');
  });
});

describe('server mode (default)', () => {
  it('starts the server-mode lifecycle with the wired emitter', () => {
    const lines: string[] = [];
    let startedEmitter: unknown = null;
    const { mode, emitter } = run([], (l) => lines.push(l), {
      startServerMode: (em) => {
        startedEmitter = em;
      },
    });
    expect(mode).toBe('server');
    expect(startedEmitter).toBe(emitter); // the same emitter the sinks are wired to
  });
});
