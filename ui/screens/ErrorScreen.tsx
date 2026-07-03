import { useEffect, useState } from 'react';
import { ErrorCode } from '../../engine/contract';
import { recoveryGuidance, type RecoveryGuidance } from '../../engine/messages';
import { useInstaller } from '../state/context';
import { STATUS_VIEW } from '../state/progress';
import { Button } from '../components/Button';

export interface ErrorScreenProps {
  /** Re-run the failed step (Flow owns the lifecycle so it can show Progress during the re-run). */
  onRetry: () => void;
  /** Route back to Configure (used for a pre-existing-project conflict — never overwrite). */
  onChooseFolder: () => void;
  /** A transport-level retry failure to surface (the retry POST itself failed — Flow sets this). */
  retryError?: string | null;
}

// In-UI error & recovery (FR-13). The user is never dropped to a terminal: the server stays
// alive on failure (3.1), so Retry re-runs the failed step in place. All copy is the engine's
// (recoveryGuidance, keyed by the failure's errorCode); the UI only renders + wires the actions.
// A pre-existing-project conflict (FR-9) offers a non-destructive "choose another folder"
// instead of Retry — Kindling never silently overwrites the user's files.
export function ErrorScreen({ onRetry, onChooseFolder, retryError }: ErrorScreenProps) {
  const { state } = useInstaller();
  const { failure, steps } = state;
  const [copied, setCopied] = useState(false);

  // Engine-authored guidance by code; fall back to the generic retry guidance (with the engine's
  // own message as the detail) for a missing OR unrecognized code — never crash on a stale code.
  const g: RecoveryGuidance = (failure?.code && recoveryGuidance[failure.code]) ?? {
    ...recoveryGuidance[ErrorCode.ExecFailed],
    detail: failure?.message ?? recoveryGuidance[ErrorCode.ExecFailed].detail,
  };

  // Reset the "Copied ✓" affordance when the failure (hence the fix command) changes.
  useEffect(() => setCopied(false), [failure?.code, g.fixCommand]);

  const copyFix = (): void => {
    if (!g.fixCommand || !navigator.clipboard) return;
    void navigator.clipboard.writeText(g.fixCommand).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };

  return (
    <section className="screen screen--error" aria-labelledby="err-h" role="alert">
      <p className="eyebrow">Needs a quick fix</p>
      <h1 id="err-h">{g.title}</h1>
      <p className="lede">{g.detail}</p>

      {g.fixCommand && (
        <div className="fix-command">
          <code className="fix-command-code">{g.fixCommand}</code>
          <Button variant="ghost" onClick={copyFix}>
            {copied ? 'Copied ✓' : 'Copy'}
          </Button>
        </div>
      )}

      {/* Context: what already succeeded, so the failure isn't a blank slate. */}
      {steps.length > 0 && (
        <ul className="steps steps--compact" role="list">
          {steps.map((step) => {
            const view = STATUS_VIEW[step.status] ?? STATUS_VIEW.queued;
            return (
              <li key={step.id} className="step-row" data-tone={view.tone}>
                <span className="step-icon" aria-hidden="true">
                  {view.icon}
                </span>
                <span className="step-word">{view.word}</span>
                <span className="step-message">{step.message}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="screen-actions">
        {g.recovery === 'choose-folder' ? (
          <Button variant="primary" onClick={onChooseFolder}>
            Choose a different folder
          </Button>
        ) : (
          <Button variant="primary" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>

      {/* role="alert": this is injected after the section's initial alert announcement, so it
          needs its own assertive region to be read when a retry transport-fails. */}
      {retryError && (
        <p className="start-error" role="alert">
          {retryError}
        </p>
      )}
    </section>
  );
}
