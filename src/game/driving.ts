import { BLOCKS, CAR_CONFIG, DRIVE, LOOP_DRIVE } from './config.ts';
import { FULL_TURN, GLOBE_RADIUS, loopFrame, loopLatitude } from './globe.ts';
import type { Vec3 } from './globe.ts';
import { WORLD_SETTINGS, distanceToRoadNetwork, landInfluence } from './worldMap.ts';
import { obstacleAt } from './obstacles.ts';

export type CarState = {
  // On the globe: longitude, latitude offset in metres, heading from the road tangent.
  x: number; z: number; heading: number; speed: number; steering: number; distance: number;
  wheelTravel: number; acceleration: number; yawRate: number; waterTravel: number;
};
export type Controls = { forward: boolean; back: boolean; left: boolean; right: boolean; brake: boolean };
export const emptyControls = (): Controls => ({ forward: false, back: false, left: false, right: false, brake: false });
export const initialCar = (): CarState => ({ ...DRIVE.spawn, speed: 0, steering: 0, distance: 0, wheelTravel: 0, acceleration: 0, yawRate: 0, waterTravel: 0 });
export const initialLoopCar = (): CarState => ({ ...initialCar(), x: 0, z: 0, heading: 0 });
const toward = (n: number, target: number, amount: number) => n < target ? Math.min(n + amount, target) : Math.max(n - amount, target);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const blend = (a: Vec3, b: Vec3, ca: number, cb: number): Vec3 => [a[0] * ca + b[0] * cb, a[1] * ca + b[1] * cb, a[2] * ca + b[2] * cb];

export function stepLoopCar(car: CarState, controls: Controls, delta: number, respectWater = false): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  const elapsed = Math.min(delta, LOOP_DRIVE.maxFrameDelta);
  const steps = Math.ceil(elapsed / LOOP_DRIVE.physicsStep);
  for (let i = 0; i < steps; i++) integrateLoopCar(car, controls, elapsed / steps, respectWater);
}

const isDrifting = (car: CarState, controls: Controls) => controls.brake
  && (controls.left || controls.right) && Math.abs(car.speed) > CAR_CONFIG.driftMinSpeed;

export function updateSpeed(car: CarState, controls: Controls, dt: number, offroad = false): void {
  const throttle = Number(controls.forward) - Number(controls.back);
  const brakeRate = isDrifting(car, controls) ? CAR_CONFIG.handbrakeDecel : CAR_CONFIG.brakeDecel;
  const friction = CAR_CONFIG.coastFriction * (offroad ? CAR_CONFIG.offroadFrictionFactor : 1);
  const coast = () => { car.speed = toward(car.speed, 0, (friction + CAR_CONFIG.airDrag * car.speed ** 2) * dt); };
  // The opposite pedal first stops the car, then engages the other direction.
  if (controls.brake || (controls.forward && controls.back) || throttle * car.speed < 0) {
    car.speed = toward(car.speed, 0, brakeRate * dt);
  } else if (throttle) {
    const limit = throttle > 0 ? CAR_CONFIG.maxSpeed : CAR_CONFIG.reverseMaxSpeed;
    const engine = throttle > 0 ? CAR_CONFIG.acceleration : CAR_CONFIG.reverseAcceleration;
    car.speed += throttle * engine * (1 - 0.45 * Math.min(Math.abs(car.speed) / limit, 1) ** 2) * dt;
    coast();
  } else {
    coast();
  }
  car.speed = Math.max(-CAR_CONFIG.reverseMaxSpeed, Math.min(CAR_CONFIG.maxSpeed, car.speed));
  const offroadLimit = CAR_CONFIG.maxSpeed * CAR_CONFIG.offroadSpeedFactor;
  if (offroad && Math.abs(car.speed) > offroadLimit) {
    const slowdown = CAR_CONFIG.maxSpeed * (1 - CAR_CONFIG.offroadSpeedFactor) / CAR_CONFIG.offroadSlowdownTime;
    car.speed = toward(car.speed, Math.sign(car.speed) * offroadLimit, slowdown * dt);
  }
}

