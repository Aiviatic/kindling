// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Phase, Status, StepId, ErrorCode, type KindlingEvent } from '../engine/contract';
import { pins } from '../engine/pins';
import type { EventSourceLike } from './lib/events';
import type { IdeCatalog } from './config/ide-catalog';
import { InstallerProvider } from './state/context';
import { Intro } from './screens/Intro';
import { Configure } from './screens/Configure';
import { Progress } from './screens/Progress';
import { ErrorScreen } from './screens/ErrorScreen';
import { Welcome } from './screens/Welcome';

// jsdom has no layout engine, so axe can't compute color contrast — that AA check is verified
// in-browser at the rehearsal. These runs catch the structural a11y: names, roles, labels,
// landmarks, list semantics, aria wiring.
const axeOpts = { rules: { 'color-contrast': { enabled: false } } };

class FakeEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  close = vi.fn();
  emit(data: string) {
    this.onmessage?.({ data });
  }
}

const catalog: IdeCatalog = {
  degraded: false,
  ides: [
    { id: 'claude-code', name: 'Claude Code', recommended: true },
    { id: 'windsurf', name: 'Windsurf', recommended: false },
  ],
};

function evt(over: Partial<KindlingEvent> & Pick<KindlingEvent, 'step' | 'status'>): KindlingEvent {
  return {
    id: `e-${over.step}-${over.status}`,
    phase: Phase.Install,
    humanMessage: 'A clear, human message about this step.',
    level: over.status === Status.Failed ? 'error' : 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
    ...over,
  };
}

async function expectNoViolations(container: HTMLElement) {
  const results = await axe(container, axeOpts);
  // Assert directly on the violations array (clear failure output, no custom matcher needed);
  // include the offending node HTML so a CI failure is debuggable without a re-run.
  const found = results.violations.map(
    (v) => `${v.id} — ${v.help} [${v.nodes.map((n) => n.html).join('; ')}]`,
  );
  expect(found).toEqual([]);
}

describe('accessibility conformance (axe) — every screen', () => {
  it('Intro', async () => {
    const { container } = render(<Intro onContinue={vi.fn()} />);
    await expectNoViolations(container);
  });

  it('Configure (default)', async () => {
    const { container } = render(<Configure catalog={catalog} pins={pins} onStart={vi.fn()} />);
    await expectNoViolations(container);
  });

  it('Configure (degraded picker)', async () => {
    const { container } = render(
      <Configure
        catalog={{ degraded: true, ides: catalog.ides, message: 'fallback in use' }}
        pins={pins}
        onStart={vi.fn()}
      />,
    );
    await expectNoViolations(container);
  });

  it('Progress (running, mixed step states)', async () => {
    const source = new FakeEventSource();
    const { container } = render(
      <InstallerProvider EventSourceCtor={() => source}>
        <Progress />
      </InstallerProvider>,
    );
    // Cover every row tone in one scan: done, working, queued, and failed.
    act(() => source.emit(JSON.stringify(evt({ step: StepId.ProvisionNode, status: Status.Done }))));
    act(() => source.emit(JSON.stringify(evt({ step: StepId.ProvisionGit, status: Status.Failed }))));
    act(() => source.emit(JSON.stringify(evt({ step: StepId.ScaffoldGitInit, status: Status.Queued }))));
    act(() => source.emit(JSON.stringify(evt({ step: StepId.InstallMethod, status: Status.Working, pct: 40 }))));
    await expectNoViolations(container);
  });

  it('ErrorScreen (with fix command)', async () => {
    const source = new FakeEventSource();
    const { container } = render(
      <InstallerProvider EventSourceCtor={() => source}>
        <ErrorScreen onRetry={vi.fn()} onChooseFolder={vi.fn()} />
      </InstallerProvider>,
    );
    act(() =>
      source.emit(
        JSON.stringify(evt({ step: StepId.ProvisionNode, status: Status.Failed, errorCode: ErrorCode.ExecPolicyBlocked })),
      ),
    );
    await expectNoViolations(container);
  });

  it('Welcome (success, copy + workshop strip)', async () => {
    const source = new FakeEventSource();
    const { container } = render(
      <InstallerProvider EventSourceCtor={() => source}>
        <Welcome pins={pins} />
      </InstallerProvider>,
    );
    act(() =>
      source.emit(
        JSON.stringify(
          evt({ step: StepId.FinalizeSelfCheck, status: Status.Done, summaryJson: '{"schemaVersion":3,"success":true,"cli":[]}' }),
        ),
      ),
    );
    await expectNoViolations(container);
  });

  it('Welcome (success, with CLI login guidance + absent-CLI notice) — Story 6.2 new DOM', async () => {
    const source = new FakeEventSource();
    const { container } = render(
      <InstallerProvider EventSourceCtor={() => source}>
        <Welcome pins={pins} />
      </InstallerProvider>,
    );
    // A present CLI (login line) AND an absent one (install notice) — the two new role="status"
    // blocks this story adds, which the empty-cli case above never renders for the axe scan.
    const cli = JSON.stringify([
      { id: 'claude-code', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code', present: true },
      { id: 'codex', name: 'Codex', bin: 'codex', pkg: '@openai/codex', present: false },
    ]);
    act(() =>
      source.emit(
        JSON.stringify(
          evt({
            step: StepId.FinalizeSelfCheck,
            status: Status.Done,
            summaryJson: `{"schemaVersion":3,"success":true,"cli":${cli}}`,
          }),
        ),
      ),
    );
    await expectNoViolations(container);
  });
});
