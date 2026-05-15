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
}

export const DEFAULT_CONTROLLER: ControllerParams = {
  accel: 18,
  decel: 22,
  friction: 6,
  maxSpeed: 30,
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

  setParams(params: ControllerParams): void {
    this.params = params;
  }

  /** Step the player by `dt` seconds. */
  update(player: PlayerState, dt: number): void {
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
      case 'ShiftLeft':
      case 'ShiftRight':
        this.boost = down;
        break;
    }
  }
}