// Steering is normalised to -1 (right) .. 1 (left) and eased toward the input.
export function updateSteering(car: CarState, controls: Controls, dt: number): void {
  const steerTarget = Number(controls.left) - Number(controls.right);
  const response = steerTarget ? CAR_CONFIG.steerResponse : CAR_CONFIG.steerReturn;
  car.steering += (steerTarget - car.steering) * (1 - Math.exp(-response * dt));
}

// No turning in place; reversing turns the other way; grip caps high-speed yaw.
export function turnRate(steer: number, speed: number, drifting = false): number {
  const requested = steer * CAR_CONFIG.maxTurnRate * Math.min(Math.abs(speed) / CAR_CONFIG.maxSpeed, 1) * Math.sign(speed)
    * (drifting ? CAR_CONFIG.driftYawBoost : 1);
  const maxYaw = CAR_CONFIG.lateralGrip * (drifting ? CAR_CONFIG.driftGripBoost : 1) / Math.max(Math.abs(speed), 0.1);
  return Math.max(-maxYaw, Math.min(maxYaw, requested));
}

function integrateLoopCar(car: CarState, controls: Controls, dt: number, respectWater: boolean): void {
  const previousSpeed = car.speed;
  const frame = loopFrame(car.x, car.z);
  const currentLand = respectWater ? landInfluence(frame.latitude, car.x) : 1;
  const currentOnRoad = !respectWater
    || distanceToRoadNetwork(frame.latitude, car.x) <= LOOP_DRIVE.waterRoadMargin;
  updateSpeed(car, controls, dt, !currentOnRoad && currentLand >= LOOP_DRIVE.waterShoreInfluence);
  if (respectWater && !currentOnRoad && currentLand < LOOP_DRIVE.waterShoreInfluence) {
    const waterAmount = Math.min(1, Math.max(0,
      (LOOP_DRIVE.waterShoreInfluence - currentLand)
      / (LOOP_DRIVE.waterShoreInfluence - LOOP_DRIVE.waterStopInfluence),
    ));
    car.speed = toward(car.speed, 0, LOOP_DRIVE.waterDrag * waterAmount * dt);
  }
  car.acceleration = (car.speed - previousSpeed) / dt;
  updateSteering(car, controls, dt);
  const travel = (previousSpeed + car.speed) * 0.5 * dt;
  car.yawRate = turnRate(car.steering, travel / dt, isDrifting(car, controls));
  if (travel === 0) return;

  // Move along the sphere and parallel-transport the heading. Updating longitude
  // and latitude independently makes the car slide sideways and breaks at poles.
  const left = cross(frame.normal, frame.tangent);
  const halfTurn = car.yawRate * dt * 0.5;
  const projectMovement = (distance: number, turn: number) => {
    const heading = car.heading + turn;
    const forward = blend(frame.tangent, left, Math.cos(heading), Math.sin(heading));
    const arc = distance / GLOBE_RADIUS;
    const normal = blend(frame.normal, forward, Math.cos(arc), Math.sin(arc));
    const transported = blend(forward, frame.normal, Math.cos(arc), -Math.sin(arc));
    const facing = blend(transported, cross(normal, transported), Math.cos(turn), Math.sin(turn));
    const longitude = (Math.atan2(normal[0], normal[2]) + FULL_TURN) % FULL_TURN;
    const latitude = Math.atan2(normal[1], Math.hypot(normal[0], normal[2]));
    return { facing, longitude, latitude };
  };
  let effectiveTravel = travel;
  let effectiveHalfTurn = halfTurn;
  let movement = projectMovement(effectiveTravel, effectiveHalfTurn);
  let nextLand = respectWater ? landInfluence(movement.latitude, movement.longitude) : 1;
  let nextOnRoad = !respectWater
    || distanceToRoadNetwork(movement.latitude, movement.longitude) <= LOOP_DRIVE.waterRoadMargin;
  let movingDeeper = nextLand <= currentLand + 1e-7;
  // The shoreline is a wall: a car on land never drives into the water. On an angled hit
  // it is turned along the shore (smallest turn that stays dry) so it keeps going.
  const isWater = (point: { latitude: number; longitude: number }) => respectWater
    && landInfluence(point.latitude, point.longitude) < LOOP_DRIVE.waterSurfaceInfluence
    && distanceToRoadNetwork(point.latitude, point.longitude) > LOOP_DRIVE.waterRoadMargin;
  if (respectWater && currentLand >= LOOP_DRIVE.waterSurfaceInfluence && isWater(movement)) {
    let dry: typeof movement | undefined;
    for (let step = 1; step <= 12 && !dry; step++) {
      for (const side of [1, -1]) {
        const candidate = projectMovement(effectiveTravel, effectiveHalfTurn + side * step * CAR_CONFIG.shoreSlideStep);
        if (!isWater(candidate)) { dry = candidate; break; }
      }
    }
    if (!dry) {
      car.speed = 0;
      car.yawRate = 0;
      return;
    }
    movement = dry;
    car.speed *= 1 - CAR_CONFIG.shoreScrape * dt;
    nextLand = landInfluence(movement.latitude, movement.longitude);
    nextOnRoad = distanceToRoadNetwork(movement.latitude, movement.longitude) <= LOOP_DRIVE.waterRoadMargin;
    movingDeeper = nextLand <= currentLand + 1e-7;
  }
  const enteringWater = respectWater && !nextOnRoad && nextLand < LOOP_DRIVE.waterSurfaceInfluence;
  if (enteringWater && movingDeeper) {
    const depth = Math.min(1, Math.max(0,
      (LOOP_DRIVE.waterSurfaceInfluence - nextLand)
      / (LOOP_DRIVE.waterSurfaceInfluence - LOOP_DRIVE.waterStopInfluence),
    ));
    const travelDepth = Math.min(1, (car.waterTravel + Math.abs(travel)) / LOOP_DRIVE.maxWaterTravel);
    const waterAmount = Math.max(depth, travelDepth);
    const resistance = waterAmount * waterAmount * (3 - 2 * waterAmount);
    const mobility = 1 - resistance * (1 - LOOP_DRIVE.waterMinimumMobility);
    const dryLimit = car.speed < 0 ? CAR_CONFIG.reverseMaxSpeed : CAR_CONFIG.maxSpeed;
    const directionLimit = dryLimit + (LOOP_DRIVE.waterCrawlSpeed - dryLimit) * resistance;
    car.speed = Math.max(-directionLimit, Math.min(directionLimit, car.speed));
    effectiveTravel *= mobility;
    effectiveHalfTurn *= mobility;
    car.yawRate *= mobility;
    movement = projectMovement(effectiveTravel, effectiveHalfTurn);
    nextLand = landInfluence(movement.latitude, movement.longitude);
    nextOnRoad = distanceToRoadNetwork(movement.latitude, movement.longitude) <= LOOP_DRIVE.waterRoadMargin;
    movingDeeper = nextLand <= currentLand + 1e-7;
  }
  const obstacle = obstacleAt(movement.latitude, movement.longitude, CAR_CONFIG.collisionRadius);
  if (obstacle) {
    obstacle.impact = Math.max(obstacle.impact ?? 0, Math.abs(car.speed));
    if (obstacle.movable) {
      if (!obstacle.ramCooldown) car.speed *= CAR_CONFIG.ramSpeedKeep;
      obstacle.ramCooldown = 0.5;
    } else {
      car.speed *= -0.16;
      car.yawRate = 0;
      return;
    }
  }
  car.acceleration = (car.speed - previousSpeed) / dt;
  car.x = movement.longitude;
  car.z = (movement.latitude - loopLatitude(car.x)) * GLOBE_RADIUS;
  if (!respectWater || nextOnRoad || nextLand >= LOOP_DRIVE.waterSurfaceInfluence) car.waterTravel = 0;
  else if (movingDeeper) car.waterTravel = Math.min(LOOP_DRIVE.maxWaterTravel, car.waterTravel + Math.abs(effectiveTravel));
  else car.waterTravel = Math.max(0, car.waterTravel - Math.abs(effectiveTravel) * 1.8);
  const nextFrame = loopFrame(car.x, car.z);
  car.heading = Math.atan2(dot(movement.facing, cross(nextFrame.normal, nextFrame.tangent)), dot(movement.facing, nextFrame.tangent));
  keepOnBridge(car);
  car.distance += Math.abs(effectiveTravel);
  car.wheelTravel += effectiveTravel;
}

