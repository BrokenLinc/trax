import type { ChaseCameraParams } from './render/camera.ts';
import type { SceneFogParams } from './render/scene.ts';
import type { WaterParams } from './render/waterPlane.ts';
import type { BendFieldParams } from './world/bendField.ts';
import type { DepthMapParams } from './world/depthMap.ts';
import type { WorldParams } from './world/world.ts';

/** Mesh lattice spacing knobs (row + road/landscape column spacing). */
export interface TerrainMeshSpacingParams {
  rowSpacing: number;
  roadColSpacing: number;
  landscapeColSpacing: number;
}

/** Player movement knobs exposed in the debug UI. */
export interface PlayerParams {
  /**
   * Max strafe speed as a fraction of forward world speed (|speed| × rowSpacing).
   * No strafe when |speed| is zero.
   */
  strafeSpeedFactor: number;
  /** Symmetric lateral acceleration toward target or zero (m/s²). */
  strafeAccel: number;
  /**
   * Bend drift strength: lateral metres per (row travelled × bend slope change).
   * Positive slope change (tightening right) pushes the player left.
   */
  driftFactor: number;
}

// Paste over MODE7_DEFAULTS and DEFAULT_WORLD_PARAMS in src/mode7Defaults.ts

/**
 * Single source of truth for tunable defaults exposed in the debug UI (procedural,
 * camera, fog, terrain spacing, water, player movement). Promote live values via
 * `formatMode7DefaultsModuleSnippet`.
 */
export const MODE7_DEFAULTS: {
  depth: DepthMapParams;
  bend: BendFieldParams;
  camera: ChaseCameraParams;
  fog: SceneFogParams;
  terrain: TerrainMeshSpacingParams;
  water: WaterParams;
  player: PlayerParams;
} = {
  depth: {
    // Broader, gentler hills: lower frequency stretches features, fewer octaves
    // and lower gain strip out the high-frequency crinkles.
    frequency: 0.002,
    amplitude: 320.85,
    octaves: 3,
    lacunarity: 1.5,
    gain: 2,
    roadDatumPull: 0.3,
    shoulderBlendColumns: 5,
  },
  bend: {
    // Longer sweeping curves with a small amplitude — gentle winding rather
    // than switchbacks. Per-row slope is the dominant turbulence knob.
    frequency: 0.005,
    amplitude: 3.84,
    detailWeight: 0,
    detailFrequency: 0.005,
  },
  camera: {
    aheadMeters: 80,
    aimElevation: 1,
    height: 2.6,
    back: 6.5,
    fov: 60,
    near: 0.1,
    far: 1051,
  },
  fog: {
    color: 0x0a0d18,
    near: 0,
    far: 1137,
  },
  terrain: {
    rowSpacing: 4,
    roadColSpacing: 6,
    landscapeColSpacing: 50,
  },
  water: {
    y: -147.5,
  },
  player: {
    strafeSpeedFactor: 0.13,
    strafeAccel: 120,
    driftFactor: 6,
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
  fog: SceneFogParams;
  terrain: TerrainMeshSpacingParams;
  water: WaterParams;
  player: PlayerParams;
};

function numLiteral(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function hexLiteral(n: number): string {
  return `0x${(n >>> 0).toString(16).padStart(6, '0')}`;
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
    `    roadDatumPull: ${numLiteral(p.roadDatumPull)},`,
    `    shoulderBlendColumns: ${numLiteral(p.shoulderBlendColumns)},`,
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
    `    aheadMeters: ${numLiteral(p.aheadMeters)},`,
    `    aimElevation: ${numLiteral(p.aimElevation)},`,
    `    height: ${numLiteral(p.height)},`,
    `    back: ${numLiteral(p.back)},`,
    `    fov: ${numLiteral(p.fov)},`,
    `    near: ${numLiteral(p.near)},`,
    `    far: ${numLiteral(p.far)},`,
  ].join('\n');
}

function formatFogInner(p: SceneFogParams): string {
  return [
    `    color: ${hexLiteral(p.color)},`,
    `    near: ${numLiteral(p.near)},`,
    `    far: ${numLiteral(p.far)},`,
  ].join('\n');
}

function formatTerrainInner(p: TerrainMeshSpacingParams): string {
  return [
    `    rowSpacing: ${numLiteral(p.rowSpacing)},`,
    `    roadColSpacing: ${numLiteral(p.roadColSpacing)},`,
    `    landscapeColSpacing: ${numLiteral(p.landscapeColSpacing)},`,
  ].join('\n');
}

function formatWaterInner(p: WaterParams): string {
  return [`    y: ${numLiteral(p.y)},`].join('\n');
}

function formatPlayerInner(p: PlayerParams): string {
  return [
    `    strafeSpeedFactor: ${numLiteral(p.strafeSpeedFactor)},`,
    `    strafeAccel: ${numLiteral(p.strafeAccel)},`,
    `    driftFactor: ${numLiteral(p.driftFactor)},`,
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
    `  fog: {`,
    formatFogInner(live.fog),
    `  },`,
    `  terrain: {`,
    formatTerrainInner(live.terrain),
    `  },`,
    `  water: {`,
    formatWaterInner(live.water),
    `  },`,
    `  player: {`,
    formatPlayerInner(live.player),
    `  },`,
  ].join('\n');

  return [
    `/**`,
    ` * Single source of truth for tunable defaults exposed in the debug UI. Promote`,
    ` * live values via \`formatMode7DefaultsModuleSnippet\`.`,
    ` */`,
    `export const MODE7_DEFAULTS: {`,
    `  depth: DepthMapParams;`,
    `  bend: BendFieldParams;`,
    `  camera: ChaseCameraParams;`,
    `  fog: SceneFogParams;`,
    `  terrain: TerrainMeshSpacingParams;`,
    `  water: WaterParams;`,
    `  player: PlayerParams;`,
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
