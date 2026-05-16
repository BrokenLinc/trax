import { bootstrap } from './app.ts';

/**
 * URL params:
 *   ?seed=<string>      world seed (default "mode7")
 *   ?distance=<number>  initial distance along the road (default 0)
 *   ?headless=1         disable rAF; advance only via window.__MODE7__.tick()
 *   ?noTopdown=1        skip inset top-down pass (debug chase-only viewport).
 *
 * Headless mode is what the snapshot/introspect/perf scripts use to drive
 * the demo deterministically from Playwright.
 */
function readParams(): {
  seed: string;
  distance: number;
  headless: boolean;
  skipTopdown: boolean;
} {
  const url = new URL(window.location.href);
  const seed = url.searchParams.get('seed') ?? 'mode7';
  const distanceRaw = url.searchParams.get('distance');
  const distance = distanceRaw === null ? 0 : Number(distanceRaw);
  const headless = url.searchParams.get('headless') === '1';
  const skipTopdown = url.searchParams.get('noTopdown') === '1';
  return {
    seed,
    distance: Number.isFinite(distance) ? distance : 0,
    headless,
    skipTopdown,
  };
}

const container = document.getElementById('app');
if (!container) {
  throw new Error('mode7b: missing #app container in index.html');
}

const params = readParams();
bootstrap({
  container,
  seed: params.seed,
  initialDistance: params.distance,
  headless: params.headless,
  skipTopdown: params.skipTopdown,
});
