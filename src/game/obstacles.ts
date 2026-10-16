import { GLOBE_RADIUS } from './globe.ts';

// `impact` is the speed the player hit this obstacle with; moving obstacles read and clear it.
// `movable` obstacles (traffic) get shoved instead of stopping the player.
// `ramCooldown` stops one overlap with a movable obstacle from slowing the player every physics step.
// Movable obstacles are capsules: `forward` is their facing as a unit (east, north) vector and `halfLength`
// the half distance between the end caps' centres, so long cars collide along their whole body.
export type Obstacle = {
  latitude: number; longitude: number; radius: number; impact?: number; movable?: boolean; ramCooldown?: number;
  forward?: [number, number]; halfLength?: number;
  // How the player's last hit on this obstacle was scored, so the struck car can react to match.
  hitKind?: 'side' | 'front';
  // The player was boosting when it hit this car: it gets thrown clear much harder.
  boostHit?: boolean;
};

// Hitboxes are smaller than the visible objects so near-misses don't count as crashes.
export const HITBOX_SCALE = 0.7;

// Player hits on traffic, read by the HUD: 'side' is a clip from beside, 'front' is a head-on nose-first hit.
// `side` is where the struck car was: 1 on the player's right, -1 on its left.
export type TrafficHit = { kind: 'side' | 'front'; speed: number; side: number; boosted?: boolean };
const trafficHits: TrafficHit[] = [];
export function reportTrafficHit(hit: TrafficHit) { trafficHits.push(hit); }
export function drainTrafficHits(): TrafficHit[] { return trafficHits.splice(0); }

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
    if (obstacle.movable) continue;
    const dz = (latitude - obstacle.latitude) * GLOBE_RADIUS;
    const dx = wrap(longitude - obstacle.longitude) * GLOBE_RADIUS * Math.cos((latitude + obstacle.latitude) * 0.5);
    if (Math.hypot(dx, dz) < obstacle.radius * HITBOX_SCALE + clearance) return obstacle;
  }
  return undefined;
}

// Closest points between segments p0→p1 and q0→q1 in the plane (all [east, north] in metres).
function segmentGap(p0: number[], p1: number[], q0: number[], q1: number[]) {
  const d1 = [p1[0] - p0[0], p1[1] - p0[1]], d2 = [q1[0] - q0[0], q1[1] - q0[1]], r = [p0[0] - q0[0], p0[1] - q0[1]];
  const a = d1[0] * d1[0] + d1[1] * d1[1], e = d2[0] * d2[0] + d2[1] * d2[1], f = d2[0] * r[0] + d2[1] * r[1];
  const c = d1[0] * r[0] + d1[1] * r[1], b = d1[0] * d2[0] + d1[1] * d2[1];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const denominator = a * e - b * b;
  // Parallel segments (cars side by side) have no unique closest pair; start from the midpoints so the push points across them.
  let s = a > 1e-9 && denominator > 1e-9 ? clamp((b * f - c * e) / denominator) : 0.5;
  let t = e > 1e-9 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = a > 1e-9 ? clamp(-c / a) : 0; } else if (t > 1) { t = 1; s = a > 1e-9 ? clamp((b - c) / a) : 0; }
  const pe = [p0[0] + d1[0] * s - q0[0] - d2[0] * t, p0[1] + d1[1] * s - q0[1] - d2[1] * t];
  return { distance: Math.hypot(pe[0], pe[1]), away: pe, s };
}

// `playerAlong` is where on the player's body the contact is, in metres from its centre (+ = nose).
export type TrafficContact = { obstacle: Obstacle; gap: number; away: [number, number]; playerAlong: number };

// What a contact means for scoring. Generous on purpose: only a car squarely ahead of the nose (within
// about 30°, a rear-end or a T-bone) is 'front'; any other clip, front corners included, is 'side'. A car
// behind the player (traffic rear-ending it) is not the player's hit at all.
export const FRONT_HIT_CONE = 0.86;
export function classifyTrafficHit(contact: TrafficContact, facing: [number, number]): 'front' | 'side' | undefined {
  const toward = facing[0] * contact.away[0] + facing[1] * contact.away[1];
  if (toward > 0.5) return undefined;
  return toward < -FRONT_HIT_CONE ? 'front' : 'side';
}

// The movable obstacle the capsule (centre, facing as unit [east, north], halfLength, radius) is closest to
// touching. `gap` < 0 means overlap; `away` is the unit direction pushing the capsule off the obstacle.
export function trafficContact(latitude: number, longitude: number, forward: [number, number], halfLength: number, radius: number): TrafficContact | undefined {
  let best: TrafficContact | undefined;
  for (const obstacle of flat) {
    if (!obstacle.movable) continue;
    const north = (obstacle.latitude - latitude) * GLOBE_RADIUS;
    const east = wrap(obstacle.longitude - longitude) * GLOBE_RADIUS * Math.cos((latitude + obstacle.latitude) * 0.5);
    if (Math.hypot(east, north) > 8) continue;
    const of = obstacle.forward ?? [0, 1], oh = obstacle.halfLength ?? 0;
    const { distance, away, s } = segmentGap(
      [-forward[0] * halfLength, -forward[1] * halfLength], [forward[0] * halfLength, forward[1] * halfLength],
      [east - of[0] * oh, north - of[1] * oh], [east + of[0] * oh, north + of[1] * oh],
    );
    const gap = distance - radius - obstacle.radius;
    if (best && gap >= best.gap) continue;
    const length = distance > 1e-6 ? distance : 1;
    best = {
      obstacle, gap, playerAlong: (2 * s - 1) * halfLength,
      away: distance > 1e-6 ? [away[0] / length, away[1] / length] : [1, 0],
    };
  }
  return best;
}
