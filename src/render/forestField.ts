import * as THREE from 'three';

import type { World } from '../world/world.ts';
import { deriveSeed } from '../world/rng.ts';
import { makeNoise2D, type Noise2D } from '../world/noise.ts';
import type { BakedChunk } from './chunkBaker.ts';
import { cumulativeOffsetAt } from './bendMath.ts';
import { meshLateralBounds, signedColFromWorldX } from './meshLattice.ts';
import { loadColorTexture } from './loadTexture.ts';

/** Trees start just past the dirt shoulder, close enough that the road is not a corridor. */
export const FOREST_MIN_M = 18;

/** Past this the fog has already taken the hill. The mesh runs much farther. */
export const FOREST_REACH_M = 280;

/** Inside this band the woods stay thin so the view can enter the stand. */
export const FOREST_NEAR_M = 40;

const STEP_M = 14;

export type ForestKind = 'pine' | 'broadleaf' | 'cedar' | 'maple' | 'birch';

export const FOREST_KINDS: readonly ForestKind[] = ['pine', 'broadleaf', 'cedar', 'maple', 'birch'];

/** 1.5× the old roadside cards. A stand shares a size, then each tree jitters. */
export const FOREST_HEIGHT: Record<ForestKind, { min: number; max: number }> = {
  pine: { min: 14, max: 48 },
  broadleaf: { min: 14, max: 33 },
  cedar: { min: 15, max: 39 },
  maple: { min: 12, max: 27 },
  birch: { min: 12, max: 24 },
};

/** Degrees from the painted sprite. Maples run green through gold to red. */
export const FOREST_HUE: Record<ForestKind, { min: number; max: number }> = {
  pine: { min: -18, max: 18 },
  broadleaf: { min: -18, max: 18 },
  cedar: { min: -18, max: 18 },
  maple: { min: -110, max: 15 },
  birch: { min: -10, max: 10 },
};

const ASPECT: Record<ForestKind, number> = {
  pine: 49 / 112,
  broadleaf: 41 / 112,
  cedar: 53 / 120,
  maple: 71 / 112,
  birch: 46 / 120,
};

const SINK: Record<ForestKind, number> = {
  pine: 1.28,
  broadleaf: 1.65,
  cedar: 1.35,
  maple: 1.58,
  birch: 1.05,
};

const SPRITE_URL: Record<ForestKind, string> = {
  pine: '/sprites/tree-pine.png',
  broadleaf: '/sprites/tree-broadleaf.png',
  cedar: '/sprites/tree-cedar.png',
  maple: '/sprites/tree-maple.png',
  birch: '/sprites/tree-birch.png',
};

const forestNoise = new Map<string, Noise2D>();

export interface ForestTree {
  kind: ForestKind;
  localX: number;
  row: number;
  height: number;
  width: number;
  flip: boolean;
  /** Hue rotation in degrees, unique to this tree. */
  hue: number;
  /** Brightness multiply, kept near 1 so it does not repaint the hue. */
  shade: number;
}

export interface ForestGround {
  at(row: number, localX: number): number;
}

/** Chance a grid cell becomes a tree. Distance only: valleys are not thinned. */
export function forestKeepChance(distanceM: number): number {
  if (distanceM < FOREST_NEAR_M) return 0.32;
  return 0.88;
}

