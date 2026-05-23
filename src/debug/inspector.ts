import type { App } from '../app.ts';
import type { Mode7DefaultsSnapshot } from '../mode7Defaults.ts';

export interface Mode7CameraDiagnose {
  /** Guidance for interpreting the numeric block (screen-centre vs lane, A/B hints). */
  interpret: readonly string[];
  /** True when `--noTopdown` / URL `noTopdown=1` skips the inset pass entirely. */
  skipTopdown: boolean;
  sphereWorld: { x: number; y: number; z: number };
  /** After `sphereWorld.project(cam)` — expect x≈0 for horizontal screen centre. */
  sphereNdc: { x: number; y: number; z: number };
  chaseCamera: {
    position: { x: number; y: number; z: number };
    quaternionWxyz: [number, number, number, number];
    worldForward: [number, number, number];
    aimFromEyeUnit: [number, number, number];
    dotWorldForwardVersusAim: number;
    aspect: number;
    fov: number;
  };
  sizing: {
    containerRectCssWidth: number;
    containerRectCssHeight: number;
    canvasClientCssWidth: number;
    canvasClientCssHeight: number;
    canvasAttrWidth: number;
    canvasAttrHeight: number;
    canvasStyleWidth: string;
    canvasStyleHeight: string;
    drawingBufferWidthPx: number;
    drawingBufferHeightPx: number;
    glDrawingBufferWidth: number;
    glDrawingBufferHeight: number;
    pixelRatio: number;
    devicePixelRatio: number;
    cameraAspect: number;
    bufferAspectRatio: number;
    cameraAspectMinusBufferAspect: number;
    bufferPerCssPx: { sx: number; sy: number };
    viewportMatchesBuffer: boolean;
    bufferMatchesClientDpr: boolean;
  };
  lookAtComparison: {
    matrixVsPerspectiveLookAtDeg: number;
  };
  /** Last sampled after main pass and after the full render (requires a recent render/tick). */
  glViewport: {
    afterMainPass: readonly [number, number, number, number] | null;
    afterFrame: readonly [number, number, number, number] | null;
  };
}

/**
 * The agent-facing introspection API exposed on `window.__MODE7__`.
 *
 * Designed so that headless scripts (Playwright + tsx) can drive the demo
 * deterministically: pause the loop, set a seed and distance, advance N
 * frames at a fixed dt, then dump JSON state or capture a screenshot.
 *
 * Every method is JSON-friendly: arguments are plain values, return values
 * are plain objects (no Three.js refs leak across the boundary).
 */
export interface Mode7Inspector {
  ready: true;
  getState(): Mode7State;
  setSeed(seed: string): void;
  setDistance(distance: number): void;
  setSpeed(speed: number): void;
  setPaused(paused: boolean): void;
  setHeadless(headless: boolean): void;
  /** Advance `frames` frames using a fixed `dt` per frame (default 1/60). */
  tick(frames?: number, dt?: number): void;
  /** Snapshot the current bend window, prefix sums, and offsets. */
  dumpMesh(): Mode7MeshDump;
  /** Snapshot world params + a slice of bend/depth samples around the player. */
  dumpWorld(opts?: { rowsAhead?: number; rowsBehind?: number }): Mode7WorldDump;
  /** JSON snapshot of depth, bend, chase camera, and fog params (GUI + defaults source). */
  getMode7DefaultsSnapshot(): Mode7DefaultsSnapshot;
  /** Pasteable snippet for `MODE7_DEFAULTS` / `DEFAULT_WORLD_PARAMS` in `src/mode7Defaults.ts`. */
  mode7DefaultsSnippet(): string;
  /**
   * One-shot chase + inset diagnostics: NDC sphere projection, buffer sizing,
   * GL viewport snapshots from the last frame, Matrix4-vs-lookAt agreement.
   * Call after `tick()` so matrices and viewports reflect a rendered frame.
   */
  cameraDiagnose(): Mode7CameraDiagnose;
  /** Captures the current canvas as a base64 PNG data URL. */
  screenshot(): string;
}

export interface Mode7State {
  seed: string;
  distance: number;
  speed: number;
  playerY: number;
  fps: number;
  paused: boolean;
  headless: boolean;
  rowFloor: number;
  rowFrac: number;
}

export interface Mode7MeshDump {
  rowCount: number;
  cols: number;
  windowRowStart: number;
  bends: number[];
  prefix: number[];
  offsets: number[];
}

export interface Mode7WorldDump {
  seed: string;
  distance: number;
  depth: { params: Record<string, number>; centreColumn: number[] };
  bend: { params: Record<string, number>; samples: number[] };
}

declare global {
  interface Window {
    __MODE7__?: Mode7Inspector;
  }
}

export function installInspector(app: App): Mode7Inspector {
  const api: Mode7Inspector = {
    ready: true,
    getState: () => app.getState(),
    setSeed: (seed) => app.setSeed(seed),
    setDistance: (d) => app.setDistance(d),
    setSpeed: (s) => app.setSpeed(s),
    setPaused: (p) => app.setPaused(p),
    setHeadless: (h) => app.setHeadless(h),
    tick: (frames = 1, dt = 1 / 60) => app.tick(frames, dt),
    dumpMesh: () => app.dumpMesh(),
    dumpWorld: (opts) => app.dumpWorld(opts),
    getMode7DefaultsSnapshot: () => app.getMode7DefaultsSnapshot(),
    mode7DefaultsSnippet: () => app.mode7DefaultsSnippet(),
    cameraDiagnose: () => app.getCameraDiagnostics(),
    screenshot: () => app.screenshot(),
  };
  window.__MODE7__ = api;
  return api;
}
