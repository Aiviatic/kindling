// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ErrorCode, Phase, Status, StepId, type KindlingEvent } from '../../engine/contract';
import type { EventSourceLike } from '../lib/events';
import type { UiCommands } from '../lib/commands';
import { InstallerProvider } from '../state/context';
import { ErrorScreen } from './ErrorScreen';

class FakeEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  close = vi.fn();
  emit(data: string) {
    this.onmessage?.({ data });
  }
}

let seq = 0;
function failEvent(step: StepId, message: string, errorCode?: ErrorCode): KindlingEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    phase: Phase.Install,
    step,
    status: Status.Failed,
    humanMessage: message,
    level: 'error',
    timestamp: '2026-05-29T00:00:00.000Z',
    errorCode,
  };
}

function renderError(
  failure: KindlingEvent,
  props: Partial<{ onRetry: () => void; onChooseFolder: () => void; retryError: string }> = {},
) {
  const source = new FakeEventSource();
  const commands: UiCommands = {
    start: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ isKindlingProject: false, installedBmadVersion: null }),
  };
  const onRetry = props.onRetry ?? vi.fn();
  const onChooseFolder = props.onChooseFolder ?? vi.fn();
  render(
    <InstallerProvider EventSourceCtor={() => source} commands={commands}>
      <ErrorScreen onRetry={onRetry} onChooseFolder={onChooseFolder} retryError={props.retryError} />
    </InstallerProvider>,
  );
  act(() => source.emit(JSON.stringify(failure)));
  return { commands, onRetry, onChooseFolder };
}

describe('<ErrorScreen>', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('is announced assertively (role="alert")', () => {
    renderError(failEvent(StepId.InstallMethod, 'boom', ErrorCode.ExecFailed));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the Windows execution-policy fix command with a copy action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderError(failEvent(StepId.ProvisionNode, 'blocked', ErrorCode.ExecPolicyBlocked));
    expect(screen.getByText('Set-ExecutionPolicy -Scope Process Bypass')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith('Set-ExecutionPolicy -Scope Process Bypass');
    expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument();
  });

  it('offers Retry for a generic failure (Flow re-runs the failed step)', () => {
    const onRetry = vi.fn();
    renderError(failEvent(StepId.InstallMethod, 'boom', ErrorCode.ExecFailed), { onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the dedicated BMad-install-failure guidance', () => {
    renderError(failEvent(StepId.InstallMethod, 'exit 1', ErrorCode.BmadInstallFailed));
    expect(screen.getByRole('heading', { name: /BMad didn’t install/ })).toBeInTheDocument();
  });

  it('a pre-existing-project conflict offers a non-destructive "choose a different folder", not Retry', () => {
    const onChooseFolder = vi.fn();
    renderError(failEvent(StepId.ScaffoldGitInit, 'folder not empty', ErrorCode.ProjectConflict), {
      onChooseFolder,
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a different folder' }));
    expect(onChooseFolder).toHaveBeenCalledTimes(1);
  });

  it('announces a transport-level retry failure assertively (role="alert")', () => {
    renderError(failEvent(StepId.InstallMethod, 'boom', ErrorCode.ExecFailed), {
      retryError: 'We couldn’t reach Kindling.',
    });
    // Both the screen section and the retry-error paragraph carry role="alert".
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes("couldn’t reach Kindling"))).toBe(true);
  });

  it('falls back to the engine message when the failure carries no code', () => {
    renderError(failEvent(StepId.InstallMethod, 'A specific engine-authored failure message.'));
    // Appears as the headline detail (and again in the step-context row) — the engine's words, not ours.
    expect(
      screen.getAllByText('A specific engine-authored failure message.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
