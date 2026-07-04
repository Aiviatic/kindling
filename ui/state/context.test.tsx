// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Phase, Status, StepId, type KindlingEvent } from '../../engine/contract';
import type { EventSourceLike } from '../lib/events';
import { InstallerProvider, useInstaller } from './context';

class FakeEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  close = vi.fn();
  emit(data: string) {
    this.onmessage?.({ data });
  }
}

function Probe() {
  const { state } = useInstaller();
  return (
    <div>
      <span data-testid="overall">{state.overall}</span>
      <span data-testid="msg">{state.lastMessage}</span>
    </div>
  );
}

const sample: KindlingEvent = {
  id: 'e1',
  phase: Phase.Install,
  step: StepId.InstallMethod,
  status: Status.Working,
  pct: 25,
  humanMessage: 'Installing BMad…',
  level: 'info',
  timestamp: '2026-05-29T00:00:00.000Z',
};

describe('InstallerProvider / useInstaller', () => {
  it('starts idle and projects an incoming event into state', () => {
    const source = new FakeEventSource();
    render(
      <InstallerProvider EventSourceCtor={() => source}>
        <Probe />
      </InstallerProvider>,
    );
    expect(screen.getByTestId('overall')).toHaveTextContent('idle');

    act(() => source.emit(JSON.stringify(sample)));

    expect(screen.getByTestId('overall')).toHaveTextContent('running');
    expect(screen.getByTestId('msg')).toHaveTextContent('Installing BMad');
  });

  it('useInstaller throws when used outside the provider', () => {
    // Silence React's expected error-boundary console noise for this assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within <InstallerProvider>/);
    spy.mockRestore();
  });
});
