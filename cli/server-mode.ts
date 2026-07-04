import { fileURLToPath } from 'node:url';
import type { Config, EngineCommands, StepId } from '../engine/contract';
import { pins } from '../engine/pins';
import type { EngineEmitter } from '../engine/emitter';
import { Engine } from '../engine/engine';
import { defaultBmadInstalled } from '../engine/orchestrate/bmad-install';
import { readInstalledBmadVersion as defaultReadInstalledBmadVersion } from '../engine/bmad-manifest';
import { startServer as defaultStartServer, type RunningServer, type ServerCommands } from '../server/server';
import { openBrowser as defaultOpenBrowser } from '../server/open-browser';
import { writeWelcomeHtml as defaultWriteWelcome } from '../server/welcome';
import {
  projectFolderOf,
  readLastProjectFolder as defaultReadLastProjectFolder,
  saveLastProjectFolder as defaultSaveLastProjectFolder,
} from '../server/prefs';
import { expandTilde } from '../engine/expand-tilde';

// Injectable seams so the lifecycle is unit-testable without a real install / browser / exit.
export interface ServerModeDeps {
  startServer?: typeof defaultStartServer;
  openBrowser?: typeof defaultOpenBrowser;
  writeWelcome?: typeof defaultWriteWelcome;
  /** Builds the engine that a /start drives — injected so tests use a fake. */
  engineFactory?: (config: Config, emitter: EngineEmitter) => EngineCommands<unknown>;
  /** Process exit, after the ephemeral server has written welcome.html + closed. */
  exit?: (code: number) => void;
  write?: (line: string) => void;
  platform?: NodeJS.Platform;
  /** Built UI directory to serve (dist/ui); resolved by the bootstrap. */
  uiDir?: string;
  /**
   * Read-only `_bmad`-dir check for the Configure-time inspect probe (Story 7.2). Default is the
   * engine's `defaultBmadInstalled`; injected as a fake in tests (no real fs).
   */
  bmadAlreadyInstalled?: (dir: string) => Promise<boolean>;
  /**
   * Read the ACTUAL installed BMad version from the manifest (7.1). Default is the engine helper;
   * injected as a fake in tests (no real fs).
   */
  readInstalledBmadVersion?: (dir: string) => Promise<string | null>;
  /** Prefs seams (last-used projects folder, `~/.kindling/prefs.json`); fakes in tests (no real fs). */
  readLastProjectFolder?: () => Promise<string | null>;
  saveLastProjectFolder?: (folder: string) => Promise<void>;
}

/**
 * Server mode (FR-12 lifecycle). Stands up the localhost server, lazily builds the engine when
 * the browser POSTs /start (the config arrives from the Configure screen), and on the Welcome
 * render-ack writes the self-contained welcome.html (so a refresh works after exit), closes the
 * server, and exits — ONLY on success. On failure nothing acks, so the server stays alive for
 * Retry. The live browser→install→exit run is validated at the dress rehearsal.
 */
export async function runServerMode(
  emitter: EngineEmitter,
  deps: ServerModeDeps = {},
): Promise<RunningServer> {
  const startServer = deps.startServer ?? defaultStartServer;
  const openBrowser = deps.openBrowser ?? defaultOpenBrowser;
  const writeWelcome = deps.writeWelcome ?? defaultWriteWelcome;
  const engineFactory =
    deps.engineFactory ?? ((config, em) => new Engine(config, em));
  const exit = deps.exit ?? ((code) => process.exit(code));
  const write = deps.write ?? ((line) => process.stdout.write(line + '\n'));
  // The built layout is dist/cli/server-mode.js alongside dist/ui — serve that by default.
  const uiDir = deps.uiDir ?? fileURLToPath(new URL('../ui', import.meta.url));
  const bmadAlreadyInstalled = deps.bmadAlreadyInstalled ?? defaultBmadInstalled;
  const readInstalledBmadVersion = deps.readInstalledBmadVersion ?? defaultReadInstalledBmadVersion;
  const readLastFolder = deps.readLastProjectFolder ?? (() => defaultReadLastProjectFolder());
  const saveLastFolder = deps.saveLastProjectFolder ?? ((f: string) => defaultSaveLastProjectFolder(f));

  let lastConfig: Config | null = null;
  let engine: EngineCommands<unknown> | null = null;

  const commands: ServerCommands = {
    start: (config) => {
      // Remember the UNexpanded projects folder for the next run's Configure prefill (a
      // `~/My Projects` prefill should round-trip as typed). Best-effort, never blocks the run.
      const folder = projectFolderOf(config.projectDir, config.projectName);
      if (folder) void saveLastFolder(folder).catch(() => {});
      // Expand a leading `~` ONCE, at intake, so every consumer — the Engine AND the Welcome
      // writer in finish() — sees a real path (the UI default is the literal `~/kindling-project`).
      const c: Config = { ...config, projectDir: expandTilde(config.projectDir) };
      lastConfig = c;
      engine = engineFactory(c, emitter);
      return engine.start(c);
    },
    cancel: () => engine?.cancel(),
    retry: (step: StepId) => engine?.retry(step),
    // Pure read-only fs probe (Story 7.2) — wraps neither the engine nor any run state. Both reads
    // degrade to false/null, so /inspect can't crash on a bad path.
    inspect: async (projectDir) => ({
      isKindlingProject: await bmadAlreadyInstalled(projectDir),
      installedBmadVersion: await readInstalledBmadVersion(projectDir),
    }),
  };

  let acked = false; // one-shot: the host shutdown must run at most once
  const server = await startServer({
    emitter,
    commands,
    uiDir,
    getLastProjectFolder: readLastFolder,
    onWelcomeAck: () => {
      if (acked) return;
      acked = true;
      void finish().catch(() => exit(0));
    },
  });

  // On success: persist the self-contained Welcome page (survives exit), then close + exit.
  const finish = async (): Promise<void> => {
    const done = emitter.events().find((e) => typeof e.summaryJson === 'string');
    if (lastConfig && done?.summaryJson) {
      // Best-effort: persisting welcome.html is a nicety, not required for a successful install —
      // a write failure must not crash the process or leave the server hanging.
      try {
        await writeWelcome(lastConfig.projectDir, {
          bmadVersion: pins.bmad,
          summaryJson: done.summaryJson,
        });
      } catch {
        // ignore — proceed to a clean shutdown regardless
      }
    }
    await server.close();
    exit(0);
  };

  openBrowser(server.url, { platform: deps.platform });
  write(`Kindling is running - open ${server.url} if it didn't open automatically.`);
  return server;
}
