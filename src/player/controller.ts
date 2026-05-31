import { MODE7_DEFAULTS } from '../mode7Defaults.ts';
import type { MeshLateralBounds } from '../render/meshLattice.ts';
import type { PlayerState } from './state.ts';

export interface ControllerParams {
  /** Acceleration when forward is held (rows/sec²). */
  accel: number;
  /** Acceleration when reverse is held (rows/sec²), positive value. */
  decel: number;
  /** Passive friction toward zero speed (rows/sec², applied as drag). */
  friction: number;
  /** Speed cap in either direction (rows/sec). */
  maxSpeed: number;
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

export const DEFAULT_CONTROLLER: ControllerParams = {
  accel: 18,
  decel: 22,
  friction: 6,
  maxSpeed: 30,
  strafeSpeedFactor: MODE7_DEFAULTS.player.strafeSpeedFactor,
  strafeAccel: MODE7_DEFAULTS.player.strafeAccel,
  driftFactor: MODE7_DEFAULTS.player.driftFactor,
};

/**
 * Listens to keyboard input and advances `player.distance` over time.
 *
 * Intentionally pure on `update()` — input state is captured in flags so
 * headless mode can drive the player by writing to those flags directly
 * (or skip the controller entirely and just set `player.distance`).
 */
export class PlayerController {
  forward = false;
  reverse = false;
  strafeLeft = false;
  strafeRight = false;
  boost = false;
  /** When true, ignore browser key events (used by headless tests). */
  headless = false;

  constructor(private params: ControllerParams = DEFAULT_CONTROLLER) {}

  attach(target: Window = window): () => void {
    const onDown = (e: KeyboardEvent): void => {
      if (this.headless) return;
      this.applyKey(e.code, true);
    };
    const onUp = (e: KeyboardEvent): void => {
      if (this.headless) return;
      this.applyKey(e.code, false);
    };
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    return () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
    };
  }

  getParams(): ControllerParams {
    return this.params;
  }

  setParams(params: ControllerParams): void {
    this.params = params;
  }

  /** Step the player by `dt` seconds. */
  update(
    player: PlayerState,
    dt: number,
    lateralBounds: MeshLateralBounds,
    rowSpacing: number,
    bendSlopeChange: number,
  ): void {
    const p = this.params;
    let accel = 0;
    if (this.forward) accel += p.accel * (this.boost ? 1.6 : 1);
    if (this.reverse) accel -= p.decel;
    if (!this.forward && !this.reverse) {
      const drag = Math.min(Math.abs(player.speed), p.friction * dt);
      player.speed -= Math.sign(player.speed) * drag;
    } else {
      player.speed += accel * dt;
    }
    if (player.speed > p.maxSpeed) player.speed = p.maxSpeed;
    if (player.speed < -p.maxSpeed) player.speed = -p.maxSpeed;
    const dRows = player.speed * dt;
    player.distance += dRows;

    if (p.driftFactor !== 0 && dRows !== 0) {
      player.lateralX += -dRows * bendSlopeChange * p.driftFactor;
    }

    const strafeDir = (this.strafeRight ? 1 : 0) + (this.strafeLeft ? -1 : 0);
    const maxStrafe =
      player.speed !== 0 ? p.strafeSpeedFactor * Math.abs(player.speed) * rowSpacing : 0;
    const targetLateralSpeed = strafeDir !== 0 && maxStrafe > 0 ? strafeDir * maxStrafe : 0;
    player.lateralSpeed = moveToward(player.lateralSpeed, targetLateralSpeed, p.strafeAccel * dt);
    if (maxStrafe > 0) {
      player.lateralSpeed = clamp(player.lateralSpeed, -maxStrafe, maxStrafe);
    } else {
      player.lateralSpeed = 0;
    }
    const nextLateralX = player.lateralX + player.lateralSpeed * dt;
    const clampedLateralX = clamp(nextLateralX, lateralBounds.minX, lateralBounds.maxX);
    if (clampedLateralX !== nextLateralX) {
      player.lateralSpeed = 0;
    }
    player.lateralX = clampedLateralX;
  }

  private applyKey(code: string, down: boolean): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.forward = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.reverse = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.strafeLeft = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.strafeRight = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.boost = down;
        break;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return current;
}
