import type { KindlingEvent } from '../../engine/contract';

// The slice of EventSource we use — lets tests inject a fake without a real network stream.
export interface EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null;
  onerror?: ((ev: unknown) => void) | null;
  close(): void;
}
export type EventSourceCtor = (url: string) => EventSourceLike;

export interface SubscribeOptions {
  url?: string;
  /** Injected for tests; defaults to the global EventSource (data-only SSE, see server 3.1). */
  EventSourceCtor?: EventSourceCtor;
  /**
   * Called when the SSE connection errors (server down/dropped). The browser auto-reconnects,
   * but this lets the UI surface "connection lost" — the recovery UX is wired in Story 3.6.
   */
  onError?: () => void;
}

/**
 * Subscribe to the engine's SSE stream. The server emits DATA-ONLY frames (no `event:` line,
 * see the 3.1 review), so we listen on `onmessage` and JSON-parse each frame into a
 * KindlingEvent. Malformed frames are ignored (never throw — a bad frame must not kill the
 * stream). Returns an unsubscribe that closes the connection.
 */
export function subscribeEvents(
  onEvent: (event: KindlingEvent) => void,
  opts: SubscribeOptions = {},
): () => void {
  const url = opts.url ?? '/events';
  const make: EventSourceCtor =
    opts.EventSourceCtor ?? ((u) => new EventSource(u) as unknown as EventSourceLike);
  const source = make(url);
  source.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as KindlingEvent);
    } catch {
      // Ignore an unparseable frame; keep the stream alive.
    }
  };
  if (opts.onError) source.onerror = () => opts.onError?.();
  return () => source.close();
}
