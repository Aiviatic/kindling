import type { KindlingEvent } from '../engine/contract';
import type { EventListener } from '../engine/emitter';

// Plain human-readable sink for `--verbose`. Interpolates event fields (no raw step literal).
export function verboseSink(write: (line: string) => void): EventListener {
  return (event: KindlingEvent) => write(`[${event.status}] ${event.step} — ${event.humanMessage}`);
}
