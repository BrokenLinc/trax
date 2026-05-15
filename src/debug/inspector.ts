import type { App } from '../app.ts';

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
    screenshot: () => app.screenshot(),
  };
  window.__MODE7__ = api;
  return api;
}
