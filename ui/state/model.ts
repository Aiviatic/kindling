import type { ErrorCode, KindlingEvent, Phase, StepId, Status } from '../../engine/contract';

/** Overall installer lifecycle, derived purely from the event stream. */
export type Overall = 'idle' | 'running' | 'success' | 'failed';

/** A single step's current view, projected from the latest event for that step. */
export interface StepView {
  id: StepId;
  status: Status;
  /** Progress percent — copied from the event ONLY; the UI never computes it. */
  pct?: number;
  /** Engine-authored copy for this step (humanMessage); the UI never composes its own. */
  message: string;
}

/**
 * Immutable UI state — a pure projection of the engine's append-only event stream.
 * Screens render this; they never derive progress or write copy themselves.
 */
export interface InstallerState {
  overall: Overall;
  phase?: Phase;
  /** Steps in first-seen (engine sequence) order. */
  steps: StepView[];
  /** Latest event's humanMessage (engine-authored). */
  lastMessage: string;
  /** Set when a step fails; drives the error/recovery screen (3.6). */
  failure?: { step: StepId; message: string; code?: ErrorCode };
  /** The Validation Summary JSON from the success event — the text the Welcome screen copies. */
  summaryJson?: string;
  /** Append-only log of every event received (debugging / SSE backlog replay). */
  events: KindlingEvent[];
}

export const initialState: InstallerState = {
  overall: 'idle',
  phase: undefined,
  steps: [],
  lastMessage: '',
  failure: undefined,
  summaryJson: undefined,
  events: [],
};
