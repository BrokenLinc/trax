import * as THREE from 'three';
import type GUI from 'lil-gui';

import { tangentSlopeChangeAtRow } from './world/bendField.ts';
import { World } from './world/world.ts';
import { ChaseCamera, diagnosticChaseVersusThreeLookAtDeg } from './render/camera.ts';
import { createScene, SceneFog } from './render/scene.ts';
import { TerrainMesh, type TerrainSnapshot } from './render/terrainMesh.ts';
import { PlayerMesh } from './render/playerMesh.ts';
import { SkyRig } from './render/skyRig.ts';
import {
  colorHex,
  DEFAULT_DAY_LENGTH_SECONDS,
  NOON,
  sampleDayNight,
  wrapDayTime,
  type DayNightSample,
} from './render/dayNight.ts';
import { SpriteLayer } from './render/spriteLayer.ts';
import { WaterPlane } from './render/waterPlane.ts';
import { DebugDraw } from './render/debugDraw.ts';
import { meshLateralBounds, signedColFromWorldX } from './render/meshLattice.ts';
import { PlayerController } from './player/controller.ts';
import { DEFAULT_FLIGHT, stepFlight, type FlightParams } from './player/flight.ts';
import { createPlayerState, type PlayerState } from './player/state.ts';
import { createEngineState, stepEngine, type EngineState } from './audio/engine.ts';
import { EngineSynth } from './audio/engineSynth.ts';
import { Hud } from './debug/hud.ts';
import { KeyOverlay } from './debug/keyOverlay.ts';
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
  /** When true, hides axes, centre line, and the aim marker (URL `noDebug=1`). */
  hideDebug?: boolean;
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
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly moonLight: THREE.DirectionalLight;
  private readonly headlight: THREE.SpotLight;
  private readonly tailLight: THREE.SpotLight;
  private readonly sceneFog: SceneFog;
  private readonly terrain: TerrainMesh;
  private readonly playerMesh: PlayerMesh;
  private readonly sprites: SpriteLayer;
  private readonly sky: SkyRig;
  private readonly water: WaterPlane;
  private readonly debugDraw: DebugDraw;
  private readonly controller: PlayerController;
  private readonly flightParams: FlightParams;
  private readonly player: PlayerState;
  private readonly hud: Hud | null;
  private readonly keys: KeyOverlay | null;
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
  private devOverlays = false;
  private headlightOn = false;
  private engineOn = false;
  private readonly engine: EngineState = createEngineState();
  private readonly engineSynth: EngineSynth | null;
  private readonly day = { timeOfDay: NOON, dayLength: DEFAULT_DAY_LENGTH_SECONDS };
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
    // Sprites are unlit cards. The rider's contact is a blob, not a shadow map.
    this.renderer.shadowMap.enabled = false;
    this.container.appendChild(this.renderer.domElement);

    const rig = createScene();
    this.scene = rig.scene;
    this.ambient = rig.ambient;
    this.sun = rig.sun;
    this.moonLight = rig.moon;
    this.sceneFog = new SceneFog(this.scene);
    this.headlight = new THREE.SpotLight(0xfff1d4, 0, 156, 0.55, 0.92, 0.22);
    this.headlight.castShadow = false;
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);
    // Wide soft cone. Decay matches the headlight so the lower intensity stays local.
    this.tailLight = new THREE.SpotLight(0xff2210, 0, 18, 1.5, 0.84, 0.22);
    this.tailLight.castShadow = false;
    this.scene.add(this.tailLight);
    this.scene.add(this.tailLight.target);

    this.world = new World(opts.seed);
    this.water = new WaterPlane();
    this.scene.add(this.water.mesh);

    this.terrain = new TerrainMesh(this.world);
    this.scene.add(this.terrain.mesh);

    this.sprites = new SpriteLayer(this.terrain.mesh, this.world, this.terrain);
    this.sky = new SkyRig();
    this.scene.add(this.sky.group);

    this.playerMesh = new PlayerMesh();
    this.scene.add(this.playerMesh.mesh);

    this.debugDraw = new DebugDraw(this.terrain.getRowCount());
    if (opts.hideDebug) this.debugDraw.setVisible(false);
    this.scene.add(this.debugDraw.group);
    this.terrain.setRowCountSink((n) => this.debugDraw.setRowCount(n));

    this.camera = new ChaseCamera(1);
    this.syncRendererSize();

    this.player = createPlayerState({ distance: opts.initialDistance });
    this.controller = new PlayerController();
    this.flightParams = { ...DEFAULT_FLIGHT };
    this.controller.headless = opts.headless;
    this.engineSynth = opts.headless ? null : new EngineSynth();

    this.hud = opts.headless ? null : new Hud(this.container);
    this.keys = opts.headless
      ? null
      : new KeyOverlay(this.container, {
          onWireframe: () => this.toggleWireframe(),
          onTopdown: () => this.toggleTopdown(),
          onDevOverlays: () => this.setDevOverlays(!this.devOverlays),
          onReseed: () => this.reseed(),
          onPause: () => this.setPaused(!this.paused),
          onCamera: () => this.toggleCameraMode(),
          onHeadlight: () => this.toggleHeadlight(),
          onEngine: () => this.toggleEngine(),
        });
    // Always create the top-down: it's useful in headless screenshots too.
    // Pass a parent only when we actually have a visible DOM container.
    this.topdown = new TopDownView(opts.headless ? null : this.container);
    this.gui = opts.headless
      ? null
      : buildGui({
          controller: this.controller,
          flight: this.flightParams,
          world: this.world,
          chaseCamera: this.camera,
          sceneFog: this.sceneFog,
          terrain: this.terrain,
          water: this.water,
          debugDraw: this.debugDraw,
          topdown: this.topdown,
          sky: this.sky,
          dayClock: this.day,
          onTimeOfDay: () => this.applyDay(sampleDayNight(this.day.timeOfDay)),
          onWireframeChange: (v) => this.terrain.setWireframe(v),
          onDebugVisible: (v) => this.debugDraw.setVisible(v),
          onTopdownVisible: (v) => this.topdown.setVisible(v),
          onTopdownWorldSpace: (v) => this.topdown.setWorldSpaceMode(v),
        });
    this.setDevOverlays(false);

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
      else this.refreshOverlays();
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
    this.engineSynth?.dispose();
    this.hud?.destroy();
    this.keys?.destroy();
    this.gui?.destroy();
    this.topdown.destroy();
    this.playerMesh.dispose();
    this.sprites.dispose();
    this.sky.dispose();
    this.water.dispose();
    this.terrain.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- Inspector / headless control surface --------------------------------

  setPaused(p: boolean): void {
    this.paused = p;
    this.refreshOverlays();
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
    this.player.prevGroundY = null;
    this.simulate(0);
    this.render();
  }

  setSpeed(speed: number): void {
    this.player.speed = speed;
  }

  setLateralX(lateralX: number): void {
    const tp = this.terrain.getParams();
    const bounds = meshLateralBounds(tp.cols, tp.roadColSpacing, tp.landscapeColSpacing);
    this.player.lateralX = Math.min(bounds.maxX, Math.max(bounds.minX, lateralX));
    this.simulate(0);
    this.render();
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
      lateralX: this.player.lateralX,
      playerY: this.player.y,
      fps: this.fps,
      paused: this.paused,
      headless: this.headless,
      rowFloor: lo,
      rowFrac: this.player.distance - lo,
    };
  }

  getMode7DefaultsSnapshot(): Mode7DefaultsSnapshot {
    const terrain = this.terrain.getParams();
    return {
      depth: { ...this.world.depth.getParams() },
      bend: { ...this.world.bend.getParams() },
      camera: { ...this.camera.getParams() },
      fog: { ...this.sceneFog.getParams() },
      terrain: {
        rowSpacing: terrain.rowSpacing,
        roadColSpacing: terrain.roadColSpacing,
        landscapeColSpacing: terrain.landscapeColSpacing,
      },
      water: { y: this.water.getParams().y },
      player: { ...this.controller.getParams() },
      flight: { ...this.flightParams },
    };
  }

  /** Pasteable block for `src/mode7Defaults.ts` (procedural, camera, fog, terrain, water, player). */
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
    const chaseCtx = this.chaseRigContext();
    this.camera.update(chaseCtx);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    const sp = this.playerMesh.mesh.position;
    const ndcTmp = new THREE.Vector3(sp.x, sp.y, sp.z);
    ndcTmp.project(cam);

    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const params = this.camera.getParams();
    const ahead = Math.max(0, params.aheadMeters);
    const aimRow = this.player.distance + ahead / chaseCtx.rowSpacing;
    const aimY = this.world.depth.sampleBilinear(aimRow, 0) + params.aimElevation;
    const aimFromEyeUnit = new THREE.Vector3(0, aimY, -ahead).sub(cam.position).normalize();
    const dot = fwd.dot(aimFromEyeUnit);

    const dq = diagnosticChaseVersusThreeLookAtDeg(chaseCtx, params);

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

  /**
   * Tangent-aligned sideways offset of the road one fog-distance ahead, in
   * metres. The sample stays on the fractional row `player + ahead`. Reading
   * the integer row ahead of `floor(player)` instead walks back along that
   * fixed row and snaps forward at every crossing, which is the sawtooth.
   */
  private roadSwing(): number {
    const playerRow = this.player.distance;
    const offsets = this.terrain.snapshot().offsets;
    const start = this.terrain.getWindowRowStart(playerRow);
    const ahead = this.sceneFog.getParams().far / this.terrain.getParams().rowSpacing;
    const target = playerRow + ahead;
    const row = Math.floor(target);
    const last = offsets.length - 1;
    if (last < 0) return 0;
    const index = Math.min(last, Math.max(0, row - start));
    const here = offsets[index] ?? 0;
    const next = offsets[Math.min(last, index + 1)] ?? here;
    const frac = target - row;
    return here + frac * (next - here);
  }

  private chaseRigContext(): {
    playerGroundY: number;
    distance: number;
    world: World;
    rowSpacing: number;
  } {
    return {
      playerGroundY: this.player.y,
      distance: this.player.distance,
      world: this.world,
      rowSpacing: this.terrain.getParams().rowSpacing,
    };
  }

  private simulate(dt: number): void {
    const tp = this.terrain.getParams();
    const bounds = meshLateralBounds(tp.cols, tp.roadColSpacing, tp.landscapeColSpacing);
    if (dt > 0) {
      const bendSlopeChange = tangentSlopeChangeAtRow(this.player.distance, this.world.bend);
      this.controller.update(
        this.player,
        dt,
        bounds,
        tp.rowSpacing,
        bendSlopeChange,
        this.player.airborne,
      );
    }
    const depthCol = signedColFromWorldX(
      this.player.lateralX,
      tp.roadColSpacing,
      tp.landscapeColSpacing,
    );
    const groundY = this.world.depth.sampleBilinear(this.player.distance, depthCol);
    stepFlight(this.player, groundY, dt, this.flightParams);
    this.terrain.update(this.player.distance, this.player.lateralX);
    this.sprites.update(this.player.distance);
    this.playerMesh.update(
      this.player.distance,
      this.world,
      this.player.lateralX,
      tp.roadColSpacing,
      tp.landscapeColSpacing,
      this.player.speed,
      this.player.lateralSpeed,
      this.player.y,
      this.player.airborne,
    );
    this.debugDraw.updateCentreLine(
      this.terrain.snapshot().offsets,
      this.terrain.getParams().rowSpacing,
      this.player.distance,
    );
    const camParams = this.camera.getParams();
    this.debugDraw.updateAimTarget(
      this.player.distance,
      this.world,
      camParams.aheadMeters,
      camParams.aimElevation,
      this.terrain.getParams().rowSpacing,
    );
    this.camera.update(this.chaseRigContext());
    this.debugDraw.setAimVisible(this.camera.getMode() === 'aim');
    if (dt > 0) {
      this.day.timeOfDay = wrapDayTime(this.day.timeOfDay + dt / Math.max(1, this.day.dayLength));
    }
    if (dt > 0) {
      stepEngine(
        this.engine,
        {
          speed: this.player.speed,
          throttle: this.controller.forward || this.controller.boost,
        },
        dt,
      );
    }
    if (this.engineOn) this.engineSynth?.setRpm(this.engine.rpm);
    const day = sampleDayNight(this.day.timeOfDay);
    this.applyDay(day);
    this.sky.update(this.camera.camera.position.y, this.roadSwing(), day);
    this.topdown.update(this.player.y);
    this.refreshOverlays();
  }

  /** HUD and keycaps. Runs while paused so a held key still reads as pressed. */
  private refreshOverlays(): void {
    if (this.hud) {
      const lo = Math.floor(this.player.distance);
      this.hud.update({
        fps: this.fps,
        seed: this.world.getSeed(),
        distance: this.player.distance,
        speed: this.player.speed,
        lateralX: this.player.lateralX,
        playerY: this.player.y,
        rowFloor: lo,
        rowFrac: this.player.distance - lo,
        bendAtPlayer: this.world.bend.sample(lo),
        gear: this.engine.gear + 1,
        rpm: this.engine.rpm,
        paused: this.paused,
        headless: this.headless,
      });
    }
    this.keys?.update({
      wireframe: this.terrain.isWireframe(),
      topdown: this.topdown.isVisible(),
      devOverlays: this.devOverlays,
      paused: this.paused,
      cameraLevel: this.camera.getMode() === 'level',
      headlight: this.headlightOn,
      engine: this.engineOn,
    });
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
        beforeUnskewed: () =>
          this.terrain.pushUnskewedView(this.player.distance, this.player.lateralX),
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
    if (e.repeat) return;
    const target = e.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        return;
      }
      if (e.code === 'Escape' && target.closest('.mode7-keys')) e.preventDefault();
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      this.setPaused(!this.paused);
    } else if (e.code === 'KeyR') {
      this.reseed();
    } else if (e.code === 'KeyG') {
      this.toggleWireframe();
    } else if (e.code === 'KeyV') {
      this.toggleTopdown();
    } else if (e.code === 'KeyU') {
      this.topdown.setWorldSpaceMode(!this.topdown.isWorldSpaceMode());
    } else if (e.code === 'KeyC') {
      this.toggleCameraMode();
    } else if (e.code === 'KeyH') {
      this.toggleHeadlight();
    } else if (e.code === 'KeyM') {
      this.toggleEngine();
    } else if (e.code === 'Backquote') {
      this.setDevOverlays(!this.devOverlays);
    }
  };

  /** `time` wraps. 0 is midnight, 0.5 is noon. */
  setTimeOfDay(time: number): void {
    this.day.timeOfDay = wrapDayTime(time);
    this.simulate(0);
    this.render();
  }

  setHeadlight(on: boolean): void {
    this.headlightOn = on;
    this.applyDay(sampleDayNight(this.day.timeOfDay));
    this.render();
  }

  private toggleWireframe(): void {
    this.terrain.setWireframe(!this.terrain.isWireframe());
  }

  private toggleTopdown(): void {
    this.topdown.setVisible(!this.topdown.isVisible());
  }

  private toggleCameraMode(): void {
    this.camera.toggleMode();
  }

  private toggleHeadlight(): void {
    this.headlightOn = !this.headlightOn;
    this.applyDay(sampleDayNight(this.day.timeOfDay));
    this.refreshOverlays();
  }

  private toggleEngine(): void {
    this.engineOn = !this.engineOn;
    if (!this.engineSynth) return;
    if (this.engineOn) this.engineSynth.setRpm(this.engine.rpm);
    this.engineSynth.setEnabled(this.engineOn);
    this.refreshOverlays();
  }

  private applyDay(day: DayNightSample): void {
    this.sceneFog.setColor(colorHex(day.fog));
    this.ambient.color.setRGB(day.ambient.color.r, day.ambient.color.g, day.ambient.color.b);
    this.ambient.intensity = day.ambient.intensity;
    this.sun.color.setRGB(day.sun.color.r, day.sun.color.g, day.sun.color.b);
    this.sun.intensity = day.sun.intensity;
    this.sun.position.set(day.sun.x, day.sun.y, day.sun.z);
    this.moonLight.color.setRGB(
      day.moonLight.color.r,
      day.moonLight.color.g,
      day.moonLight.color.b,
    );
    this.moonLight.intensity = day.moonLight.intensity;
    this.moonLight.position.set(day.moonLight.x, day.moonLight.y, day.moonLight.z);
    this.headlight.intensity = this.headlightOn ? 52.5 : 0;
    this.headlight.visible = this.headlightOn;
    this.tailLight.intensity = this.headlightOn ? 16 : 0;
    this.tailLight.visible = this.headlightOn;
    this.playerMesh.setTailLight(this.headlightOn);
    const y = this.player.y;
    // Ahead of the rider, aimed down the lane, so the cone is a corridor not a puddle.
    this.headlight.position.set(0, y + 1.15, -1.6);
    this.headlight.target.position.set(0, y + 0.2, -46);
    // Mostly down, biased behind the tire. A level beam faces the camera and
    // misses the frame; this still points backward and lays a wide pool on
    // the lane around the rear wheel.
    this.tailLight.position.set(0, y + 0.8, 0.08);
    this.tailLight.target.position.set(0, y - 2.8, 0.55);
  }

  private reseed(): void {
    this.world.reseed(`${this.world.getSeed()}+${Math.floor(Math.random() * 1e6)}`);
    this.terrain.setWorld(this.world);
  }

  /** Raw HUD and the lil-gui panel. The key strip stays up. */
  private setDevOverlays(on: boolean): void {
    this.devOverlays = on;
    this.hud?.setVisible(on);
    if (!this.gui) return;
    if (on) this.gui.show();
    else this.gui.hide();
  }
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
