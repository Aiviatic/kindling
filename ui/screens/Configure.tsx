import { useEffect, useRef, useState } from 'react';
import type { Config, Pins, InspectResult } from '../../engine/contract';
import type { IdeCatalog, IdeOption } from '../config/ide-catalog';
import { MODULE_OPTIONS, defaultConfig, DEFAULT_PROJECT_FOLDER } from '../config/defaults';
import { AGENT_CLI_LABELS, isAgentCliId } from '../config/agent-cli';
import { ENABLE_BMAD_UPDATE, BMAD_UPDATE_COPY } from '../config/bmad-update';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';

export interface ConfigureProps {
  catalog: IdeCatalog;
  pins: Pins;
  onStart: (config: Config) => void;
  /** A transport-level start failure to surface (the POST itself failed — Flow sets this). */
  startError?: string | null;
  /**
   * Configure-time existing-project probe (Story 7.2 / approach A). Threaded from Flow
   * (`commands.inspect`); absent in tests/gate-off paths, in which case the detection UI never runs.
   */
  inspect?: (projectDir: string) => Promise<InspectResult>;
  /**
   * Cohort gate override seam — defaults to the build-time `ENABLE_BMAD_UPDATE` constant. A prop so
   * tests can exercise both gate states WITHOUT env plumbing (Task 8). Production never passes it.
   */
  enableBmadUpdate?: boolean;
  /** Probe debounce (ms). Prop so tests can shorten it; production uses the ~350ms default. */
  debounceMs?: number;
  /**
   * The projects folder from the LAST run (GET /prefs), so a re-run starts where the user
   * already keeps projects. Null/absent falls back to the built-in default.
   */
  initialFolder?: string | null;
  /** Quit the installer from this pre-start screen (kills the local server). Optional so the
   *  screen still renders in isolation (tests) without the quit wiring. */
  onCancel?: () => void;
}

type ProbeStatus = 'idle' | 'checking' | 'done' | 'error';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * Step 2 — single smart-default Configure screen. Everything is pre-filled so a user can press
 * Start without touching anything (FR-14); the "Customize" disclosure (collapsed) reveals the
 * directory/name overrides. IDE Picker is populated from the catalog and degrades gracefully.
 */
