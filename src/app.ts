import * as THREE from 'three';
import type GUI from 'lil-gui';

import { World } from './world/world.ts';
import { ChaseCamera, diagnosticChaseVersusThreeLookAtDeg } from './render/camera.ts';
import { createScene } from './render/scene.ts';
import { TerrainMesh, type TerrainSnapshot } from './render/terrainMesh.ts';
import { PlayerMesh } from './render/playerMesh.ts';
import { DebugDraw } from './render/debugDraw.ts';
import { PlayerController } from './player/controller.ts';
import { createPlayerState, type PlayerState } from './player/state.ts';
import { Hud } from './debug/hud.ts';
import { buildGui } from './debug/gui.ts';
import { TopDownView } from './debug/topdownView.ts';
import {
  installInspector,
  type Mode7CameraDiagnose,
  type Mode7MeshDump,
  type Mode7State,
  type Mode7WorldDump,
} from './debug/inspector.ts';
import { formatMode7DefaultsModuleSnippet, type Mode7DefaultsSnapshot } from './mode7Defaults.ts';

const CAMERA_DIAGNOSE_HINTS = [
  'sphereNdc.x near 0 means world X=0 projects to horizontal screen centre (symmetric chase frustum).',
  'Centred sphereNdc but “wrong lane” sensation is tangent-aligned bend vs literal screen-centre framing.',
  '?noTopdown=1 skips inset render to A/B chase-only viewport behaviour.',
  'Compare Safari/Firefox vs Chromium/Tauri; confirm browser zoom 100%.',
  'If viewport ≠ drawingBuffer or buffer ≠ client×DPR, resize sync is broken.',
] as const;

export interface AppOptions {
  container: HTMLElement;
  seed: string;
  initialDistance: number;
  headless: boolean;
  /** When true, skips the inset top-down `renderer.render` (URL `noTopdown=1`). */
  skipTopdown?: boolean;
}

/**
 * The App owns one renderer, one scene, one terrain mesh, one player state,
 * and the loop that drives them. In `headless` mode the rAF loop is skipped
 * and stepping happens only via `tick()` from the inspector — gives scripts
 * frame-exact determinism for screenshots and JSON dumps.
 */
