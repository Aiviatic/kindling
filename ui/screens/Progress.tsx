import { useRef } from 'react';
import { useInstaller } from '../state/context';
import { Status } from '../../engine/contract';
import {
  STATUS_VIEW,
  overallPercent,
  showsActivity,
  activeStep,
  valueText,
  isSlowStep,
} from '../state/progress';

// Step 3 — honest, never-frozen Progress. One row per step (icon + WORD + the engine's own
// message), an aria-live summary so transitions are announced, and a progress bar that only
// advances on real completion. On a known-slow step — or in the gap between steps — the bar
// shows indeterminate activity instead of a stuck number, so it never looks frozen.
export function Progress() {
  const { state } = useInstaller();
  const { steps } = state;

  // The observed-step denominator grows as events stream in, which could make a naive percent
  // jump backward (e.g. 1/1=100% → 1/2=50% when the next step appears). Clamp to a high-water
  // mark so the bar is monotonic — it advances on real completion and never regresses.
  const hwm = useRef(0);
  const raw = overallPercent(steps);
  if (raw > hwm.current) hwm.current = raw;
  const pct = hwm.current;

  const active = activeStep(steps);
  // Indeterminate activity while a known-slow step works OR in the gap between steps (running
  // but nothing is Working yet) — both would otherwise show a frozen number on a slow machine.
  const activity = showsActivity(steps) || (state.overall === 'running' && !active);

  return (
    <section
      className="screen screen--progress"
      aria-labelledby="prog-h"
      aria-busy={state.overall === 'running' || undefined}
    >
      <p className="eyebrow">Setting things up</p>
      <h1 id="prog-h">Hang tight, we're getting everything ready.</h1>

      <div
        className={`progressbar${activity ? ' progressbar--activity' : ''}`}
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        // Omit aria-valuenow while indeterminate (ARIA signal) so AT doesn't announce a
        // number that contradicts the full-width activity fill.
        aria-valuenow={activity ? undefined : pct}
        // When indeterminate, describe the activity (no percentage) so AT doesn't announce a
        // number that contradicts the full-width pulse.
        aria-valuetext={activity ? (active?.message ?? 'Working…') : valueText(steps)}
      >
        <div className="progressbar-fill" style={{ width: activity ? '100%' : `${pct}%` }} />
      </div>

      {/* Live region: announces each step transition (the engine's latest message). */}
      <p className="sr-live" aria-live="polite">
        {state.lastMessage}
      </p>

      <ul className="steps" role="list">
        {steps.map((step) => {
          const view = STATUS_VIEW[step.status] ?? STATUS_VIEW[Status.Queued]; // guard unknown
          const working = step.status === Status.Working;
          const slow = working && isSlowStep(step.id);
          return (
            <li
              key={step.id}
              className={`step-row${working ? ' step-row--working' : ''}`}
              data-tone={view.tone}
            >
              <span className="step-icon" aria-hidden="true">
                {view.icon}
              </span>
              <span className="step-word">{view.word}</span>
              <span className="step-message">{step.message}</span>
              {slow && (
                <span className="step-activity" aria-hidden="true">
                  •••
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
