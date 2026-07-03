import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type { KindlingEvent } from '../../engine/contract';
import { subscribeEvents, type EventSourceCtor } from '../lib/events';
import { createCommands, type UiCommands } from '../lib/commands';
import { reduce } from './reducer';
import { initialState, type InstallerState } from './model';

interface InstallerContextValue {
  state: InstallerState;
  commands: UiCommands;
  /** Clear the projection for a fresh run (e.g. after picking a new folder). Does NOT touch the
   *  SSE subscription — only re-runs that emit new events repopulate state. */
  reset: () => void;
}

// Either an engine event to fold, or a reset to clear the projection. `reduce` stays a pure
// event fold (its unit tests are untouched); this root reducer just adds the reset branch.
type Action = KindlingEvent | { reset: true };
function rootReducer(state: InstallerState, action: Action): InstallerState {
  if ('reset' in action) return initialState;
  return reduce(state, action);
}

const InstallerContext = createContext<InstallerContextValue | null>(null);

export interface InstallerProviderProps {
  children: ReactNode;
  /** Injected for tests (fake EventSource / commands); production uses the real defaults. */
  EventSourceCtor?: EventSourceCtor;
  commands?: UiCommands;
}

/**
 * Wires the SSE stream into a useReducer projection. State is read-only to consumers;
 * the only way it changes is an engine event arriving (pure projection — architecture).
 */
export function InstallerProvider({
  children,
  EventSourceCtor,
  commands,
}: InstallerProviderProps) {
  const [state, dispatch] = useReducer(rootReducer, initialState);
  const reset = useCallback(() => dispatch({ reset: true }), []);
  // Commands and the EventSource factory are captured once — the SSE stream opens a single
  // time for the provider's lifetime. (Both are read at mount; changing the props later does
  // NOT re-subscribe — that would tear down and re-open the stream, replaying the backlog.)
  const commandsRef = useRef<UiCommands>(commands ?? createCommands());
  const ctorRef = useRef<EventSourceCtor | undefined>(EventSourceCtor);

  useEffect(() => {
    // Open the SSE stream once for the provider's lifetime (ctor captured via ref above, so
    // there are no reactive deps — dispatch is stable). Cleanup closes it on unmount.
    return subscribeEvents((event) => dispatch(event), { EventSourceCtor: ctorRef.current });
  }, []);

  return (
    <InstallerContext.Provider value={{ state, commands: commandsRef.current, reset }}>
      {children}
    </InstallerContext.Provider>
  );
}

/** Read the installer state + commands. Throws if used outside the provider. */
export function useInstaller(): InstallerContextValue {
  const ctx = useContext(InstallerContext);
  if (!ctx) throw new Error('useInstaller must be used within <InstallerProvider>');
  return ctx;
}
