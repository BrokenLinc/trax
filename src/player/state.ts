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
  /** Derived each frame; cached for HUD/inspector consumers. */
  y: number;
}

export function createPlayerState(initial: Partial<PlayerState> = {}): PlayerState {
  return {
    distance: initial.distance ?? 0,
    speed: initial.speed ?? 0,
    lateralX: initial.lateralX ?? 0,
    y: initial.y ?? 0,
  };
}
