import { useEffect, useRef, useState } from 'react';
import type { Config, Pins } from '../../engine/contract';
import type { IdeCatalog } from '../config/ide-catalog';
import { useInstaller } from '../state/context';
import { Intro } from './Intro';
import { Configure } from './Configure';
import { Progress } from './Progress';
import { ErrorScreen } from './ErrorScreen';
import { Welcome } from './Welcome';

export interface FlowProps {
  catalog: IdeCatalog;
  pins: Pins;
  /** Last run's projects folder (prefs prefill), threaded through to Configure. */
  initialFolder?: string | null;
}

type PreStartScreen = 'intro' | 'configure';

// Top-level screen selector. Pre-start it walks Intro → Configure (local UI state). Pressing
// Start (or Retry) hands off to the engine: Progress while running, the error/recovery screen
// on failure (Retry in place, or — for a pre-existing-project conflict — back to Configure to
// pick a new folder), Welcome on success (3.7 replaces that placeholder).
export function Flow({ catalog, pins, initialFolder }: FlowProps) {
  const { state, commands, reset } = useInstaller();
  const [screen, setScreen] = useState<PreStartScreen>('intro');
  // `starting` covers the gap between pressing Start/Retry and the engine's first NEW event
  // (during a re-run the prior run's events still sit in state). `runErrorBaseline` records the
  // event count at hand-off so the effect clears `starting` only on a genuinely new event — not
  // on the stale backlog. `runError` surfaces a transport failure (the POST itself failed →
  // no SSE event). `reconfiguring` re-shows Configure after a project conflict (FR-9).
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [reconfiguring, setReconfiguring] = useState(false);
  // The user quit from a pre-start screen: the local server is being torn down, so show a
  // terminal "stopped" screen and never fall back into the flow.
  const [stopped, setStopped] = useState(false);
  const baseline = useRef(0);

  // Clear the pre-event flag once the engine emits an event BEYOND the hand-off baseline.
  useEffect(() => {
    if (state.events.length > baseline.current) setStarting(false);
  }, [state.events.length]);

  // Begin a run/re-run: arm `starting`, record the baseline, fire the command (a transport
  // failure has no SSE event, so catch it and surface a retryable message).
  const run = (fire: Promise<void> | void): void => {
    setRunError(null);
    baseline.current = state.events.length;
    setStarting(true);
    void Promise.resolve(fire).catch(() => {
      setStarting(false);
      setRunError("We couldn't reach Kindling. Make sure it's still running, then try again.");
    });
  };

  const handleStart = (config: Config): void => {
    setReconfiguring(false);
    reset(); // fresh run from Configure → clear any prior run's steps so they don't bleed in
    run(commands.start(config));
  };

  const handleRetry = (): void => {
    if (state.failure) run(commands.retry(state.failure.step)); // re-run in place; no reset
  };

  // Quit from a pre-start screen: fire the kill (best-effort — the server may exit before the
  // response lands) and switch to the terminal stopped screen immediately.
  const handleQuit = (): void => {
    void commands.quit().catch(() => {});
    setStopped(true);
  };

  if (stopped) {
    return (
      <section className="screen" aria-labelledby="stopped-h">
        <p className="eyebrow">Stopped</p>
        <h1 id="stopped-h">Setup canceled.</h1>
        <p className="lede">
          Kindling has stopped and nothing was installed. It's safe to close this tab. To set up a
          project later, just start Kindling again the same way you did this time.
        </p>
      </section>
    );
  }

  if (reconfiguring) {
    return (
      <Configure
        catalog={catalog}
        pins={pins}
        startError={runError}
        onStart={handleStart}
        inspect={commands.inspect}
        initialFolder={initialFolder}
        onCancel={handleQuit}
      />
    );
  }

  if (state.overall === 'success') {
    return <Welcome pins={pins} onRendered={() => void commands.ack().catch(() => {})} />;
  }

  // Failure (and not in the middle of a re-run) → the error/recovery screen.
  if (state.overall === 'failed' && !starting) {
    return (
      <ErrorScreen
        onRetry={handleRetry}
        onChooseFolder={() => setReconfiguring(true)}
        retryError={runError}
      />
    );
  }

  // Running, or the brief pre-first-event window after Start/Retry → the honest Progress screen.
  if (starting || state.overall === 'running') {
    return <Progress />;
  }

  if (screen === 'intro') {
    return <Intro onContinue={() => setScreen('configure')} onCancel={handleQuit} />;
  }
  return (
    <Configure
      catalog={catalog}
      pins={pins}
      startError={runError}
      onStart={handleStart}
      inspect={commands.inspect}
      initialFolder={initialFolder}
      onCancel={handleQuit}
    />
  );
}
