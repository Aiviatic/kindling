import { useEffect, useState } from 'react';
import './tokens.css';
import { pins } from '../engine/pins';
import { InstallerProvider } from './state/context';
import { Flow } from './screens/Flow';
import { loadIdeCatalog, type IdeCatalog } from './config/ide-catalog';
import { loadLastProjectFolder } from './lib/prefs';
import { Footer } from './components/Footer';

// Window-framed app shell (DESIGN.md): a faux browser/app window — titlebar with traffic-light
// dots + a url bar — over the dark flame stage, content centered at ~1000px max. The guided
// flow (Intro/Configure/Progress/Welcome) mounts inside `.app-stage`.
export default function App() {
  // Load the IDE catalog once; until it resolves, the Configure picker has nothing to show.
  // loadIdeCatalog never throws — it degrades to a built-in list — so there's no error branch.
  const [catalog, setCatalog] = useState<IdeCatalog | null>(null);
  // Last run's projects folder (GET /prefs). `undefined` = still loading (gate the Flow render so
  // Configure mounts with the prefill); `null` = no saved folder → the built-in default.
  const [lastFolder, setLastFolder] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadIdeCatalog().then((c) => {
      if (live) setCatalog(c);
    });
    void loadLastProjectFolder().then((f) => {
      if (live) setLastFolder(f);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="app-window" role="application" aria-label="Kindling installer">
        <div className="app-titlebar">
          <div className="app-traffic" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="app-urlbar">kindling · local setup</div>
        </div>
        <main className="app-stage">
          <InstallerProvider>
            {catalog && lastFolder !== undefined ? (
              <Flow catalog={catalog} pins={pins} initialFolder={lastFolder} />
            ) : (
              <p className="lede" role="status">
                Loading…
              </p>
            )}
          </InstallerProvider>
        </main>
        <Footer />
      </div>
    </div>
  );
}
