import { createNoise2D, createNoise3D } from 'simplex-noise';
import { createRng } from './rng.ts';

export type Noise2D = (x: number, y: number) => number;
export type Noise3D = (x: number, y: number, z: number) => number;

export function makeNoise2D(seed: string): Noise2D {
  return createNoise2D(createRng(seed));
}

export function makeNoise3D(seed: string): Noise3D {
  return createNoise3D(createRng(seed));
}

/**
 * Fractional Brownian motion: octaves of noise summed with shrinking
 * amplitude and growing frequency. The classic "natural-looking" terrain
 * trick. Output normalised so the theoretical bounds stay in [-1, 1].
 */
export function fbm2D(
  noise: Noise2D,
  x: number,
  y: number,
  opts: { octaves: number; lacunarity: number; gain: number } = {
    octaves: 4,
    lacunarity: 2.0,
    gain: 0.5,
  },
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < opts.octaves; i++) {
    sum += amplitude * noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= opts.gain;
    frequency *= opts.lacunarity;
  }
  return sum / norm;
}
