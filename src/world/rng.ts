import alea from 'alea';

/**
 * A seeded PRNG. Same string seed always yields the same sequence; that
 * determinism is load-bearing — snapshot tests, introspection scripts,
 * and visual regression all depend on it.
 */
export type Rng = () => number;

export function createRng(seed: string): Rng {
  return alea(seed);
}

/**
 * Derive a stable child seed from a parent seed plus a label.
 * Use this when one logical world needs multiple independent noise streams
 * (e.g. depth map vs. bend field) without them visibly correlating.
 */
export function deriveSeed(parent: string, label: string): string {
  return `${parent}::${label}`;
}
