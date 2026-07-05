// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { Configure } from './Configure';
import type { IdeCatalog } from '../config/ide-catalog';
import type { InspectResult } from '../../engine/contract';
import { pins } from '../../engine/pins';

const catalog: IdeCatalog = {
  degraded: false,
  ides: [
    { id: 'claude-code', name: 'Claude Code', recommended: true },
    { id: 'cursor', name: 'Cursor', recommended: true },
    { id: 'windsurf', name: 'Windsurf', recommended: false },
  ],
};

function renderConfigure(over: Partial<Parameters<typeof Configure>[0]> = {}) {
  const onStart = vi.fn();
  render(<Configure catalog={catalog} pins={pins} onStart={onStart} {...over} />);
  return { onStart };
}

describe('<Configure>', () => {
  it('starts with smart defaults and reaches Start without any interaction (FR-14)', () => {
    const { onStart } = renderConfigure();
    const startBtn = screen.getByRole('button', { name: 'Start' });
    expect(startBtn).toBeEnabled();
    startBtn.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    const cfg = onStart.mock.calls[0][0];
    expect(cfg.ides).toEqual(['claude-code']); // the default IDE
    expect(cfg.modules).toEqual(['bmm', 'cis']); // bmm + cis are checked by default
    expect(cfg.projectName).toBeTruthy();
    // NFR3: the literal never-touch-Customize path never emits an update-to-latest target.
    expect(cfg.bmadTarget).toBeUndefined();
  });

  it('No framework: hides the modules section and Starts with method:none + empty modules', () => {
    const { onStart } = renderConfigure();
    // The method selector is collapsed by default (default flow never sees it).
    expect(screen.getByText('What to include')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Setup method:/ }));
    fireEvent.click(screen.getByRole('radio', { name: /No framework/ }));
    // Modules are BMad-only → the section is gone, and Start no longer needs a module.
    expect(screen.queryByText('What to include')).toBeNull();
    const startBtn = screen.getByRole('button', { name: 'Start' });
    expect(startBtn).toBeEnabled();
    startBtn.click();
    const cfg = onStart.mock.calls[0][0];
    expect(cfg.method).toBe('none');
    expect(cfg.modules).toEqual([]);
  });

  it('the default (BMad) Start omits the method field (byte-identical default Config)', () => {
    const { onStart } = renderConfigure();
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].method).toBeUndefined();
  });

  it('only shows recommended IDEs until "Show all" is toggled', () => {
    renderConfigure();
    expect(screen.queryByText('Windsurf')).toBeNull(); // not recommended → hidden initially
    fireEvent.click(screen.getByRole('button', { name: /Show all 3 tools/ }));
    expect(screen.getByText('Windsurf')).toBeInTheDocument();
  });

  it('reflects added IDE selections in the started config', () => {
    const { onStart } = renderConfigure();
    fireEvent.click(screen.getByRole('checkbox', { name: /Cursor/ }));
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].ides).toEqual(['claude-code', 'cursor']);
  });

  it('blocks Start if every IDE is deselected (--tools must be non-empty)', () => {
    renderConfigure();
    fireEvent.click(screen.getByRole('checkbox', { name: /^Claude Code/ })); // deselect the default
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('blocks Start if every module is deselected (--modules must be non-empty)', () => {
    renderConfigure();
    fireEvent.click(screen.getByRole('checkbox', { name: /BMad Method/ })); // deselect bmm
    fireEvent.click(screen.getByRole('checkbox', { name: /Creative Studio/ })); // deselect cis
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('shows the project folder + name as first-class controls with a composed-path preview', () => {
    renderConfigure();
    // Folder and name are editable, always-visible fields pre-filled with the friendly defaults…
    expect(screen.getByLabelText('Where your projects go')).toHaveValue('~/My Projects');
    expect(screen.getByLabelText('Project name')).toHaveValue('My Project');
    // …and the install path is the live composition of the two.
    expect(screen.getByText('📁 ~/My Projects/My Project')).toBeInTheDocument();
  });

  it('keeps a selected non-recommended IDE visible after collapsing "Show all"', () => {
    renderConfigure();
    fireEvent.click(screen.getByRole('button', { name: /Show all 3 tools/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Windsurf/ })); // select non-recommended
    fireEvent.click(screen.getByRole('button', { name: /Show fewer/ }));
    // Windsurf is non-recommended but selected → must remain visible (no hidden-active state).
    expect(screen.getByText('Windsurf')).toBeInTheDocument();
  });

  it('surfaces a transport-level start error as an alert', () => {
    renderConfigure({ startError: 'could not start' });
    expect(screen.getByRole('alert')).toHaveTextContent('could not start');
  });

  it('renders the degraded message when the catalog could not be read (FR-15)', () => {
    renderConfigure({
      catalog: { degraded: true, ides: catalog.ides, message: 'could not read IDE list' },
    });
    expect(screen.getByText('could not read IDE list')).toBeInTheDocument();
  });

  it('AC-1/3: default-on agent-CLI opt-in submits installCli: [claude-code] on an untouched Start', () => {
    const { onStart } = renderConfigure();
    // The opt-in is present and checked by default for the selected claude-code tool.
    const optIn = screen.getByRole('checkbox', { name: /Also install the Claude Code CLI/ });
    expect(optIn).toBeChecked();
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].installCli).toEqual(['claude-code']);
  });

  it('AC-2: unchecking the opt-in removes that id from the submitted installCli', () => {
    const { onStart } = renderConfigure();
    fireEvent.click(screen.getByRole('checkbox', { name: /Also install the Claude Code CLI/ }));
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].installCli).toEqual([]); // opted out → engine step is a no-op
  });

  it('AC-1: a selected non-eligible tool (cursor) shows NO opt-in (scope guard)', () => {
    renderConfigure();
    fireEvent.click(screen.getByRole('checkbox', { name: /Cursor/ })); // select cursor (ineligible)
    expect(screen.queryByRole('checkbox', { name: /Also install the Cursor CLI/ })).toBeNull();
  });

  it('AC-3: de-selecting the claude-code tool removes both its selection and its installCli entry', () => {
    const { onStart } = renderConfigure();
    // Add cursor so Start stays reachable after dropping claude-code (≥1 tool required).
    fireEvent.click(screen.getByRole('checkbox', { name: /Cursor/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^Claude Code/ })); // deselect the eligible tool
    // Its opt-in row is gone…
    expect(screen.queryByRole('checkbox', { name: /Also install the Claude Code CLI/ })).toBeNull();
    screen.getByRole('button', { name: 'Start' }).click();
    const cfg = onStart.mock.calls[0][0];
    expect(cfg.ides).toEqual(['cursor']);
    expect(cfg.installCli).toEqual([]); // installCli ⊆ selected ∩ eligible
  });

  it('AC-1: opt-in for a newly-selected eligible tool (codex) is default-on', () => {
    const onStart = vi.fn();
    const withCodex: IdeCatalog = {
      degraded: false,
      ides: [
        { id: 'claude-code', name: 'Claude Code', recommended: true },
        { id: 'codex', name: 'Codex', recommended: true },
      ],
    };
    render(<Configure catalog={withCodex} pins={pins} onStart={onStart} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Codex/ })); // select codex tool
    const optIn = screen.getByRole('checkbox', { name: /Also install the Codex CLI/ });
    expect(optIn).toBeChecked(); // default-on for the freshly-selected eligible tool
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].installCli).toEqual(['claude-code', 'codex']);
  });

  it('shows folder + name as always-visible first-class fields; no Customize when the gate is off', () => {
    renderConfigure();
    // Folder + name are first-class now — visible up front, no disclosure needed.
    expect(screen.getByLabelText('Project name')).toBeInTheDocument();
    expect(screen.getByLabelText('Where your projects go')).toBeInTheDocument();
    // The Customize disclosure only renders under the Epic-7 gate (off by default) — so it's absent.
    expect(screen.queryByRole('button', { name: /Customize/ })).toBeNull();
  });
});

