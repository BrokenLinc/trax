import { MODE7_DEFAULTS } from '../mode7Defaults.ts';

/**
 * Vertical motion of the bike. The road can push `vy` up. Gravity pulls it
 * down. A crest launches when the road falls away faster than that pull.
 * Landing on the road sticks. While `enabled` is false the bike stays planted.
 */
export interface FlightParams {
  /** Crest launches and gravity. Off keeps the bike on the road. */
  enabled: boolean;
  /** Downward acceleration, m/s². Used only while enabled. */
  gravity: number;
}

/** @see MODE7_DEFAULTS.flight in `src/mode7Defaults.ts` */
export const DEFAULT_FLIGHT: FlightParams = MODE7_DEFAULTS.flight;

export interface FlightBody {
  /** Bike altitude in metres. The road sample while planted. */
  y: number;
  /** Metres/sec, up positive. */
  vy: number;
  airborne: boolean;
  /** Road height at the previous step. Null until the first sample. */
  prevGroundY: number | null;
}

/** Ignore a sub-millimetre separation so a flat road does not chatter. */
const LAUNCH_EPS_M = 1e-4;

/**
 * Advance one step against the road height under the bike. `dt <= 0` or a
 * missing previous sample plants the bike and forgets any carried fall.
 */
export function stepFlight(
  body: FlightBody,
  groundY: number,
  dt: number,
  params: FlightParams = DEFAULT_FLIGHT,
): void {
  if (!params.enabled) {
    plant(body, groundY, 0);
    return;
  }
  if (body.prevGroundY === null || dt <= 0) {
    plant(body, groundY, 0);
    return;
  }

  const groundVy = (groundY - body.prevGroundY) / dt;
  if (!body.airborne) {
    let vy = body.vy;
    if (groundVy > vy) vy = groundVy;
    vy -= params.gravity * dt;
    const y = body.y + vy * dt;
    if (y > groundY + LAUNCH_EPS_M) {
      body.airborne = true;
      body.y = y;
      body.vy = vy;
    } else {
      plant(body, groundY, groundVy);
    }
  } else {
    const vy = body.vy - params.gravity * dt;
    const y = body.y + vy * dt;
    if (y > groundY) {
      body.y = y;
      body.vy = vy;
    } else {
      plant(body, groundY, groundVy);
    }
  }
  body.prevGroundY = groundY;
}

function plant(body: FlightBody, groundY: number, vy: number): void {
  body.y = groundY;
  body.vy = vy;
  body.airborne = false;
  body.prevGroundY = groundY;
}
