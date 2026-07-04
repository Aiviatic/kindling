import { useEffect, useRef, useState } from 'react';
import type { Pins } from '../../engine/contract';
import {
  cliMissing,
  bmadVersionLabel,
  type CliPresence,
  type ValidationSummary,
} from '../../engine/validation-summary';
import { useInstaller } from '../state/context';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { submitOptIn } from '../lib/optin';
import { AGENT_CLI_DESKTOP_URLS } from '../config/agent-cli';

// Parse the engine-produced summary JSON defensively — the CLI guidance is DERIVED from the
// summary's actual `cli` presence (order-robust, not from the transient step row). Bad/absent
// JSON simply yields no guidance (the screen stays celebratory).
function parseSummary(
  json: string | undefined,
): {
  cli: CliPresence[];
  bmad: ValidationSummary['bmad'];
  node?: ValidationSummary['node'];
  git?: ValidationSummary['git'];
  projectDir?: string;
  os?: string;
} | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      cli?: CliPresence[];
      bmad?: ValidationSummary['bmad'];
      node?: ValidationSummary['node'];
      git?: ValidationSummary['git'];
      projectDir?: unknown;
      os?: unknown;
    };
    return {
      cli: Array.isArray(parsed.cli) ? parsed.cli : [],
      // Read defensively for the versions table + the honest BMad chip; a legacy/absent shape simply
      // yields fewer rows (bmadVersionLabel reads only `bmad.installedVersion`).
      bmad: parsed.bmad as ValidationSummary['bmad'],
      node: parsed.node,
      git: parsed.git,
      projectDir: typeof parsed.projectDir === 'string' ? parsed.projectDir : undefined,
      // `os` (win32/darwin/linux) makes the "how to open a terminal here" tip OS-aware.
      os: typeof parsed.os === 'string' ? parsed.os : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The friendly, OS-aware one-liner for opening a terminal *in the project folder* — the folder
 * matters because running `claude`/`codex` from the wrong place starts them in the wrong project.
 * Falls back to a neutral `cd` hint when the OS is unknown/absent.
 */
function terminalTip(os: string | undefined): string {
  switch (os) {
    case 'win32':
      return 'To open one there: open the folder in File Explorer, click the address bar, type cmd, and press Enter.';
    case 'darwin':
      return 'To open one there: in Finder, right-click the project folder and choose New Terminal at Folder (you can enable this once under System Settings > Keyboard > Shortcuts > Services if you do not see it).';
    case 'linux':
      return 'To open one there: right-click the project folder and choose Open in Terminal.';
    default:
      return 'To open one there: open a terminal and cd into your project folder, then run the command.';
  }
}

/** Join tool names into calm prose: "Claude Code" or "Claude Code or Codex" or "A, B or C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export interface WelcomeProps {
  pins: Pins;
  /** Optional: notify the host the Welcome has rendered (drives the ephemeral-server exit, 3.7
   *  lifecycle). Called once on mount; never blocks the screen. */
  onRendered?: () => void;
}

