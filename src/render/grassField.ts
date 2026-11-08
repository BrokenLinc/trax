import * as THREE from 'three';

import type { World } from '../world/world.ts';
import { VALLEY_DROP_M } from '../world/scenery.ts';
import type { BakedChunk } from './chunkBaker.ts';
import { cumulativeOffsetAt } from './bendMath.ts';
import { meshLateralBounds, signedColFromWorldX } from './meshLattice.ts';

/** Past the dirt easement. Matches the ground-tile takeover in the terrain shader. */
export const GRASS_CLEARANCE_M = 16;

/** How far from the centreline the field is scattered. Farther than this is fog. */
const GRASS_REACH_M = 150;

const STEP_M = 1.25;
const SINK_M = 0.16;

const TUFT_W = 32;
const TUFT_H = 48;

/**
 * A clump of a few chunky blades, roots on the bottom row. Nearest-filtered
 * and alpha-tested so the field reads as pixels, not a soft fur.
 */
export function createGrassTuftTexture(): THREE.DataTexture {
  const data = new Uint8Array(TUFT_W * TUFT_H * 4);
  const blades: Array<{ x: number; h: number; lean: number; rgb: [number, number, number] }> = [
    { x: 3, h: 26, lean: 0, rgb: [58, 104, 46] },
    { x: 7, h: 40, lean: 1, rgb: [74, 118, 52] },
    { x: 12, h: 18, lean: -1, rgb: [96, 132, 58] },
    { x: 16, h: 44, lean: 0, rgb: [46, 88, 38] },
    { x: 21, h: 30, lean: 1, rgb: [68, 110, 44] },
    { x: 26, h: 22, lean: -1, rgb: [112, 128, 62] },
    { x: 29, h: 34, lean: 0, rgb: [52, 96, 42] },
  ];
  for (const blade of blades) {
    for (let y = 0; y < blade.h; y++) {
      const lean = Math.round((y / blade.h) * blade.lean * 3);
      const x = blade.x + lean;
      const tip = y > blade.h - 4;
      const rgb: [number, number, number] = tip ? [132, 124, 72] : blade.rgb;
      plot(data, x, y, rgb);
      if (y < blade.h - 6) plot(data, x + 1, y, rgb);
    }
  }
  const tex = new THREE.DataTexture(data, TUFT_W, TUFT_H);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function plot(data: Uint8Array, x: number, y: number, rgb: [number, number, number]): void {
  if (x < 0 || x >= TUFT_W || y < 0 || y >= TUFT_H) return;
  const i = (y * TUFT_W + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

export function createGrassMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexColors: true,
    depthWrite: true,
  });
}

/** Chance a cell becomes a tuft. Valleys are a carpet; ridges stay thin under the pines. */
export function grassKeepChance(groundY: number, roadY: number): number {
  if (roadY - groundY >= VALLEY_DROP_M) return 0.96;
  if (groundY > roadY + 8) return 0.34;
  return 0.84;
}

export interface GrassGround {
  at(row: number, localX: number): number;
  roadAt(row: number): number;
}

export interface GrassTuft {
  /** Metres right of the centreline, before the chunk's bend offset. */
  localX: number;
  row: number;
  height: number;
  width: number;
  flip: boolean;
  tint: number;
}

const TINTS = [0xffffff, 0xd5e6c4, 0xf0e2b8, 0xc5d6b0] as const;

export function grassPlacements(opts: {
  seed: string;
  rowStart: number;
  rowEnd: number;
  rowSpacing: number;
  roadColSpacing: number;
  landscapeColSpacing: number;
  maxX: number;
  ground: GrassGround;
}): GrassTuft[] {
  const reach = Math.min(GRASS_REACH_M, opts.maxX);
  if (reach <= GRASS_CLEARANCE_M) return [];
  const salt = seedSalt(opts.seed);
  const length = (opts.rowEnd - opts.rowStart) * opts.rowSpacing;
  const out: GrassTuft[] = [];
  let iz = 0;
  for (let z = STEP_M * 0.5; z < length; z += STEP_M) {
    const row = opts.rowStart + z / opts.rowSpacing;
    const roadY = opts.ground.roadAt(row);
    const xOrigin = GRASS_CLEARANCE_M + (iz % 2) * (STEP_M * 0.5);
    for (let x = xOrigin; x <= reach; x += STEP_M) {
      for (const side of [-1, 1] as const) {
        const cell = hash(iz, Math.round(x * 4) * side, salt);
        const jx = (hash(iz, side * 13 + Math.round(x), salt + 1) - 0.5) * STEP_M * 0.85;
        const jz = (hash(iz + 3, side * 29 + Math.round(x), salt + 2) - 0.5) * STEP_M * 0.85;
        const localX = side * x + jx;
        if (Math.abs(localX) < GRASS_CLEARANCE_M) continue;
        const tuftRow = row + jz / opts.rowSpacing;
        if (tuftRow < opts.rowStart || tuftRow >= opts.rowEnd) continue;
        const groundY = opts.ground.at(tuftRow, localX);
        if (cell > grassKeepChance(groundY, roadY)) continue;
        const hRand = hash(iz, side * 7 + Math.round(localX), salt + 4);
        const height = 0.48 + hRand * 0.7;
        out.push({
          localX,
          row: tuftRow,
          height,
          width: height * (1.15 + hRand * 0.55),
          flip: hash(iz, side, salt + 5) < 0.5,
          tint: TINTS[Math.floor(hash(iz, side * 3, salt + 6) * TINTS.length)] ?? 0xffffff,
        });
      }
    }
    iz += 1;
  }
  return out;
}

