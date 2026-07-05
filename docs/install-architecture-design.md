# Install architecture: framework providers + a system/project split

**Status:** proposal (phase 1 shipped) · **Target:** a future iteration · **Scope:** the installer engine + UI

Two related restructurings of what Kindling calls "the install":

1. **Framework providers** — make the framework (BMad) a pluggable choice: BMad by default, a
   "No framework" option, and room for vetted alternatives, without regressing the "sensible
   defaults, one-click Start" experience.
2. **A system/project split** — group the work by *what it touches*: machine-wide "system"
   installs (Node, Git, the AI-tool CLIs) vs "project" installs (the folder, the framework,
   the tools config). The two are conflated today, and one step (the global agent-CLI
   install) sits in the wrong bucket.

The two reinforce each other: the project section *is* the framework provider's domain, so a
"No framework" framework simply makes the project section thinner.

**Phase 1 is done** (see the phasing section): `StepId.InstallBmad` was renamed to
`install.framework`, and the BMad install was extracted behind a `FrameworkProvider` seam
(`engine/framework/`) with no behavior change. The rest of this document is the remaining design.

## Framework providers — goal

Turn "the BMad installer" into "the AI-dev setup tool that installs BMad by default."
Concretely:

1. BMad stays the recommended default; the workshop path is unchanged.
2. A user can pick **No framework** (scaffold the project + wire up tools, skip the framework).
3. Adding a specific alternative (e.g. Spec Kit) later is a bounded, testable task — not
   engine surgery.

Non-goal: a mandatory "choose your methodology" screen. That reintroduces exactly the
decision fatigue Kindling removes. The framework choice is a quiet, collapsed advanced
affordance; the default flow still lands on BMad and Starts in one click.

## Where BMad is coupled today

The engine runs a fixed step array (`engine/engine.ts`):

```
provision.node → provision.git → scaffold.git-init → install.framework → install.agent-cli → finalize.self-check
```

(`install.framework` was `install.bmad` before phase 1.) BMad specifically is wired into:

- **`install.framework` step** — `runBmadInstall()` (`engine/orchestrate/bmad-install.ts`) →
  `composeInstallArgs()` (`engine/orchestrate/flags.ts`) → `npx bmad-method@<pins.bmad>` with
  `--modules/--tools`.
- **`Config`** (`engine/contract.ts`) — `modules[]` (BMad modules), `bmadTarget: 'pinned'|'latest'`,
  `pins.bmad`.
- **Self-check + `ValidationSummary`** (`engine/self-check.ts`, `engine/validation-summary.ts`) —
  a hardcoded `bmad: { pinnedVersion, installed, installedVersion }` field, read from
  `_bmad/_config/manifest.yaml` via `engine/bmad-manifest.ts`.
- **Welcome** — `bmadVersionLabel()` drives the "BMad Method 6.9.0" versions-table row, and the
  `/bmad-help` "what to do next" line (`ui/screens/Welcome.tsx`, `server/welcome.ts`).
- **`/inspect` probe** — "existing project?" detection is `defaultBmadInstalled()`, a `_bmad`-dir
  check (`server/server.ts` → `cli/server-mode.ts`).
- **The tools catalog** — `ui/public/platform-codes.yaml` is *generated from*
  `bmad-method --list-tools` (`scripts/gen-platform-codes.mjs`). This is the load-bearing one:
  today the IDE picker cannot be built without BMad.
- **Vocabulary** — `StepId.InstallBmad`, `ErrorCode.BmadInstallFailed`, `stepMessages`/
  `installMessages` (`engine/contract.ts`, `engine/messages.ts`).

## The abstraction: `FrameworkProvider`

```ts
// engine/framework/provider.ts
export interface FrameworkContext {
  config: Config;
  emitter: EngineEmitter;
  exec: (cmd: string, args: string[]) => Promise<ExecResult>;
  runner: { command: string; prefixArgs: string[] }; // the npx/node shim, threaded like today
  now: () => string;
}

export interface FrameworkInstallResult { ok: boolean; version?: string }

// One option in the framework's "what to include" picker (BMad: bmm/cis/bmb).
export interface FrameworkOption { id: string; name: string; description: string; recommended: boolean }

export interface FrameworkProvider {
  id: string;                 // 'bmad' | 'none' | 'speckit' …
  label: string;              // "BMad Method"
  description: string;        // one line for the Configure picker
  recommended: boolean;       // BMad = true (stays the default)
  options: FrameworkOption[];    // BMad → bmm/cis/bmb; 'none' → []
  usesTools: boolean;         // does the IDE/tools picker apply to this framework?

  // Emits Working/Done/Failed on the generic install step. 'none' = no-op → ok:true.
  install(ctx: FrameworkContext): Promise<FrameworkInstallResult>;
  // Powers /inspect + update-in-place detection ('none' → { present:false }).
  detectExisting(projectDir: string): Promise<{ present: boolean; version: string | null }>;
  // Fills the Welcome versions-table row; return null to omit it (the 'none' case).
  summaryFacts(projectDir: string, r: FrameworkInstallResult):
    Promise<{ label: string; version: string | null; note: string } | null>;
  // The framework-specific "start building" guidance (BMad: mention /bmad-help).
  welcomeGuidance(ctx: FrameworkContext): { lines: string[] };
}
```

