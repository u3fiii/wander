import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_CONFIG } from './config.ts';
import { initialLoopCar, stepLoopCar } from './driving.ts';
import { GLOBE_RADIUS, loopFrame, loopLatitude } from './globe.ts';
import { classifyTrafficHit, clearObstacleGroup, drainTrafficHits, setObstacleGroup, trafficContact } from './obstacles.ts';
import type { TrafficContact } from './obstacles.ts';
import type { Obstacle } from './obstacles.ts';

const eastNorth = (v: number[], latitude: number, longitude: number): [number, number] => {
  const east = Math.cos(longitude) * v[0] - Math.sin(longitude) * v[2];
  const north = -Math.sin(latitude) * Math.sin(longitude) * v[0] + Math.cos(latitude) * v[1] - Math.sin(latitude) * Math.cos(longitude) * v[2];
  const length = Math.hypot(east, north);
  return [east / length, north / length];
};

const controls = { forward: true, back: false, left: false, right: false, brake: false };
const pose = (car: ReturnType<typeof initialLoopCar>) => {
  const latitude = loopLatitude(car.x) + car.z / GLOBE_RADIUS;
  const frame = loopFrame(car.x, car.z);
  const left = [
    frame.normal[1] * frame.tangent[2] - frame.normal[2] * frame.tangent[1],
    frame.normal[2] * frame.tangent[0] - frame.normal[0] * frame.tangent[2],
    frame.normal[0] * frame.tangent[1] - frame.normal[1] * frame.tangent[0],
  ];
  const facing = frame.tangent.map((t, i) => t * Math.cos(car.heading) + left[i] * Math.sin(car.heading));
  return { latitude, longitude: car.x, facing: eastNorth(facing, latitude, car.x) };
};

test('the player cannot drive through a traffic car that stays put', () => {
  // Dry run: where the car is after 1.2 s at full throttle is where the traffic car will wait.
  const probe = initialLoopCar();
  for (let i = 0; i < 72; i++) stepLoopCar(probe, controls, 1 / 60);
  const spot = pose(probe);
  const npc: Obstacle = { latitude: spot.latitude, longitude: spot.longitude, radius: 0.55, halfLength: 0.6, movable: true, forward: spot.facing };
  setObstacleGroup('traffic', [npc]);
  try {
    const car = initialLoopCar();
    let worst = Infinity;
    for (let i = 0; i < 240; i++) {
      stepLoopCar(car, controls, 1 / 60);
      npc.ramCooldown = Math.max(0, (npc.ramCooldown ?? 0) - 1 / 60);
      const now = pose(car);
      const gap = trafficContact(now.latitude, now.longitude, now.facing, CAR_CONFIG.collisionHalfLength, CAR_CONFIG.trafficRadius)?.gap ?? Infinity;
      worst = Math.min(worst, gap);
    }
    assert.ok(npc.impact && npc.impact > 0, 'the car reached the traffic car');
    const hits = drainTrafficHits();
    assert.equal(hits.length, 1, 'one head-on hit is scored');
    assert.equal(hits[0].kind, 'front', 'a nose-first hit is scored as front');
    assert.ok(worst > -0.15, `overlapped the traffic car by ${(-worst).toFixed(2)} m`);
  } finally {
    clearObstacleGroup('traffic');
  }
});

test('hits are scored by which part of the car touched, and whether it was the player\'s doing', () => {
  const north: [number, number] = [0, 1];
  const contact = (playerAlong: number, away: [number, number]): TrafficContact =>
    ({ obstacle: {} as Obstacle, gap: -0.1, away, playerAlong });
  // Nose into a car ahead: the car is pushed back against its facing.
  assert.equal(classifyTrafficHit(contact(0.8, [0, -1]), north), 'front');
  // Front corner swerving into a car alongside: still a side clip.
  assert.equal(classifyTrafficHit(contact(0.8, [0.7, -0.7]), north), 'side');
  // Flank of the middle of the car: pushed sideways.
  assert.equal(classifyTrafficHit(contact(0, [1, 0]), north), 'side');
  // Rear of the car clipped from beside.
  assert.equal(classifyTrafficHit(contact(-0.6, [-1, 0]), north), 'side');
  // Traffic rear-ending the player is not scored.
  assert.equal(classifyTrafficHit(contact(-0.8, [0, 1]), north), undefined);
});
