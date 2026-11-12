/**
 * Four-speed twin. Road speed couples each gear to an RPM; throttle can
 * pull above that coupling. Shifts scale RPM by the ratio change, which
 * is the short drop (or rise) you hear.
 */

export const ENGINE_IDLE_RPM = 850;
export const ENGINE_REDLINE_RPM = 6500;
/** Upshift once the engine is this close to redline. */
export const ENGINE_UPSHIFT_RPM = 6000;
/**
 * Downshift when the current gear's coupled RPM falls to this. Kept below
 * the RPM a just-completed upshift lands on, so the box does not hunt.
 */
export const ENGINE_DOWNSHIFT_COUPLED_RPM = 2600;
/** Refuse an upshift whose next gear would still be near idle. */
export const ENGINE_NEXT_GEAR_MIN_RPM = 3200;
export const ENGINE_REV_UP_PER_SEC = 5200;
export const ENGINE_REV_DOWN_PER_SEC = 3400;

/** RPM above idle for each row/sec of road speed, 1st through 4th. */
export const ENGINE_GEAR_RATIOS: readonly number[] = [500, 280, 165, 105];

export interface EngineInput {
  /** Rows/sec. Sign is ignored; reverse uses the same gears. */
  speed: number;
  /** True while forward or boost is held, including in the air. */
  throttle: boolean;
}

export interface EngineState {
  rpm: number;
  /** 0 is 1st gear. */
  gear: number;
}

export function createEngineState(): EngineState {
  return { rpm: ENGINE_IDLE_RPM, gear: 0 };
}

export function coupledRpm(speed: number, gear: number): number {
  const ratio = ratioAt(gear);
  const raw = ENGINE_IDLE_RPM + Math.abs(speed) * ratio;
  return clamp(raw, ENGINE_IDLE_RPM, ENGINE_REDLINE_RPM);
}

export function stepEngine(state: EngineState, input: EngineInput, dt: number): void {
  if (dt <= 0) return;
  state.gear = clampGear(state.gear);
  const coupled = coupledRpm(input.speed, state.gear);
  const demand = input.throttle ? ENGINE_REDLINE_RPM : coupled;
  const rate = state.rpm < demand ? ENGINE_REV_UP_PER_SEC : ENGINE_REV_DOWN_PER_SEC;
  state.rpm = moveToward(state.rpm, demand, rate * dt);

  const next = state.gear + 1;
  const prev = state.gear - 1;
  if (
    next < ENGINE_GEAR_RATIOS.length &&
    state.rpm >= ENGINE_UPSHIFT_RPM &&
    coupledRpm(input.speed, next) >= ENGINE_NEXT_GEAR_MIN_RPM
  ) {
    shift(state, next);
  } else if (prev >= 0 && coupled <= ENGINE_DOWNSHIFT_COUPLED_RPM) {
    shift(state, prev);
  }
  state.rpm = clamp(state.rpm, ENGINE_IDLE_RPM, ENGINE_REDLINE_RPM);
}

function shift(state: EngineState, toGear: number): void {
  const from = ratioAt(state.gear);
  const to = ratioAt(toGear);
  state.rpm *= to / from;
  state.gear = toGear;
}

function ratioAt(gear: number): number {
  return ENGINE_GEAR_RATIOS[clampGear(gear)] ?? ENGINE_GEAR_RATIOS[0] ?? 1;
}

function clampGear(gear: number): number {
  return clamp(gear, 0, ENGINE_GEAR_RATIOS.length - 1);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return current;
}
