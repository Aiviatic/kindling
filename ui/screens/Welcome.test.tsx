// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within, waitFor } from '@testing-library/react';
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

const SUMMARY =
  '{"schemaVersion":5,"success":true,"cli":[],"framework":"bmad","frameworkInfo":{"label":"BMad Method","version":"6.9.0","note":"a stable, tested version"}}';

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
  // The geo pre-fill (best-effort) fires on mount. Default to a rejecting fetch so it degrades
  // silently and NEVER makes a real network call in tests; individual tests override as needed.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests'); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('celebrates readiness and shows the pinned BMad version chip', () => {
    renderWelcome();
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
    expect(screen.getByText(pins.bmad)).toBeInTheDocument();
  });

  it("framework 'none' hides all BMad-specific copy (no version row, no /bmad-help)", () => {
    const noneSummary = JSON.stringify({ schemaVersion: 4, success: true, cli: [], framework: 'none' });
    renderWelcome(vi.fn(), noneSummary);
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
    // No BMad Method row, no pinned version, no /bmad-help hint.
    expect(screen.queryByText('BMad Method')).toBeNull();
    expect(screen.queryByText(pins.bmad)).toBeNull();
    expect(screen.queryByText('/bmad-help')).toBeNull();
    // The generic ready line still shows.
    expect(screen.getByText(/set up and ready for your tools/)).toBeInTheDocument();
  });

  // The framework row is rendered generically from `frameworkInfo`. The honest "updated to latest"
  // chip logic now lives in the provider (bmad-provider.summaryFacts) + validation-summary tests,
  // so here we only verify the row reflects whatever frameworkInfo carries, and degrades safely.
  const summaryWithFramework = (frameworkInfo: unknown, framework = 'bmad'): string =>
    JSON.stringify({ schemaVersion: 5, success: true, cli: [], framework, frameworkInfo });

  it('renders the framework row from frameworkInfo (label, version, note)', () => {
    renderWelcome(vi.fn(), summaryWithFramework({ label: 'BMad Method', version: '6.10.0', note: 'updated to latest' }));
    const table = screen.getByTestId('versions');
    expect(within(table).getByText('BMad Method')).toBeInTheDocument();
    expect(within(table).getByText(/updated to latest/)).toHaveTextContent('6.10.0');
  });

  it('renders an OpenSpec row + OpenSpec getting-started, not BMad', () => {
    // A CLI is present so the "start building" section (which carries the getting-started line) renders.
    const s = JSON.stringify({
      schemaVersion: 5,
      success: true,
      cli: [presentClaude],
      framework: 'openspec',
      frameworkInfo: { label: 'OpenSpec', version: '1.5.0', note: 'a stable, tested version' },
    });
    renderWelcome(vi.fn(), s);
    const table = screen.getByTestId('versions');
    expect(within(table).getByText('OpenSpec')).toBeInTheDocument();
    expect(within(table).getByText('1.5.0')).toBeInTheDocument();
    // OpenSpec's getting-started hint, not BMad's.
    expect(screen.getByText('/opsx:propose "your idea"')).toBeInTheDocument();
    expect(screen.queryByText('/bmad-help')).toBeNull();
  });

  it('shows no framework row when frameworkInfo is absent (never blank/crash)', () => {
    renderWelcome(vi.fn(), JSON.stringify({ schemaVersion: 5, success: true, cli: [], framework: 'bmad' }));
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
    expect(screen.queryByText('BMad Method')).toBeNull();
  });

  it('a malformed summaryJson still renders (no framework row, never crash)', () => {
    renderWelcome(vi.fn(), 'not json at all');
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
    expect(screen.queryByText('BMad Method')).toBeNull();
  });

  it('shows a versions table with Node, Git, BMad, and the agent CLIs', () => {
    const withVersions = JSON.stringify({
      schemaVersion: 5,
      success: true,
      framework: 'bmad',
      frameworkInfo: { label: 'BMad Method', version: '6.9.0', note: 'a stable, tested version' },
      node: { present: true, version: '24.16.0', satisfiesFloor: true },
      git: { present: true, version: '2.43.0' },
      cli: [presentClaude],
    });
    renderWelcome(vi.fn(), withVersions);
    const table = screen.getByTestId('versions');
    expect(within(table).getByText('24.16.0')).toBeInTheDocument();
    expect(within(table).getByText('2.43.0')).toBeInTheDocument();
    expect(within(table).getByText('BMad Method')).toBeInTheDocument();
    expect(within(table).getByText('6.9.0')).toBeInTheDocument();
    expect(within(table).getByText('Claude Code')).toBeInTheDocument();
  });

  it('shows the project folder as the first row of the versions table when the summary includes projectDir', () => {
    const withProjectDir = JSON.stringify({
      schemaVersion: 3,
      success: true,
      projectDir: '/Users/ada/projects/my-app',
      node: { present: true, version: '24.16.0', satisfiesFloor: true },
      git: { present: true, version: '2.43.0' },
      bmad: { pinnedVersion: '6.9.0', installed: true, installedVersion: '6.9.0' },
      cli: [],
    });
    renderWelcome(vi.fn(), withProjectDir);
    const table = screen.getByTestId('versions');
    expect(within(table).getByText('Project folder')).toBeInTheDocument();
    expect(within(table).getByText('/Users/ada/projects/my-app')).toBeInTheDocument();
    // It's the FIRST data row (most useful "where is my project").
    const firstHeader = within(table).getAllByRole('rowheader')[0];
    expect(firstHeader).toHaveTextContent('Project folder');
  });

  it('omits the project folder row when the summary carries no projectDir', () => {
    renderWelcome(vi.fn(), summaryWith([]));
    const table = screen.getByTestId('versions');
    expect(within(table).queryByText('Project folder')).toBeNull();
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

  it('uses the updated opt-in copy ("Totally optional, setup is complete.")', () => {
    renderWelcome();
    const strip = screen.getByTestId('workshop-strip');
    expect(within(strip).getByText('Totally optional, setup is complete.')).toBeInTheDocument();
    expect(within(strip).queryByText(/project's already done/)).toBeNull();
  });

  // A summary that carries os + projectDir alongside the requested CLIs, for the directory-aware,
  // OS-aware "Start building" guidance.
  const summaryWithOs = (cli: unknown, os: string, projectDir = '/Users/ada/projects/my-app'): string =>
    JSON.stringify({ schemaVersion: 3, success: true, os, projectDir, cli, bmad: { pinnedVersion: '6.9.0' } });

  it('Start building: shows one cohesive section naming the requested tool command', () => {
    renderWelcome(vi.fn(), summaryWith([presentClaude]));
    const section = screen.getByTestId('start-building');
    expect(within(section).getByText('Start building')).toBeInTheDocument();
    // The terminal command for the requested tool is shown.
    expect(within(section).getByText('claude')).toBeInTheDocument();
    // Calm and celebratory: plain convenience region, not an alert, and readiness still stands.
    expect(section.getAttribute('role')).toBeNull();
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
  });

  it('Start building: desktop-app instructions come BEFORE the terminal instructions in the DOM', () => {
    renderWelcome(vi.fn(), summaryWith([presentClaude]));
    const desktop = screen.getByTestId('start-desktop');
    const terminal = screen.getByTestId('start-terminal');
    // Desktop first (most users use the app); terminal is the labeled alternative.
    expect(desktop.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(terminal).getByText(/Prefer the terminal/i)).toBeInTheDocument();
  });

  it('Start building: shows the project folder path in BOTH the desktop and terminal guidance', () => {
    renderWelcome(vi.fn(), summaryWithOs([presentClaude], 'darwin'));
    expect(screen.getByTestId('start-desktop-folder')).toHaveTextContent('/Users/ada/projects/my-app');
    expect(screen.getByTestId('start-terminal-folder')).toHaveTextContent('/Users/ada/projects/my-app');
  });

  it('Start building: renders the Windows-specific terminal tip for os=win32', () => {
    renderWelcome(vi.fn(), summaryWithOs([presentClaude], 'win32'));
    const tip = screen.getByTestId('start-terminal-tip');
    expect(tip).toHaveTextContent(/File Explorer/i);
    expect(tip).toHaveTextContent(/type cmd/i);
  });

  it('Start building: renders the macOS-specific terminal tip for os=darwin', () => {
    renderWelcome(vi.fn(), summaryWithOs([presentClaude], 'darwin'));
    const tip = screen.getByTestId('start-terminal-tip');
    expect(tip).toHaveTextContent(/Finder/i);
    expect(tip).toHaveTextContent(/New Terminal at Folder/i);
  });

  it('Start building: falls back to a neutral cd tip when the os is absent', () => {
    renderWelcome(vi.fn(), summaryWith([presentClaude]));
    expect(screen.getByTestId('start-terminal-tip')).toHaveTextContent(/cd into your project folder/i);
  });

  it('AC-8: keeps the install-it-yourself fallback (named, non-error) for an absent CLI', () => {
    renderWelcome(vi.fn(), summaryWith([absentCodex]));
    const missing = screen.getByTestId('start-missing');
    expect(within(missing).getByText('npm install -g @openai/codex')).toBeInTheDocument();
    // Still celebratory: it lives in the calm Start-building section, not an alert.
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
  });

  it('shows NO Start building section when no CLI was requested (cli: [])', () => {
    renderWelcome(vi.fn(), summaryWith([]));
    expect(screen.queryByTestId('start-building')).toBeNull();
  });

  it('offers a desktop-app link to the Claude quickstart when claude-code was requested', () => {
    renderWelcome(vi.fn(), summaryWith([presentClaude]));
    const desktop = screen.getByTestId('start-desktop');
    const link = within(desktop).getByRole('link', { name: /Claude Code app/i });
    expect(link).toHaveAttribute('href', 'https://code.claude.com/docs/en/desktop-quickstart');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('offers a desktop-app link to the Codex app when codex was requested (even if not installed)', () => {
    renderWelcome(vi.fn(), summaryWith([absentCodex]));
    const desktop = screen.getByTestId('start-desktop');
    const link = within(desktop).getByRole('link', { name: /Codex app/i });
    expect(link).toHaveAttribute('href', 'https://developers.openai.com/codex/app');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('lists a desktop-app link for each requested CLI that offers one', () => {
    renderWelcome(vi.fn(), summaryWith([presentClaude, absentCodex]));
    const desktop = screen.getByTestId('start-desktop');
    expect(within(desktop).getByRole('link', { name: /Claude Code app/i })).toBeInTheDocument();
    expect(within(desktop).getByRole('link', { name: /Codex app/i })).toBeInTheDocument();
  });

  it('#9: tells the user the install is complete and they can close the browser tab', () => {
    renderWelcome();
    expect(screen.getByText(/close this browser tab/i)).toBeInTheDocument();
    // Celebratory, not an error: still under the "You're ready" heading, no alert role.
    expect(screen.getByRole('heading', { name: /You're ready/ })).toBeInTheDocument();
  });

  it('opt-in form collects first name, last name, email (required) plus city and state (optional)', () => {
    renderWelcome();
    // First/Last/Email are required now — their labels no longer carry "(optional)".
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name (optional)')).toBeNull();
    expect(screen.queryByLabelText('Last name (optional)')).toBeNull();
    expect(screen.queryByLabelText('Email (optional)')).toBeNull();
    // City/State stay optional and keep the "(optional)" suffix.
    expect(screen.getByLabelText('City (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('State (optional)')).toBeInTheDocument();
  });

  it('opt-in is consent-first: disabled until first+last+email are filled, then acks quietly (5.2)', () => {
    renderWelcome();
    const submit = screen.getByRole('button', { name: 'Keep me posted' });
    expect(submit).toBeDisabled(); // skipping is always valid; nothing to capture yet
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } });
    expect(submit).toBeDisabled(); // last name + email still missing
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    expect(submit).toBeDisabled(); // email still missing — it's the identity
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    // Endpoint is unconfigured in tests → graceful no-op, but the user still gets a calm thanks.
    expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument();
  });

  it('geo pre-fill: a successful IP lookup fills City + State the user has not typed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ city: 'Austin', region: 'Texas' }) })),
    );
    renderWelcome();
    expect(await screen.findByDisplayValue('Austin')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Texas')).toBeInTheDocument();
  });

  it('geo pre-fill never clobbers a value the user already typed into City', async () => {
    let resolve!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((r) => {
      resolve = r;
    });
    vi.stubGlobal('fetch', vi.fn(() => pending));
    renderWelcome();
    fireEvent.change(screen.getByLabelText('City (optional)'), { target: { value: 'Portland' } });
    await act(async () => {
      resolve({ ok: true, json: async () => ({ city: 'Austin', region: 'Texas' }) });
    });
    // State was untouched, so it fills; City keeps the user's typed value.
    await waitFor(() =>
      expect((screen.getByLabelText('State (optional)') as HTMLInputElement).value).toBe('Texas'),
    );
    expect((screen.getByLabelText('City (optional)') as HTMLInputElement).value).toBe('Portland');
  });

  it('geo pre-fill degrades silently when fetch is unavailable (no throw, fields stay empty)', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => renderWelcome()).not.toThrow();
    expect((screen.getByLabelText('City (optional)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('State (optional)') as HTMLInputElement).value).toBe('');
  });
});