A small registry maps id → provider:

```ts
// engine/framework/registry.ts
export const FRAMEWORKS: Record<string, FrameworkProvider> = { bmad: bmadProvider, none: noneProvider };
export const DEFAULT_FRAMEWORK = 'bmad';
export const getFramework = (id: string | undefined): FrameworkProvider => FRAMEWORKS[id ?? DEFAULT_FRAMEWORK] ?? FRAMEWORKS[DEFAULT_FRAMEWORK];
```

### `Config` changes

- Add `framework?: string` (absent ⇒ `'bmad'`), following the flat-and-serializable pattern of
  `installCli`/`bmadTarget`.
- `modules[]` becomes the generic "framework options" array (interpreted per provider). Keep the name
  or rename to `methodOptions[]` — either is fine; keeping `modules` minimizes churn.
- Move `bmadTarget` (the `latest` update opt-in) *into* a provider-scoped options bag — it is a
  BMad concept, not a top-level installer concept.

## The two first providers

- **`BmadProvider`** is today's code wearing the interface: `install()` wraps `runBmadInstall`,
  `detectExisting()` wraps `defaultBmadInstalled` + `readInstalledBmadVersion`, `summaryFacts()`
  returns `{ label: "BMad Method", version, note }`, `welcomeGuidance()` returns the `/bmad-help`
  line, `options` = bmm/cis/bmb.
- **`NoneProvider`** (the bare path): `install()` emits Working→Done immediately and returns
  `{ ok: true }` (nothing to install); `detectExisting()` → `{ present: false }`; `summaryFacts()`
  → `null` (Welcome omits the framework row); `welcomeGuidance()` → a generic "open it in your editor
  and describe what you want to build"; `options` = `[]`.

## Engine wiring

The `install.bmad` step becomes a generic framework step:

```ts
{ id: StepId.InstallFramework, run: async () => {
    const framework = getFramework(this.config.framework);
    const r = await framework.install(this.ctx());
    this.methodResult = r;
    return r.ok;
} }
```

`finalize.self-check` calls `framework.summaryFacts(...)` instead of the hardcoded manifest read.
`provision.*`, `scaffold.git-init`, and `install.agent-cli` are untouched.

## Decision: rename `StepId.InstallBmad` → `StepId.InstallFramework`

The step is no longer BMad-specific, so the id shouldn't claim to be. This is a mechanical rename
that TypeScript enforces; event ids are ephemeral (per-session SSE — the saved `welcome.html` reads
`summaryJson`, not step ids), so there is no wire-compat cost. Touch points:

- `engine/contract.ts` — `InstallBmad: 'install.bmad'` → `InstallFramework: 'install.framework'`. Consider
  `ErrorCode.BmadInstallFailed` → `MethodInstallFailed` (generic), with BMad-specific detail supplied
  by the provider. `NON_FATAL_STEPS` is unaffected (it lists `InstallAgentCli`).
- `engine/messages.ts` — the generic step's default copy; provider supplies framework-specific text.
- `ui/state/progress.ts` — the slow-step set (BMad install is slow) keys off this id.
- `ui/screens/Progress.tsx`, `ui/state/reducer.ts` — reference `StepId` generically; the rename is a
  compile-time update.
- Tests + the screenshot gallery (`ui/dev/gallery.tsx`) reference `StepId.InstallBmad` — TS catches
  every one.

The ESLint SSOT guard keeps raw `'install.framework'` literals out of everything but `engine/contract.ts`.

## `ValidationSummary` change

Replace the hardcoded `bmad: {...}` field with a nullable, generic one:

```ts
framework: { id: string; label: string; installed: boolean; version: string | null; note: string } | null
```

`null` ⇒ the "No framework" case; the Welcome versions table simply omits the row. Bump
`schemaVersion`. `server/welcome.ts` already parses the summary defensively (a legacy/absent shape
yields fewer rows), so an older saved page degrades gracefully.

## UI changes

- **Configure** (`ui/screens/Configure.tsx`): add a **Method** selector as a collapsed/advanced
  affordance — default BMad, plus "No framework". When the framework changes, the "What to include"
  picker renders that provider's `options` (BMad: bmm/cis/bmb; none: nothing). The IDE/tools picker
  stays whenever `usesTools` is true.
- **Defaults** (`ui/config/defaults.ts`): `DEFAULT_FRAMEWORK = 'bmad'`; `MODULE_OPTIONS` moves under the
  BMad provider.
- **Welcome**: the versions row + "start building" guidance come from `framework.summaryFacts` /
  `framework.welcomeGuidance` instead of hardcoded BMad copy.

## Prerequisite: decouple the tools catalog from BMad

