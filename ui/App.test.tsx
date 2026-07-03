// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// App's InstallerProvider opens a real EventSource on mount; jsdom has none, so stub a no-op.
class NoopEventSource {
  onmessage: unknown = null;
  onerror: unknown = null;
  close() {}
}

describe('<App> shell', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', NoopEventSource);
    // loadIdeCatalog uses fetch; make it reject so we exercise the never-throws degraded path.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the window-framed shell as a labelled application region', () => {
    render(<App />);
    expect(screen.getByRole('application', { name: 'Kindling installer' })).toBeInTheDocument();
  });

  it('shows a loading status until the catalog resolves', () => {
    render(<App />);
    // Initial render (catalog still null) shows the loading placeholder.
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