// The bridge railings are walls: clamp the car inside the deck and, on an angled hit,
// turn it toward the bridge direction so it rolls across instead of sticking.
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
function keepOnBridge(car: CarState) {
  if (Math.abs(wrapAngle(car.x - WORLD_SETTINGS.roads.bridgeLongitude)) > WORLD_SETTINGS.roads.bridgeHalfSpan) return;
  const rail = (WORLD_SETTINGS.roads.mainWidth + WORLD_SETTINGS.roads.shoulderExtra) * 0.5 - CAR_CONFIG.collisionRadius;
  // Only cars on the deck meet the railing; a car far off the road (e.g. in the water) is left alone.
  if (Math.abs(car.z) <= rail || Math.abs(car.z) > rail + 1) return;
  car.z = Math.sign(car.z) * rail;
  const along = Math.cos(car.heading) >= 0 ? 0 : Math.PI;
  const angle = wrapAngle(car.heading - along);
  if (Math.abs(angle) > 0.05) car.speed *= 0.97;
  car.heading = along + angle * CAR_CONFIG.bridgeStraighten;
}

export function isBlocked(x: number, z: number): boolean {
  if (Math.abs(x) > DRIVE.worldLimit || Math.abs(z) > DRIVE.worldLimit) return true;
  // Rounded rectangle collision keeps the car out of the raised city blocks.
  return BLOCKS.some(bx => BLOCKS.some(bz => {
    const dx = Math.max(Math.abs(x - bx) - 20, 0);
    const dz = Math.max(Math.abs(z - bz) - 20, 0);
    return dx * dx + dz * dz < DRIVE.carRadius * DRIVE.carRadius;
  }));
}

