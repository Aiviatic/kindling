import { parseArgs } from 'node:util';
import { EngineEmitter } from '../engine/emitter';
import type { EventListener } from '../engine/emitter';
import { jsonSink } from './json-sink';
import { verboseSink } from './verbose-sink';
import { runServerMode } from './server-mode';

export type Mode = 'server' | 'json' | 'verbose';

/** Pick the run mode from argv. No flag → server (the default product frontend). */
export function selectMode(argv: string[]): Mode {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: 'boolean' }, verbose: { type: 'boolean' } },
    strict: false,
  });
  if (values.json && values.verbose) {
    process.stderr.write('Both --json and --verbose given; using --json.\n');
  }
  if (values.json) return 'json';
  if (values.verbose) return 'verbose';
  return 'server';
}

/** Build the stdout sink for a mode. Server mode renders via the browser UI (Epic 3), not stdout. */
export function makeSink(mode: Mode, write: (line: string) => void): EventListener {
  if (mode === 'json') return jsonSink(write);
  if (mode === 'verbose') return verboseSink(write);
  return () => {};
}

/**
 * Wire an EngineEmitter to the chosen sink and return both. The real engine orchestration
 * (Stories 1.4–1.7) drives the returned emitter; this harness just renders its events.
 */
export interface RunDeps {
  /** Server-mode starter — injectable so tests don't bind a port / open a browser. */
  startServerMode?: (emitter: EngineEmitter) => void;
}

export function run(
  argv: string[],
  write: (line: string) => void = (line) => process.stdout.write(line + '\n'),
  deps: RunDeps = {},
): { mode: Mode; emitter: EngineEmitter } {
  const mode = selectMode(argv);
  const emitter = new EngineEmitter();
  emitter.on(makeSink(mode, write));
  if (mode === 'server') {
    // Default: stand up the localhost server + browser UI (FR-12 lifecycle). Fire-and-forget —
    // the server keeps the process alive; a startup failure is surfaced, not thrown.
    const start =
      deps.startServerMode ??
      ((em: EngineEmitter) => {
        void runServerMode(em, { write }).catch((err) =>
          write(`Kindling failed to start the server: ${String(err)}`),
        );
      });
    start(emitter);
  }
  return { mode, emitter };
}
