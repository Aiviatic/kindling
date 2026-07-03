#!/usr/bin/env node
// npx entry — dispatches to the built CLI (server | --json | --verbose).
// Resolves the built output relative to this file (robust under global/symlinked installs).
const target = new URL('../dist/cli/main.js', import.meta.url);
import(target.href)
  .then((cli) => cli.run(process.argv.slice(2)))
  .catch((err) => {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('Kindling must be built first: run `npm run build`.');
    } else {
      console.error('Kindling failed to start:', err);
    }
    process.exit(1);
  });
