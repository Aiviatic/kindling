import { defineConfig } from 'tsup';

// Bundles the Node side (engine + server + cli) into dist/ for the npm/npx payload.
// Entries are placeholders this story; real modules land in Story 1.2 (engine), 1.3 (cli),
// and Epic 3 (server).
export default defineConfig({
  entry: ['engine/index.ts', 'engine/web.ts', 'server/index.ts', 'cli/main.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  sourcemap: true,
  // Emit .d.ts so the (separate, private) website repo can import the shared constants
  // (`pins`, `recoveryGuidance`, `ErrorCode`) from the published @aiviatic/kindling with types.
  // Use the Node tsconfig (types:["node"]); the default tsconfig.json is the browser one.
  dts: true,
  tsconfig: 'tsconfig.node.json',
  clean: true,
});
