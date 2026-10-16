import { GLOBE_RADIUS } from './globe.ts';

// `impact` is the speed the player hit this obstacle with; moving obstacles read and clear it.
// `movable` obstacles (traffic) get shoved instead of stopping the player.
// `ramCooldown` stops one overlap with a movable obstacle from slowing the player every physics step.
export type Obstacle = { latitude: number; longitude: number; radius: number; impact?: number; movable?: boolean; ramCooldown?: number };

// Hitboxes are smaller than the visible objects so near-misses don't count as crashes.
export const HITBOX_SCALE = 0.7;

const groups = new Map<string, Obstacle[]>();
let flat: Obstacle[] = [];

function rebuild() {
  flat = [...groups.values()].flat();
}

export function setObstacleGroup(key: string, obstacles: Obstacle[]) {
  groups.set(key, obstacles);
  rebuild();
}

export function clearObstacleGroup(key: string) {
  groups.delete(key);
  rebuild();
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export function obstacleAt(latitude: number, longitude: number, clearance: number): Obstacle | undefined {
  for (const obstacle of flat) {
    const dz = (latitude - obstacle.latitude) * GLOBE_RADIUS;
    const dx = wrap(longitude - obstacle.longitude) * GLOBE_RADIUS * Math.cos((latitude + obstacle.latitude) * 0.5);
    if (Math.hypot(dx, dz) < obstacle.radius * HITBOX_SCALE + clearance) return obstacle;
  }
  return undefined;
}
