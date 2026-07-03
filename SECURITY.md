# Security Policy

Kindling sets up a development environment on a fresh computer. Because that
means running code and installing software on your machine, we take its security
seriously and we keep the whole thing open so you can verify exactly what runs.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to **security@aiviatic.com**.
Do not open a public issue for a security problem.

We aim to acknowledge a report within 3 business days and to keep you updated as
we work on a fix. Please give us a reasonable window to release a fix before any
public disclosure.

## What Kindling actually does on your machine

Being able to read this is the point of open-sourcing the installer. On a fresh
machine, Kindling:

1. **Provisions a Node.js runtime** — via `nvm` on macOS/Linux, or a portable
   Node download on Windows (pinned versions live in `engine/pins.ts`).
2. **Provisions Git** — reusing a system Git if present, otherwise installing it.
3. **Scaffolds a project** and installs the **BMad Method** into it
   (`npx bmad-method install`), plus any agent CLIs you opt into (e.g. Claude
   Code / Codex, installed with `npm install -g`).
4. **Runs a temporary local web server** on `127.0.0.1` (an ephemeral port) that
   serves the setup UI to your browser and exits when the install completes.

The bootstrap entry points are plain, readable scripts in [`bootstrap/`](bootstrap/):

- macOS/Linux: `curl -fsSL https://kindling.aiviatic.com/go | bash` runs
  [`bootstrap/setup.sh`](bootstrap/setup.sh).
- Windows: a one-file `kindling.cmd` that fetches and runs
  [`bootstrap/setup.ps1`](bootstrap/setup.ps1) over HTTPS
  (`irm … | iex`, the PowerShell equivalent of `curl … | bash`).

## Security properties

- **Transparency.** Everything the bootstrap runs is in this repo. Read it before
  you run it.
- **HTTPS only.** The bootstrap scripts and the package are fetched over TLS.
- **Windows execution policy** is set with `-ExecutionPolicy Bypass` **scoped to
  the single PowerShell process** — it changes no system-wide setting and is
  fully reversible.
- **The local server binds `127.0.0.1`** on an ephemeral port, requires a custom
  header on mutating requests (a CSRF guard), and serves only its own built UI
  from a path-traversal-guarded directory.
- **No secrets in the repo or the published package.** The lead-capture endpoint's
  webhook is a deploy-time secret, never committed.

## Known hardening roadmap

We are transparent about what is not yet hardened:

- **Download integrity.** The provisioning steps download `nvm`, and portable
  Node/Git, without SHA-256 / signature verification yet. Pinning and verifying
  those checksums is the top hardening item.

If you spot something else, please tell us at **security@aiviatic.com**.
