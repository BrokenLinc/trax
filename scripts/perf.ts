import { parseArgs, withPreviewPage } from './_runtime.ts';

/**
 * Headless micro-benchmark: ticks the simulation as fast as possible and
 * reports per-frame wall time percentiles. This isn't a true FPS number
 * (no rAF, no vsync) but it IS a stable measure of sim+render cost that
 * agents can compare across edits.
 *
 *   pnpm perf --frames 600 --seed mode7 --distance 120
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seed = args['seed'] ?? 'mode7';
  const distance = Number(args['distance'] ?? '0');
  const frames = Number(args['frames'] ?? '600');
  const dt = Number(args['dt'] ?? `${1 / 60}`);
  const speed = Number(args['speed'] ?? '15');

  await withPreviewPage({ seed, distance }, async (_page, mode7) => {
    await mode7.setDistance(distance);
    await mode7.setSpeed(speed);
    // Warmup so JIT settles.
    await mode7.benchmark(60, dt);
    const samples = await mode7.benchmark(frames, dt);
    const sorted = [...samples].sort((a, b) => a - b);
    const pct = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = sum / samples.length;
    const report = {
      frames: samples.length,
      dtSeconds: dt,
      meanMs: round(mean, 4),
      p50Ms: round(pct(0.5), 4),
      p95Ms: round(pct(0.95), 4),
      p99Ms: round(pct(0.99), 4),
      maxMs: round(sorted[sorted.length - 1] ?? 0, 4),
      effectiveFps: round(1000 / mean, 1),
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  });
}

function round(n: number, p: number): number {
  const m = 10 ** p;
  return Math.round(n * m) / m;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