export function Configure({
  catalog,
  pins,
  onStart,
  startError,
  inspect,
  enableBmadUpdate = ENABLE_BMAD_UPDATE,
  debounceMs = 350,
  initialFolder,
  onCancel,
}: ConfigureProps) {
  const base = defaultConfig(pins);
  // Folder (where projects live) + project name are separate, first-class fields; the install path
  // is composed from them (<folder>/<name>) — friendlier for non-technical users than one raw path.
  // The folder prefers the last run's saved value (prefs) over the built-in default.
  const [folder, setFolder] = useState(initialFolder ?? DEFAULT_PROJECT_FOLDER);
  const [projectName, setProjectName] = useState(base.projectName);
  const [ides, setIdes] = useState<string[]>(base.ides);
  const [modules, setModules] = useState<string[]>(base.modules);
  const [showAllIdes, setShowAllIdes] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Agent-CLI opt-in is DEFAULT-ON for every eligible selected tool (AC-1). We track explicit
  // opt-OUTs (unchecked ids) rather than opt-ins, so a freshly-selected eligible tool is on by
  // default without extra wiring. `installCli` is always derived as the eligible-selected tools
  // minus the opt-outs — so it stays a subset of `selected IDEs ∩ eligible` (AC-3).
  const [optedOut, setOptedOut] = useState<string[]>([]);

  // Epic-7 "Update to latest BMad" opt-in (Story 7.2) — DEFAULT OFF, never pre-checked. The probe
  // detects an existing project under the (Customize) project dir; the affordance sets
  // `bmadTarget: 'latest'` only on the explicit toggle. Both are behind `enableBmadUpdate` (the
  // cohort gate) AND the Customize placement — two independent guards (AC-3).
  const [updateToLatest, setUpdateToLatest] = useState(false);
  const [probe, setProbe] = useState<{ status: ProbeStatus; result: InspectResult | null }>({
    status: 'idle',
    result: null,
  });
  // Latest-request-wins: each debounced probe bumps this; a resolution whose id is stale (a newer
  // dir superseded it) is ignored, so an out-of-order response can't clobber the current state.
  const probeReqId = useRef(0);

  // Currently-selected eligible tools, in picker order. Each renders a default-on opt-in checkbox.
  const eligibleSelected = ides.filter(isAgentCliId);
  const installCli = eligibleSelected.filter((id) => !optedOut.includes(id));

  const rest = catalog.ides.filter((i) => !i.recommended);
  // Collapsed view shows the recommended IDEs PLUS any selected non-recommended one, so a
  // selection can never become hidden-but-active (a deceptive state the user can't undo).
  const visibleIdes: IdeOption[] = showAllIdes
    ? catalog.ides
    : catalog.ides.filter((i) => i.recommended || ides.includes(i.id));

  // Everything bmad-method needs for a fresh non-interactive install must be present: at least
  // one tool (--tools) and one module (--modules), and a non-blank directory/name. The defaults
  // satisfy all of these, so an untouched screen can always Start (FR-14).
  // Compose the install path from folder + name (trailing slashes on the folder are trimmed).
  const folderTrim = folder.trim().replace(/[\\/]+$/, '');
  const name = projectName.trim();
  const dir = folderTrim && name ? `${folderTrim}/${name}` : '';
  const canStart = ides.length > 0 && modules.length > 0 && folderTrim.length > 0 && name.length > 0;

  // Deselecting an eligible tool from the picker forgets its opt-out, so a later re-select is
  // default-on again (and its opt-in row simply disappears while deselected — AC-3).
  const toggleIde = (id: string): void => {
    if (isAgentCliId(id) && ides.includes(id)) setOptedOut((cur) => cur.filter((x) => x !== id));
    setIdes((cur) => toggle(cur, id));
  };

  const toggleOptIn = (id: string): void => {
    setOptedOut((cur) => toggle(cur, id));
  };

  // On ANY project-dir change, SYNCHRONOUSLY drop the previous dir's detection + opt-in BEFORE the
  // debounce fires. Without this, for the ~350ms debounce window `detected`/`updateToLatest` still
  // reflect the OLD dir — so a Start pressed mid-debounce (or a navigate-away-and-back) could leak
  // `bmadTarget: 'latest'` onto a dir that was never freshly detected, or re-show the checkbox
  // pre-checked for a different project. Reset here guarantees "never pre-checked" per detected dir
  // and that `detected` is false until the new dir is actually re-probed. (Runs regardless of the
  // gate; when the gate is off both were already false, so it's a harmless no-op.)
  useEffect(() => {
    setProbe({ status: 'idle', result: null });
    setUpdateToLatest(false);
  }, [dir]);

  // Debounced Configure-time probe (approach A). Fires ONLY when the gate is ON, an `inspect` is
  // wired, and the Customize panel (which holds the editable dir) is open — so a normal-flow /
  // gate-off user never triggers it (AC-3). Cleanup clears the pending timer; the stale-request
  // guard drops a superseded resolution. Never blocks Start; a rejection degrades to 'error'.
  useEffect(() => {
    if (!enableBmadUpdate || !inspect || !customizeOpen) return;
    if (dir.length === 0) {
      setProbe({ status: 'idle', result: null });
      return;
    }
    const reqId = ++probeReqId.current;
    const timer = setTimeout(() => {
      setProbe({ status: 'checking', result: null });
      void inspect(dir).then(
        (result) => {
          if (probeReqId.current === reqId) setProbe({ status: 'done', result });
        },
        () => {
          if (probeReqId.current === reqId) setProbe({ status: 'error', result: null });
        },
      );
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [dir, customizeOpen, enableBmadUpdate, inspect, debounceMs]);

  // An existing Kindling project was detected AND the gate is on ⇒ the affordance is allowed.
  const detected =
    enableBmadUpdate && probe.status === 'done' && probe.result?.isKindlingProject === true;
  const installedVersion = probe.result?.installedBmadVersion ?? null;

  const start = (): void => {
    // Defense in depth (AC-3(b)): `bmadTarget: 'latest'` is composed ONLY when the gate is on, the
    // user explicitly opted in, AND an existing project was detected — otherwise the field is OMITTED
    // entirely, keeping the default Config byte-identical to today (AC-7).
    const sendLatest = enableBmadUpdate && updateToLatest && detected;
    onStart({
      ...base,
      projectDir: dir,
      projectName: name,
      ides,
      modules,
      installCli,
      ...(sendLatest ? { bmadTarget: 'latest' as const } : {}),
    });
  };

  return (
    <section className="screen screen--configure" aria-labelledby="cfg-h">
      <p className="eyebrow">Configure</p>
      <h1 id="cfg-h">Give your project a name.</h1>
      <p className="lede">
        We picked sensible defaults for everything else. Change whatever you like, then
        press Start.
      </p>

      {/* Project folder + name — first-class, shown up front (not hidden under Customize). Both
          editable, each with a plain-language explanation for non-technical users. */}
      <div className="field">
        <TextInput
          label="Where your projects go"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
        <p className="field-note">
          The folder on your computer where your projects are kept. We'll create it if it isn't there yet.
        </p>
      </div>
      <div className="field">
        <TextInput
          label="Project name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
        <p className="field-note">
          A short name for this project. It becomes a new folder inside the one above:
        </p>
        <p className="field-row">
          <span className="field-value">📁 {dir || '…'}</span>
        </p>
      </div>

      {/* IDE Picker */}
      <fieldset className="field" aria-describedby={catalog.degraded ? 'ide-degraded' : undefined}>
        <legend className="field-label">Your AI coding tools</legend>
        {catalog.degraded && (
          <p id="ide-degraded" className="field-note" role="status">
            {catalog.message}
          </p>
        )}
        <ul className="picker" role="list">
          {visibleIdes.map((ide) => {
            const checked = ides.includes(ide.id);
            return (
              <li key={ide.id}>
                <label className="picker-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleIde(ide.id)}
                  />
                  <span className="picker-name">{ide.name}</span>
                  {ide.recommended && <span className="picker-tag">Recommended</span>}
                  {checked && <span className="picker-check">✓ Selected</span>}
                </label>
              </li>
            );
          })}
        </ul>
        {rest.length > 0 && (
          <Button
            variant="ghost"
            aria-expanded={showAllIdes}
            onClick={() => setShowAllIdes((v) => !v)}
          >
            {showAllIdes ? 'Show fewer' : `Show all ${catalog.ides.length} tools`}
          </Button>
        )}
      </fieldset>

      {/* Agent-CLI opt-in — one default-on row per eligible selected tool (claude-code / codex).
          Checking it adds the id to `installCli`; the engine then installs that CLI so it's ready
          to run right after setup. Only appears for eligible selected tools (scope guard). */}
      {eligibleSelected.length > 0 && (
        <fieldset className="field">
          <legend className="field-label">Run your assistant right away</legend>
          <ul className="picker" role="list">
            {eligibleSelected.map((id) => (
              <li key={id}>
                <label className="picker-row">
                  <input
                    type="checkbox"
                    checked={!optedOut.includes(id)}
                    onChange={() => toggleOptIn(id)}
                  />
                  <span className="picker-name">
                    Also install the {AGENT_CLI_LABELS[id]} CLI so you can run it right away
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {/* Module selection */}
      <fieldset className="field">
        <legend className="field-label">What to include</legend>
        <ul className="modules" role="list">
          {MODULE_OPTIONS.map((mod) => (
            <li key={mod.id}>
              <label className="mod-row">
                <input
                  type="checkbox"
                  checked={modules.includes(mod.id)}
                  onChange={() => setModules((cur) => toggle(cur, mod.id))}
                />
                <span className="mod-name">{mod.name}</span>
                <span className="mod-desc">{mod.description}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {/* Customize disclosure — now holds ONLY the gated "Update to latest BMad" affordance (Story
          7.2); the project folder + name are first-class fields above. Rendered only when the cohort
          gate is on, so a normal-flow user has nothing extra to customize. */}
      {enableBmadUpdate && (
      <div className="disclosure">
        <Button
          variant="ghost"
          aria-expanded={customizeOpen}
          aria-controls="customize-panel"
          onClick={() => setCustomizeOpen((v) => !v)}
        >
          {customizeOpen ? '▾ Customize' : '▸ Customize'}
        </Button>
        {customizeOpen && (
          <div id="customize-panel" className="disclosure-panel">

            {/* Epic-7 existing-project detection + opt-in "Update to latest BMad" (Story 7.2).
                Gated (cohort window OFF) AND scoped to this Customize panel — two guards keeping it
                off the default flow. Detected-state line degrades gracefully; the opt-in appears only
                when an existing project is detected, always with the loud reproducibility warning. */}
            {enableBmadUpdate && (
              <div className="bmad-update" data-testid="bmad-update">
                {probe.status === 'checking' && (
                  <p className="field-note" role="status">
                    {BMAD_UPDATE_COPY.checking}
                  </p>
                )}
                {probe.status === 'error' && (
                  <p className="field-note" role="status">
                    {BMAD_UPDATE_COPY.error}
                  </p>
                )}
                {probe.status === 'done' &&
                  (probe.result?.isKindlingProject ? (
                    <p className="field-note" role="status">
                      {installedVersion
                        ? BMAD_UPDATE_COPY.detected(installedVersion)
                        : BMAD_UPDATE_COPY.detectedUnknownVersion}
                    </p>
                  ) : (
                    <p className="field-note" role="status">
                      {BMAD_UPDATE_COPY.none}
                    </p>
                  ))}

                {detected && (
                  <div className="update-affordance">
                    <label className="picker-row">
                      <input
                        type="checkbox"
                        checked={updateToLatest}
                        onChange={() => setUpdateToLatest((v) => !v)}
                      />
                      <span className="picker-name">
                        {BMAD_UPDATE_COPY.optInLabel} (
                        {BMAD_UPDATE_COPY.targetHint(installedVersion ?? 'unknown')})
                      </span>
                    </label>
                    <p className="update-warning" role="alert">
                      {BMAD_UPDATE_COPY.warning}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {startError && (
        <p className="start-error" role="alert">
          {startError}
        </p>
      )}

      <div className="screen-actions start-row">
        <Button variant="primary" onClick={start} disabled={!canStart}>
          Start
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel setup
          </Button>
        )}
        {!canStart && (
          <span className="start-note" role="status">
            Pick at least one tool and one module, and keep a project name and folder.
          </span>
        )}
      </div>
    </section>
  );
}
