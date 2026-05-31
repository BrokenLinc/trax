import { describe, expect, it } from 'vitest';
import { MODE7_DEFAULTS } from '../src/mode7Defaults.ts';
import {
  baseVariationFactor,
  latticeNoiseSample,
  makeSurfaceVariationNoise,
  sanitiseSurfaceVariationParams,
  surfaceVertexColorMultiplier,
  surfaceVertexColorMultiplierForQuad,
  type TerrainSurfaceVariationParams,
} from '../src/render/terrainSurfaceVariation.ts';

const PARAMS: TerrainSurfaceVariationParams = MODE7_DEFAULTS.surfaceVariation;

describe('terrainSurfaceVariation', () => {
  it('is deterministic for the same seed and lattice cell', () => {
    const noise = makeSurfaceVariationNoise('det');
    const a = latticeNoiseSample(48, -6, PARAMS, noise);
    const b = latticeNoiseSample(48, -6, PARAMS, noise);
    expect(a).toBe(b);
  });

  it('can differ across cells', () => {
    const noise = makeSurfaceVariationNoise('cells');
    const samples = new Set<number>();
    for (let row = 0; row < 8; row++) {
      for (let col = -4; col <= 4; col++) {
        samples.add(
          latticeNoiseSample(row * PARAMS.rowCellSize, col * PARAMS.colCellSize, PARAMS, noise),
        );
      }
    }
    expect(samples.size).toBeGreaterThan(1);
  });

  it('maps noise to [minFactor, maxFactor]', () => {
    expect(baseVariationFactor(-1, PARAMS)).toBeCloseTo(PARAMS.minFactor, 6);
    expect(baseVariationFactor(1, PARAMS)).toBeCloseTo(PARAMS.maxFactor, 6);
    expect(baseVariationFactor(0, PARAMS)).toBeCloseTo(
      (PARAMS.minFactor + PARAMS.maxFactor) * 0.5,
      6,
    );
  });

  it('quad multiplier is constant for all corners of the same quad', () => {
    const noise = makeSurfaceVariationNoise('quadConst');
    const centre = 16;
    const c = 0;
    const r = 2;
    const rowStart = 0;
    const m = surfaceVertexColorMultiplierForQuad(rowStart, r, c, centre, PARAMS, noise);
    expect(m).toBe(surfaceVertexColorMultiplierForQuad(rowStart, r, c, centre, PARAMS, noise));
  });

  it('returns 1 when surface strength is zero', () => {
    const noise = makeSurfaceVariationNoise('flat');
    const flat: TerrainSurfaceVariationParams = {
      ...PARAMS,
      shoulderStrength: 0,
      roadStrength: 0,
    };
    expect(surfaceVertexColorMultiplier(10, 2, 'shoulder', flat, noise)).toBe(1);
    expect(surfaceVertexColorMultiplier(10, 0, 'asphalt', flat, noise)).toBe(1);
  });

  it('keeps multipliers within expected bounds for default strengths', () => {
    const noise = makeSurfaceVariationNoise('bounds');
    for (let row = 0; row < 200; row += 3) {
      for (let col = -20; col <= 20; col += 2) {
        const shoulder = surfaceVertexColorMultiplier(row, col, 'shoulder', PARAMS, noise);
        const road = surfaceVertexColorMultiplier(row, col, 'asphalt', PARAMS, noise);
        expect(shoulder).toBeGreaterThanOrEqual(
          1 - (1 - PARAMS.minFactor) * PARAMS.shoulderStrength - 1e-6,
        );
        expect(shoulder).toBeLessThanOrEqual(
          1 + (PARAMS.maxFactor - 1) * PARAMS.shoulderStrength + 1e-6,
        );
        expect(road).toBeGreaterThanOrEqual(
          1 - (1 - PARAMS.minFactor) * PARAMS.roadStrength - 1e-6,
        );
        expect(road).toBeLessThanOrEqual(1 + (PARAMS.maxFactor - 1) * PARAMS.roadStrength + 1e-6);
      }
    }
  });

  it('sanitiseSurfaceVariationParams swaps inverted min/max', () => {
    const s = sanitiseSurfaceVariationParams({
      ...PARAMS,
      minFactor: 1.2,
      maxFactor: 0.8,
    });
    expect(s.minFactor).toBeCloseTo(0.8, 6);
    expect(s.maxFactor).toBeCloseTo(1.2, 6);
  });
});
