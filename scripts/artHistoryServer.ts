/**
 * Local viewer for `art-history/`. Serves the page, the catalog, the PNGs,
 * and a server-sent event when the folder changes.
 *
 *   pnpm art-history
 */
import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { readCatalog, resolveMediaPath, type HistoryCatalog } from './artHistoryCatalog.ts';

const ROOT = resolve('art-history');
const PAGE = resolve('art-viewer/index.html');
const HOST = '127.0.0.1';
const PORT = 5190;
const REFRESH_MS = 200;

const clients = new Set<ServerResponse>();
let lastCatalog: HistoryCatalog = { rounds: [] };
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let watcher: FSWatcher | undefined;

async function catalog(): Promise<HistoryCatalog> {
  try {
    lastCatalog = await readCatalog(ROOT);
  } catch (err) {
    console.error('[art-history] catalog read failed', err);
  }
  return lastCatalog;
}

function toApi(history: HistoryCatalog): unknown {
  return {
    rounds: history.rounds.map((round) => ({
      folder: round.folder,
      title: round.title,
      when: round.when,
      seed: round.seed,
      distances: round.distances,
      frame: round.frame,
      target: round.target,
      summary: round.summary,
      images: round.images.map((image) => ({
        file: image.file,
        src: `/media/${encodeURIComponent(round.folder)}/${encodeURIComponent(image.file)}?v=${Math.round(image.mtimeMs)}`,
        distance: image.distance,
        prose: image.prose,
        scores: image.scores,
      })),
    })),
  };
}

function broadcast(): void {
  const payload = 'event: update\ndata: refresh\n\n';
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function scheduleRefresh(): void {
  if (refreshTimer !== undefined) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    broadcast();
  }, REFRESH_MS);
}

function pathnameOf(req: IncomingMessage): string {
  return new URL(req.url ?? '/', `http://${HOST}`).pathname;
}

function mediaParts(pathname: string): { folder: string; file: string } | null {
  const rest = pathname.slice('/media/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash !== rest.lastIndexOf('/')) return null;
  try {
    return {
      folder: decodeURIComponent(rest.slice(0, slash)),
      file: decodeURIComponent(rest.slice(slash + 1)),
    };
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function sendPage(res: ServerResponse): Promise<void> {
  const html = await readFile(PAGE);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

async function sendMedia(res: ServerResponse, folder: string, file: string): Promise<void> {
  const full = resolveMediaPath(ROOT, folder, file);
  if (!full) {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  try {
    const png = await readFile(full);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    });
    res.end(png);
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

function sendEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    res.end();
    return;
  }

  const pathname = pathnameOf(req);
  if (pathname === '/' || pathname === '/index.html') {
    await sendPage(res);
    return;
  }
  if (pathname === '/api/history') {
    send(res, 200, JSON.stringify(toApi(await catalog())), 'application/json; charset=utf-8');
    return;
  }
  if (pathname === '/events') {
    sendEvents(req, res);
    return;
  }
  if (pathname.startsWith('/media/')) {
    const parts = mediaParts(pathname);
    if (!parts) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    await sendMedia(res, parts.folder, parts.file);
    return;
  }
  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
}

function listen(): void {
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      console.error('[art-history]', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : 'listen failed';
    console.error('[art-history]', message);
    process.exit(1);
  });

  try {
    watcher = watch(ROOT, { recursive: true }, () => {
      scheduleRefresh();
    });
    watcher.on('error', (err: unknown) => {
      console.error('[art-history] watch failed', err);
    });
  } catch (err) {
    console.error('[art-history] watch failed', err);
  }

  const shutdown = (): void => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    watcher?.close();
    for (const client of clients) client.end();
    clients.clear();
    server.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(PORT, HOST, () => {
    console.info(`[art-history] http://${HOST}:${PORT}`);
  });
}

listen();
