import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureArtifactsDir, parseArgs, withPreviewPage } from './_runtime.ts';

/**
 * Print (or save) a JSON dump of world + mesh state at (seed, distance).
 * Lets agents reason about geometry changes without reading pixels.
 *
 *   pnpm introspect --seed mode7 --distance 120
 *   pnpm introspect --seed mode7 --distance 120 --out artifacts/dump.json
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seed = args['seed'] ?? 'mode7';
  const distance = Number(args['distance'] ?? '0');
  const ahead = Number(args['ahead'] ?? '32');
  const behind = Number(args['behind'] ?? '8');

  await withPreviewPage({ seed, distance }, async (_page, mode7) => {
    await mode7.setDistance(distance);
    await mode7.tick(2, 1 / 60);
    const state = await mode7.getState();
    const mesh = await mode7.dumpMesh();
    const world = await mode7.dumpWorld({ rowsAhead: ahead, rowsBehind: behind });
    const payload = JSON.stringify({ state, mesh, world }, null, 2);
    if (args['out']) {
      const dir = await ensureArtifactsDir();
      const out = resolve(dir, args['out']);
      await writeFile(out, payload);
      console.info(`[introspect] ${out}`);
    } else {
      process.stdout.write(payload + '\n');
    }
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
