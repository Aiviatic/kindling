// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { Phase, Status, StepId, type KindlingEvent } from '../../engine/contract';
import type { EventSourceLike } from '../lib/events';
import { InstallerProvider } from '../state/context';
import { Progress } from './Progress';

class FakeEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  close = vi.fn();
  emit(data: string) {
    this.onmessage?.({ data });
  }
}

let seq = 0;
function ev(step: StepId, status: Status, humanMessage: string, pct?: number): KindlingEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    phase: Phase.Install,
    step,
    status,
    pct,
    humanMessage,
    level: status === Status.Failed ? 'error' : 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
  };
}

function renderProgress() {
  const source = new FakeEventSource();
  render(
    <InstallerProvider EventSourceCtor={() => source}>
      <Progress />
    </InstallerProvider>,
  );
  const emit = (e: KindlingEvent) => act(() => source.emit(JSON.stringify(e)));
  return { emit };
}

describe('<Progress>', () => {
  it('renders one row per step with icon + WORD + the engine message', () => {
    const { emit } = renderProgress();
    emit(ev(StepId.ProvisionNode, Status.Done, 'Node ready'));
    emit(ev(StepId.InstallMethod, Status.Working, 'Installing BMad…'));

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Done')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Node ready')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Working')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Installing BMad…')).toBeInTheDocument();
  });

  it('drives the progress bar from real completion (aria-valuenow) on a non-slow working step', () => {
    const { emit } = renderProgress();
    emit(ev(StepId.ProvisionNode, Status.Done, 'Node ready'));
    emit(ev(StepId.ScaffoldGitInit, Status.Working, 'Creating your project folder…'));
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '20'); // 1 of floored-5; non-slow → determinate
    expect(bar.getAttribute('aria-valuetext')).toMatch(/Creating your project folder/);
  });

  it('shows indeterminate activity (no aria-valuenow) while a known-slow step works (never frozen)', () => {
    const { emit } = renderProgress();
    emit(ev(StepId.InstallMethod, Status.Working, 'Installing BMad — this can take a couple of minutes…'));
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveClass('progressbar--activity');
    expect(bar).not.toHaveAttribute('aria-valuenow'); // omitted → AT reads it as indeterminate
  });

  it('advances on each real completion and never regresses (monotonic, no premature 100)', () => {
    const { emit } = renderProgress();
    // Read aria-valuenow only while a (non-slow) step is working → determinate; between steps
    // the bar is intentionally indeterminate (never-frozen) and omits the number.
    const now = () => Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'));
    emit(ev(StepId.ProvisionNode, Status.Done, 'Node ready'));
    emit(ev(StepId.ProvisionGit, Status.Working, 'Setting up Git…'));
    expect(now()).toBe(20); // 1 of 5 — NOT 100, despite few steps seen
    emit(ev(StepId.ProvisionGit, Status.Done, 'Git ready'));
    emit(ev(StepId.ScaffoldGitInit, Status.Working, 'Creating…'));
    expect(now()).toBe(40); // advanced, never regressed
  });

  it('marks skipped steps as "Already present"', () => {
    const { emit } = renderProgress();
    emit(ev(StepId.ProvisionGit, Status.Skipped, 'Git already installed — reusing it.'));
    expect(screen.getByText('Already present')).toBeInTheDocument();
  });

  it('renders the queued and failed states with icon + word', () => {
    const { emit } = renderProgress();
    emit(ev(StepId.ProvisionNode, Status.Queued, 'Node needs setting up.'));
    expect(screen.getByText('Queued')).toBeInTheDocument();
    emit(ev(StepId.InstallMethod, Status.Failed, 'A step did not finish. Press Retry.'));
    const failedRow = screen.getByText('Failed').closest('li');
    expect(failedRow).not.toBeNull();
    expect(within(failedRow as HTMLElement).getByText('A step did not finish. Press Retry.')).toBeInTheDocument();
  });
});
