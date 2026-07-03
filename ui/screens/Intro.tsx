import { Button } from '../components/Button';

export interface IntroProps {
  onContinue: () => void;
}

// Step 1 — Intro. States, in one breath, what's about to happen, then a single primary action.
// No jargon, no choices yet (EXPERIENCE.md: "User knows, in one breath, what's about to happen").
export function Intro({ onContinue }: IntroProps) {
  return (
    <section className="screen screen--intro" aria-labelledby="intro-h">
      <p className="eyebrow">Welcome</p>
      <h1 id="intro-h">Let's get your project set up.</h1>
      <p className="lede">
        In a few minutes you'll have a fresh project, wired up with BMad and your AI coding
        tools — no terminal, nothing to install by hand. We'll handle the rest.
      </p>
      <div className="screen-actions">
        <Button variant="primary" onClick={onContinue}>
          Let's go
        </Button>
      </div>
    </section>
  );
}
