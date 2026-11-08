import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ensureArtifactsDir, parseArgs, withPreviewPage } from './_runtime.ts';

/**
 * Capture a deterministic PNG of the current render at (seed, distance).
 *
 *   pnpm snapshot --seed mode7 --distance 120 [--out path.png] [--warmup 4]
 *   pnpm snapshot --seed mode7 --distances 0,120,280 --no-topdown --out-dir artifacts/art
 *
 * `--no-topdown` asks the page for a chase-only frame (`noTopdown=1` and
 * `noDebug=1`) so beauty shots are not composited with the inset or gizmos.
 *
 * Companion JSON dump (same basename + .json) records bend/depth state so a
 * diff can pinpoint whether a rendering change is geometric or visual.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seed = args['seed'] ?? 'mode7';
  const warmup = Number(args['warmup'] ?? '2');
  const distances = (args['distances'] ?? args['distance'] ?? '0')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
  if (distances.length === 0) throw new Error('snapshot: no finite distances');
  const noTopdown = args['no-topdown'] === 'true';
  const extraQuery = noTopdown ? '&noTopdown=1&noDebug=1' : '';
  const dir = await ensureArtifactsDir();
  const outDir = args['out-dir'];
  const first = distances[0] ?? 0;

  await withPreviewPage({ seed, distance: first, extraQuery }, async (_page, mode7) => {
    for (const distance of distances) {
      const outPng =
        distances.length === 1 && args['out']
          ? args['out']
          : resolve(outDir ?? dir, `snapshot-${safe(seed)}-${distance}.png`);
      const outJson = outPng.replace(/\.png$/i, '.json');
      await mode7.setDistance(distance);
      for (let i = 0; i < warmup; i++) await mode7.tick(1, 1 / 60);
      const time = args['time'];
      if (time !== undefined) await mode7.setTimeOfDay(Number(time));
      if (args['headlight'] === 'true') await mode7.setHeadlight(true);
      const dataUrl = await mode7.screenshot();
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      await mkdir(dirname(outPng), { recursive: true });
      await writeFile(outPng, Buffer.from(b64, 'base64'));
      const state = await mode7.getState();
      const mesh = await mode7.dumpMesh();
      const world = await mode7.dumpWorld();
      await writeFile(outJson, JSON.stringify({ state, mesh, world }, null, 2));
      console.info(`[snapshot] ${outPng}`);
      console.info(`[snapshot] ${outJson}`);
    }
  });
}

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
