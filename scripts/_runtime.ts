import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

import type { Mode7Inspector } from '../src/debug/inspector.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_URL = 'http://127.0.0.1:4173';

/**
 * Boot a Vite preview server (rebuilding `dist/` if missing), launch a
 * Playwright Chromium page in headless mode, and run `body` with that page.
 * Tears everything down on exit, even on failure.
 *
 * Headless flag (`?headless=1`) is appended automatically so the inspector's
 * `tick()` API drives the loop deterministically.
 */
export async function withPreviewPage<T>(
  args: { seed: string; distance: number; extraQuery?: string },
  body: (page: Page, mode7: Mode7Tunnel) => Promise<T>,
): Promise<T> {
  await ensureBuild();
  const server = await startPreviewServer();
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => {
      console.error('[page error]', err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.error(`[page ${msg.type()}]`, msg.text());
      }
    });
    const url = `${PREVIEW_URL}/?headless=1&seed=${encodeURIComponent(args.seed)}&distance=${args.distance}${args.extraQuery ?? ''}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__MODE7__?.ready), null, { timeout: 15_000 });
    return await body(page, makeTunnel(page));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    await server.exited;
  }
}

/**
 * Bridge that calls `__MODE7__` methods inside the page and returns their
 * results to Node. Each method is a thin wrapper around `page.evaluate`.
 */
export interface Mode7Tunnel {
  getState(): Promise<ReturnType<Mode7Inspector['getState']>>;
  setSeed(seed: string): Promise<void>;
  setDistance(d: number): Promise<void>;
  setSpeed(s: number): Promise<void>;
  tick(frames?: number, dt?: number): Promise<void>;
  dumpMesh(): Promise<ReturnType<Mode7Inspector['dumpMesh']>>;
  dumpWorld(opts?: {
    rowsAhead?: number;
    rowsBehind?: number;
  }): Promise<ReturnType<Mode7Inspector['dumpWorld']>>;
  screenshot(): Promise<string>;
  /** Run `frames` ticks back-to-back and return the per-tick wall-time in ms. */
  benchmark(frames: number, dt?: number): Promise<number[]>;
}

function makeTunnel(page: Page): Mode7Tunnel {
  return {
    getState: () => page.evaluate(() => window.__MODE7__!.getState()),
    setSeed: (seed) => page.evaluate((s) => window.__MODE7__!.setSeed(s), seed),
    setDistance: (d) => page.evaluate((v) => window.__MODE7__!.setDistance(v), d),
    setSpeed: (s) => page.evaluate((v) => window.__MODE7__!.setSpeed(v), s),
    tick: (frames = 1, dt = 1 / 60) =>
      page.evaluate((args) => window.__MODE7__!.tick(args.frames, args.dt), { frames, dt }),
    dumpMesh: () => page.evaluate(() => window.__MODE7__!.dumpMesh()),
    dumpWorld: (opts) =>
      page.evaluate((o) => window.__MODE7__!.dumpWorld(o ?? undefined), opts ?? null),
    screenshot: () => page.evaluate(() => window.__MODE7__!.screenshot()),
    benchmark: (frames, dt = 1 / 60) =>
      page.evaluate(
        (args) => {
          const out: number[] = [];
          for (let i = 0; i < args.frames; i++) {
            const t0 = performance.now();
            window.__MODE7__!.tick(1, args.dt);
            out.push(performance.now() - t0);
          }
          return out;
        },
        { frames, dt },
      ),
  };
}

async function ensureBuild(): Promise<void> {
  // Always rebuild. Snapshot/introspect/perf serve `dist/` via `pnpm preview`,
  // and a stale `dist/` from a previous run produces extremely misleading
  // results (you edit source, run a snapshot, see no change, and chase a
  // phantom bug). The build is fast; pay the cost every invocation.
  const distIndex = resolve(ROOT, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    console.info('[runtime] dist/ missing — running `pnpm build`…');
  } else {
    console.info('[runtime] rebuilding dist/ to match current source…');
  }
  await run('pnpm', ['build']);
}

function startPreviewServer(): Promise<{
  kill: (sig: NodeJS.Signals) => boolean;
  exited: Promise<void>;
}> {
  return new Promise((resolveStart, reject) => {
    const child = spawn('pnpm', ['preview'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let resolved = false;
    const onData = (buf: Buffer): void => {
      const s = buf.toString();
      if (!resolved && /Local:\s+http/i.test(s)) {
        resolved = true;
        resolveStart({
          kill: (sig) => child.kill(sig),
          exited: waitForExit(child),
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!resolved) reject(new Error(`vite preview exited early with code ${code}`));
    });
    setTimeout(() => {
      if (!resolved) reject(new Error('vite preview did not start within 30s'));
    }, 30_000);
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((res) => {
    if (child.exitCode !== null) {
      res();
      return;
    }
    child.once('exit', () => res());
  });
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} → ${code}`)),
    );
    child.on('error', rej);
  });
}

export async function ensureArtifactsDir(): Promise<string> {
  const dir = resolve(ROOT, 'artifacts');
  await mkdir(dir, { recursive: true });
  return dir;
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const eq = k.indexOf('=');
      if (eq >= 0) {
        out[k.slice(0, eq)] = k.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          out[k] = next;
          i++;
        } else {
          out[k] = 'true';
        }
      }
    }
  }
  return out;
}
