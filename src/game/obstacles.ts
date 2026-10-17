import { GLOBE_RADIUS } from './globe.ts';
import { difficulty } from './difficulty.ts';

// `impact` is the speed the player hit this obstacle with; moving obstacles read and clear it.
// `movable` obstacles (traffic) get shoved instead of stopping the player.
// `ramCooldown` stops one overlap with a movable obstacle from slowing the player every physics step.
// Movable obstacles are capsules: `forward` is their facing as a unit (east, north) vector and `halfLength`
// the half distance between the end caps' centres, so long cars collide along their whole body.
export type Obstacle = {
  latitude: number; longitude: number; radius: number; impact?: number; movable?: boolean; ramCooldown?: number;
  forward?: [number, number]; halfLength?: number;
  // Movable obstacles: how fast (m/s) the car is driving along `forward`, so hits and near misses can use the
  // closing speed between the two cars rather than the player's speed alone.
  velocity?: number;
  // A traffic car that is off the road for now (fewer cars at low levels): it is ignored entirely.
  inactive?: boolean;
  // How the player's last hit on this obstacle was scored, so the struck car can react to match.
  hitKind?: 'side' | 'front';
  // The player was boosting when it hit this car: it gets thrown clear much harder.
  boostHit?: boolean;
};

// Hitboxes are smaller than the visible objects so near-misses don't count as crashes.
export const HITBOX_SCALE = 0.7;

// Player hits on traffic, read by the HUD: 'side' is a clip from beside, 'front' is a head-on nose-first hit.
// `side` is where the struck car was: 1 on the player's right, -1 on its left. `closing` is how fast (m/s) the two
// cars were coming together along the contact: high for a real smash, low for a nudge or a glancing scrape.
// `cinematic` is set by the scene when the hit got the slow-motion cut-in (the HUD then shows it big).
export type TrafficHit = { kind: 'side' | 'front'; speed: number; side: number; boosted?: boolean; closing: number; cinematic?: boolean };
const trafficHits: TrafficHit[] = [];
export function reportTrafficHit(hit: TrafficHit) { trafficHits.push(hit); }
export function drainTrafficHits(): TrafficHit[] { return trafficHits.splice(0); }

// Near misses: the player flashed past a traffic car at speed without touching it. `speed` is the relative
// speed of the pass (m/s), `gap` the closest the two bodies got (m), `side` as for hits.
export type NearMiss = { speed: number; gap: number; side: number; cinematic?: boolean };
const nearMisses: NearMiss[] = [];
export function drainNearMisses(): NearMiss[] { return nearMisses.splice(0); }

// One pass by an obstacle, from the moment it comes within `NEAR_MISS.watch` until it is left behind. A pass
// counts once the bodies have been within `gap` of each other, never touched, and start pulling apart (so the
// slow motion lands while the player is still right beside the thing it dodged, not after). Traffic and
// static things (trees, poles, rocks, houses: threading past them off the road) are tracked separately.
// How close and how fast a pass must be come from the difficulty (generous at low levels); `gap` here is only
// the scale the reported gap is given on, for scoring.
export const NEAR_MISS = { watch: 1.6, gap: 0.65, separate: 0.06, minPlayerSpeed: 8 };
type Pass = { obstacle: Obstacle; closest: number; touched: boolean; reported: boolean; speed: number; side: number };
function passTracker(gapLimit: () => number) {
  let pass: Pass | undefined;
  return {
    reset() { pass = undefined; },
    // Called every physics step with the closest obstacle (or none), the relative speed and which side it is on.
    track(near: { obstacle: Obstacle; gap: number } | undefined, relativeSpeed: number, playerSpeed: number, side: number, boosting: boolean, touched = false) {
      if (!near || near.gap > NEAR_MISS.watch || (pass && pass.obstacle !== near.obstacle)) pass = undefined;
      if (!near || near.gap > NEAR_MISS.watch) return;
      pass ??= { obstacle: near.obstacle, closest: Infinity, touched: false, reported: false, speed: 0, side };
      if (near.gap < 0 || touched) pass.touched = true;
      if (near.gap <= pass.closest) { pass.closest = near.gap; pass.speed = relativeSpeed; pass.side = side; return; }
      const maxGap = gapLimit();
      if (pass.reported || pass.touched || boosting || pass.closest > maxGap) return;
      if (near.gap - pass.closest < NEAR_MISS.separate) return;
      pass.reported = true;
      if (pass.speed >= difficulty.nearMissSpeed && playerSpeed >= NEAR_MISS.minPlayerSpeed) nearMisses.push({ speed: pass.speed, gap: pass.closest / maxGap * NEAR_MISS.gap, side: pass.side });
    },
  };
}
const trafficPasses = passTracker(() => difficulty.nearMissGap);
const staticPasses = passTracker(() => difficulty.nearMissStaticGap);
export function resetNearMiss() { trafficPasses.reset(); staticPasses.reset(); }
export function trackNearMiss(contact: TrafficContact | undefined, relativeSpeed: number, playerSpeed: number, side: number, boosting: boolean) {
  trafficPasses.track(contact, relativeSpeed, playerSpeed, side, boosting);
}
// `touched`: the player ran into a static obstacle this step (even if it then slid round it).
export function trackStaticNearMiss(latitude: number, longitude: number, clearance: number, facing: [number, number], playerSpeed: number, boosting: boolean, touched: boolean) {
  const near = nearestStatic(latitude, longitude, clearance);
  const side = near && facing[0] * near.away[1] - facing[1] * near.away[0] > 0 ? 1 : -1;
  staticPasses.track(near, playerSpeed, playerSpeed, side, boosting, touched);
}

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

// The closest static obstacle within a few metres, with the gap between its hitbox and a circle of `clearance`
// (the same test as obstacleAt, so gap < 0 is a hit) and the unit [east, north] direction from it to the point.
function nearestStatic(latitude: number, longitude: number, clearance: number) {
  let best: { obstacle: Obstacle; gap: number; away: [number, number] } | undefined;
  for (const obstacle of flat) {
    if (obstacle.movable) continue;
    const north = (latitude - obstacle.latitude) * GLOBE_RADIUS;
    const east = wrap(longitude - obstacle.longitude) * GLOBE_RADIUS * Math.cos((latitude + obstacle.latitude) * 0.5);
    const distance = Math.hypot(east, north);
    const gap = distance - obstacle.radius * HITBOX_SCALE - clearance;
    if (gap > NEAR_MISS.watch || (best && gap >= best.gap)) continue;
    best = { obstacle, gap, away: distance > 1e-6 ? [east / distance, north / distance] : [1, 0] };
  }
  return best;
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
    if (!obstacle.movable || obstacle.inactive) continue;
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
