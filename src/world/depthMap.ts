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
   * Width of the road (in columns) over which depth is gently flattened
   * toward zero so the road surface stays drivable. 0 disables flattening.
   */
  roadFlatColumns: number;
  /** How aggressively to flatten near the road centre. */
  roadFlatStrength: number;
}

export const DEFAULT_DEPTH_PARAMS: DepthMapParams = {
  frequency: 0.04,
  amplitude: 1.5,
  octaves: 4,
  lacunarity: 2.1,
  gain: 0.5,
  roadFlatColumns: 5,
  roadFlatStrength: 0.85,
};

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
    const raw = fbm2D(this.noise, row * p.frequency, col * p.frequency, {
      octaves: p.octaves,
      lacunarity: p.lacunarity,
      gain: p.gain,
    });
    const flatten = roadFlattenFactor(col, p.roadFlatColumns, p.roadFlatStrength);
    return raw * p.amplitude * flatten;
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
}

/**
 * Returns a 0..1 multiplier that suppresses height near the road centre
 * so the player has a navigable surface. Cosine falloff over `width` columns
 * either side, scaled by `strength` (1 = full flatten at centre).
 */
function roadFlattenFactor(col: number, width: number, strength: number): number {
  if (width <= 0 || strength <= 0) return 1;
  const t = Math.min(1, Math.abs(col) / width);
  const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
  return 1 - strength * (1 - ease);
}
