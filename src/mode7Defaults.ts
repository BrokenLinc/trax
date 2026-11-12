import type { FlightParams } from './player/flight.ts';
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
  /** Acceleration when forward is held (rows/sec²). */
  accel: number;
  /** Acceleration when reverse is held (rows/sec²), positive value. */
  decel: number;
  /** Passive friction toward zero speed (rows/sec², applied as drag). */
  friction: number;
  /** Speed cap in either direction (rows/sec). */
  maxSpeed: number;
  /** Multiplier on forward accel while Shift is held. */
  boostFactor: number;
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
 * Single source of truth for tunable defaults exposed in the debug UI. Promote
 * live values via `formatMode7DefaultsModuleSnippet`.
 */
export const MODE7_DEFAULTS: {
  depth: DepthMapParams;
  bend: BendFieldParams;
  camera: ChaseCameraParams;
  fog: SceneFogParams;
  terrain: TerrainMeshSpacingParams;
  water: WaterParams;
  player: PlayerParams;
  flight: FlightParams;
} = {
  depth: {
    // Rolling forested hills: a few hundred metres between crests, tens of
    // metres tall, with the high-frequency crinkle turned down.
    frequency: 0.013,
    amplitude: 38,
    octaves: 2,
    lacunarity: 2,
    gain: 0.5,
    roadDatumPull: 0.48,
    shoulderBlendColumns: 2,
  },
  bend: {
    // Highway bends. Slope change has to stay inside full-lock strafe,
    // or the bike is thrown off the asphalt no matter how hard you steer.
    frequency: 0.005,
    amplitude: 2.6,
    detailWeight: 0.1,
    detailFrequency: 0.008,
  },
  camera: {
    aheadMeters: 52,
    aimElevation: 1.7,
    height: 2.7,
    back: 6.6,
    fov: 48,
    near: 0.12,
    far: 900,
  },
  fog: {
    // The hazy mountain band on the horizon card. Hills fade into that
    // colour, not the sky. When the backdrop changes, use the mountain
    // sample `process-art` prints and put it here.
    color: 0x91a1ba,
    near: 80,
    far: 460,
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
    accel: 18,
    decel: 22,
    friction: 6,
    maxSpeed: 30,
    boostFactor: 1.6,
    strafeSpeedFactor: 0.24,
    strafeAccel: 220,
    driftFactor: 14,
  },
  flight: {
    // Off: the bike stays on the road. On: crests launch and gravity pulls down.
    enabled: false,
    gravity: 66,
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
  flight: FlightParams;
};

function numLiteral(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function boolLiteral(v: boolean): string {
  return v ? 'true' : 'false';
}

function hexLiteral(n: number): string {
  return `0x${(n >>> 0).toString(16).padStart(6, '0')}`;
}

function formatDepthInner(p: DepthMapParams): string {
  return [
    `    // Rolling forested hills: a few hundred metres between crests, tens of`,
    `    // metres tall, with the high-frequency crinkle turned down.`,
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
    `    // Highway bends. Slope change stays inside full-lock strafe.`,
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
    `    // Match the hazy mountain band on the horizon card, not the sky.`,
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
    `    accel: ${numLiteral(p.accel)},`,
    `    decel: ${numLiteral(p.decel)},`,
    `    friction: ${numLiteral(p.friction)},`,
    `    maxSpeed: ${numLiteral(p.maxSpeed)},`,
    `    boostFactor: ${numLiteral(p.boostFactor)},`,
    `    strafeSpeedFactor: ${numLiteral(p.strafeSpeedFactor)},`,
    `    strafeAccel: ${numLiteral(p.strafeAccel)},`,
    `    driftFactor: ${numLiteral(p.driftFactor)},`,
  ].join('\n');
}

function formatFlightInner(p: FlightParams): string {
  return [
    `    // Off: the bike stays on the road. On: crests launch and gravity pulls down.`,
    `    enabled: ${boolLiteral(p.enabled)},`,
    `    gravity: ${numLiteral(p.gravity)},`,
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
    `  flight: {`,
    formatFlightInner(live.flight),
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
    `  flight: FlightParams;`,
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
