import { Button } from '../components/Button';
import { BmadLink } from '../components/BmadLink';

export interface IntroProps {
  onContinue: () => void;
  /** Quit the installer from this pre-start screen (kills the local server). Optional so the
   *  screen still renders in isolation (tests / storybook) without the quit wiring. */
  onCancel?: () => void;
}

// Step 1 — Intro. Says what Kindling is and what it's about to do, in plain language, then a
// single primary action (EXPERIENCE.md: "User knows, in one breath, what's about to happen").
export function Intro({ onContinue, onCancel }: IntroProps) {
  return (
    <section className="screen screen--intro" aria-labelledby="intro-h">
      <p className="eyebrow">Welcome</p>
      <h1 id="intro-h">Let's get your project set up.</h1>
      <p className="lede">
        Kindling gets your computer ready to build real software by describing what you want,
        with an AI assistant writing the code. No coding background needed.
      </p>
      <p className="lede">In the next few minutes it will:</p>
      <ul className="intro-list">
        <li>Create a fresh project folder on your computer.</li>
        <li>
          Set up <BmadLink><b>BMad</b></BmadLink> by default — the framework that guides your AI from
          an idea to a working app. You can pick a different one, or none, on the next screen.
        </li>
        <li>Connect the AI coding tools you choose on the next screen.</li>
      </ul>
      <p className="lede">
        It's free and open source, so anyone can see exactly what it does before running it.
      </p>
      <div className="screen-actions">
        <Button variant="primary" onClick={onContinue}>
          Let's go
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel setup
          </Button>
        )}
      </div>
    </section>
  );
}
