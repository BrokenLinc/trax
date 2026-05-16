import type { ChaseCameraParams } from './render/camera.ts';
import type { BendFieldParams } from './world/bendField.ts';
import type { DepthMapParams } from './world/depthMap.ts';
import type { WorldParams } from './world/world.ts';

/**
 * Single source of truth for tunable procedural + chase-camera defaults exposed
 * in the debug UI. Promote live values via `formatMode7DefaultsModuleSnippet`.
 */
export const MODE7_DEFAULTS: {
  depth: DepthMapParams;
  bend: BendFieldParams;
  camera: ChaseCameraParams;
} = {
  depth: {
    // Broader, gentler hills: lower frequency stretches features, fewer octaves
    // and lower gain strip out the high-frequency crinkles.
    frequency: 0.012,
    amplitude: 1.2,
    octaves: 3,
    lacunarity: 2.0,
    gain: 0.4,
    roadFlatColumns: 5,
    roadFlatStrength: 0.85,
  },
  bend: {
    // Longer sweeping curves with a small amplitude — gentle winding rather
    // than switchbacks. Per-row slope is the dominant turbulence knob.
    frequency: 0.006,
    amplitude: 0.18,
    detailWeight: 0.05,
    detailFrequency: 0.08,
  },
  camera: {
    // `height` clears the player sphere (radius 0.5 in DEFAULT_PLAYER_MESH),
    // `back` leaves breathing room behind it.
    height: 2.6,
    back: 6.5,
    fov: 60,
    near: 0.1,
    far: 200,
  },
};

export const DEFAULT_WORLD_PARAMS: WorldParams = {
  depth: MODE7_DEFAULTS.depth,
  bend: MODE7_DEFAULTS.bend,
};

/** Live values used by the UI copy action (mirrors `MODE7_DEFAULTS` shape). */
export type Mode7DefaultsSnapshot = {
  depth: DepthMapParams;
  bend: BendFieldParams;
  camera: ChaseCameraParams;
};

function numLiteral(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function formatDepthInner(p: DepthMapParams): string {
  return [
    `    // Broader, gentler hills: lower frequency stretches features, fewer octaves`,
    `    // and lower gain strip out the high-frequency crinkles.`,
    `    frequency: ${numLiteral(p.frequency)},`,
    `    amplitude: ${numLiteral(p.amplitude)},`,
    `    octaves: ${numLiteral(p.octaves)},`,
    `    lacunarity: ${numLiteral(p.lacunarity)},`,
    `    gain: ${numLiteral(p.gain)},`,
    `    roadFlatColumns: ${numLiteral(p.roadFlatColumns)},`,
    `    roadFlatStrength: ${numLiteral(p.roadFlatStrength)},`,
  ].join('\n');
}

function formatBendInner(p: BendFieldParams): string {
  return [
    `    // Longer sweeping curves with a small amplitude — gentle winding rather`,
    `    // than switchbacks. Per-row slope is the dominant turbulence knob.`,
    `    frequency: ${numLiteral(p.frequency)},`,
    `    amplitude: ${numLiteral(p.amplitude)},`,
    `    detailWeight: ${numLiteral(p.detailWeight)},`,
    `    detailFrequency: ${numLiteral(p.detailFrequency)},`,
  ].join('\n');
}

function formatCameraInner(p: ChaseCameraParams): string {
  return [
    `    // \`height\` clears the player sphere (radius 0.5 in DEFAULT_PLAYER_MESH),`,
    `    // \`back\` leaves breathing room behind it.`,
    `    height: ${numLiteral(p.height)},`,
    `    back: ${numLiteral(p.back)},`,
    `    fov: ${numLiteral(p.fov)},`,
    `    near: ${numLiteral(p.near)},`,
    `    far: ${numLiteral(p.far)},`,
  ].join('\n');
}

function formatDefaultsExportsBlock(live: Mode7DefaultsSnapshot): string {
  const body = [
    `  depth: {`,
    formatDepthInner(live.depth),
    `  },`,
    `  bend: {`,
    formatBendInner(live.bend),
    `  },`,
    `  camera: {`,
    formatCameraInner(live.camera),
    `  },`,
  ].join('\n');

  return [
    `/**`,
    ` * Single source of truth for tunable procedural + chase-camera defaults exposed`,
    ` * in the debug UI. Promote live values via \`formatMode7DefaultsModuleSnippet\`.`,
    ` */`,
    `export const MODE7_DEFAULTS: {`,
    `  depth: DepthMapParams;`,
    `  bend: BendFieldParams;`,
    `  camera: ChaseCameraParams;`,
    `} = {`,
    body,
    `};`,
    ``,
    `export const DEFAULT_WORLD_PARAMS: WorldParams = {`,
    `  depth: MODE7_DEFAULTS.depth,`,
    `  bend: MODE7_DEFAULTS.bend,`,
    `};`,
  ].join('\n');
}

/**
 * Paste over `MODE7_DEFAULTS` + `DEFAULT_WORLD_PARAMS` in `src/mode7Defaults.ts`
 * (types/imports at top of that file stay as-is).
 */
export function formatMode7DefaultsModuleSnippet(live: Mode7DefaultsSnapshot): string {
  return [
    `// Paste over MODE7_DEFAULTS and DEFAULT_WORLD_PARAMS in src/mode7Defaults.ts`,
    ``,
    formatDefaultsExportsBlock(live),
    ``,
  ].join('\n');
}
