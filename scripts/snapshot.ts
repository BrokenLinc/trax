import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureArtifactsDir, parseArgs, withPreviewPage } from './_runtime.ts';

/**
 * Capture a deterministic PNG of the current render at (seed, distance).
 *
 *   pnpm snapshot --seed mode7 --distance 120 [--out path.png] [--warmup 4]
 *
 * Companion JSON dump (same basename + .json) records bend/depth state so a
 * diff can pinpoint whether a rendering change is geometric or visual.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seed = args['seed'] ?? 'mode7';
  const distance = Number(args['distance'] ?? '0');
  const warmup = Number(args['warmup'] ?? '2');
  const dir = await ensureArtifactsDir();
  const outPng = args['out'] ?? resolve(dir, `snapshot-${safe(seed)}-${distance}.png`);
  const outJson = outPng.replace(/\.png$/i, '.json');

  await withPreviewPage({ seed, distance }, async (_page, mode7) => {
    await mode7.setDistance(distance);
    for (let i = 0; i < warmup; i++) await mode7.tick(1, 1 / 60);
    const dataUrl = await mode7.screenshot();
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    await writeFile(outPng, Buffer.from(b64, 'base64'));
    const state = await mode7.getState();
    const mesh = await mode7.dumpMesh();
    const world = await mode7.dumpWorld();
    await writeFile(outJson, JSON.stringify({ state, mesh, world }, null, 2));
    console.info(`[snapshot] ${outPng}`);
    console.info(`[snapshot] ${outJson}`);
  });
}

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
