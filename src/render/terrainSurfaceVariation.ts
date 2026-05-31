import { deriveSeed } from '../world/rng.ts';
import { makeNoise2D, type Noise2D } from '../world/noise.ts';
import { isAsphaltQuad, type SurfaceKind } from './terrainSurface.ts';

export interface TerrainSurfaceVariationParams {
  /** Absolute rows per noise cell along the track. */
  rowCellSize: number;
  /** Signed columns per noise cell laterally. */
  colCellSize: number;
  /** Noise input scale applied to cell indices. */
  sampleScale: number;
  /** How much lattice variation affects shoulder vertices (0 = flat). */
  shoulderStrength: number;
  /** How much the same cells affect asphalt (typically lower). */
  roadStrength: number;
  /** Multiplier at noise sample −1 before strength is applied. */
  minFactor: number;
  /** Multiplier at noise sample +1 before strength is applied. */
  maxFactor: number;
}

export function sanitiseSurfaceVariationParams(
  p: TerrainSurfaceVariationParams,
): TerrainSurfaceVariationParams {
  const rowCellSize = Math.max(1, Math.floor(p.rowCellSize));
  const colCellSize = Math.max(1, Math.floor(p.colCellSize));
  let minFactor = p.minFactor;
  let maxFactor = p.maxFactor;
  if (minFactor > maxFactor) {
    const swap = minFactor;
    minFactor = maxFactor;
    maxFactor = swap;
  }
  return {
    rowCellSize,
    colCellSize,
    sampleScale: Math.max(0.001, p.sampleScale),
    shoulderStrength: Math.max(0, p.shoulderStrength),
    roadStrength: Math.max(0, p.roadStrength),
    minFactor,
    maxFactor,
  };
}

export function makeSurfaceVariationNoise(seed: string): Noise2D {
  return makeNoise2D(deriveSeed(seed, 'surface'));
}

/** Lattice noise sample in [-1, 1] — constant for all verts in the same cell. */
export function latticeNoiseSample(
  absRow: number,
  signedCol: number,
  params: TerrainSurfaceVariationParams,
  noise: Noise2D,
): number {
  const cellRow = Math.floor(absRow / params.rowCellSize);
  const cellCol = Math.floor(signedCol / params.colCellSize);
  return noise(cellRow * params.sampleScale, cellCol * params.sampleScale);
}

/** Map noise ∈ [-1, 1] to [minFactor, maxFactor]. */
export function baseVariationFactor(n: number, params: TerrainSurfaceVariationParams): number {
  const t = (n + 1) * 0.5;
  return params.minFactor + t * (params.maxFactor - params.minFactor);
}

/**
 * One multiplier per terrain quad, sampled at the lattice cell that contains
 * the quad centre. Avoids per-corner colors that the GPU interpolates into
 * soft gradients across each quad.
 */
export function surfaceVertexColorMultiplierForQuad(
  rowStart: number,
  quadRow: number,
  quadCol: number,
  centreCol: number,
  params: TerrainSurfaceVariationParams,
  noise: Noise2D,
): number {
  const surface: SurfaceKind = isAsphaltQuad(quadCol, centreCol) ? 'asphalt' : 'shoulder';
  const midAbsRow = rowStart + quadRow + 0.5;
  const midSignedCol = quadCol - centreCol + 0.5;
  const cellRow = Math.floor(midAbsRow / params.rowCellSize);
  const cellCol = Math.floor(midSignedCol / params.colCellSize);
  const strength = surface === 'asphalt' ? params.roadStrength : params.shoulderStrength;
  if (strength <= 0) return 1;
  const n = noise(cellRow * params.sampleScale, cellCol * params.sampleScale);
  const base = baseVariationFactor(n, params);
  return 1 + (base - 1) * strength;
}

/**
 * Vertex-color RGB multiplier (scalar) for map × color blend.
 * 1 = neutral; shoulder uses `shoulderStrength`, asphalt uses `roadStrength`.
 */
export function surfaceVertexColorMultiplier(
  absRow: number,
  signedCol: number,
  surface: SurfaceKind,
  params: TerrainSurfaceVariationParams,
  noise: Noise2D,
): number {
  const strength = surface === 'asphalt' ? params.roadStrength : params.shoulderStrength;
  if (strength <= 0) return 1;
  const n = latticeNoiseSample(absRow, signedCol, params, noise);
  const base = baseVariationFactor(n, params);
  return 1 + (base - 1) * strength;
}
