import { createRng, deriveSeed } from './rng.ts';
import { makeNoise2D, type Noise2D } from './noise.ts';

export type SceneryKind = 'broadleaf' | 'pine' | 'shrub' | 'post' | 'rock';

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
}

/** Nothing is allowed inside this distance of the centreline. */
export const SCENERY_CLEARANCE_M = 8;

const TREE_CLEARANCE_M = 11;

const forestNoise = new Map<string, Noise2D>();

function noiseFor(seed: string): Noise2D {
  const hit = forestNoise.get(seed);
  if (hit) return hit;
  const noise = makeNoise2D(deriveSeed(seed, 'forest'));
  forestNoise.set(seed, noise);
  return noise;
}

/**
 * Props for one integer row. A low-frequency noise field decides how thick
 * the forest is, so groves clump instead of a coin flip on every row.
 * The row rng only jitters inside that field, so one row cannot reshuffle
 * the rest.
 */
export function sceneryForRow(seed: string, row: number): SceneryInstance[] {
  const rng = createRng(deriveSeed(seed, `scenery:${row}`));
  const noise = noiseFor(seed);
  const out: SceneryInstance[] = [];

  for (const side of [-1, 1] as const) {
    const cover = noise(row * 0.04, side * 2.4) * 0.5 + 0.5;
    const count = 1 + Math.floor(cover * 3);
    for (let i = 0; i < count; i++) {
      const clump = noise(row * 0.04, side * (5.5 + i * 1.7)) * 0.5 + 0.5;
      const dist = TREE_CLEARANCE_M + clump * 26 + rng() * 7;
      const kind: SceneryKind = rng() < 0.78 ? 'pine' : 'broadleaf';
      const tall = noise(row * 0.07 + i * 0.4, side * 9) * 0.5 + 0.5;
      const height = kind === 'pine' ? 14 + tall * 18 : 11 + tall * 10;
      out.push({
        kind,
        row,
        localX: side * dist,
        height,
        flip: rng() < 0.5,
      });
    }
  }

  if (rng() < 0.55) {
    const side = rng() < 0.5 ? -1 : 1;
    out.push({
      kind: 'shrub',
      row,
      localX: side * (SCENERY_CLEARANCE_M + 0.6 + rng() * 10),
      height: 1.25 + rng() * 1.15,
      flip: rng() < 0.5,
    });
  }

  if (rng() < 0.04) {
    const side = rng() < 0.5 ? -1 : 1;
    const kind: SceneryKind = rng() < 0.55 ? 'post' : 'rock';
    out.push({
      kind,
      row,
      localX: side * (SCENERY_CLEARANCE_M + 0.15 + rng() * 3.4),
      height: kind === 'post' ? 1.1 + rng() * 0.35 : 0.55 + rng() * 0.6,
      flip: false,
    });
  }

  return out;
}

export function sceneryInRange(seed: string, rowStart: number, rowEnd: number): SceneryInstance[] {
  const out: SceneryInstance[] = [];
  const a = Math.ceil(Math.min(rowStart, rowEnd));
  const b = Math.floor(Math.max(rowStart, rowEnd));
  for (let row = a; row <= b; row++) {
    for (const inst of sceneryForRow(seed, row)) out.push(inst);
  }
  return out;
}
