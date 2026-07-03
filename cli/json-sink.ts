import type { KindlingEvent } from '../engine/contract';
import type { EventListener } from '../engine/emitter';

// JSON-lines sink: one parseable JSON object per event. Used by `--json` (CI/debug/technical).
export function jsonSink(write: (line: string) => void): EventListener {
  return (event: KindlingEvent) => write(JSON.stringify(event));
}
