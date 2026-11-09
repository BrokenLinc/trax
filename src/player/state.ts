/**
 * Player state — minimal because the player has no world position other
 * than a fractional row index. View-space X/Z stay at the origin; lateral
 * offset shifts the terrain and selects the depth-map column for Y.
 *
 * `distance` IS `playerRow`: 1 unit of distance = 1 row of the world.
 * Naming it "distance" reflects player intent ("I've travelled X units down
 * the road"); the renderer reads it as a row index.
 */
export interface PlayerState {
  distance: number;
  speed: number;
  /** Metres right of the road centreline (world X); clamped to mesh bounds. */
  lateralX: number;
  /** Metres/sec right of centreline; integrated into lateralX each frame. */
  lateralSpeed: number;
  /** Bike altitude in metres. The road while planted, above it in the air. */
  y: number;
  /** Metres/sec, up positive. The road pushes this; gravity pulls it down. */
  vy: number;
  /** True from a crest launch until the wheels meet the road. */
  airborne: boolean;
  /** Road height last step. Null after a teleport, until the next sample. */
  prevGroundY: number | null;
}

export function createPlayerState(initial: Partial<PlayerState> = {}): PlayerState {
  return {
    distance: initial.distance ?? 0,
    speed: initial.speed ?? 0,
    lateralX: initial.lateralX ?? 0,
    lateralSpeed: initial.lateralSpeed ?? 0,
    y: initial.y ?? 0,
    vy: initial.vy ?? 0,
    airborne: initial.airborne ?? false,
    prevGroundY: initial.prevGroundY ?? null,
  };
}
