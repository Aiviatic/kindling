# Contributing to Kindling

Thanks for your interest! Kindling gets a non-technical user from a blank
computer to a working, BMad-scaffolded AI-development project in about five
minutes, with no terminal knowledge. Contributions that make that faster, safer,
or work on more machines are very welcome — especially **Windows** fixes, which
is our highest-risk path.

## Getting set up

```bash
git clone https://github.com/Aiviatic/kindling.git
cd kindling
nvm use            # Node version from .nvmrc (dev/build); runtime floor is Node 20+
npm install
```

Common commands:

| Command | What it does |
|---|---|
| `npm run dev` | Watch-build the Node side + run the Vite dev server for the UI |
| `npm test` | Run the unit suite (Vitest, co-located `*.test.ts(x)`) |
| `npm run typecheck` | `tsc` for both the browser and Node tsconfigs |
| `npm run lint` | ESLint (flat config) |
| `npm run build` | Bundle the Node payload (tsup) + the browser UI (Vite) |

Please make sure `typecheck`, `lint`, `test`, and `build` all pass before opening
a PR — CI runs them on macOS, Windows, and Ubuntu across Node 20 and 24.

## Layout

- `engine/` — the headless install/provision logic (no I/O without an injected seam).
- `server/` — the ephemeral localhost server + the static Welcome page renderer.
- `ui/` — the React browser UI served during install (Configure → Progress → Welcome).
- `cli/`, `bin/` — the `npx @aiviatic/kindling` entry point.
- `bootstrap/` — the per-OS entry scripts (`setup.sh`, `setup.ps1`, `kindling.cmd`).
- `scripts/` — dev/codegen helpers.

## A couple of ground rules

- **Version pins are single-source-of-truth.** The pinned Node/BMad/Kindling
  versions live in `engine/pins.ts` and are asserted against the bootstrap
  scripts by `bootstrap/bootstrap.test.ts`. Change them in lock-step.
- **Keep the engine testable.** Side effects (exec, fs, network) go through
  injectable seams so they can be faked in tests; `exec` runs with `shell: false`.
- **Match the surrounding code** — comment density, naming, and idiom.
- **User-facing copy**: plain language, no emdashes, "computer" (not "laptop").

## Security

If you find a vulnerability, please **do not** open a public issue — see
[`SECURITY.md`](SECURITY.md).

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
