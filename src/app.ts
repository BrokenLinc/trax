import * as THREE from 'three';
import type GUI from 'lil-gui';

import { World } from './world/world.ts';
import { ChaseCamera } from './render/camera.ts';
import { createScene } from './render/scene.ts';
import { TerrainMesh, type TerrainSnapshot } from './render/terrainMesh.ts';
import { DebugDraw } from './render/debugDraw.ts';
import { PlayerController } from './player/controller.ts';
import { createPlayerState, type PlayerState } from './player/state.ts';
import { Hud } from './debug/hud.ts';
import { buildGui } from './debug/gui.ts';
import { TopDownView } from './debug/topdownView.ts';
import {
  installInspector,
  type Mode7MeshDump,
  type Mode7State,
  type Mode7WorldDump,
} from './debug/inspector.ts';

export interface AppOptions {
  container: HTMLElement;
  seed: string;
  initialDistance: number;
  headless: boolean;
}

/**
 * The App owns one renderer, one scene, one terrain mesh, one player state,
 * and the loop that drives them. In `headless` mode the rAF loop is skipped
 * and stepping happens only via `tick()` from the inspector — gives scripts
 * frame-exact determinism for screenshots and JSON dumps.
 */
export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: ChaseCamera;
  private readonly scene: THREE.Scene;
  private readonly terrain: TerrainMesh;
  private readonly debugDraw: DebugDraw;
  private readonly controller: PlayerController;
  private readonly player: PlayerState;
  private readonly hud: Hud | null;
  private readonly gui: GUI | null;
  private readonly topdown: TopDownView;
  private readonly world: World;
  private readonly container: HTMLElement;

  private rafHandle: number | null = null;
  private detachInput: (() => void) | null = null;
  private lastTimeMs = 0;
  private fps = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private paused = false;
  private headless: boolean;

  constructor(opts: AppOptions) {
    this.container = opts.container;
    this.headless = opts.headless;

    const { width, height } = sizeOf(this.container);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: opts.headless,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.container.appendChild(this.renderer.domElement);

    const rig = createScene();
    this.scene = rig.scene;

    this.world = new World(opts.seed);
    this.terrain = new TerrainMesh(this.world);
    this.scene.add(this.terrain.mesh);

    this.debugDraw = new DebugDraw(this.terrain.getRowCount());
    this.scene.add(this.debugDraw.group);

    this.camera = new ChaseCamera(width / height);

    this.player = createPlayerState({ distance: opts.initialDistance });
    this.controller = new PlayerController();
    this.controller.headless = opts.headless;

    this.hud = opts.headless ? null : new Hud(this.container);
    // Always create the top-down: it's useful in headless screenshots too.
    // Pass a parent only when we actually have a visible DOM container.
    this.topdown = new TopDownView(opts.headless ? null : this.container);
    this.gui = opts.headless
      ? null
      : buildGui({
          world: this.world,
          terrain: this.terrain,
          debugDraw: this.debugDraw,
          topdown: this.topdown,
          onWireframeChange: (v) => this.terrain.setWireframe(v),
          onDebugVisible: (v) => this.debugDraw.setVisible(v),
          onTopdownVisible: (v) => this.topdown.setVisible(v),
          onTopdownWorldSpace: (v) => this.topdown.setWorldSpaceMode(v),
        });

    if (!opts.headless) {
      this.detachInput = this.controller.attach(window);
      window.addEventListener('keydown', this.handleHotkey);
      window.addEventListener('resize', this.handleResize);
    }

    // Render one frame so a fresh canvas isn't blank.
    this.simulate(0);
    this.render();

    if (!opts.headless) this.start();
  }

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastTimeMs = performance.now();
    const frame = (t: number): void => {
      const dt = Math.min(0.1, (t - this.lastTimeMs) / 1000);
      this.lastTimeMs = t;
      if (!this.paused) this.simulate(dt);
      this.render();
      this.updateFps(dt);
      this.rafHandle = requestAnimationFrame(frame);
    };
    this.rafHandle = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  destroy(): void {
    this.stop();
    this.detachInput?.();
    this.detachInput = null;
    window.removeEventListener('keydown', this.handleHotkey);
    window.removeEventListener('resize', this.handleResize);
    this.hud?.destroy();
    this.gui?.destroy();
    this.topdown.destroy();
    this.terrain.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- Inspector / headless control surface --------------------------------

  setPaused(p: boolean): void {
    this.paused = p;
  }

  setHeadless(h: boolean): void {
    if (h === this.headless) return;
    this.headless = h;
    this.controller.headless = h;
    if (h) this.stop();
    else this.start();
  }

  setSeed(seed: string): void {
    this.world.reseed(seed);
    this.terrain.setWorld(this.world);
    this.simulate(0);
    this.render();
  }

  setDistance(distance: number): void {
    this.player.distance = distance;
    this.simulate(0);
    this.render();
  }

  setSpeed(speed: number): void {
    this.player.speed = speed;
  }

  /** Advance `frames` × `dt` seconds and render once at the end. */
  tick(frames = 1, dt = 1 / 60): void {
    for (let i = 0; i < frames; i++) this.simulate(dt);
    this.render();
  }

  getState(): Mode7State {
    const lo = Math.floor(this.player.distance);
    return {
      seed: this.world.getSeed(),
      distance: this.player.distance,
      speed: this.player.speed,
      playerY: this.player.y,
      fps: this.fps,
      paused: this.paused,
      headless: this.headless,
      rowFloor: lo,
      rowFrac: this.player.distance - lo,
    };
  }

  dumpMesh(): Mode7MeshDump {
    const snap: TerrainSnapshot = this.terrain.snapshot();
    const windowRowStart = this.terrain.getWindowRowStart(this.player.distance);
    return { ...snap, windowRowStart };
  }

  dumpWorld(opts?: { rowsAhead?: number; rowsBehind?: number }): Mode7WorldDump {
    const ahead = opts?.rowsAhead ?? 32;
    const behind = opts?.rowsBehind ?? 8;
    const lo = Math.floor(this.player.distance);
    const start = lo - behind;
    const count = ahead + behind + 1;
    const samples: number[] = [];
    const centreColumn: number[] = [];
    for (let i = 0; i < count; i++) {
      samples.push(this.world.bend.sample(start + i));
      centreColumn.push(this.world.depth.sample(start + i, 0));
    }
    return {
      seed: this.world.getSeed(),
      distance: this.player.distance,
      depth: {
        params: this.world.depth.getParams() as unknown as Record<string, number>,
        centreColumn,
      },
      bend: {
        params: this.world.bend.getParams() as unknown as Record<string, number>,
        samples,
      },
    };
  }

  screenshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  // --- Internals -----------------------------------------------------------

  private simulate(dt: number): void {
    if (dt > 0) this.controller.update(this.player, dt);
    this.player.y = this.world.depth.sampleBilinear(this.player.distance, 0);
    this.terrain.update(this.player.distance);
    this.debugDraw.updateCentreLine(
      this.terrain.snapshot().offsets,
      this.terrain.getParams().rowSpacing,
      this.player.distance,
    );
    this.camera.update(this.player.y);
    this.topdown.update(this.player.y);
    if (this.hud) {
      const lo = Math.floor(this.player.distance);
      this.hud.update({
        fps: this.fps,
        seed: this.world.getSeed(),
        distance: this.player.distance,
        speed: this.player.speed,
        playerY: this.player.y,
        rowFloor: lo,
        rowFrac: this.player.distance - lo,
        bendAtPlayer: this.world.bend.sample(lo),
        paused: this.paused,
        headless: this.headless,
      });
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera.camera);
    this.topdown.render(this.renderer, this.scene, {
      beforeUnskewed: () => this.terrain.pushUnskewedView(this.player.distance),
      afterUnskewed: () => this.terrain.popUnskewedView(),
    });
  }

  private updateFps(dt: number): void {
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  }

  private readonly handleResize = (): void => {
    const { width, height } = sizeOf(this.container);
    this.renderer.setSize(width, height, false);
    this.camera.setAspect(width / height);
    this.render();
  };

  private readonly handleHotkey = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.paused = !this.paused;
    } else if (e.code === 'KeyR') {
      this.world.reseed(`${this.world.getSeed()}+${Math.floor(Math.random() * 1e6)}`);
      this.terrain.setWorld(this.world);
    } else if (e.code === 'KeyG') {
      this.terrain.setWireframe(!this.terrain.isWireframe());
    } else if (e.code === 'KeyV') {
      this.topdown.setVisible(!this.topdown.isVisible());
    } else if (e.code === 'KeyU') {
      this.topdown.setWorldSpaceMode(!this.topdown.isWorldSpaceMode());
    }
  };
}

function sizeOf(el: HTMLElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height)),
  };
}

/** Bootstrap helper used by `main.ts`; also exported for tests/headless. */
export function bootstrap(opts: AppOptions): App {
  const app = new App(opts);
  installInspector(app);
  return app;
}