/**
 * +Z-facing tuft quads in the chunk's local frame, so they inherit the
 * chunk's bend and the world-root shear. Empty when the mesh does not
 * reach past the dirt shoulder.
 */
export function bakeGrassGeometry(
  world: World,
  baked: BakedChunk,
  params: {
    cols: number;
    rowSpacing: number;
    roadColSpacing: number;
    landscapeColSpacing: number;
  },
): THREE.BufferGeometry | null {
  const bounds = meshLateralBounds(params.cols, params.roadColSpacing, params.landscapeColSpacing);
  const cache = new Map<number, number>();
  const sample = (row: number, col: number): number => {
    const r = Math.floor(row);
    const c = Math.floor(col);
    const key = (r + 8192) * 16384 + (c + 8192);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const y = world.depth.sample(r, c);
    cache.set(key, y);
    return y;
  };
  const ground: GrassGround = {
    roadAt: (row) => sample(row, 0),
    at: (row, localX) => {
      const col = signedColFromWorldX(localX, params.roadColSpacing, params.landscapeColSpacing);
      const c0 = Math.floor(col);
      const cx = col - c0;
      const r0 = Math.floor(row);
      const ry = row - r0;
      const y00 = sample(r0, c0);
      const y10 = sample(r0, c0 + 1);
      const y01 = sample(r0 + 1, c0);
      const y11 = sample(r0 + 1, c0 + 1);
      const y0 = y00 + (y10 - y00) * cx;
      const y1 = y01 + (y11 - y01) * cx;
      return y0 + (y1 - y0) * ry;
    },
  };
  const tufts = grassPlacements({
    seed: world.getSeed(),
    rowStart: baked.rowStart,
    rowEnd: baked.rowEnd,
    rowSpacing: params.rowSpacing,
    roadColSpacing: params.roadColSpacing,
    landscapeColSpacing: params.landscapeColSpacing,
    maxX: bounds.maxX,
    ground,
  });
  if (tufts.length === 0) return null;

  const positions = new Float32Array(tufts.length * 4 * 3);
  const uvs = new Float32Array(tufts.length * 4 * 2);
  const colors = new Float32Array(tufts.length * 4 * 3);
  const indices = new Uint32Array(tufts.length * 6);
  tufts.forEach((tuft, i) => {
    const phi = cumulativeOffsetAt(tuft.row, baked.rowStart, baked.bends, baked.prefix);
    const x = tuft.localX + phi;
    const y = ground.at(tuft.row, tuft.localX);
    const z = -(tuft.row - baked.rowStart) * params.rowSpacing;
    const hw = tuft.width * 0.5;
    const left = tuft.flip ? hw : -hw;
    const right = tuft.flip ? -hw : hw;
    const base = i * 12;
    writeCorner(positions, base, x + left, y - SINK_M, z);
    writeCorner(positions, base + 3, x + right, y - SINK_M, z);
    writeCorner(positions, base + 6, x + right, y - SINK_M + tuft.height, z);
    writeCorner(positions, base + 9, x + left, y - SINK_M + tuft.height, z);
    const uv = i * 8;
    uvs[uv] = 0;
    uvs[uv + 1] = 0;
    uvs[uv + 2] = 1;
    uvs[uv + 3] = 0;
    uvs[uv + 4] = 1;
    uvs[uv + 5] = 1;
    uvs[uv + 6] = 0;
    uvs[uv + 7] = 1;
    const tint = new THREE.Color(tuft.tint);
    for (let c = 0; c < 4; c++) {
      colors[i * 12 + c * 3] = tint.r;
      colors[i * 12 + c * 3 + 1] = tint.g;
      colors[i * 12 + c * 3 + 2] = tint.b;
    }
    const v = i * 4;
    const k = i * 6;
    indices[k] = v;
    indices[k + 1] = v + 1;
    indices[k + 2] = v + 2;
    indices[k + 3] = v;
    indices[k + 4] = v + 2;
    indices[k + 5] = v + 3;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function writeCorner(out: Float32Array, offset: number, x: number, y: number, z: number): void {
  out[offset] = x;
  out[offset + 1] = y;
  out[offset + 2] = z;
}

function seedSalt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash(a: number, b: number, salt: number): number {
  let x = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ salt;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
