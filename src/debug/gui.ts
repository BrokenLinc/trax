import GUI from 'lil-gui';

import { formatMode7DefaultsModuleSnippet } from '../mode7Defaults.ts';
import type { ChaseCamera } from '../render/camera.ts';
import type { SceneFog } from '../render/scene.ts';
import type { TerrainMesh } from '../render/terrainMesh.ts';
import type { WaterPlane } from '../render/waterPlane.ts';
import type { World } from '../world/world.ts';
import type { DebugDraw } from '../render/debugDraw.ts';
import type { PlayerController } from '../player/controller.ts';
import type { TopDownView } from './topdownView.ts';

/**
 * Bind a lil-gui panel to the live mutable knobs of the renderer:
 * noise parameters, terrain window, and visual toggles. Returns the GUI
 * so callers can hide/destroy it from the inspector.
 */
export function buildGui(opts: {
  controller: PlayerController;
  world: World;
  chaseCamera: ChaseCamera;
  sceneFog: SceneFog;
  terrain: TerrainMesh;
  water: WaterPlane;
  debugDraw: DebugDraw;
  topdown: TopDownView;
  onWireframeChange: (on: boolean) => void;
  onDebugVisible: (on: boolean) => void;
  onTopdownVisible: (on: boolean) => void;
  onTopdownWorldSpace: (on: boolean) => void;
}): GUI {
  const gui = new GUI({ title: 'mode7b', width: 300 });

  const player = gui.addFolder('player');
  const playerParams = opts.controller.getParams();
  player
    .add(playerParams, 'strafeSpeedFactor', 0.05, 1.5, 0.01)
    .name('strafe speed factor')
    .onChange(() => opts.controller.setParams(playerParams));

  const visuals = gui.addFolder('visuals');
  const visState = {
    wireframe: opts.terrain.isWireframe(),
    debug: opts.debugDraw.isVisible(),
    topdown: opts.topdown.isVisible(),
    topdownWorldSpace: opts.topdown.isWorldSpaceMode(),
  };
  visuals.add(visState, 'wireframe').onChange((v: boolean) => opts.onWireframeChange(v));
  visuals.add(visState, 'debug').onChange((v: boolean) => opts.onDebugVisible(v));
  visuals.add(visState, 'topdown').onChange((v: boolean) => opts.onTopdownVisible(v));
  visuals
    .add(visState, 'topdownWorldSpace')
    .name('topdown world-space')
    .onChange((v: boolean) => opts.onTopdownWorldSpace(v));

  const wp = opts.water.getParams();
  visuals
    .add(wp, 'y', -200, 30, 0.5)
    .name('water height')
    .onChange(() => opts.water.setParams(wp));

  const fog = gui.addFolder('fog');
  const fp = opts.sceneFog.getParams();
  const fogGui = {
    color: `#${(fp.color >>> 0).toString(16).padStart(6, '0')}`,
    near: fp.near,
    far: fp.far,
  };
  const syncFog = (): void => {
    opts.sceneFog.setParams({
      color: Number.parseInt(fogGui.color.slice(1), 16),
      near: fogGui.near,
      far: fogGui.far,
    });
  };
  fog.addColor(fogGui, 'color').onChange(syncFog);
  fog.add(fogGui, 'near', 0, 200, 0.5).onChange(syncFog);
  fog.add(fogGui, 'far', 1, 2000, 1).onChange(syncFog);

  // Slider ranges are biased toward the smooth aesthetic of MODE7_DEFAULTS;
  // headroom is preserved at the upper end for users who want to crank up the
  // turbulence on purpose.
  const depth = gui.addFolder('depth map');
  const dp = opts.world.depth.getParams();
  depth.add(dp, 'frequency', 0.001, 2, 0.001).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'amplitude', 0, 500, 0.05).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'octaves', 1, 10, 1).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'lacunarity', 1.5, 3, 0.05).onChange(() => opts.world.depth.setParams(dp));
  depth.add(dp, 'gain', 0.1, 2, 0.01).onChange(() => opts.world.depth.setParams(dp));
  depth
    .add(dp, 'roadDatumPull', 0, 1, 0.01)
    .name('datum pull')
    .onChange(() => opts.world.depth.setParams(dp));
  depth
    .add(dp, 'shoulderBlendColumns', 0, 16, 1)
    .name('shoulder blend cols')
    .onChange(() => opts.world.depth.setParams(dp));

  const mesh = gui.addFolder('mesh');
  const tp = opts.terrain.getParams();
  const syncMesh = (): void => {
    opts.terrain.setParams({
      rowSpacing: tp.rowSpacing,
      roadColSpacing: tp.roadColSpacing,
      landscapeColSpacing: tp.landscapeColSpacing,
    });
  };
  mesh.add(tp, 'rowSpacing', 0.5, 16, 0.25).name('row spacing').onChange(syncMesh);
  mesh.add(tp, 'roadColSpacing', 0.5, 16, 0.25).name('road col spacing').onChange(syncMesh);
  mesh
    .add(tp, 'landscapeColSpacing', 0.5, 50, 0.25)
    .name('landscape col spacing')
    .onChange(syncMesh);

  const bend = gui.addFolder('bend field');
  const bp = opts.world.bend.getParams();
  bend.add(bp, 'frequency', 0.001, 0.1, 0.001).onChange(() => opts.world.bend.setParams(bp));
  bend.add(bp, 'amplitude', 0, 10, 0.01).onChange(() => opts.world.bend.setParams(bp));
  bend.add(bp, 'detailWeight', 0, 0.5, 0.01).onChange(() => opts.world.bend.setParams(bp));
  bend.add(bp, 'detailFrequency', 0.005, 0.3, 0.005).onChange(() => opts.world.bend.setParams(bp));

  const chase = gui.addFolder('chase camera');
  const cp = opts.chaseCamera.getParams();
  chase.add(cp, 'aheadMeters', 0, 80, 0.5).onChange(() => opts.chaseCamera.setParams(cp));
  chase.add(cp, 'aimElevation', 0, 5, 0.05).onChange(() => opts.chaseCamera.setParams(cp));
  chase.add(cp, 'height', 0.5, 12, 0.05).onChange(() => opts.chaseCamera.setParams(cp));
  chase.add(cp, 'back', 0, 25, 0.1).onChange(() => opts.chaseCamera.setParams(cp));
  chase.add(cp, 'fov', 20, 100, 1).onChange(() => opts.chaseCamera.setParams(cp));
  chase.add(cp, 'near', 0.01, 5, 0.01).onChange(() => opts.chaseCamera.setParams(cp));
  chase.add(cp, 'far', 50, 2000, 1).onChange(() => opts.chaseCamera.setParams(cp));

  const defaultsExport = {
    copyMode7DefaultsSnippet: (): void => {
      const terrainParams = opts.terrain.getParams();
      const text = formatMode7DefaultsModuleSnippet({
        depth: opts.world.depth.getParams(),
        bend: opts.world.bend.getParams(),
        camera: opts.chaseCamera.getParams(),
        fog: opts.sceneFog.getParams(),
        terrain: {
          rowSpacing: terrainParams.rowSpacing,
          roadColSpacing: terrainParams.roadColSpacing,
          landscapeColSpacing: terrainParams.landscapeColSpacing,
        },
        water: { y: opts.water.getParams().y },
        player: { strafeSpeedFactor: opts.controller.getParams().strafeSpeedFactor },
      });
      const copy = async (): Promise<void> => {
        try {
          await navigator.clipboard.writeText(text);
          console.info('[mode7] Copied mode7Defaults.ts snippet to clipboard.');
        } catch {
          console.info(text);
        }
      };
      void copy();
    },
  };
  gui.add(defaultsExport, 'copyMode7DefaultsSnippet').name('copy mode7Defaults snippet');

  return gui;
}
