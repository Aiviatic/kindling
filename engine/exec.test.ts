import { describe, it, expect } from 'vitest';
import { exec } from './exec';

// Uses the Node binary (process.execPath) as a cross-platform test command — no shell
// builtins, so these pass identically on macOS/Windows/Ubuntu and Node 20/24.
describe('exec', () => {
  it('runs an args-array command and captures stdout + exit code', async () => {
    const result = await exec(process.execPath, [
      '-e',
      'process.stdout.write("ok"); process.exit(3)',
    ]);
    expect(result.stdout).toBe('ok');
    expect(result.code).toBe(3);
  });

  it('captures stderr with a zero exit', async () => {
    const result = await exec(process.execPath, ['-e', 'process.stderr.write("boom")']);
    expect(result.stderr).toBe('boom');
    expect(result.code).toBe(0);
  });

  it('rejects when the binary cannot be spawned', async () => {
    await expect(exec('definitely-not-a-real-binary-xyz', ['--nope'])).rejects.toBeTruthy();
  });

  it('does not interpret a shell string as a command (no shell-string entry point)', async () => {
    // Passing a whole shell string as `cmd` must NOT run via a shell — it tries to spawn a
    // binary literally named that and fails. Proves there is no string-shell escape hatch.
    await expect(
      exec(`${process.execPath} -e "process.exit(0)"`, []),
    ).rejects.toBeTruthy();
  });
});
