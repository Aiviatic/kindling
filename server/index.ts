// Ephemeral localhost server barrel (node:http + SSE). Started by the bootstrap/CLI;
// lifecycle (ephemeral-on-success / Welcome-survives-exit) wired in Story 3.7.
export { startServer } from './server';
export type { StartServerOptions, RunningServer, ServerCommands } from './server';
export { openBrowser } from './open-browser';
export type { OpenBrowserOptions } from './open-browser';