// Step 4 — Welcome (success). Celebratory but calm: confirms readiness, shows a table of what got
// installed (versions from the self-check), the one-time CLI login step, and a PASSIVE workshop
// strip — never autofocused, never required, never blocking.
export function Welcome({ pins, onRendered }: WelcomeProps) {
  const { state } = useInstaller();

  // Render-ack EXACTLY ONCE: let the host know the success screen is up so the ephemeral server
  // can exit. Guarded by a ref + empty deps so a changing `onRendered` identity (inline arrow)
  // or a StrictMode double-invoke can't fire a second ack at an already-closed server.
  const acked = useRef(false);
  useEffect(() => {
    if (acked.current) return;
    acked.current = true;
    onRendered?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);

  // Passive opt-in (5.2 / FR-19/20) — consent-first, never required, never blocks. Submitting is
  // best-effort: it degrades to a quiet "thanks" whether the endpoint is unconfigured (hosting
  // deferred) or the post fails — the user's project is already done either way.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [state_, setState_] = useState('');
  const [optedIn, setOptedIn] = useState(false);
  const sent = useRef(false); // synchronous double-submit guard (state flips a tick later)
  const optIn = (): void => {
    if (sent.current) return;
    sent.current = true;
    setOptedIn(true); // acknowledge immediately; capture is best-effort and never surfaces errors
    void submitOptIn({ firstName, lastName, email, city, state: state_ });
  };

  // Best-effort geo pre-fill (FR-20) — on mount, try a free IP geolocation lookup and pre-fill
  // City/State so the user rarely has to type them. NEVER blocks render, never throws, fully silent
  // on any failure, and NEVER clobbers a value the user already typed. Guarded on `typeof fetch`
  // because jsdom (tests) may not provide a real fetch.
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('https://ipapi.co/json/');
        if (!res.ok) return;
        const data = (await res.json()) as { city?: unknown; region?: unknown };
        if (cancelled) return;
        // Only fill fields the user hasn't touched yet (functional updater: no stale-closure race).
        if (typeof data.city === 'string' && data.city) setCity((cur) => (cur ? cur : data.city as string));
        if (typeof data.region === 'string' && data.region) setState_((cur) => (cur ? cur : data.region as string));
      } catch {
        // silent: geo pre-fill is a convenience, never a requirement
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);

  const summary = state.summaryJson;
  const parsed = parseSummary(summary);
  // Every requested agent tool (present or not) — the terminal command is the tool's `bin` either way.
  const requestedClis = parsed?.cli ?? [];
  const missingClis = parsed ? cliMissing(parsed) : [];
  // Requested tools that offer a desktop app — the "easy way" most people will use. Only ids in the
  // map get a link; both current tools do, so this normally equals `requestedClis`.
  const desktopClis = requestedClis.filter((c) => c.id in AGENT_CLI_DESKTOP_URLS);
  const projectDir = parsed?.projectDir;
  // Honest version chip (Story 7.2 / AC-6): reflect the ACTUAL installed version for a latest run;
  // fall back to the pinned chip for the default (unchanged) run or an absent installedVersion.
  const versionChip = bmadVersionLabel(parsed, pins.bmad);

  return (
    <section className="screen screen--welcome" aria-labelledby="welcome-h">
      <p className="eyebrow">All set</p>
      <h1 id="welcome-h">You're ready 🔥</h1>
      <p className="lede">
        Your project is set up with BMad and your tools. Open it in your editor to start building,
        and close this browser tab whenever you like.
      </p>

      <table className="versions" data-testid="versions">
        <caption>Here's what's set up on your computer</caption>
        <tbody>
          {parsed?.projectDir && (
            <tr>
              <th scope="row">Project folder</th>
              <td>{parsed.projectDir}</td>
            </tr>
          )}
          {parsed?.node && (
            <tr>
              <th scope="row">Node.js</th>
              <td>{parsed.node.version ?? 'Installed'}</td>
            </tr>
          )}
          {parsed?.git && (
            <tr>
              <th scope="row">Git</th>
              <td>{parsed.git.version ?? 'Installed'}</td>
            </tr>
          )}
          <tr>
            <th scope="row">BMad Method</th>
            <td>
              <strong>{versionChip.version}</strong> · {versionChip.note}
            </td>
          </tr>
          {(parsed?.cli ?? []).map((c) => (
            <tr key={c.id ?? c.bin}>
              <th scope="row">{c.name}</th>
              <td>{c.present ? '✓ Installed' : 'Not installed'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* "Start building" — the one calm, celebratory (never error-styled, never blocking) section
          that tells a NON-developer how to actually start using their AI tool. Two ways, easiest
          first: the desktop app, then the terminal. Rendered only when a tool was requested. */}
      {requestedClis.length > 0 && (
        <div className="cli-guidance" data-testid="start-building">
          <p className="eyebrow">Start building</p>

          {/* THE EASY WAY — desktop app first: most people will use the app, not the terminal. Open
              the app, point it at the project folder (it needs to know where your project lives),
              and log in. */}
          {desktopClis.length > 0 && (
            <div data-testid="start-desktop">
              <p>
                The easy way: open the {joinNames(desktopClis.map((c) => c.name))} app, choose your
                project folder, and log in.
              </p>
              {projectDir && (
                <p className="start-note" data-testid="start-desktop-folder">
                  📁 {projectDir}
                </p>
              )}
              {desktopClis.map((c) => (
                <p key={c.id} className="start-note">
                  Get the{' '}
                  <a href={AGENT_CLI_DESKTOP_URLS[c.id]} target="_blank" rel="noreferrer">
                    {c.name} app<span className="sr-live"> (opens in a new tab)</span>
                  </a>
                  .
                </p>
              ))}
            </div>
          )}

          {/* THE ALTERNATIVE — the terminal. Critical: open it IN the project folder, or the tool
              starts in the wrong place. OS-aware tip on how to do exactly that. */}
          <div data-testid="start-terminal">
            <p className="eyebrow">Prefer the terminal?</p>
            <p>
              Open a terminal in your project folder, run{' '}
              {requestedClis.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && (i === requestedClis.length - 1 ? ' or ' : ', ')}
                  <code>{c.bin}</code>
                </span>
              ))}
              , and log in.
            </p>
            {projectDir && (
              <p className="start-note" data-testid="start-terminal-folder">
                📁 {projectDir}
              </p>
            )}
            <p className="start-note" data-testid="start-terminal-tip">
              {terminalTip(parsed?.os)}
            </p>
            {missingClis.length > 0 && (
              <p className="start-note" data-testid="start-missing">
                If a command is not found, it did not finish installing. No problem, your project is
                ready. Install it yourself with{' '}
                {missingClis.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && (i === missingClis.length - 1 ? ' and ' : ', ')}
                    <code>npm install -g {c.pkg}</code>
                  </span>
                ))}
                , then run it and log in.
              </p>
            )}
          </div>

          {/* The first thing to actually DO once inside — BMad is already installed in the
              project, so /bmad-help is the guided front door for a non-developer. */}
          <p className="start-note" data-testid="start-first-prompt">
            Once you're in, just describe what you want to build. You can also type{' '}
            <code>/bmad-help</code> to see what BMad can do.
          </p>
        </div>
      )}

      {/* Good-to-know strip: the saved welcome.html copy + the re-run path. Calm, never blocking. */}
      <div className="cli-guidance" data-testid="good-to-know">
        <p className="eyebrow">Good to know</p>
        <p className="start-note">
          A copy of this page is saved in your project folder as <code>welcome.html</code>, so
          you can come back to these instructions any time.
        </p>
        <p className="start-note">
          Want another project later? Run Kindling again. It remembers where your projects go.
        </p>
      </div>

      {/* Passive workshop strip — informational, never autofocused or required. A plain <div>
          (not an <aside>) so it isn't a nested complementary landmark inside the screen region. */}
      <div className="workshop-strip" data-testid="workshop-strip">
        <p className="eyebrow">Optional</p>
        <p>
          Aiviatic runs hands-on build workshops. Want to hear if there's one near
          you? <b>Totally optional, setup is complete.</b>
        </p>
        {optedIn ? (
          <p role="status">Thanks, we'll be in touch. 🔥</p>
        ) : (
          <form
            className="optin-form"
            onSubmit={(e) => {
              e.preventDefault();
              optIn();
            }}
          >
            <div className="optin-row">
              <TextInput
                label="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ada"
              />
              <TextInput
                label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Lovelace"
              />
            </div>
            <div className="optin-row">
              <TextInput
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="optin-row">
              <TextInput
                label="City (optional)"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
              />
              <TextInput
                label="State (optional)"
                value={state_}
                onChange={(e) => setState_(e.target.value)}
                placeholder="State"
              />
            </div>
            <Button
              type="submit"
              variant="ghost"
              disabled={
                firstName.trim() === '' || lastName.trim() === '' || email.trim() === ''
              }
            >
              Keep me posted
            </Button>
          </form>
        )}
        <p className="start-note">
          Prefer not to?{' '}
          <a href="https://aiviatic.com" target="_blank" rel="noreferrer">
            Just read more<span className="sr-live"> (opens in a new tab)</span>
          </a>
          .
        </p>
      </div>
    </section>
  );
}