export class App {
  private readonly skipTopdown: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: ChaseCamera;
  private readonly scene: THREE.Scene;
  private readonly terrain: TerrainMesh;
  private readonly playerMesh: PlayerMesh;
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
  /** Filled inside `render()` from `gl.VIEWPORT` after each pass boundary. */
  private glVpAfterMain: [number, number, number, number] | null = null;
  /** After top-down restores state, or mirrors main-only when inset is skipped. */
  private glVpAfterFrame: [number, number, number, number] | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(opts: AppOptions) {
    this.container = opts.container;
    this.headless = opts.headless;
    this.skipTopdown = opts.skipTopdown ?? false;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: opts.headless,
    });
    this.renderer.shadowMap.enabled = true;
    // Default PCFShadowMap is used. PCFSoftShadowMap is deprecated in
    // three ≥ 0.184 (the renderer silently downgrades), and VSMShadowMap
    // would force every shadow receiver to also cast — that would produce
    // noisy self-shadowing on the flat-shaded terrain.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    const rig = createScene();
    this.scene = rig.scene;

    this.world = new World(opts.seed);
    this.terrain = new TerrainMesh(this.world);
    this.scene.add(this.terrain.mesh);

    this.playerMesh = new PlayerMesh();
    this.scene.add(this.playerMesh.mesh);

    this.debugDraw = new DebugDraw(this.terrain.getRowCount());
    this.scene.add(this.debugDraw.group);

    this.camera = new ChaseCamera(1);
    this.syncRendererSize();

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
          chaseCamera: this.camera,
          terrain: this.terrain,
          debugDraw: this.debugDraw,
          topdown: this.topdown,
          onWireframeChange: (v) => this.terrain.setWireframe(v),
          onDebugVisible: (v) => this.debugDraw.setVisible(v),
          onTopdownVisible: (v) => this.topdown.setVisible(v),
          onTopdownWorldSpace: (v) => this.topdown.setWorldSpaceMode(v),
        });

    this.resizeObserver = new ResizeObserver(() => {
      this.syncRendererSize();
    });
    this.resizeObserver.observe(this.container);

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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.hud?.destroy();
    this.gui?.destroy();
    this.topdown.destroy();
    this.playerMesh.dispose();
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

  getMode7DefaultsSnapshot(): Mode7DefaultsSnapshot {
    return {
      depth: { ...this.world.depth.getParams() },
      bend: { ...this.world.bend.getParams() },
      camera: { ...this.camera.getParams() },
    };
  }

  /** Pasteable block for `src/mode7Defaults.ts` (depth, bend, chase camera). */
  mode7DefaultsSnippet(): string {
    return formatMode7DefaultsModuleSnippet(this.getMode7DefaultsSnapshot());
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

  /** Headless/agent diagnostics for chase-camera + inset issues. */
  getCameraDiagnostics(): Mode7CameraDiagnose {
    this.syncRendererSize();
    this.render();

    const cam = this.camera.camera;
    this.camera.update(this.player.y);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    const sp = this.playerMesh.mesh.position;
    const ndcTmp = new THREE.Vector3(sp.x, sp.y, sp.z);
    ndcTmp.project(cam);

    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const params = this.camera.getParams();
    const py = Number.isFinite(this.player.y) ? this.player.y : 0;
    const aimY = py + 0.5;
    const aimFromEyeUnit = new THREE.Vector3(0, aimY, 0).sub(cam.position).normalize();
    const dot = fwd.dot(aimFromEyeUnit);

    const dq = diagnosticChaseVersusThreeLookAtDeg(this.player.y, params);

    const rect = this.container.getBoundingClientRect();
    const cvs = this.renderer.domElement;
    const gl = this.renderer.getContext();

    const db = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(db);
    const bufW = Math.max(1, db.x);
    const bufH = Math.max(1, db.y);
    const glDbW = gl.drawingBufferWidth;
    const glDbH = gl.drawingBufferHeight;

    const clientW = Math.max(1, cvs.clientWidth);
    const clientH = Math.max(1, cvs.clientHeight);
    const pr = this.renderer.getPixelRatio();
    const expectedBufW = Math.floor(clientW * pr);
    const expectedBufH = Math.floor(clientH * pr);
    const vpAfterFrame = readGlViewport(gl);
    const viewportMatchesBuffer =
      vpAfterFrame !== null &&
      vpAfterFrame[0] === 0 &&
      vpAfterFrame[1] === 0 &&
      vpAfterFrame[2] === glDbW &&
      vpAfterFrame[3] === glDbH;
    const bufferMatchesClientDpr =
      Math.abs(cvs.width - expectedBufW) <= 1 && Math.abs(cvs.height - expectedBufH) <= 1;

    return {
      interpret: [...CAMERA_DIAGNOSE_HINTS],
      skipTopdown: this.skipTopdown,
      sphereWorld: { x: sp.x, y: sp.y, z: sp.z },
      sphereNdc: { x: ndcTmp.x, y: ndcTmp.y, z: ndcTmp.z },
      chaseCamera: {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        quaternionWxyz: [cam.quaternion.w, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z],
        worldForward: fwd.toArray(),
        aimFromEyeUnit: aimFromEyeUnit.toArray(),
        dotWorldForwardVersusAim: dot,
        aspect: cam.aspect,
        fov: cam.fov,
      },
      sizing: {
        containerRectCssWidth: rect.width,
        containerRectCssHeight: rect.height,
        canvasClientCssWidth: clientW,
        canvasClientCssHeight: clientH,
        canvasAttrWidth: cvs.width,
        canvasAttrHeight: cvs.height,
        canvasStyleWidth: cvs.style.width,
        canvasStyleHeight: cvs.style.height,
        drawingBufferWidthPx: bufW,
        drawingBufferHeightPx: bufH,
        glDrawingBufferWidth: glDbW,
        glDrawingBufferHeight: glDbH,
        pixelRatio: pr,
        devicePixelRatio: Math.round(window.devicePixelRatio * 100) / 100,
        cameraAspect: cam.aspect,
        bufferAspectRatio: bufW / bufH,
        cameraAspectMinusBufferAspect: cam.aspect - bufW / bufH,
        bufferPerCssPx: { sx: bufW / clientW, sy: bufH / clientH },
        viewportMatchesBuffer,
        bufferMatchesClientDpr,
      },
      lookAtComparison: { matrixVsPerspectiveLookAtDeg: dq },
      glViewport: { afterMainPass: this.glVpAfterMain, afterFrame: this.glVpAfterFrame },
    };
  }

  // --- Internals -----------------------------------------------------------

  private simulate(dt: number): void {
    if (dt > 0) this.controller.update(this.player, dt);
    this.player.y = this.world.depth.sampleBilinear(this.player.distance, 0);
    this.terrain.update(this.player.distance);
    this.playerMesh.update(this.player.distance, this.world);
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
    if (this.needsSizeHeal()) {
      this.syncRendererSize();
    }
    // Main pass must always use the full drawing buffer; the top-down overlay
    // uses scissor+viewport and must not leave a sub-rectangle active here.
    // Three.js setViewport/setScissor take logical (CSS) pixels; the renderer
    // multiplies by pixelRatio internally — do not pass drawing-buffer sizes.
    const { width, height } = logicalSizeOf(this.renderer.domElement);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.render(this.scene, this.camera.camera);
    this.sampleGlViewportInto('afterMainPass');

    if (!this.skipTopdown) {
      this.topdown.render(this.renderer, this.scene, {
        beforeUnskewed: () => this.terrain.pushUnskewedView(this.player.distance),
        afterUnskewed: () => this.terrain.popUnskewedView(),
      });
    }
    this.sampleGlViewportInto('afterFrame');
  }

  /** Reads `VIEWPORT`; call immediately after renderer operations of interest. */
  private sampleGlViewportInto(
    sink: 'afterMainPass' | 'afterFrame',
  ): [number, number, number, number] | null {
    const gl = this.renderer.getContext();
    const p = gl.getParameter(gl.VIEWPORT) as number[] | Float32Array | Int32Array | null;
    if (!p?.length || p.length < 4) {
      if (sink === 'afterMainPass') this.glVpAfterMain = null;
      else this.glVpAfterFrame = null;
      return null;
    }
    const t: [number, number, number, number] = [
      Number(p[0]),
      Number(p[1]),
      Number(p[2]),
      Number(p[3]),
    ];
    if (sink === 'afterMainPass') this.glVpAfterMain = t;
    else this.glVpAfterFrame = t;
    return t;
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

  /** Keep drawing buffer, camera aspect, and DPR aligned with `#app` layout. */
  private syncRendererSize(): void {
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    const { width, height } = sizeOf(this.container);
    this.renderer.setSize(width, height, false);
    this.camera.setAspect(width / height);
  }

  /** True when canvas bitmap size drifted from client CSS × pixel ratio. */
  private needsSizeHeal(): boolean {
    const cvs = this.renderer.domElement;
    const pr = this.renderer.getPixelRatio();
    const expectedW = Math.floor(Math.max(1, cvs.clientWidth) * pr);
    const expectedH = Math.floor(Math.max(1, cvs.clientHeight) * pr);
    return cvs.width !== expectedW || cvs.height !== expectedH;
  }

  private readonly handleResize = (): void => {
    this.syncRendererSize();
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

function readGlViewport(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): [number, number, number, number] | null {
  const p = gl.getParameter(gl.VIEWPORT) as number[] | Float32Array | Int32Array | null;
  if (!p?.length || p.length < 4) return null;
  return [Number(p[0]), Number(p[1]), Number(p[2]), Number(p[3])];
}

function sizeOf(el: HTMLElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height)),
  };
}

/** Logical canvas size for Three.js viewport/scissor (not drawing-buffer pixels). */
function logicalSizeOf(canvas: HTMLCanvasElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(canvas.clientWidth)),
    height: Math.max(1, Math.floor(canvas.clientHeight)),
  };
}

/** Bootstrap helper used by `main.ts`; also exported for tests/headless. */
export function bootstrap(opts: AppOptions): App {
  const app = new App(opts);
  installInspector(app);
  return app;
}
