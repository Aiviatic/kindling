import type { KindlingEvent } from './contract';

export type EventListener = (event: KindlingEvent) => void;

// Typed, append-only event emitter. The engine is the sole producer. Each emitted event is
// frozen and never mutated; the log only grows (architecture: append-only event stream).
export class EngineEmitter {
  private readonly log: KindlingEvent[] = [];
  private readonly listeners = new Set<EventListener>();

  /** Subscribe to events. Returns an unsubscribe function. */
  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Emit an event: freeze it, append to the log, then notify listeners in subscription order. */
  emit(event: KindlingEvent): void {
    // KindlingEvent fields are all primitives by contract, so a shallow freeze fully locks it.
    const frozen = Object.freeze({ ...event });
    this.log.push(frozen);
    // Snapshot listeners and isolate failures: one throwing sink must not stop delivery to the
    // others (Epic 3 runs the browser SSE sink alongside CLI sinks). A bad sink never crashes
    // the engine. (Story 1.7 wires the on-disk failure log to capture such errors.)
    for (const listener of [...this.listeners]) {
      try {
        listener(frozen);
      } catch {
        // swallow — delivery to remaining listeners continues
      }
    }
  }

  /** A snapshot of the append-only event log, in emission order. */
  events(): readonly KindlingEvent[] {
    return [...this.log];
  }
}
