import { describe, expect, it, vi } from 'vitest';
import { projectFolderOf, readLastProjectFolder, saveLastProjectFolder } from './prefs';

describe('projectFolderOf', () => {
  it('strips the trailing /<name> from a composed projectDir', () => {
    expect(projectFolderOf('~/My Projects/My Project', 'My Project')).toBe('~/My Projects');
    expect(projectFolderOf('/home/ada/dev/app', 'app')).toBe('/home/ada/dev');
  });

  it('handles a Windows-style backslash separator', () => {
    expect(projectFolderOf('C:\\Users\\ada\\Projects\\app', 'app')).toBe('C:\\Users\\ada\\Projects');
  });

  it('returns null when the dir does not end with the name', () => {
    expect(projectFolderOf('/home/ada/dev/app', 'other')).toBeNull();
  });

  it('returns null when the dir IS just the name (no folder to recover)', () => {
    expect(projectFolderOf('/app', 'app')).toBeNull();
    expect(projectFolderOf('app', 'app')).toBeNull();
  });
});

describe('readLastProjectFolder', () => {
  it('returns the saved folder', async () => {
    const read = async () => JSON.stringify({ lastProjectFolder: '~/My Projects' });
    await expect(readLastProjectFolder(read, '/p')).resolves.toBe('~/My Projects');
  });

  it.each([
    ['unreadable file', () => Promise.reject(new Error('ENOENT'))],
    ['malformed JSON', async () => 'not json'],
    ['missing field', async () => '{}'],
    ['empty string field', async () => JSON.stringify({ lastProjectFolder: '' })],
    ['non-string field', async () => JSON.stringify({ lastProjectFolder: 7 })],
  ])('degrades to null on %s', async (_label, read) => {
    await expect(readLastProjectFolder(read, '/p')).resolves.toBeNull();
  });
});

describe('saveLastProjectFolder', () => {
  it('writes the folder as JSON to the prefs path', async () => {
    const write = vi.fn(async () => {});
    await saveLastProjectFolder('~/My Projects', write, '/p/prefs.json');
    expect(write).toHaveBeenCalledOnce();
    const [path, contents] = write.mock.calls[0] as unknown as [string, string];
    expect(path).toBe('/p/prefs.json');
    expect(JSON.parse(contents)).toEqual({ lastProjectFolder: '~/My Projects' });
  });

  it('swallows a write failure (best-effort)', async () => {
    const write = () => Promise.reject(new Error('EACCES'));
    await expect(saveLastProjectFolder('~/My Projects', write, '/p/prefs.json')).resolves.toBeUndefined();
  });
});
