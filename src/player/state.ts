/**
 * Player state — minimal because the player has no world position other
 * than a fractional row index. X/Z are pinned to the origin; Y is derived
 * from the depth map every frame.
 *
 * `distance` IS `playerRow`: 1 unit of distance = 1 row of the world.
 * Naming it "distance" reflects player intent ("I've travelled X units down
 * the road"); the renderer reads it as a row index.
 */
export interface PlayerState {
  distance: number;
  speed: number;
  /** Derived each frame; cached for HUD/inspector consumers. */
  y: number;
}

export function createPlayerState(initial: Partial<PlayerState> = {}): PlayerState {
  return {
    distance: initial.distance ?? 0,
    speed: initial.speed ?? 0,
    y: initial.y ?? 0,
  };
}