// Arcade driving runs independently of React, once per animation frame.
export function stepCar(car: CarState, controls: Controls, delta: number): boolean {
  const dt = Math.min(Math.max(delta, 0), 0.05);
  const throttle = Number(controls.forward) - Number(controls.back);
  if (controls.brake) car.speed = toward(car.speed, 0, DRIVE.braking * dt);
  else if (throttle) {
    const acceleration = Math.sign(car.speed) !== throttle && Math.abs(car.speed) > 0.5 ? DRIVE.braking : DRIVE.acceleration;
    car.speed += throttle * acceleration * dt;
  } else car.speed = toward(car.speed, 0, DRIVE.rollingDrag * dt);
  car.speed = Math.max(-DRIVE.reverseSpeed, Math.min(DRIVE.maxSpeed, car.speed));
  const desiredSteering = Number(controls.left) - Number(controls.right);
  car.steering += (desiredSteering - car.steering) * (1 - Math.exp(-9 * dt));
  // Steering scales with travel speed; reverse steering follows the rearward motion.
  car.heading += car.steering * DRIVE.steering * Math.min(Math.abs(car.speed) / 5, 1) * Math.sign(car.speed) * dt * 1.6;
  const nx = car.x - Math.sin(car.heading) * car.speed * dt;
  const nz = car.z - Math.cos(car.heading) * car.speed * dt;
  if (isBlocked(nx, nz)) { car.speed *= -0.16; return true; }
  car.distance += Math.hypot(nx - car.x, nz - car.z);
  car.wheelTravel += car.speed * dt;
  car.x = nx; car.z = nz;
  return false;
}
