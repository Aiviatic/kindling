import { describe, it, expect, afterEach, vi } from 'vitest';
import { get, request } from 'node:http';
import { startServer, type RunningServer, type ServerCommands } from './server';
import { EngineEmitter } from '../engine/emitter';
import { Phase, StepId, Status, type KindlingEvent } from '../engine/contract';

function ev(id: string): KindlingEvent {
  return {
    id,
    phase: Phase.Provision,
    step: StepId.ProvisionNode,
    status: Status.Working,
    humanMessage: 'm',
    level: 'info',
    timestamp: '2026-05-29T00:00:00.000Z',
  };
}

function fakeCommands(): ServerCommands & {
  start: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(async () => {}),
    cancel: vi.fn(() => {}),
    retry: vi.fn(async () => {}),
  };
}

function post(
  base: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = { 'x-kindling': '1' },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path.replace(/^\//, ''));
    const data = body === undefined ? '' : JSON.stringify(body);
    const req = request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Length': Buffer.byteLength(data), ...extraHeaders },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

// Like `post`, but resolves the { status, body } so /inspect's JSON contract can be asserted.
function postJson(
  base: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = { 'x-kindling': '1' },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path.replace(/^\//, ''));
    const data = body === undefined ? '' : JSON.stringify(body);
    const req = request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Length': Buffer.byteLength(data), ...extraHeaders },
      },
      (res) => {
        let buf = '';
        res.on('data', (c: Buffer) => (buf += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

// Open SSE, resolve once `n` events are received.
function collectSSE(base: string, n: number): Promise<KindlingEvent[]> {
  return new Promise((resolve, reject) => {
    const req = get(base + 'events', (res) => {
      let buf = '';
      const out: KindlingEvent[] = [];
      res.on('data', (c: Buffer) => {
        buf += c.toString();
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const m = /^data: (.*)$/m.exec(frame);
          if (m) {
            out.push(JSON.parse(m[1]) as KindlingEvent);
            if (out.length >= n) {
              req.destroy();
              resolve(out);
            }
          }
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('startServer', () => {
  it('binds 127.0.0.1 on an ephemeral port', async () => {
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands() });
    expect(running.port).toBeGreaterThan(0);
    expect(running.url).toBe(`http://127.0.0.1:${running.port}/`);
  });

  it('rejects a non-loopback Host header (DNS-rebinding guard, 403)', async () => {
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands() });
    // Connect to 127.0.0.1 but send an attacker domain as Host — i.e. a DNS-rebinding page.
    const status = await post(running.url, '/inspect', { projectDir: '/x' }, { 'x-kindling': '1', Host: 'evil.example' });
    expect(status).toBe(403);
  });

  it('SSE relays the backlog then live events', async () => {
    const emitter = new EngineEmitter();
    running = await startServer({ emitter, commands: fakeCommands() });
    emitter.emit(ev('a')); // backlog, before any client connects
    const collected = collectSSE(running.url, 2);
    await new Promise((r) => setTimeout(r, 30)); // let the SSE client connect + subscribe
    emitter.emit(ev('b')); // live
    const events = await collected;
    expect(events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  const cfg = {
    projectDir: '/tmp/p',
    projectName: 'p',
    ides: ['claude-code'],
    modules: ['bmm'],
    pins: { node: '24', bmad: '6.9.0', kindling: '0.0.0' },
  };

  it('POST /start forwards the parsed config to the engine; bad/empty body → 400', async () => {
    const commands = fakeCommands();
    running = await startServer({ emitter: new EngineEmitter(), commands });
    expect(await post(running.url, '/start', cfg)).toBe(202);
    expect(commands.start).toHaveBeenCalledWith(cfg);
    // missing/invalid config bodies are rejected, not run with junk
    expect(await post(running.url, '/start')).toBe(400);
    expect(await post(running.url, '/start', { nope: 1 })).toBe(400);
    expect(commands.start).toHaveBeenCalledTimes(1);
  });

  it('POST /cancel invokes the engine command (202)', async () => {
    const commands = fakeCommands();
    running = await startServer({ emitter: new EngineEmitter(), commands });
    expect(await post(running.url, '/cancel')).toBe(202);
    expect(commands.cancel).toHaveBeenCalledOnce();
  });

  it('POST /ack fires the render-ack hook (202) so the host can exit on success', async () => {
    const onWelcomeAck = vi.fn();
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands(), onWelcomeAck });
    expect(await post(running.url, '/ack')).toBe(202);
    expect(onWelcomeAck).toHaveBeenCalledOnce();
  });

  it('POST /quit fires the onQuit hook (202) so the host can tear down + exit', async () => {
    const onQuit = vi.fn();
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands(), onQuit });
    expect(await post(running.url, '/quit')).toBe(202);
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it('POST /quit without the CSRF header → 403 (guarded like every command)', async () => {
    const onQuit = vi.fn();
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands(), onQuit });
    expect(await post(running.url, '/quit', undefined, {})).toBe(403);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('POST /retry passes the step; missing step → 400', async () => {
    const commands = fakeCommands();
    running = await startServer({ emitter: new EngineEmitter(), commands });
    expect(await post(running.url, '/retry', { step: StepId.InstallBmad })).toBe(202);
    expect(commands.retry).toHaveBeenCalledWith(StepId.InstallBmad);
    expect(await post(running.url, '/retry', {})).toBe(400); // missing step
    expect(await post(running.url, '/retry', { step: 'not.a-real-step' })).toBe(400); // unknown step
  });

  it('POST /inspect without the CSRF header → 403 (read-only, but still guarded)', async () => {
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands() });
    expect(await post(running.url, '/inspect', { projectDir: '/p' }, {})).toBe(403);
  });

  it('POST /inspect with a bad/blank body → 400', async () => {
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands() });
    expect(await post(running.url, '/inspect')).toBe(400); // no body
    expect(await post(running.url, '/inspect', { projectDir: '' })).toBe(400); // blank
    expect(await post(running.url, '/inspect', { nope: 1 })).toBe(400); // missing field
    expect(await post(running.url, '/inspect', { projectDir: 123 })).toBe(400); // present-but-non-string
  });

  it('POST /inspect with a valid body → 200 + the inspector JSON contract', async () => {
    const commands = {
      ...fakeCommands(),
      inspect: vi.fn(async () => ({ isKindlingProject: true, installedBmadVersion: '6.9.0' })),
    };
    running = await startServer({ emitter: new EngineEmitter(), commands });
    const { status, body } = await postJson(running.url, '/inspect', { projectDir: '/p' });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ isKindlingProject: true, installedBmadVersion: '6.9.0' });
    expect(commands.inspect).toHaveBeenCalledWith('/p');
  });

  it('POST /inspect with NO inspect command → 200 + neutral result (existing fakes do not break)', async () => {
    // fakeCommands() omits `inspect` (optional member) — the handler falls back to the neutral shape.
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands() });
    const { status, body } = await postJson(running.url, '/inspect', { projectDir: '/p' });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ isKindlingProject: false, installedBmadVersion: null });
  });

  it('rejects command POSTs without the X-Kindling header (403, CSRF guard)', async () => {
    const commands = fakeCommands();
    running = await startServer({ emitter: new EngineEmitter(), commands });
    expect(await post(running.url, '/start', undefined, {})).toBe(403); // no x-kindling header
    expect(commands.start).not.toHaveBeenCalled();
  });

  it('unknown route → 404', async () => {
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands() });
    const status: number = await new Promise((resolve) => {
      get(running!.url + 'nope', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
    });
    expect(status).toBe(404);
  });

  // GET /prefs — the Configure prefill. Read-only; every failure degrades to null.
  const getPrefs = (url: string): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      get(url + 'prefs', (res) => {
        let body = '';
        res.on('data', (c) => (body += String(c)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      }).on('error', reject);
    });

  it('GET /prefs returns the saved folder from the injected getter', async () => {
    running = await startServer({
      emitter: new EngineEmitter(),
      commands: fakeCommands(),
      getLastProjectFolder: async () => '~/My Projects',
    });
    const { status, body } = await getPrefs(running.url);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ lastProjectFolder: '~/My Projects' });
  });

  it('GET /prefs without a getter → null (existing hosts do not break)', async () => {
    running = await startServer({ emitter: new EngineEmitter(), commands: fakeCommands() });
    const { status, body } = await getPrefs(running.url);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ lastProjectFolder: null });
  });

  it('GET /prefs degrades to null when the getter rejects', async () => {
    running = await startServer({
      emitter: new EngineEmitter(),
      commands: fakeCommands(),
      getLastProjectFolder: () => Promise.reject(new Error('boom')),
    });
    const { status, body } = await getPrefs(running.url);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ lastProjectFolder: null });
  });
});
