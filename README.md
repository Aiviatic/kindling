# Kindling

**Blank computer to building in about five minutes — no terminal knowledge required.**

Kindling is a cross-platform installer that gets a non-technical person from a
fresh computer (Mac, Windows, or Linux) to a working, [BMad](https://github.com/bmad-code-org/BMAD-METHOD)-scaffolded
project set up for AI-driven app development. You run one step, make a few choices
in your browser, and Kindling installs and wires everything up for you.

It's open source on purpose: the very first thing Kindling does is run a script on
your machine, so you should be able to read exactly what that script does. See
[SECURITY.md](SECURITY.md) for the security model.

## How it works

Three layers, so the scary parts happen where they can be explained:

1. **A per-OS bootstrap script** (`bootstrap/`) handles the steps that need Node
   present: it provisions a pinned Node.js (via `nvm` on macOS/Linux; on Windows it
   reuses an existing Node 20+, and portable-Node provisioning is being validated),
   then launches Kindling in the same shell.
   - macOS/Linux: `curl -fsSL https://kindling.aiviatic.com/go | bash`
   - Windows: download `kindling.cmd` and double-click it (it fetches and runs
     `setup.ps1` over HTTPS).
2. **A temporary localhost server** (`server/`) stands up on `127.0.0.1`, serves a
   friendly browser UI, provisions Git, scaffolds the project, runs
   `npx bmad-method install`, and installs any agent CLIs you opt into. It exits
   when the install completes.
3. **A browser UI** (`ui/`) walks you through the few choices (project name,
   tools) and shows honest progress — including the ~5-minute macOS developer-tools
   dialog, so it never looks frozen.

The installer is published to npm as **`@aiviatic/kindling`**; the bootstrap's
final step is `npx @aiviatic/kindling@<pinned-version>`.

> This repo is the **installer** (what runs on your machine). The marketing/landing
> site and its serverless bits are maintained separately.

## Try it

If you already have Node 20+, you can run the installer directly:

```bash
npx @aiviatic/kindling
```

Otherwise, get the one-step command for your OS at
**<https://kindling.aiviatic.com/install>**.

## Development

```bash
git clone https://github.com/Aiviatic/kindling.git
cd kindling
nvm use && npm install
npm test        # unit suite (Vitest)
npm run build   # tsup (Node payload) + Vite (browser UI)
```

- **TypeScript + ESM** throughout; dev/build on the Node in `.nvmrc`, runtime floor **Node 20+**.
- **React + Vite** for the browser UI; **tsup** bundles the Node side (`engine/`, `server/`, `cli/`).
- **Vitest** for tests (co-located `*.test.ts(x)`); CI runs typecheck + lint + test + build on
  macOS/Windows/Ubuntu × Node 20/24.

Layout: `engine/` (headless install logic) · `server/` (localhost server + Welcome
page) · `ui/` (React install UI) · `cli/` + `bin/` (the `npx` entry) · `bootstrap/`
(per-OS entry scripts) · `scripts/` (dev helpers).

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started — Windows fixes especially welcome.

## License

[MIT](LICENSE) © Aiviatic
