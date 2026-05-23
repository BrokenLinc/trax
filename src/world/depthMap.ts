import { MODE7_DEFAULTS } from '../mode7Defaults.ts';
import { fbm2D, makeNoise2D, type Noise2D } from './noise.ts';
import { deriveSeed } from './rng.ts';

export interface DepthMapParams {
  /** World scale: lower = larger features. */
  frequency: number;
  /** Vertical exaggeration applied to the noise output. */
  amplitude: number;
  /** FBM octaves. */
  octaves: number;
  /** FBM lacunarity (frequency growth per octave). */
  lacunarity: number;
  /** FBM gain (amplitude shrink per octave). */
  gain: number;
  /**
   * Pulls the road centerline toward Y = 0 (1 = flat datum at centre).
   * Asphalt columns −1, 0, +1 share the centerline height.
   */
  roadDatumPull: number;
  /**
   * Columns beyond the asphalt band (|col| > 1) over which height eases from
   * the centerline to natural terrain. 0 jumps to natural at |col| = 2.
   */
  shoulderBlendColumns: number;
}

/** @see MODE7_DEFAULTS.depth in `src/mode7Defaults.ts` */
export const DEFAULT_DEPTH_PARAMS: DepthMapParams = MODE7_DEFAULTS.depth;

/**
 * Samples the world's height field at integer (row, col) lattice positions.
 * Pure function of (seed, params, row, col) — same inputs always yield the
 * same Y. The renderer rebuilds the mesh window from this each frame.
 *
 * `col` is centred on zero: negative values are left of the road centre,
 * positive are right. `row` is unbounded (the road is conceptually infinite).
 */
export class DepthMap {
  private readonly noise: Noise2D;
  constructor(
    private readonly seed: string,
    private params: DepthMapParams = DEFAULT_DEPTH_PARAMS,
  ) {
    this.noise = makeNoise2D(deriveSeed(seed, 'depth'));
  }

  setParams(params: DepthMapParams): void {
    this.params = params;
  }

  getParams(): DepthMapParams {
    return this.params;
  }

  getSeed(): string {
    return this.seed;
  }

  /** Height at a single lattice point. */
  sample(row: number, col: number): number {
    const p = this.params;
    const rawAtCol = this.rawFbm(row, col);
    const natural = rawAtCol * p.amplitude;
    const centerline = this.rawFbm(row, 0) * p.amplitude * (1 - p.roadDatumPull);

    if (Math.abs(col) <= 1) return centerline;

    const dist = Math.abs(col) - 1;
    const t = p.shoulderBlendColumns <= 0 ? 1 : Math.min(1, dist / p.shoulderBlendColumns);
    const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
    return centerline + ease * (natural - centerline);
  }

  /**
   * Bilinear sample at a fractional row/col (used for the player's
   * vertical position when they are between integer rows).
   */
  sampleBilinear(row: number, col: number): number {
    const r0 = Math.floor(row);
    const c0 = Math.floor(col);
    const fr = row - r0;
    const fc = col - c0;
    const a = this.sample(r0, c0);
    const b = this.sample(r0 + 1, c0);
    const c = this.sample(r0, c0 + 1);
    const d = this.sample(r0 + 1, c0 + 1);
    return a * (1 - fr) * (1 - fc) + b * fr * (1 - fc) + c * (1 - fr) * fc + d * fr * fc;
  }

  private rawFbm(row: number, col: number): number {
    const p = this.params;
    return fbm2D(this.noise, row * p.frequency, col * p.frequency, {
      octaves: p.octaves,
      lacunarity: p.lacunarity,
      gain: p.gain,
    });
  }
}
