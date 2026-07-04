import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { EngineEmitter } from '../engine/emitter';
import { StepId, type Config, type KindlingEvent, type InspectResult } from '../engine/contract';
import { expandTilde } from '../engine/expand-tilde';

// Minimal command surface the server drives (the Engine satisfies this).
export interface ServerCommands {
  start(config: Config): unknown | Promise<unknown>;
  cancel(): void;
  retry(step: StepId): unknown | Promise<unknown>;
  /**
   * Read-only filesystem probe for the Configure-time "existing project?" detection (Story 7.2 /
   * `POST /inspect`). OPTIONAL so existing `ServerCommands` fakes (e.g. server.test.ts) don't break;
   * when absent the handler returns the neutral `{ isKindlingProject: false, installedBmadVersion: null }`.
   */
  inspect?(projectDir: string): Promise<InspectResult>;
}

export interface StartServerOptions {
  emitter: EngineEmitter;
  commands: ServerCommands;
  /** Built UI directory (dist/ui) to serve statically; omit to skip static serving. */
  uiDir?: string;
  /** Called when the Welcome screen render-acks (POST /ack). The host uses this to write the
   *  static welcome.html and exit the ephemeral server — only fired on success (3.7 lifecycle). */
  onWelcomeAck?: () => void;
  /** Last run's projects folder for the Configure prefill (GET /prefs); absent → null. */
  getLastProjectFolder?: () => Promise<string | null>;
}

export interface RunningServer {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const MAX_BODY_BYTES = 64 * 1024;
const KNOWN_STEPS = new Set<string>(Object.values(StepId));

// Reads the request body with a hard size cap (throws past the cap → caller responds 413).
async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > MAX_BODY_BYTES) throw new Error('body too large');
  }
  return body;
}

