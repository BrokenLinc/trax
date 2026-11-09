/**
 * Vertical motion of the bike. The road can push `vy` up. Gravity pulls it
 * down. A crest launches when the road falls away faster than that pull.
 * Landing on the road sticks.
 */
export interface FlightParams {
  /** Downward acceleration, m/s². */
  gravity: number;
}

export const DEFAULT_FLIGHT: FlightParams = {
  gravity: 66,
};

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