`scripts/gen-platform-codes.mjs` derives `platform-codes.yaml` from `bmad-method --list-tools`. For a
truly BMad-optional install, promote the committed `platform-codes.yaml` to the real source of truth
(the `FALLBACK_IDES` list in `ui/config/ide-catalog.ts` already exists as a seed). Trade-off: we lose
"auto-discovers new IDEs BMad adds" and maintain the list ourselves — acceptable, and it removes a
hard BMad dependency from the tools picker.

## The system/project install split

Today the steps are ordered by accident of dependency, not by scope. Sorted by *what they
touch*:

| Scope | Steps | Character |
| --- | --- | --- |
| **System** (machine-wide) | `provision.node`, `provision.git`, `install.agent-cli` | install once, skip if present, may need elevation; persist beyond any project |
| **Project** (in the folder) | `scaffold.git-init`, `install.framework` | per project; re-run for each new project |
| Finalize | `finalize.self-check` | reports on both |

The instinct behind the split is right, and it's *almost* latent already — except
**`install.agent-cli` is the outlier**: it's a global `npm install -g` (system-scoped) sitting in
the middle of the project work. That's the one thing the split really fixes.

### What changes

- **Phase taxonomy.** Rework the `Phase` enum (`engine/contract.ts`) so steps carry a scope the UI
  can group on — e.g. `System` and `Project` (keep `Finalize` as its own tail, or fold it into the
  project section as a final "check"). `Phase` is on every `KindlingEvent`, so this ripples through
  the reducer and Progress and their tests — about the size of the `install.framework` rename.
- **The one behavior change: reorder `install.agent-cli`.** For clean, contiguous sections the
  global CLI install should run *with* Node/Git (before scaffold), not after the framework. It is safe
  to move — the CLI install doesn't depend on the project existing, and the self-check re-probes CLI
  presence, so the Welcome guidance is unaffected. This is the only decision here that is not just a
  relabel (see open questions).
- **Progress UI** (`ui/screens/Progress.tsx`): today a flat `steps.map` with one bar. Render two
  labelled sections — "Getting your computer ready" (system) then "Setting up your project"
  (project) — with a decision on whether each section gets its own bar or they share one.
- **Configure UI**: optionally mirror the grouping — the AI-tool CLI opt-in ("run your assistant
  right away") reads as *system* setup, while the framework + modules read as *project* setup.

### Why it's worth it

- **User clarity.** The scary/slow machine work (Xcode CLT, global npm) is visibly one phase, and
  it matches the real distinction a person cares about: "what are you putting on my computer" vs
  "what are you setting up for this project".
- **Honest re-run semantics.** The system section is skip-if-present (already true per step); the
  project section is what re-runs for a second project. Two sections make "your computer's already
  set up, we're just making the new project" expressible.
- **It reinforces the framework seam.** The project section *is* the provider's domain — a "No
  framework" framework just makes it thinner (scaffold, no framework install).

Keep it to two sections of a few steps each; don't let a 6-step flow grow ceremony.

## Phasing

1. **DONE — the framework seam (zero behavior change).** Extracted `BmadProvider`, added the registry
   with just `{ bmad }`, routed the engine through it via an injectable `installFramework` dep, and did
   the `install.framework` rename. Full suite green, install output byte-identical.
2. **The system/project split.** Rework the `Phase` taxonomy into system/project scopes, reorder the
   agent-CLI install into the system section, and render Progress as two labelled sections. Mostly
   relabel + one deliberate reorder; no new methods yet. Good to pair with — or do just before —
   phase 3, so the project section is clearly labelled when the "No framework" option lands in it.
3. **Add the bare option.** `NoneProvider` + the collapsed framework selector + the nullable
   `ValidationSummary.framework`. Decouple the tools catalog (above). Ship — BMad is now optional, and
   the project section visibly shrinks when "No framework" is chosen.
4. **Add one vetted alternative.** Implement the interface + tests for a single framework (e.g. Spec
   Kit) — no engine surgery. Repeat per framework.

Phases 2–4 are all user-visible, so each wants its own version bump + `npm publish` + site redeploy.

## Open questions / risks

- **Non-interactive install is the gate for any new framework.** Kindling depends on scriptable,
  `--yes`-style installs (like BMad's). Some candidates are "copy these files / add these rules"
  (easy); interactive wizards don't fit without work. Vet each candidate's CLI before committing.
- **Keep the framework choice out of the default flow** — collapsed/advanced only, so a non-technical
  user never has to know it exists.
- **Agent-CLI ordering (the split's one real decision).** Moving the global CLI install into the
  system section, before scaffold, front-loads a slow `npm -g` before the reassuring "your project
  is created" moment. Options: (a) system section fully first and accept the wait — cleanest scope
  story; (b) keep the CLI install last but label it as system in the UI — preserves the early
  "project created" beat at the cost of non-contiguous sections. Leaning (a); decide before building.
- **`bmadTarget`/`--action update` semantics** are BMad-specific; they live in the provider, not the
  generic step.
