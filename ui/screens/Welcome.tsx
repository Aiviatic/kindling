import { useEffect, useRef, useState } from 'react';
import type { Pins } from '../../engine/contract';
import {
  cliLoginGuidance,
  cliMissing,
  bmadVersionLabel,
  type CliPresence,
  type ValidationSummary,
} from '../../engine/validation-summary';
import { useInstaller } from '../state/context';
import { Button } from '../components/Button';
import { TextInput } from '../components/TextInput';
import { submitOptIn } from '../lib/optin';

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
} | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      cli?: CliPresence[];
      bmad?: ValidationSummary['bmad'];
      node?: ValidationSummary['node'];
      git?: ValidationSummary['git'];
    };
    return {
      cli: Array.isArray(parsed.cli) ? parsed.cli : [],
      // Read defensively for the versions table + the honest BMad chip; a legacy/absent shape simply
      // yields fewer rows (bmadVersionLabel reads only `bmad.installedVersion`).
      bmad: parsed.bmad as ValidationSummary['bmad'],
      node: parsed.node,
      git: parsed.git,
    };
  } catch {
    return null;
  }
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
  const presentClis = parsed ? cliLoginGuidance(parsed) : [];
  const missingClis = parsed ? cliMissing(parsed) : [];
  // Honest version chip (Story 7.2 / AC-6): reflect the ACTUAL installed version for a latest run;
  // fall back to the pinned chip for the default (unchanged) run or an absent installedVersion.
  const versionChip = bmadVersionLabel(parsed, pins.bmad);

  return (
    <section className="screen screen--welcome" aria-labelledby="welcome-h">
      <p className="eyebrow">All set</p>
      <h1 id="welcome-h">You're ready 🔥</h1>
      <p className="lede">
        Your project is set up with BMad and your tools. Open it in your editor and start building.
      </p>
      <p className="lede">
        Your project is ready. You can close this browser tab whenever you like.
      </p>

      <table className="versions" data-testid="versions">
        <caption>Here's what's set up on your computer</caption>
        <tbody>
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

      {/* FR25 login guidance — the ONE remaining manual step for each present agent CLI. Calm and
          celebratory (not an error): the CLI is installed, you just log in once. Derived from the
          summary's `cli` presence, so it's accurate regardless of install-event ordering. */}
      {presentClis.length > 0 && (
        <div className="cli-guidance" role="status" data-testid="cli-login">
          <p className="eyebrow">One last step</p>
          <p>
            Open a terminal, run{' '}
            {presentClis.map((c, i) => (
              <span key={c.id}>
                {i > 0 && (i === presentClis.length - 1 ? ' or ' : ', ')}
                <code>{c.bin}</code>
              </span>
            ))}
            , and log in, then you're all set.
          </p>
        </div>
      )}

      {/* Non-blocking "install-it-yourself" notice for a requested CLI that didn't install (AC-8).
          Never error-styled — your project is already done; this is just the one line to finish. */}
      {missingClis.length > 0 && (
        <div className="cli-guidance" role="status" data-testid="cli-missing">
          <p className="eyebrow">Optional finishing touch</p>
          <p>
            Your AI assistant didn't finish installing. No problem, your project is ready. To install
            it yourself, run{' '}
            {missingClis.map((c, i) => (
              <span key={c.id}>
                {i > 0 && (i === missingClis.length - 1 ? ' and ' : ', ')}
                <code>npm install -g {c.pkg}</code>
              </span>
            ))}
            , then start it and log in.
          </p>
        </div>
      )}

      {/* Passive workshop strip — informational, never autofocused or required. A plain <div>
          (not an <aside>) so it isn't a nested complementary landmark inside the screen region. */}
      <div className="workshop-strip" data-testid="workshop-strip">
        <p className="eyebrow">Optional</p>
        <p>
          Aiviatic runs hands-on build workshops. Want to hear if there's one near
          you? <b>Totally optional. Your project's already done.</b>
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
