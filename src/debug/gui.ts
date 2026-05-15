import GUI from 'lil-gui';
import type { World } from '../world/world.ts';
import type { TerrainMesh } from '../render/terrainMesh.ts';
import type { DebugDraw } from '../render/debugDraw.ts';
import type { TopDownView } from './topdownView.ts';

/**
 * Bind a lil-gui panel to the live mutable knobs of the renderer:
 * noise parameters, terrain window, and visual toggles. Returns the GUI
 * so callers can hide/destroy it from the inspector.
 */
export function buildGui(opts: {
  world: World;
  terrain: TerrainMesh;
  debugDraw: DebugDraw;
  topdown: TopDownView;
  onWireframeChange: (on: boolean) => void;
  onDebugVisible: (on: boolean) => void;
  onTopdownVisible: (on: boolean) => void;
}): GUI {
  const gui = new GUI({ title: 'mode7b', width: 300 });

  const visuals = gui.addFolder('visuals');
  const visState = {
    wireframe: opts.terrain.isWireframe(),
    debug: opts.debugDraw.isVisible(),
    topdown: opts.topdown.isVisible(),
  };
  visuals.add(visState, 'wireframe').onChange((v: boolean) => opts.onWireframeChange(v));
  visuals.add(visState, 'debug').onChange((v: boolean) => opts.onDebugVisible(v));
  visuals.add(visState, 'topdown').onChange((v: boolean) => opts.onTopdownVisible(v));

  const depth = gui.addFolder('depth map');
  const dp = opts.world.depth.getParams();
  depth.add(dp, 'frequency', 0.005, 0.2, 0.001).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'amplitude', 0, 5, 0.05).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'octaves', 1, 6, 1).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'lacunarity', 1.5, 3, 0.05).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'gain', 0.2, 0.8, 0.01).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'roadFlatColumns', 0, 16, 1).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'roadFlatStrength', 0, 1, 0.01).onChange(() => opts.world.depth.setParams(dp));

  const bend = gui.addFolder('bend field');
  const bp = opts.world.bend.getParams();
  bend.add(bp, 'frequency', 0.001, 0.1, 0.001).onChange(() => opts.world.bend.setParams(bp));
  bend.add(bp, 'amplitude', 0, 2, 0.01).onChange(() => opts.world.bend.setParams(bp));
  bend.add(bp, 'detailWeight', 0, 1, 0.01).onChange(() => opts.world.bend.setParams(bp));
  bend.add(bp, 'detailFrequency', 0.005, 0.3, 0.005).onChange(() => opts.world.bend.setParams(bp));

  return gui;
}