async function serveStatic(uiDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = normalize(join(uiDir, rel));
  // Path-traversal guard: the resolved path must stay within uiDir. (We serve only our own
  // built dist/ui — not attacker-writable — so symlink resolution is out of scope.)
  // Use the platform path separator, NOT a literal '/': on Windows `normalize` yields backslash
  // paths, so `+ '/'` never matched and EVERY file was forbidden (dress-rehearsal Windows bug).
  if (filePath !== normalize(uiDir) && !filePath.startsWith(normalize(uiDir) + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

// Stands up the localhost server: SSE event stream, command POSTs, and (optional) static UI.
// Binds 127.0.0.1 on an ephemeral port (NFR6); resolves once listening.
export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const { emitter, commands, uiDir, onWelcomeAck, getLastProjectFolder } = opts;
  const sseClients = new Set<ServerResponse>();

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');

    // DNS-rebinding guard: only serve requests whose Host header is loopback. A page that rebinds
    // its own domain's DNS to 127.0.0.1 still sends that domain as Host, not 127.0.0.1 / localhost.
    const hostname = (req.headers.host ?? '').split(':')[0].toLowerCase();
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      res.writeHead(403).end('forbidden');
      return;
    }

    if (req.method === 'GET' && pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Data-only SSE framing (one stream per connection); the UI client uses `onmessage`.
      const send = (event: KindlingEvent): void => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      for (const event of emitter.events()) send(event); // replay backlog so late clients catch up
      const off = emitter.on(send);
      sseClients.add(res);
      req.on('close', () => {
        off();
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/prefs') {
      // Read-only prefill for Configure. A prefs read failure degrades to null (no prefill) —
      // same posture as every other prefs path: a convenience, never an error.
      let lastProjectFolder: string | null = null;
      if (getLastProjectFolder) {
        try {
          lastProjectFolder = await getLastProjectFolder();
        } catch {
          lastProjectFolder = null;
        }
      }
      res
        .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ lastProjectFolder }));
      return;
    }

    if (req.method === 'POST') {
      // CSRF guard: a cross-origin browser page can reach 127.0.0.1, but cannot set a custom
      // header without a CORS preflight (which this server never approves). The UI sends it.
      if (req.headers['x-kindling'] !== '1') {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (pathname === '/start') {
        let body: string;
        try {
          body = await readBody(req);
        } catch {
          res.writeHead(413).end('body too large');
          return;
        }
        let config: Config | undefined;
        try {
          const p = JSON.parse(body || 'null') as Partial<Config> | null;
          // Shape-guard every field the engine dereferences (flags.ts reads projectDir; the
          // self-check/validation reads pins) so a malformed body is rejected as 400 rather
          // than reaching the engine and crashing after we've already sent 202.
          if (
            p &&
            typeof p === 'object' &&
            typeof p.projectDir === 'string' &&
            p.projectDir.length > 0 &&
            typeof p.projectName === 'string' &&
            p.projectName.length > 0 &&
            Array.isArray(p.ides) &&
            p.ides.length > 0 &&
            Array.isArray(p.modules) &&
            p.pins !== null &&
            typeof p.pins === 'object'
          ) {
            config = p as Config;
          }
        } catch {
          config = undefined;
        }
        if (!config) {
          res.writeHead(400).end('invalid config');
          return;
        }
        res.writeHead(202).end(); // progress flows over SSE; don't block on the run
        void Promise.resolve(commands.start(config)).catch(() => {});
        return;
      }
      if (pathname === '/inspect') {
        // Read-only, fixed-suffix probe (Story 7.2). Same CSRF guard + readBody cap as /start;
        // shape-guard the body → 400; else 200 + the InspectResult JSON. No engine, no writes,
        // no user-controlled traversal (the inspector only stats <dir>/_bmad + reads the fixed
        // <dir>/_bmad/_config/manifest.yaml). Both underlying reads never throw.
        let body: string;
        try {
          body = await readBody(req);
        } catch {
          res.writeHead(413).end('body too large');
          return;
        }
        let projectDir: string | undefined;
        try {
          const p = JSON.parse(body || 'null') as { projectDir?: unknown } | null;
          if (p && typeof p === 'object' && typeof p.projectDir === 'string' && p.projectDir.length > 0) {
            projectDir = p.projectDir;
          }
        } catch {
          projectDir = undefined;
        }
        if (!projectDir) {
          res.writeHead(400).end('invalid dir');
          return;
        }
        const result: InspectResult = commands.inspect
          ? await commands.inspect(expandTilde(projectDir))
          : { isKindlingProject: false, installedBmadVersion: null };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(result));
        return;
      }
      if (pathname === '/cancel') {
        commands.cancel();
        res.writeHead(202).end();
        return;
      }
      if (pathname === '/ack') {
        // The Welcome screen rendered — let the host exit the ephemeral server. Respond first so
        // the ack completes even if onWelcomeAck closes the server synchronously.
        res.writeHead(202).end();
        onWelcomeAck?.();
        return;
      }
      if (pathname === '/retry') {
        let body: string;
        try {
          body = await readBody(req);
        } catch {
          res.writeHead(413).end('body too large');
          return;
        }
        let step: string | undefined;
        try {
          step = (JSON.parse(body || '{}') as { step?: string }).step;
        } catch {
          step = undefined;
        }
        if (!step || !KNOWN_STEPS.has(step)) {
          res.writeHead(400).end('invalid step');
          return;
        }
        res.writeHead(202).end();
        void Promise.resolve(commands.retry(step as StepId)).catch(() => {});
        return;
      }
    }

    if (req.method === 'GET' && uiDir) {
      await serveStatic(uiDir, pathname, res);
      return;
    }

    res.writeHead(404).end('not found');
  };

  const server = createHttpServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end('server error');
      else res.destroy();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    server,
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const res of sseClients) res.end(); // SSE keeps sockets alive — close them first
        sseClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections(); // terminate any remaining keep-alive sockets (Node 18.2+)
      }),
  };
}
