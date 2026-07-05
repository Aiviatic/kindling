import { describe, it, expect } from 'vitest';
import { ErrorCode, Phase, Status, StepId, type KindlingEvent } from '../../engine/contract';
import { reduce } from './reducer';
import { initialState } from './model';

let seq = 0;
function ev(partial: Partial<KindlingEvent> & Pick<KindlingEvent, 'step' | 'status'>): KindlingEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    phase: Phase.Install,
    pct: undefined,
    humanMessage: `${partial.step} ${partial.status}`,
    level: 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
    ...partial,
  };
}

function fold(events: KindlingEvent[]) {
  return events.reduce(reduce, initialState);
}

describe('reduce — event stream → UI state', () => {
  it('projects a happy-path sequence to the expected state (AC sequence test)', () => {
    const state = fold([
      ev({ step: StepId.ProvisionNode, status: Status.Queued, phase: Phase.Provision }),
      ev({ step: StepId.ProvisionNode, status: Status.Working, phase: Phase.Provision, pct: 50 }),
      ev({ step: StepId.ProvisionNode, status: Status.Done, phase: Phase.Provision }),
      ev({ step: StepId.InstallFramework, status: Status.Working, phase: Phase.Install, pct: 40 }),
      ev({ step: StepId.InstallFramework, status: Status.Done, phase: Phase.Install }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done, phase: Phase.Finalize, humanMessage: "You're ready" }),
    ]);

    // First-seen order preserved; one row per step (upsert, not append).
    expect(state.steps.map((s) => s.id)).toEqual([
      StepId.ProvisionNode,
      StepId.InstallFramework,
      StepId.FinalizeSelfCheck,
    ]);
    expect(state.steps[0].status).toBe(Status.Done);
    expect(state.overall).toBe('success');
    expect(state.phase).toBe(Phase.Finalize);
    expect(state.lastMessage).toBe("You're ready");
    expect(state.failure).toBeUndefined();
    expect(state.events).toHaveLength(6); // append-only log keeps every event
  });

  it('carries summaryJson from the success event (drives the Welcome copy action)', () => {
    const summary = '{"schemaVersion":3,"success":true}';
    const state = fold([
      ev({ step: StepId.InstallFramework, status: Status.Done }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done, summaryJson: summary }),
    ]);
    expect(state.summaryJson).toBe(summary);
    expect(state.overall).toBe('success');
  });

  it('copies pct from the event and never invents its own', () => {
    const state = fold([
      ev({ step: StepId.InstallFramework, status: Status.Working, pct: 73 }),
    ]);
    expect(state.steps[0].pct).toBe(73);
    expect(state.overall).toBe('running');
  });

  it('a Failed event makes overall "failed" and records the failure; it stays failed', () => {
    const state = fold([
      ev({ step: StepId.ProvisionNode, status: Status.Done }),
      ev({ step: StepId.InstallFramework, status: Status.Failed, humanMessage: 'install blew up' }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done }), // a later done must not clear it
    ]);
    expect(state.overall).toBe('failed');
    expect(state.failure).toEqual({ step: StepId.InstallFramework, message: 'install blew up' });
  });

  it('carries the failure errorCode into state.failure (drives 3.6 recovery guidance)', () => {
    const state = fold([
      ev({
        step: StepId.ScaffoldGitInit,
        status: Status.Failed,
        humanMessage: 'folder not empty',
        errorCode: ErrorCode.ProjectConflict,
      }),
    ]);
    expect(state.failure).toEqual({
      step: StepId.ScaffoldGitInit,
      message: 'folder not empty',
      code: ErrorCode.ProjectConflict,
    });
  });

  it('AC-8: a NON-fatal agent-CLI Failed does not fail the run; self-check Done → success', () => {
    const state = fold([
      ev({ step: StepId.InstallFramework, status: Status.Done }),
      ev({ step: StepId.InstallAgentCli, status: Status.Failed, humanMessage: 'cli install failed' }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done }),
    ]);
    // The non-fatal marker excludes InstallAgentCli from the failed-check, so overall is success.
    expect(state.overall).toBe('success');
    // The failed row is still recorded (for the error surface), it just doesn't gate lifecycle.
    expect(state.steps.find((s) => s.id === StepId.InstallAgentCli)?.status).toBe(Status.Failed);
  });

  it('AC-8: order-robust — a CLI Failed even AFTER self-check Done stays success', () => {
    const state = fold([
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done }),
      ev({ step: StepId.InstallAgentCli, status: Status.Failed, humanMessage: 'cli install failed' }),
    ]);
    expect(state.overall).toBe('success');
  });

  it('AC-8: the marker does not over-reach — a FATAL step Failed still fails the run', () => {
    const state = fold([
      ev({ step: StepId.InstallFramework, status: Status.Failed, humanMessage: 'bmad install failed' }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done }),
    ]);
    expect(state.overall).toBe('failed');
  });

  it('AC-8: a non-fatal CLI Failed with self-check NOT yet done is "running", not "success"', () => {
    const state = fold([ev({ step: StepId.InstallAgentCli, status: Status.Failed, humanMessage: 'cli install failed' })]);
    expect(state.overall).toBe('running'); // success still gates on FinalizeSelfCheck Done
  });

  it('AC-8: a non-fatal Failed AND a fatal Failed together still fails the run', () => {
    const state = fold([
      ev({ step: StepId.InstallAgentCli, status: Status.Failed, humanMessage: 'cli install failed' }),
      ev({ step: StepId.InstallFramework, status: Status.Failed, humanMessage: 'bmad install failed' }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done }),
    ]);
    expect(state.overall).toBe('failed'); // the fatal one still wins
  });

  it('treats Skipped ("already present") as success-compatible, not a failure', () => {
    const state = fold([
      ev({ step: StepId.ProvisionGit, status: Status.Skipped }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done }),
    ]);
    expect(state.overall).toBe('success');
    expect(state.failure).toBeUndefined();
  });

  it('clears the failure when the failed step recovers on retry (drives 3.6 off the error screen)', () => {
    const state = fold([
      ev({ step: StepId.InstallFramework, status: Status.Failed, humanMessage: 'install blew up' }),
      // Retry re-runs the same step:
      ev({ step: StepId.InstallFramework, status: Status.Working, pct: 10 }),
      ev({ step: StepId.InstallFramework, status: Status.Done }),
      ev({ step: StepId.FinalizeSelfCheck, status: Status.Done }),
    ]);
    expect(state.failure).toBeUndefined();
    expect(state.overall).toBe('success');
  });

  it('is idempotent on event id — a replayed backlog (SSE reconnect) is applied exactly once', () => {
    const e = ev({ step: StepId.InstallFramework, status: Status.Working, pct: 30 });
    const once = reduce(initialState, e);
    const twice = reduce(once, e); // same id re-delivered after a reconnect
    expect(twice).toBe(once); // unchanged reference — duplicate ignored
    expect(twice.events).toHaveLength(1);
    expect(twice.steps).toHaveLength(1);
  });

  it('is immutable — returns a new object and never mutates the input', () => {
    const before = initialState;
    const after = reduce(before, ev({ step: StepId.ProvisionNode, status: Status.Working }));
    expect(after).not.toBe(before);
    expect(before.steps).toHaveLength(0); // input untouched
    expect(before.events).toHaveLength(0);
    expect(after.steps).toHaveLength(1);
  });
});
