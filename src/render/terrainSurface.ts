import * as THREE from 'three';

import { loadColorTexture } from './loadTexture.ts';

/** Shoulder fill (default terrain). */
export const SHOULDER_RGB = { r: 0x8a, g: 0xa0, b: 0xd6 } as const;
/** Central road strip. */
export const ASPHALT_RGB = { r: 0x5a, g: 0x5c, b: 0x62 } as const;

/** Chunk-fill surface image resolution (`public/terrain-chunk-surface.png`). */
export const CHUNK_SURFACE_SIZE = 1024;

const CHUNK_SURFACE_URL = '/terrain-chunk-surface.png';

export type SurfaceKind = 'asphalt' | 'shoulder';

/** True for the two road quads flanking the centre column line (`centreCol`). */
export function isAsphaltQuad(c: number, centreCol: number): boolean {
  return c === centreCol - 1 || c === centreCol;
}

/** Road texel used by asphalt quad `c` (west → left, east → right). */
export function asphaltSideForQuad(c: number, centreCol: number): 'left' | 'right' {
  if (c === centreCol - 1) return 'left';
  if (c === centreCol) return 'right';
  throw new RangeError(`asphaltSideForQuad: c=${c} is not a road quad for centreCol=${centreCol}`);
}

/**
 * Travelled lanes in `public/terrain-chunk-surface.png`: the white edge
 * lines of the shoulder atlas. ±`roadColSpacing` maps onto this band, so
 * the two road quads are the asphalt and the dirt sits in the shoulder
 * stretch past them.
 */
export const ASPHALT_U_MIN = 314 / CHUNK_SURFACE_SIZE;
export const ASPHALT_U_MAX = 710 / CHUNK_SURFACE_SIZE;

/**
 * V along a chunk. One copy of the surface image per chunk, so the sealed
 * top/bottom seam in the PNG tiles as chunks are placed end to end.
 */
export function chunkLatticeV(quadRow: number, cornerDv: 0 | 1, rowsPerChunk: number): number {
  return (quadRow + cornerDv) / rowsPerChunk;
}

/**
 * Cross-section U for a road-local X in metres (bend offset removed).
 * Painted asphalt covers ±`roadColSpacing`, which lines up with the centre
 * columns so the two road quads interpolate that band linearly. Each grass
 * shoulder is stretched across the first landscape column (the next vertex);
 * columns beyond that hold the texture edge. U has to be linear between
 * vertices — the GPU interpolates the corners, it does not re-evaluate this
 * function inside a quad.
 */
export function chunkCrossSectionU(
  localX: number,
  roadColSpacing: number,
  landscapeColSpacing: number,
): number {
  const min = ASPHALT_U_MIN;
  const max = ASPHALT_U_MAX;
  const center = (min + max) / 2;
  if (!(roadColSpacing > 0) || !Number.isFinite(localX)) return center;
  if (localX >= -roadColSpacing && localX <= roadColSpacing) {
    const uvPerMeter = (max - min) / (2 * roadColSpacing);
    return center + localX * uvPerMeter;
  }
  const shoulder = landscapeColSpacing > 0 ? landscapeColSpacing : roadColSpacing;
  if (localX < -roadColSpacing) {
    const t = Math.min(1, (-roadColSpacing - localX) / shoulder);
    return min * (1 - t);
  }
  const t = Math.min(1, (localX - roadColSpacing) / shoulder);
  return max + (1 - max) * t;
}

function applyChunkSurfaceSettings(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  // The loader calls this once before the image exists. Flagging needsUpdate
  // then makes WebGLRenderer warn and skip the upload.
  if (tex.image) tex.needsUpdate = true;
  return tex;
}

/** Shared chunk-fill surface map from `public/terrain-chunk-surface.png`. */
export function createChunkSurfaceTexture(onLoad?: () => void): THREE.Texture {
  return loadColorTexture(CHUNK_SURFACE_URL, (loaded) => {
    applyChunkSurfaceSettings(loaded);
    if (loaded.image) onLoad?.();
  });
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

const VALLEY_TINT: readonly [number, number, number] = [0.6, 0.74, 0.56];
const CREST_TINT: readonly [number, number, number] = [0.9, 0.86, 0.68];

/**
 * Per-vertex multiply for the hill albedo. Valleys go cooler and duller,
 * crests warmer. On the road itself the tint fades to white so the painted
 * asphalt is not stained green.
 */
export function hillTint(
  height: number,
  localX: number,
  roadColSpacing: number,
): [number, number, number] {
  const t = clamp01((height + 8) / 32);
  const r = VALLEY_TINT[0] + (CREST_TINT[0] - VALLEY_TINT[0]) * t;
  const g = VALLEY_TINT[1] + (CREST_TINT[1] - VALLEY_TINT[1]) * t;
  const b = VALLEY_TINT[2] + (CREST_TINT[2] - VALLEY_TINT[2]) * t;
  const onRoad = 1 - smoothstep(roadColSpacing, roadColSpacing + 3, Math.abs(localX));
  return [r + (1 - r) * onRoad, g + (1 - g) * onRoad, b + (1 - b) * onRoad];
}
