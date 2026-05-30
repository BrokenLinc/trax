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
   * Strafe speed as a fraction of forward world speed (|speed| × rowSpacing).
   * No strafe when |speed| is zero.
   */
  strafeSpeedFactor: number;
}

export const DEFAULT_CONTROLLER: ControllerParams = {
  accel: 18,
  decel: 22,
  friction: 6,
  maxSpeed: 30,
  strafeSpeedFactor: MODE7_DEFAULTS.player.strafeSpeedFactor,
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
    player.distance += player.speed * dt;

    const strafeDir = (this.strafeRight ? 1 : 0) + (this.strafeLeft ? -1 : 0);
    if (strafeDir !== 0 && player.speed !== 0) {
      const strafeSpeed = p.strafeSpeedFactor * Math.abs(player.speed) * rowSpacing;
      player.lateralX = clamp(
        player.lateralX + strafeDir * strafeSpeed * dt,
        lateralBounds.minX,
        lateralBounds.maxX,
      );
    }
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
