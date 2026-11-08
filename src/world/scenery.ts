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

/** Ground height in metres at a row and a road-local X. */
export interface SceneryHeight {
  at(row: number, localX: number): number;
}

/** Nothing is allowed inside this distance of the centreline. */
export const SCENERY_CLEARANCE_M = 8;

/** Trees start outside the open shoulder. Grass and shrubs may sit closer. */
export const TREE_MIN_M = 34;

/** A spot this far below the road is a valley floor: no trees. */
export const VALLEY_DROP_M = 6;

const SHOULDER_MAX_M = 28;
const TREE_REACH_M = 150;

const forestNoise = new Map<string, Noise2D>();

function noiseFor(seed: string): Noise2D {
  const hit = forestNoise.get(seed);
  if (hit) return hit;
  const noise = makeNoise2D(deriveSeed(seed, 'forest'));
  forestNoise.set(seed, noise);
  return noise;
}

/**
 * Props for one integer row. The shoulder and the valley floors stay open.
 * Pines clump on the ridges and the outer slopes, with gaps so the hill
 * can show through. The row rng only jitters inside the noise field.
 */
export function sceneryForRow(seed: string, row: number, height: SceneryHeight): SceneryInstance[] {
  const rng = createRng(deriveSeed(seed, `scenery:${row}`));
  const noise = noiseFor(seed);
  const roadY = height.at(row, 0);
  const out: SceneryInstance[] = [];

  for (const side of [-1, 1] as const) {
    const grass = noise(row * 0.11, side * 3.1) * 0.5 + 0.5;
    if (grass > 0.62) {
      out.push({
        kind: 'shrub',
        row,
        localX:
          side * (SCENERY_CLEARANCE_M + 1 + rng() * (SHOULDER_MAX_M - SCENERY_CLEARANCE_M - 1)),
        height: 0.7 + rng() * 0.9,
        flip: rng() < 0.5,
      });
    }

    const cover = noise(row * 0.02, side * 1.3) * 0.5 + 0.5;
    if (cover < 0.42) continue;
    const count = cover > 0.78 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const clump = noise(row * 0.02, side * (4 + i * 2.2)) * 0.5 + 0.5;
      const dist = TREE_MIN_M + clump * TREE_REACH_M * 0.72 + rng() * 26;
      const localX = side * dist;
      const groundY = height.at(row, localX);
      if (groundY < roadY - VALLEY_DROP_M) {
        if (rng() < 0.22) {
          out.push({
            kind: 'shrub',
            row,
            localX,
            height: 0.85 + rng() * 0.7,
            flip: rng() < 0.5,
          });
        }
        continue;
      }
      const kind: SceneryKind = rng() < 0.78 ? 'pine' : 'broadleaf';
      const tall = noise(row * 0.05 + i * 0.4, side * 8) * 0.5 + 0.5;
      const treeHeight = kind === 'pine' ? 12 + tall * 16 : 10 + tall * 8;
      out.push({
        kind,
        row,
        localX,
        height: treeHeight,
        flip: rng() < 0.5,
      });
    }
  }

  if (rng() < 0.03) {
    const side = rng() < 0.5 ? -1 : 1;
    const kind: SceneryKind = rng() < 0.55 ? 'post' : 'rock';
    out.push({
      kind,
      row,
      localX: side * (SCENERY_CLEARANCE_M + 0.4 + rng() * 6),
      height: kind === 'post' ? 1.1 + rng() * 0.35 : 0.55 + rng() * 0.6,
      flip: false,
    });
  }

  return out;
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