export function forestPlacements(opts: {
  seed: string;
  rowStart: number;
  rowEnd: number;
  rowSpacing: number;
  maxX: number;
}): ForestTree[] {
  const reach = Math.min(FOREST_REACH_M, opts.maxX);
  if (reach <= FOREST_MIN_M) return [];
  const noise = noiseFor(opts.seed);
  const salt = seedSalt(opts.seed);
  const length = (opts.rowEnd - opts.rowStart) * opts.rowSpacing;
  const out: ForestTree[] = [];
  let iz = 0;
  for (let z = STEP_M * 0.5; z < length; z += STEP_M) {
    const row = opts.rowStart + z / opts.rowSpacing;
    const xOrigin = FOREST_MIN_M + (iz % 2) * (STEP_M * 0.5);
    for (let x = xOrigin; x <= reach; x += STEP_M) {
      for (const side of [-1, 1] as const) {
        const cell = hash(iz, Math.round(x) * side, salt);
        if (cell > forestKeepChance(x)) continue;
        const jx = (hash(iz, side * 13 + Math.round(x), salt + 1) - 0.5) * STEP_M * 0.75;
        const jz = (hash(iz + 3, side * 29 + Math.round(x), salt + 2) - 0.5) * STEP_M * 0.75;
        const localX = side * x + jx;
        if (Math.abs(localX) < FOREST_MIN_M || Math.abs(localX) > reach) continue;
        const treeRow = row + jz / opts.rowSpacing;
        if (treeRow < opts.rowStart || treeRow >= opts.rowEnd) continue;
        const kind = kindAt(noise, treeRow, localX);
        const stand = unit(noise, treeRow * 0.005, localX * 0.003);
        const jitter = hash(iz, side * 7 + Math.round(localX), salt + 4);
        const limits = FOREST_HEIGHT[kind];
        const height = standHeight(limits.min, limits.max, stand, jitter);
        const hueSpan = FOREST_HUE[kind];
        const hueT = hash(iz, side * 17 + Math.round(localX * 3), salt + 8);
        const shadeT = hash(iz, side * 19 + Math.round(treeRow), salt + 9);
        out.push({
          kind,
          localX,
          row: treeRow,
          height,
          width: height * ASPECT[kind],
          flip: hash(iz, side, salt + 5) < 0.5,
          hue: hueSpan.min + hueT * (hueSpan.max - hueSpan.min),
          shade: 0.88 + shadeT * 0.24,
        });
      }
    }
    iz += 1;
  }
  return out;
}

/**
 * +Z cards in the chunk's local frame, split by species so each draw uses
 * one cutout. Empty species are omitted.
 */
export function bakeForestGeometries(
  trees: readonly ForestTree[],
  ground: ForestGround,
  bend: {
    rowStart: number;
    bends: ArrayLike<number>;
    prefix: Float32Array;
    rowSpacing: number;
  },
): Partial<Record<ForestKind, THREE.BufferGeometry>> {
  const grouped = new Map<ForestKind, ForestTree[]>();
  for (const tree of trees) {
    const list = grouped.get(tree.kind);
    if (list) list.push(tree);
    else grouped.set(tree.kind, [tree]);
  }
  const out: Partial<Record<ForestKind, THREE.BufferGeometry>> = {};
  for (const [kind, list] of grouped) {
    out[kind] = bakeKind(list, ground, bend);
  }
  return out;
}

export function bakeForestForChunk(
  world: World,
  baked: BakedChunk,
  params: {
    cols: number;
    rowSpacing: number;
    roadColSpacing: number;
    landscapeColSpacing: number;
  },
): Partial<Record<ForestKind, THREE.BufferGeometry>> {
  const bounds = meshLateralBounds(params.cols, params.roadColSpacing, params.landscapeColSpacing);
  const ground = chunkGround(world, params.roadColSpacing, params.landscapeColSpacing);
  const trees = forestPlacements({
    seed: world.getSeed(),
    rowStart: baked.rowStart,
    rowEnd: baked.rowEnd,
    rowSpacing: params.rowSpacing,
    maxX: bounds.maxX,
  });
  return bakeForestGeometries(trees, ground, {
    rowStart: baked.rowStart,
    bends: baked.bends,
    prefix: baked.prefix,
    rowSpacing: params.rowSpacing,
  });
}

export function createForestMaterials(): Record<ForestKind, THREE.MeshLambertMaterial> {
  const materials = {} as Record<ForestKind, THREE.MeshLambertMaterial>;
  for (const kind of FOREST_KINDS) {
    materials[kind] = createForestMaterial(loadForestMap(SPRITE_URL[kind]));
  }
  return materials;
}

/** Lambert cutout whose sampled color is hue-rotated per tree. */
export function createForestMaterial(map: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.58,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthWrite: true,
  });
  material.customProgramCacheKey = () => 'mode7-forest-hue-v1';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = mustReplace(
      shader.vertexShader,
      '#include <uv_pars_vertex>',
      `#include <uv_pars_vertex>
attribute float treeHue;
attribute float treeShade;
varying float vTreeHue;
varying float vTreeShade;`,
    );
    shader.vertexShader = mustReplace(
      shader.vertexShader,
      '#include <uv_vertex>',
      `#include <uv_vertex>
vTreeHue = treeHue;
vTreeShade = treeShade;`,
    );
    shader.fragmentShader = mustReplace(
      shader.fragmentShader,
      '#include <uv_pars_fragment>',
      `#include <uv_pars_fragment>
varying float vTreeHue;
varying float vTreeShade;

vec3 forestHue(vec3 color, float deg) {
  float angle = radians(deg);
  float c = cos(angle);
  float s = sin(angle);
  mat3 m = mat3(
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072
  );
  return clamp(m * color, 0.0, 1.0);
}`,
    );
    shader.fragmentShader = mustReplace(
      shader.fragmentShader,
      '#include <map_fragment>',
      `vec4 texelColor = texture2D(map, vMapUv);
texelColor.rgb = forestHue(texelColor.rgb, vTreeHue) * vTreeShade;
diffuseColor *= texelColor;`,
    );
  };
  return material;
}

