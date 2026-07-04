// Persistent footer shown on every installer screen (mounted once in the app shell). Points a
// curious user at the source and the project home — the installer runs code on their machine, so
// "here's where this comes from" belongs in view the whole time, not just on the success screen.
const SITE_URL = 'https://kindling.aiviatic.com';
const REPO_URL = 'https://github.com/Aiviatic/kindling';

export function Footer() {
  return (
    <footer className="app-footer">
      <span className="app-footer-brand">Kindling by Aiviatic</span>
      <nav className="app-footer-links" aria-label="Kindling links">
        <a href={SITE_URL} target="_blank" rel="noreferrer">
          kindling.aiviatic.com<span className="sr-live"> (opens in a new tab)</span>
        </a>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub<span className="sr-live"> (opens in a new tab)</span>
        </a>
      </nav>
    </footer>
  );
}
