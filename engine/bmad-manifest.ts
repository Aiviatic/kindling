import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'js-yaml';

/**
 * Read the ACTUAL installed BMad version from a project's manifest (FR26).
 *
 * Reads `<projectDir>/_bmad/_config/manifest.yaml` and returns `installation.version` as a string,
 * or `null` on ANY of: file absent, YAML parse error, a non-object document, or a
 * missing/non-string `installation.version`. NEVER throws — it mirrors the tolerance of
 * `probeVersion`/`defaultBmadInstalled`: a "couldn't read disk reality" degrades to `null`
 * (honest not-ready on the Validation Page), never a crash or a false pin.
 *
 * Node-side only (uses `node:fs/promises` + `js-yaml`). The PURE summary module
 * (`validation-summary.ts`) must not import this — the browser imports that module.
 */
export async function readInstalledBmadVersion(projectDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(projectDir, '_bmad', '_config', 'manifest.yaml'), 'utf8');
    const doc = load(raw);
    if (typeof doc !== 'object' || doc === null) return null;
    const installation = (doc as { installation?: unknown }).installation;
    if (typeof installation !== 'object' || installation === null) return null;
    const version = (installation as { version?: unknown }).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}