function bakeKind(
  trees: readonly ForestTree[],
  ground: ForestGround,
  bend: {
    rowStart: number;
    bends: ArrayLike<number>;
    prefix: Float32Array;
    rowSpacing: number;
  },
): THREE.BufferGeometry {
  const positions = new Float32Array(trees.length * 4 * 3);
  const uvs = new Float32Array(trees.length * 4 * 2);
  const hues = new Float32Array(trees.length * 4);
  const shades = new Float32Array(trees.length * 4);
  const indices = new Uint32Array(trees.length * 6);
  trees.forEach((tree, i) => {
    const phi = cumulativeOffsetAt(tree.row, bend.rowStart, bend.bends, bend.prefix);
    const x = tree.localX + phi;
    const y = ground.at(tree.row, tree.localX);
    const z = -(tree.row - bend.rowStart) * bend.rowSpacing;
    const sink = SINK[tree.kind];
    const hw = tree.width * 0.5;
    const left = tree.flip ? hw : -hw;
    const right = tree.flip ? -hw : hw;
    const base = i * 12;
    writeCorner(positions, base, x + left, y - sink, z);
    writeCorner(positions, base + 3, x + right, y - sink, z);
    writeCorner(positions, base + 6, x + right, y - sink + tree.height, z);
    writeCorner(positions, base + 9, x + left, y - sink + tree.height, z);
    const uv = i * 8;
    uvs[uv] = 0;
    uvs[uv + 1] = 0;
    uvs[uv + 2] = 1;
    uvs[uv + 3] = 0;
    uvs[uv + 4] = 1;
    uvs[uv + 5] = 1;
    uvs[uv + 6] = 0;
    uvs[uv + 7] = 1;
    for (let c = 0; c < 4; c++) {
      hues[i * 4 + c] = tree.hue;
      shades[i * 4 + c] = tree.shade;
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
  geometry.setAttribute('treeHue', new THREE.BufferAttribute(hues, 1));
  geometry.setAttribute('treeShade', new THREE.BufferAttribute(shades, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function kindAt(noise: Noise2D, row: number, localX: number): ForestKind {
  const conifer = unit(noise, row * 0.006, localX * 0.004);
  const maple = unit(noise, row * 0.012 + 40, localX * 0.008);
  const birch = unit(noise, row * 0.02 + 80, localX * 0.012);
  if (maple > 0.62 && conifer < 0.78) return 'maple';
  if (birch > 0.72 && conifer > 0.25 && conifer < 0.7) return 'birch';
  if (conifer > 0.66) return 'pine';
  if (conifer > 0.42) return 'broadleaf';
  return 'cedar';
}

function standHeight(min: number, max: number, stand: number, jitter: number): number {
  const span = max - min;
  const base = min + stand * span;
  const wobble = (jitter - 0.5) * span * 0.18;
  return Math.max(min, base + wobble);
}

function chunkGround(
  world: World,
  roadColSpacing: number,
  landscapeColSpacing: number,
): ForestGround {
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
  return {
    at(row, localX) {
      const col = signedColFromWorldX(localX, roadColSpacing, landscapeColSpacing);
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
}

function noiseFor(seed: string): Noise2D {
  const hit = forestNoise.get(seed);
  if (hit) return hit;
  const noise = makeNoise2D(deriveSeed(seed, 'forest-field'));
  forestNoise.set(seed, noise);
  return noise;
}

function unit(noise: Noise2D, x: number, y: number): number {
  return noise(x, y) * 0.5 + 0.5;
}

function configureCutout(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  if (tex.image) tex.needsUpdate = true;
}

function loadForestMap(url: string): THREE.Texture {
  if (typeof document === 'undefined') {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    configureCutout(tex);
    return tex;
  }
  return loadColorTexture(url, configureCutout);
}

function mustReplace(source: string, token: string, replacement: string): string {
  if (!source.includes(token)) {
    throw new Error(`forest shader is missing ${token}`);
  }
  return source.replace(token, replacement);
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
