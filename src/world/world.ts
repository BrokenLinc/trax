import { BendField, DEFAULT_BEND_PARAMS, type BendFieldParams } from './bendField.ts';
import { DepthMap, DEFAULT_DEPTH_PARAMS, type DepthMapParams } from './depthMap.ts';

export interface WorldParams {
  depth: DepthMapParams;
  bend: BendFieldParams;
}

export const DEFAULT_WORLD_PARAMS: WorldParams = {
  depth: DEFAULT_DEPTH_PARAMS,
  bend: DEFAULT_BEND_PARAMS,
};

/**
 * The world is the combined read-only API the renderer talks to. It owns
 * the two procedural channels (depth + bend), keyed by a single string seed
 * so that snapshotting and reproducing a scene only needs `(seed, distance)`.
 *
 * `depth` and `bend` are swapped wholesale on `reseed` so that holding a
 * reference to the World remains stable, while the underlying samplers are
 * rebuilt for the new seed.
 */
export class World {
  depth: DepthMap;
  bend: BendField;

  constructor(
    private seed: string,
    params: WorldParams = DEFAULT_WORLD_PARAMS,
  ) {
    this.depth = new DepthMap(seed, params.depth);
    this.bend = new BendField(seed, params.bend);
  }

  getSeed(): string {
    return this.seed;
  }

  reseed(seed: string): void {
    this.seed = seed;
    this.depth = new DepthMap(seed, this.depth.getParams());
    this.bend = new BendField(seed, this.bend.getParams());
  }

  getParams(): WorldParams {
    return { depth: this.depth.getParams(), bend: this.bend.getParams() };
  }
}
