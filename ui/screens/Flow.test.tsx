// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

// Force the cohort gate ON for this file so the PRIMARY Intro→Configure path can exercise the
// probe — proving `commands.inspect` is threaded to the primary <Configure> (not just the
// reconfiguring one). Gate ON is inert for the other tests here (they never open Customize).
vi.mock('../config/bmad-update', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/bmad-update')>()),
  ENABLE_BMAD_UPDATE: true,
}));
import { ErrorCode, Phase, Status, StepId, type KindlingEvent } from '../../engine/contract';
import type { EventSourceLike } from '../lib/events';
import type { UiCommands } from '../lib/commands';
import type { IdeCatalog } from '../config/ide-catalog';
import { pins } from '../../engine/pins';
import { InstallerProvider } from '../state/context';
import { Flow } from './Flow';

class FakeEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  close = vi.fn();
  emit(data: string) {
    this.onmessage?.({ data });
  }
}

const catalog: IdeCatalog = {
  degraded: false,
  ides: [{ id: 'claude-code', name: 'Claude Code', recommended: true }],
};

function renderFlow(startImpl: UiCommands['start'] = vi.fn().mockResolvedValue(undefined)) {
  const source = new FakeEventSource();
  const commands: UiCommands = {
    start: startImpl,
    cancel: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ isKindlingProject: false, installedBmadVersion: null }),
  };
  render(
    <InstallerProvider EventSourceCtor={() => source} commands={commands}>
      <Flow catalog={catalog} pins={pins} />
    </InstallerProvider>,
  );
  return { source, commands };
}

const evt: KindlingEvent = {
  id: 'e1',
  phase: Phase.Install,
  step: StepId.InstallBmad,
  status: Status.Working,
  humanMessage: 'Installing BMad…',
  level: 'info',
  timestamp: '2026-05-29T00:00:00.000Z',
};

describe('<Flow>', () => {
  it('walks Intro → Configure → start, then shows the running screen on the first event', () => {
    const { source, commands } = renderFlow();

    // Intro
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    // Configure
    expect(screen.getByRole('heading', { name: /Give your project a name/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(commands.start).toHaveBeenCalledTimes(1);

    // Engine emits its first event → overall leaves 'idle' → the running Progress screen.
    act(() => source.emit(JSON.stringify(evt)));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getAllByText('Installing BMad…').length).toBeGreaterThan(0);
  });

  it('shows the error screen on a failed event, and a project-conflict routes back to Configure', () => {
    const { source } = renderFlow();
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    const fail: KindlingEvent = {
      ...evt,
      id: 'f1',
      step: StepId.ScaffoldGitInit,
      status: Status.Failed,
      humanMessage: 'folder not empty',
      level: 'error',
      errorCode: ErrorCode.ProjectConflict,
    };
    act(() => source.emit(JSON.stringify(fail)));

    // Error/recovery screen, announced via role="alert".
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Conflict → non-destructive choose-folder, which returns to Configure.
    fireEvent.click(screen.getByRole('button', { name: 'Choose a different folder' }));
    expect(screen.getByRole('heading', { name: /Give your project a name/ })).toBeInTheDocument();
  });

  it('threads commands.inspect to the PRIMARY Intro→Configure <Configure> (the probe fires from it)', async () => {
    const { commands } = renderFlow();
    // Primary path: Intro → Configure (NOT the reconfiguring site).
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    expect(screen.getByRole('heading', { name: /Give your project a name/ })).toBeInTheDocument();
    // Open Customize so the (gated-ON) probe effect can run — it only fires if `inspect` was
    // actually passed through; a missing prop would short-circuit the effect and never call it.
    fireEvent.click(screen.getByRole('button', { name: /Customize/ }));
    await waitFor(() => expect(commands.inspect).toHaveBeenCalled());
  });

  it('reverts to Configure with an alert when the start POST itself fails (no SSE event)', async () => {
    const rejecting = vi.fn().mockRejectedValue(new Error('403'));
    renderFlow(rejecting);
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    });
    expect(rejecting).toHaveBeenCalledTimes(1);
    // No SSE event arrives on a transport failure → user must still see the error + Start again.
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't reach Kindling/);
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});
