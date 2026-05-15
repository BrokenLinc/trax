import { makeNoise2D, type Noise2D } from './noise.ts';
import { deriveSeed } from './rng.ts';

export interface BendFieldParams {
  /** World scale along the road for bend variation. */
  frequency: number;
  /**
   * Maximum per-row sideways shift contributed by a single row.
   * Larger values mean tighter curves; small values are subtle drifts.
   */
  amplitude: number;
  /**
   * Optional secondary octave at higher frequency, mixed at this weight.
   * Useful for adding fine wobble on top of broad sweeping curves.
   */
  detailWeight: number;
  detailFrequency: number;
}

export const DEFAULT_BEND_PARAMS: BendFieldParams = {
  // Longer sweeping curves with a small amplitude — gentle winding rather
  // than switchbacks. Per-row slope is the dominant turbulence knob.
  frequency: 0.006,
  amplitude: 0.18,
  detailWeight: 0.05,
  detailFrequency: 0.08,
};

/**
 * The 1D bend channel: one signed value per integer row index. Renderer
 * accumulates these outward from the player row to produce per-row X
 * offsets — see `src/render/bendMath.ts` for the cumulative semantics.
 *
 * Pure function of (seed, params, row).
 */
export class BendField {
  private readonly noise: Noise2D;
  constructor(
    private readonly seed: string,
    private params: BendFieldParams = DEFAULT_BEND_PARAMS,
  ) {
    // 2D noise sampled along a single axis avoids the periodic artefacts
    // that show up in some 1D simplex implementations.
    this.noise = makeNoise2D(deriveSeed(seed, 'bend'));
  }

  setParams(params: BendFieldParams): void {
    this.params = params;
  }

  getParams(): BendFieldParams {
    return this.params;
  }

  getSeed(): string {
    return this.seed;
  }

  /** Signed per-row sideways delta (in world units) for integer `row`. */
  sample(row: number): number {
    const p = this.params;
    const broad = this.noise(row * p.frequency, 0);
    const detail = this.noise(row * p.detailFrequency, 17.31);
    return p.amplitude * (broad + p.detailWeight * detail);
  }

  /** Bake a contiguous range [rowStart, rowStart + count) into a Float32Array. */
  bake(rowStart: number, count: number, out?: Float32Array): Float32Array {
    const buf = out && out.length >= count ? out : new Float32Array(count);
    for (let i = 0; i < count; i++) buf[i] = this.sample(rowStart + i);
    return buf;
  }
}
