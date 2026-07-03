// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { Phase, Status, StepId, type KindlingEvent } from '../../engine/contract';
import type { EventSourceLike } from '../lib/events';
import { pins } from '../../engine/pins';
import { InstallerProvider } from '../state/context';
import { Welcome } from './Welcome';

class FakeEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  close = vi.fn();
  emit(data: string) {
    this.onmessage?.({ data });
  }
}

const SUMMARY = '{"schemaVersion":3,"success":true,"cli":[],"bmad":{"pinnedVersion":"6.9.0"}}';

function successEvent(summaryJson = SUMMARY): KindlingEvent {
  return {
    id: 'done1',
    phase: Phase.Finalize,
    step: StepId.FinalizeSelfCheck,
    status: Status.Done,
    humanMessage: "Everything checks out — you're ready.",
    level: 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
    summaryJson,
  };
}

function renderWelcome(onRendered = vi.fn(), summaryJson = SUMMARY) {
  const source = new FakeEventSource();
  render(
    <InstallerProvider EventSourceCtor={() => source}>
      <Welcome pins={pins} onRendered={onRendered} />
    </InstallerProvider>,
  );
  act(() => source.emit(JSON.stringify(successEvent(summaryJson))));
  return { onRendered };
}

const summaryWith = (cli: unknown): string =>
  JSON.stringify({ schemaVersion: 3, success: true, cli, bmad: { pinnedVersion: '6.9.0' } });
const presentClaude = { id: 'claude-code', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code', present: true };
const absentCodex = { id: 'codex', name: 'Codex', bin: 'codex', pkg: '@openai/codex', present: false };

describe('<Welcome>', () => {
  it('celebrates readiness and shows the pinned BMad version chip', () => {
    renderWelcome();
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
    expect(screen.getByText(pins.bmad)).toBeInTheDocument();
  });

  // AC-6: version-chip honesty for the latest path.
  const summaryWithBmad = (installedVersion: string | null): string =>
    JSON.stringify({
      schemaVersion: 3,
      success: true,
      cli: [],
      bmad: { pinnedVersion: '6.9.0', installed: true, installedVersion },
    });

  it('AC-6: an installedVersion differing from the pin shows the honest version + "updated to latest"', () => {
    renderWelcome(vi.fn(), summaryWithBmad('6.10.0'));
    const chip = screen.getByText(/updated to latest/);
    expect(chip).toHaveTextContent('6.10.0');
    expect(screen.queryByText(/a stable, tested version/)).toBeNull();
  });

  it('AC-6: an installedVersion EQUAL to the pin keeps the pinned chip unchanged', () => {
    renderWelcome(vi.fn(), summaryWithBmad('6.9.0'));
    expect(screen.getByText(/a stable, tested version/)).toBeInTheDocument();
    expect(screen.queryByText(/updated to latest/)).toBeNull();
  });

  it('AC-6: a null installedVersion falls back to the pinned chip (never blank/crash)', () => {
    renderWelcome(vi.fn(), summaryWithBmad(null));
    expect(screen.getByText(/a stable, tested version/)).toBeInTheDocument();
    expect(screen.getByText('6.9.0')).toBeInTheDocument();
  });

  it('AC-6: a malformed summaryJson falls back to the pinned chip (never blank/crash)', () => {
    renderWelcome(vi.fn(), 'not json at all');
    expect(screen.getByText(/a stable, tested version/)).toBeInTheDocument();
    expect(screen.getByText('6.9.0')).toBeInTheDocument();
  });

  it('AC-6: a summary with NO bmad key falls back to the pinned chip', () => {
    renderWelcome(vi.fn(), JSON.stringify({ schemaVersion: 3, success: true, cli: [] }));
    expect(screen.getByText(/a stable, tested version/)).toBeInTheDocument();
    expect(screen.getByText('6.9.0')).toBeInTheDocument();
  });

  it('shows a versions table with Node, Git, BMad, and the agent CLIs', () => {
    const withVersions = JSON.stringify({
      schemaVersion: 3,
      success: true,
      node: { present: true, version: '24.16.0', satisfiesFloor: true },
      git: { present: true, version: '2.43.0' },
      bmad: { pinnedVersion: '6.9.0', installed: true, installedVersion: '6.9.0' },
      cli: [presentClaude],
    });
    renderWelcome(vi.fn(), withVersions);
    const table = screen.getByTestId('versions');
    expect(within(table).getByText('24.16.0')).toBeInTheDocument();
    expect(within(table).getByText('2.43.0')).toBeInTheDocument();
    expect(within(table).getByText('6.9.0')).toBeInTheDocument();
    expect(within(table).getByText('Claude Code')).toBeInTheDocument();
  });

  it('render-acks once so the host can exit the ephemeral server', () => {
    const { onRendered } = renderWelcome();
    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it('shows the workshop strip as a passive, non-autofocused element', () => {
    renderWelcome();
    const strip = screen.getByTestId('workshop-strip');
    expect(strip).toBeInTheDocument();
    expect(strip).toHaveTextContent(/workshop/i);
    // Passive: nothing inside it grabs focus on mount.
    expect(strip.contains(document.activeElement)).toBe(false);
  });

  it('AC-4: shows the login line naming a present CLI command; not the install notice', () => {
    renderWelcome(vi.fn(), summaryWith([presentClaude]));
    const login = screen.getByTestId('cli-login');
    expect(login).toHaveTextContent(/log in/i);
    expect(within(login).getByText('claude')).toBeInTheDocument();
    expect(screen.queryByTestId('cli-missing')).toBeNull();
  });

  it('AC-8: shows the install-it-yourself notice (named, non-error) for an absent CLI', () => {
    renderWelcome(vi.fn(), summaryWith([absentCodex]));
    const missing = screen.getByTestId('cli-missing');
    expect(within(missing).getByText('npm install -g @openai/codex')).toBeInTheDocument();
    // Non-error: it's a role=status region, not an alert; readiness stays celebratory.
    expect(missing.getAttribute('role')).toBe('status');
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
    expect(screen.queryByTestId('cli-login')).toBeNull();
  });

  it('shows NEITHER guidance block when no CLI was requested (cli: [])', () => {
    renderWelcome(vi.fn(), summaryWith([]));
    expect(screen.queryByTestId('cli-login')).toBeNull();
    expect(screen.queryByTestId('cli-missing')).toBeNull();
  });

  it('opt-in is consent-first: disabled until an email is typed, then acks quietly (5.2)', () => {
    renderWelcome();
    const submit = screen.getByRole('button', { name: 'Keep me posted' });
    expect(submit).toBeDisabled(); // skipping is always valid; nothing to capture yet
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'a@b.com' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    // Endpoint is unconfigured in tests → graceful no-op, but the user still gets a calm thanks.
    expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument();
  });
});