// ── Story 7.2: existing-project detection + "Update to latest BMad" opt-in ───────────────────
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const detectedResult: InspectResult = { isKindlingProject: true, installedBmadVersion: '6.9.0' };

function openCustomize(): void {
  fireEvent.click(screen.getByRole('button', { name: /Customize/ }));
}

describe('<Configure> — 7.2 update-to-latest affordance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('AC-3/AC-7: gate OFF (default) — the probe never fires, no detection UI, untouched Start omits bmadTarget', async () => {
    const onStart = vi.fn();
    const inspect = vi.fn(async () => detectedResult);
    // enableBmadUpdate omitted ⇒ defaults to the build-time constant (false for the cohort window).
    render(<Configure catalog={catalog} pins={pins} onStart={onStart} inspect={inspect} debounceMs={0} />);
    // Gate off ⇒ there is no Customize disclosure at all (it's gated behind enableBmadUpdate), so
    // there is nothing to open and the probe can never be reached.
    expect(screen.queryByRole('button', { name: /Customize/ })).toBeNull();
    // Give any (wrongly-scheduled) debounce a chance — it must NOT fire when the gate is off.
    await new Promise((r) => setTimeout(r, 10));
    expect(inspect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('bmad-update')).toBeNull();
    screen.getByRole('button', { name: 'Start' }).click();
    const cfg = onStart.mock.calls[0][0];
    expect(cfg.bmadTarget).toBeUndefined();
    expect(cfg.installCli).toEqual(['claude-code']); // 6.2 opt-in + hidden-IDE fix intact
  });

  it('AC-1/2/4: gate ON — an existing-project probe renders the detected line + default-OFF opt-in + loud warning; toggling ON submits bmadTarget: latest', async () => {
    const onStart = vi.fn();
    const inspect = vi.fn(async () => detectedResult);
    render(
      <Configure catalog={catalog} pins={pins} onStart={onStart} inspect={inspect} enableBmadUpdate debounceMs={0} />,
    );
    openCustomize();
    await waitFor(() => expect(inspect).toHaveBeenCalled());
    expect(await screen.findByText(/Detected: BMad 6\.9\.0 installed in this folder/)).toBeInTheDocument();
    const optIn = screen.getByRole('checkbox', { name: /Update this existing project to the latest BMad/ });
    expect(optIn).not.toBeChecked(); // default OFF, never pre-checked
    expect(screen.getByRole('alert')).toHaveTextContent(/moves you off the frozen workshop version/);
    // Not enabled yet ⇒ Start omits bmadTarget.
    fireEvent.click(optIn); // opt in
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].bmadTarget).toBe('latest');
  });

  it('AC-4: gate ON — a non-existing result shows the neutral line + NO opt-in; Start omits bmadTarget', async () => {
    const onStart = vi.fn();
    const inspect = vi.fn(async (): Promise<InspectResult> => ({ isKindlingProject: false, installedBmadVersion: null }));
    render(
      <Configure catalog={catalog} pins={pins} onStart={onStart} inspect={inspect} enableBmadUpdate debounceMs={0} />,
    );
    openCustomize();
    expect(await screen.findByText(/No existing Kindling project here/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Update this existing project/ })).toBeNull();
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].bmadTarget).toBeUndefined();
  });

  it('AC-4: gate ON — an inspect rejection degrades to the neutral/error state without crashing; Start still omits bmadTarget', async () => {
    const onStart = vi.fn();
    const inspect = vi.fn(async (): Promise<InspectResult> => Promise.reject(new Error('boom')));
    render(
      <Configure catalog={catalog} pins={pins} onStart={onStart} inspect={inspect} enableBmadUpdate debounceMs={0} />,
    );
    openCustomize();
    expect(await screen.findByText(/Couldn't check this folder/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Update this existing project/ })).toBeNull();
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].bmadTarget).toBeUndefined();
  });

  it('AC-4: gate ON — a present-but-unreadable manifest ({true, null}) shows "version unknown" and still offers the opt-in', async () => {
    const inspect = vi.fn(async (): Promise<InspectResult> => ({ isKindlingProject: true, installedBmadVersion: null }));
    render(<Configure catalog={catalog} pins={pins} onStart={vi.fn()} inspect={inspect} enableBmadUpdate debounceMs={0} />);
    openCustomize();
    expect(await screen.findByText(/existing project here \(version unknown\)/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Update this existing project/ })).toBeInTheDocument();
  });

  it('HIGH regression: opt-in does NOT leak onto a freshly-edited dir (edit-dir-then-Start omits bmadTarget)', async () => {
    const onStart = vi.fn();
    const inspect = vi.fn(async () => detectedResult);
    render(
      <Configure catalog={catalog} pins={pins} onStart={onStart} inspect={inspect} enableBmadUpdate debounceMs={0} />,
    );
    openCustomize();
    // Detected on the initial dir → opt in.
    const optIn = await screen.findByRole('checkbox', {
      name: /Update this existing project to the latest BMad/,
    });
    fireEvent.click(optIn);
    expect(optIn).toBeChecked();
    // Now EDIT the dir and immediately Start (mirror the real mid-debounce edit-then-Start race).
    // The dir-change effect must have synchronously dropped `detected` + `updateToLatest`, so the
    // opt-in cannot carry over to a dir that was never freshly detected.
    fireEvent.change(within(document.body).getByLabelText('Where your projects go'), {
      target: { value: '/some-other-dir' },
    });
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].bmadTarget).toBeUndefined();
  });

  it('HIGH regression: the opt-in never re-arms pre-checked — a newly-detected dir B starts unchecked', async () => {
    const onStart = vi.fn();
    // dir A + dir B are existing projects; a middle non-project dir has no `_bmad`.
    // The probe fires on the COMPOSED dir (<folder>/<name>), so key off the folder prefix.
    const inspect = vi.fn(async (dir: string): Promise<InspectResult> =>
      dir.startsWith('/no-project')
        ? { isKindlingProject: false, installedBmadVersion: null }
        : { isKindlingProject: true, installedBmadVersion: '6.9.0' },
    );
    render(
      <Configure catalog={catalog} pins={pins} onStart={onStart} inspect={inspect} enableBmadUpdate debounceMs={0} />,
    );
    openCustomize();
    const dirField = within(document.body).getByLabelText('Where your projects go');
    // Dir A detected → check the opt-in.
    const optInA = await screen.findByRole('checkbox', { name: /Update this existing project/ });
    fireEvent.click(optInA);
    expect(optInA).toBeChecked();
    // → non-project dir: the checkbox disappears.
    fireEvent.change(dirField, { target: { value: '/no-project' } });
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Update this existing project/ })).toBeNull(),
    );
    // → another detected project B: the checkbox is back but UNCHECKED (never pre-checked).
    fireEvent.change(dirField, { target: { value: '/project-b' } });
    const optInB = await screen.findByRole('checkbox', { name: /Update this existing project/ });
    expect(optInB).not.toBeChecked();
    // Start with no further action ⇒ no bmadTarget.
    screen.getByRole('button', { name: 'Start' }).click();
    expect(onStart.mock.calls[0][0].bmadTarget).toBeUndefined();
  });

  it('AC-4: gate ON — a stale superseded-dir response is ignored (latest-request-wins)', async () => {
    const onStart = vi.fn();
    const pending: Array<ReturnType<typeof deferred<InspectResult>>> = [];
    const inspect = vi.fn((_dir: string) => {
      const d = deferred<InspectResult>();
      pending.push(d);
      return d.promise;
    });
    render(
      <Configure catalog={catalog} pins={pins} onStart={onStart} inspect={inspect} enableBmadUpdate debounceMs={0} />,
    );
    openCustomize();
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(1)); // probe #1 (default dir)
    fireEvent.change(within(document.body).getByLabelText('Where your projects go'), {
      target: { value: '/superseding-dir' },
    });
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2)); // probe #2 (new dir)
    // Resolve the LATEST first (wins), then the stale first probe (must be ignored).
    pending[1].resolve({ isKindlingProject: true, installedBmadVersion: '6.9.0' });
    expect(await screen.findByText(/Detected: BMad 6\.9\.0 installed in this folder/)).toBeInTheDocument();
    pending[0].resolve({ isKindlingProject: true, installedBmadVersion: '1.0.0-STALE' });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/1\.0\.0-STALE/)).toBeNull(); // stale resolution dropped
    expect(screen.getByText(/Detected: BMad 6\.9\.0 installed in this folder/)).toBeInTheDocument();
  });
});
