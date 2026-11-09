import { createRng, deriveSeed } from './rng.ts';
import { makeNoise2D, type Noise2D } from './noise.ts';

export type SceneryKind = 'shrub' | 'bloom' | 'flowers' | 'post' | 'rock';

/** How many baked hue stops each kind has. A patch shares one index. */
export const HUE_STOPS: Record<SceneryKind, number> = {
  shrub: 3,
  bloom: 3,
  flowers: 3,
  post: 1,
  rock: 1,
};

export interface SceneryInstance {
  kind: SceneryKind;
  /** Absolute world row. The sprite sits on this row's depth sample. */
  row: number;
  /** Metres right of the centreline, before the bend offset is applied. */
  localX: number;
  /** Sprite height in metres. */
  height: number;
  /** Mirror the card on X. The plane still faces world +Z. */
  flip: boolean;
  /** Index into this kind's hue stops. A grove shares one value. */
  hue: number;
}

/** Ground height in metres at a row and a road-local X. */
export interface SceneryHeight {
  at(row: number, localX: number): number;
}

/** Nothing is allowed inside this distance of the centreline. */
export const SCENERY_CLEARANCE_M = 8;

/** A spot this far below the road is a valley floor. Grass carpets it; the forest does too. */
export const VALLEY_DROP_M = 6;

const SHOULDER_MAX_M = 28;
const forestNoise = new Map<string, Noise2D>();

function noiseFor(seed: string): Noise2D {
  const hit = forestNoise.get(seed);
  if (hit) return hit;
  const noise = makeNoise2D(deriveSeed(seed, 'forest'));
  forestNoise.set(seed, noise);
  return noise;
}

function unit(noise: Noise2D, x: number, y: number): number {
  return noise(x, y) * 0.5 + 0.5;
}

function hueIndex(value: number, stops: number): number {
  if (stops <= 1) return 0;
  const i = Math.floor(value * stops);
  return i >= stops ? stops - 1 : i;
}

/** Stand height, then a small individual jitter that cannot drop below `min`. */
function standHeight(min: number, max: number, stand: number, jitter: number): number {
  const span = max - min;
  const base = min + stand * span;
  const wobble = (jitter - 0.5) * span * 0.18;
  return Math.max(min, base + wobble);
}

interface Plant {
  kind: SceneryKind;
  localX: number;
  height: number;
  hue: number;
}

/**
 * Shoulder props for one integer row. Trees live in the chunk-baked forest.
 * Shrubs, flowers, posts, and rocks stay here, off the asphalt.
 */
export function sceneryForRow(
  seed: string,
  row: number,
  _height: SceneryHeight,
): SceneryInstance[] {
  void _height;
  const rng = createRng(deriveSeed(seed, `scenery:${row}`));
  const noise = noiseFor(seed);
  const plants: Plant[] = [];

  for (const side of [-1, 1] as const) {
    const shrubStand = unit(noise, row * 0.05, side * 3.2);
    if (unit(noise, row * 0.09, side * 3.2) > 0.4) {
      plants.push({
        kind: 'shrub',
        localX:
          side * (SCENERY_CLEARANCE_M + 0.6 + rng() * (SHOULDER_MAX_M - SCENERY_CLEARANCE_M - 0.6)),
        height: standHeight(0.5, 2.2, shrubStand, rng()),
        hue: hueIndex(shrubStand, HUE_STOPS.shrub),
      });
    }

    const flowerStand = unit(noise, row * 0.045, side * 7.2);
    if (flowerStand > 0.64) {
      plants.push({
        kind: 'flowers',
        localX: side * (SCENERY_CLEARANCE_M + 1 + rng() * 22),
        height: standHeight(0.45, 0.9, flowerStand, rng()),
        hue: hueIndex(flowerStand, HUE_STOPS.flowers),
      });
    }

    const bloomStand = unit(noise, row * 0.03, side * 9.4);
    if (bloomStand > 0.73) {
      plants.push({
        kind: 'bloom',
        localX: side * (SCENERY_CLEARANCE_M + 2 + rng() * 16),
        height: standHeight(0.7, 1.8, bloomStand, rng()),
        hue: hueIndex(bloomStand, HUE_STOPS.bloom),
      });
    }
  }

  if (rng() < 0.03) {
    const side = rng() < 0.5 ? -1 : 1;
    const kind: SceneryKind = rng() < 0.55 ? 'post' : 'rock';
    plants.push({
      kind,
      localX: side * (SCENERY_CLEARANCE_M + 0.4 + rng() * 6),
      height: kind === 'post' ? 1.1 + rng() * 0.35 : 0.55 + rng() * 0.6,
      hue: 0,
    });
  }

  return plants.map((plant) => ({
    kind: plant.kind,
    row,
    localX: plant.localX,
    height: plant.height,
    flip: plant.kind === 'post' || plant.kind === 'rock' ? false : rng() < 0.5,
    hue: plant.hue,
  }));
}

export function sceneryInRange(
  seed: string,
  rowStart: number,
  rowEnd: number,
  height: SceneryHeight,
): SceneryInstance[] {
  const out: SceneryInstance[] = [];
  const a = Math.ceil(Math.min(rowStart, rowEnd));
  const b = Math.floor(Math.max(rowStart, rowEnd));
  for (let row = a; row <= b; row++) {
    for (const inst of sceneryForRow(seed, row, height)) out.push(inst);
  }
  return out;
}

/** Flat ground. Tests and a missing depth sample use this. */
export function flatHeight(y = 0): SceneryHeight {
  return { at: () => y };
}
