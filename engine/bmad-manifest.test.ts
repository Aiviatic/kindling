import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstalledBmadVersion } from './bmad-manifest';

// Uses a real OS tmpdir (path.join — cross-OS safe; never a hardcoded POSIX path) so we exercise
// the actual fs/yaml read. No network, no real `_bmad` in the repo.
describe('readInstalledBmadVersion', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'kindling-manifest-'));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeManifest(contents: string): Promise<void> {
    const dir = join(projectDir, '_bmad', '_config');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifest.yaml'), contents, 'utf8');
  }

  it('returns installation.version from a valid manifest', async () => {
    await writeManifest('installation:\n  version: 6.9.0\n  installDate: 2026-05-24T00:38:59.772Z\n');
    expect(await readInstalledBmadVersion(projectDir)).toBe('6.9.0');
  });

  it('returns null when the manifest file is absent', async () => {
    // No _bmad written at all.
    expect(await readInstalledBmadVersion(projectDir)).toBeNull();
  });

  it('returns null on malformed YAML (never throws)', async () => {
    await writeManifest('installation: : : not valid yaml : [\n');
    expect(await readInstalledBmadVersion(projectDir)).toBeNull();
  });

  it('returns null when installation.version is missing', async () => {
    await writeManifest('installation:\n  installDate: 2026-05-24T00:38:59.772Z\nmodules: []\n');
    expect(await readInstalledBmadVersion(projectDir)).toBeNull();
  });

  it('returns null when the installation key is absent entirely', async () => {
    await writeManifest('modules:\n  - name: core\n');
    expect(await readInstalledBmadVersion(projectDir)).toBeNull();
  });

  it('returns null when version is a bare YAML number (unquoted `6` parses as a number, not a string)', async () => {
    await writeManifest('installation:\n  version: 6\n');
    expect(await readInstalledBmadVersion(projectDir)).toBeNull();
  });

  it('returns null when version is a non-string (e.g. a bare number/map)', async () => {
    await writeManifest('installation:\n  version:\n    nested: true\n');
    expect(await readInstalledBmadVersion(projectDir)).toBeNull();
  });

  it('returns null when the document is not a mapping (e.g. a bare scalar)', async () => {
    await writeManifest('just a string\n');
    expect(await readInstalledBmadVersion(projectDir)).toBeNull();
  });
});
