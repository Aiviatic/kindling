// DEV-ONLY screenshot harness. Renders one installer screen inside the real app shell, chosen by
// `?screen=intro|configure|progress|welcome`, with seeded state so the later screens can be
// captured without running a real install. NOT shipped: `vite build` only has `index.html` as an
// entry, so this never lands in dist/ui. To regenerate the README screenshots, run `npm run dev`
// and open http://localhost:5173/dev/gallery.html?screen=<name>, then screenshot the app window.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../tokens.css';
import { pins } from '../../engine/pins';
import { Phase, StepId, Status, type KindlingEvent } from '../../engine/contract';
import type { EventSourceLike } from '../lib/events';
import type { IdeCatalog } from '../config/ide-catalog';
import { InstallerProvider } from '../state/context';
import { Intro } from '../screens/Intro';
import { Configure } from '../screens/Configure';
import { Progress } from '../screens/Progress';
import { Welcome } from '../screens/Welcome';
import { Footer } from '../components/Footer';

// A canned SSE stream: replays a fixed list of frames once the provider attaches `onmessage`.
class ScriptedEventSource implements EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(private frames: string[]) {
    setTimeout(() => this.frames.forEach((data) => this.onmessage?.({ data })), 0);
  }
  close(): void {}
}

const catalog: IdeCatalog = {
  degraded: false,
  ides: [
    { id: 'claude-code', name: 'Claude Code', recommended: true },
    { id: 'codex', name: 'Codex', recommended: true },
    { id: 'cursor', name: 'Cursor', recommended: false },
    { id: 'github-copilot', name: 'GitHub Copilot', recommended: false },
  ],
};

function ev(over: Partial<KindlingEvent> & Pick<KindlingEvent, 'step' | 'status' | 'humanMessage'>): string {
  return JSON.stringify({
    id: `${over.step}-${over.status}`,
    phase: Phase.Install,
    level: over.status === Status.Failed ? 'error' : 'info',
    timestamp: '2026-07-04T00:00:00.000Z',
    ...over,
  } satisfies KindlingEvent);
}

const progressFrames = [
  ev({ step: StepId.ProvisionNode, status: Status.Done, humanMessage: 'Node.js is ready.' }),
  ev({ step: StepId.ProvisionGit, status: Status.Done, humanMessage: 'Git is ready.' }),
  ev({ step: StepId.ScaffoldGitInit, status: Status.Done, humanMessage: 'Created your project and made the first commit.' }),
  ev({ step: StepId.InstallMethod, status: Status.Working, pct: 60, humanMessage: 'Installing BMad into your project…' }),
  ev({ step: StepId.InstallAgentCli, status: Status.Queued, humanMessage: 'Next: install the Claude Code CLI.' }),
  ev({ step: StepId.FinalizeSelfCheck, status: Status.Queued, humanMessage: 'Next: check everything over.' }),
];

const welcomeSummary = JSON.stringify({
  schemaVersion: 3,
  success: true,
  projectDir: '~/My Projects/My Project',
  os: 'darwin',
  node: { present: true, version: '24.16.0', satisfiesFloor: true },
  git: { present: true, version: '2.45.2' },
  bmad: { pinnedVersion: pins.bmad, installed: true, installedVersion: pins.bmad },
  cli: [
    { id: 'claude-code', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code', present: true },
  ],
});
const welcomeFrames = [
  ev({ step: StepId.FinalizeSelfCheck, status: Status.Done, humanMessage: 'All set.', summaryJson: welcomeSummary }),
];

const noop = (): void => {};

function screenFor(name: string) {
  switch (name) {
    case 'configure':
      return <Configure catalog={catalog} pins={pins} onStart={noop} onCancel={noop} />;
    case 'progress':
      return (
        <InstallerProvider EventSourceCtor={() => new ScriptedEventSource(progressFrames)}>
          <Progress />
        </InstallerProvider>
      );
    case 'welcome':
      return (
        <InstallerProvider EventSourceCtor={() => new ScriptedEventSource(welcomeFrames)}>
          <Welcome pins={pins} />
        </InstallerProvider>
      );
    case 'intro':
    default:
      return <Intro onContinue={noop} onCancel={noop} />;
  }
}

const screen = new URLSearchParams(location.search).get('screen') ?? 'intro';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-shell">
      <div className="app-window" role="application" aria-label="Kindling installer">
        <div className="app-titlebar">
          <div className="app-traffic" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="app-urlbar">kindling · local setup</div>
        </div>
        <main className="app-stage">{screenFor(screen)}</main>
        <Footer />
      </div>
    </div>
  </StrictMode>,
);
