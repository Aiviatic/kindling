import { NON_FATAL_STEPS, Status, StepId, type KindlingEvent } from '../../engine/contract';
import type { InstallerState, Overall, StepView } from './model';

// Upsert the step for this event, preserving first-seen order (the engine's sequence).
function upsertStep(steps: StepView[], event: KindlingEvent): StepView[] {
  const next: StepView = {
    id: event.step,
    status: event.status,
    pct: event.pct, // copied straight from the event — never computed here
    message: event.humanMessage,
  };
  const idx = steps.findIndex((s) => s.id === event.step);
  if (idx === -1) return [...steps, next];
  const copy = steps.slice();
  copy[idx] = next;
  return copy;
}

// Derive overall lifecycle from the accumulated steps. A single FATAL Failed wins (failure is
// terminal until Retry); success requires the final self-check Done with nothing fatal failed.
// `Skipped` ("already present") is success-compatible, NOT a failure. A Failed on a NON_FATAL_STEPS
// step (the optional agent-CLI install, Story 6.1) is excluded from the failed-check so it never
// blocks Welcome — honoring 6.1's non-fatal contract end-to-end (AC-8). The row is still recorded.
function deriveOverall(steps: StepView[]): Overall {
  if (steps.some((s) => s.status === Status.Failed && !NON_FATAL_STEPS.has(s.id))) return 'failed';
  const selfCheck = steps.find((s) => s.id === StepId.FinalizeSelfCheck);
  if (selfCheck && selfCheck.status === Status.Done) return 'success';
  return 'running';
}

// Resolve the failure field for this event:
//  - a Failed event records (or replaces) the failure;
//  - a non-Failed event on the *currently-failed* step clears it (a successful Retry — 3.6);
//  - otherwise the existing failure carries.
function nextFailure(
  current: InstallerState['failure'],
  event: KindlingEvent,
): InstallerState['failure'] {
  if (event.status === Status.Failed)
    return { step: event.step, message: event.humanMessage, code: event.errorCode };
  if (current && current.step === event.step) return undefined; // the failed step recovered
  return current;
}

/**
 * Pure fold of one engine event into the UI state. Immutable: always returns a new object;
 * the input state is never mutated. The UI's entire truth is this projection.
 *
 * Idempotent on event id: the server replays its whole backlog on every SSE (re)connect, so
 * a dropped-and-reopened stream re-delivers already-seen events — we ignore duplicates by id
 * to keep `events` (and the projection) exactly-once.
 */
export function reduce(state: InstallerState, event: KindlingEvent): InstallerState {
  if (state.events.some((e) => e.id === event.id)) return state; // already applied (replay)
  const steps = upsertStep(state.steps, event);
  return {
    overall: deriveOverall(steps),
    phase: event.phase,
    steps,
    lastMessage: event.humanMessage,
    failure: nextFailure(state.failure, event),
    summaryJson: event.summaryJson ?? state.summaryJson, // keep the success event's summary
    events: [...state.events, event],
  };
}
