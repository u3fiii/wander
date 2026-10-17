import { BLOCKS, CAR_CONFIG, DRIVE, JUICE_CONFIG, LOOP_DRIVE } from './config.ts';
import { FULL_TURN, GLOBE_RADIUS, loopFrame, loopLatitude } from './globe.ts';
import type { Vec3 } from './globe.ts';
import { WORLD_SETTINGS, distanceToRoadNetwork, landInfluence } from './worldMap.ts';
import { difficulty } from './difficulty.ts';
import { classifyTrafficHit, obstacleAt, reportTrafficHit, resetNearMiss, trackNearMiss, trackStaticNearMiss, trafficContact } from './obstacles.ts';

export type CarState = {
  // On the globe: longitude, latitude offset in metres, heading from the road tangent.
  x: number; z: number; heading: number; speed: number; steering: number; distance: number;
  wheelTravel: number; acceleration: number; yawRate: number; waterTravel: number;
  // Boost meter (0..1), whether boost is firing (0/1), and how much the car is sliding (0..1).
  boost: number; boosting: number; drift: number;
  // Seconds left of the stronger road assist that follows a head-on hit (so the car settles back on the road).
  hitAssist?: number;
  // Seconds of boost left in the current burst, and cooldown progress (1 = ready).
  boostTime: number; boostCharge: number;
};
// Booleans come from keys/touch. Optional analog values (0..1, steer -1..1) override them when present.
export type Controls = {
  forward: boolean; back: boolean; left: boolean; right: boolean; brake: boolean; gentle?: boolean; boost?: boolean;
  throttle?: number; reverse?: number; steer?: number;
};
export type ControlKey = 'forward' | 'back' | 'left' | 'right' | 'brake' | 'gentle' | 'boost';
const steerInput = (controls: Controls) => controls.steer ?? (Number(controls.left) - Number(controls.right));
export const emptyControls = (): Controls => ({ forward: false, back: false, left: false, right: false, brake: false });
export const initialCar = (): CarState => ({ ...DRIVE.spawn, speed: 0, steering: 0, distance: 0, wheelTravel: 0, acceleration: 0, yawRate: 0, waterTravel: 0, boost: 1, boosting: 0, drift: 0, boostTime: 0, boostCharge: 1 });
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
  && Math.abs(steerInput(controls)) > 0.2 && Math.abs(car.speed) > CAR_CONFIG.driftMinSpeed;

// Shift fires a timed boost burst (holding it does not extend it), then it needs a cooldown.
// `boost` is what the HUD shows: burst time left while boosting, recharge progress otherwise.
export function updateBoost(car: CarState, controls: Controls, dt: number, onRoad = true): void {
  const forwardAmount = controls.throttle ?? Number(controls.forward);
  if (car.boostTime > 0) {
    car.boostTime = Math.max(0, car.boostTime - dt);
  } else {
    car.boostCharge = Math.min(1, car.boostCharge + dt / (CAR_CONFIG.boostCooldown * difficulty.boostCooldown));
    // Boost only fires from the road.
    if (controls.boost && forwardAmount > 0 && car.boostCharge >= 1 && onRoad) {
      car.boostTime = CAR_CONFIG.boostDuration;
      car.boostCharge = 0;
    }
  }
  car.boosting = car.boostTime > 0 ? 1 : 0;
  car.boost = car.boosting ? car.boostTime / CAR_CONFIG.boostDuration : car.boostCharge;
}

// Rails mode, for touch screens: the car drives itself (the scene holds the throttle at `autoThrottle`), the
// player only steers, and the car never leaves the road. Its offset from the road's centre line is held inside
// `halfWidth`; at the edge its heading is turned back along the road (by `edgeTurn`) so it slides along the edge
// instead of grinding, and the road assist pulls it straight `assist` times harder when the player lets go.
export const DRIVE_MODE = { rails: false };
export const RAILS = { halfWidth: 2.15, edgeTurn: 14, assist: 3, autoThrottle: 1 };
function keepOnRails(car: CarState, dt: number) {
  const limit = RAILS.halfWidth / lateralScale(car.x);
  if (Math.abs(car.z) <= limit) return;
  car.z = Math.sign(car.z) * limit;
  const along = Math.cos(car.heading) >= 0 ? 0 : Math.PI;
  car.heading = along + wrapAngle(car.heading - along) * Math.exp(-RAILS.edgeTurn * dt);
  car.yawRate = 0;
}

// Boost is earned as well as waited for: skilled moves top the meter up (shares of a full charge), a level-up
// fills it. Nothing is added while a burst is burning.
export const BOOST_EARN = { nearMiss: 0.22, drift: 0.08, driftPerSecond: 0.05, flick: 0.06, streak: 0.06, levelUp: 1 };
export function earnBoost(car: CarState, amount: number) {
  if (car.boostTime > 0 || amount <= 0) return;
  car.boostCharge = Math.min(1, car.boostCharge + amount);
  if (!car.boosting) car.boost = car.boostCharge;
}

export function updateSpeed(car: CarState, controls: Controls, dt: number, offroad = false): void {
  const forwardAmount = controls.throttle ?? Number(controls.forward);
  const backAmount = controls.reverse ?? Number(controls.back);
  const throttle = forwardAmount - backAmount;
  const bothPedals = forwardAmount > 0 && backAmount > 0;
  const brakeRate = isDrifting(car, controls) ? CAR_CONFIG.handbrakeDecel : CAR_CONFIG.brakeDecel;
  const friction = CAR_CONFIG.coastFriction * (offroad ? CAR_CONFIG.offroadFrictionFactor : 1);
  const coast = () => { car.speed = toward(car.speed, 0, (friction + CAR_CONFIG.airDrag * car.speed ** 2) * dt); };
  // The opposite pedal first stops the car, then engages the other direction.
  if (controls.brake || bothPedals || throttle * car.speed < 0) {
    const pedal = controls.brake || bothPedals ? 1 : Math.abs(throttle);
    car.speed = toward(car.speed, 0, brakeRate * pedal * dt);
  } else if (throttle) {
    const boosting = throttle > 0 && car.boosting > 0;
    const limit = throttle > 0 ? CAR_CONFIG.maxSpeed * (boosting ? CAR_CONFIG.boostSpeedFactor : 1) : CAR_CONFIG.reverseMaxSpeed;
    const engine = (throttle > 0 ? CAR_CONFIG.acceleration : CAR_CONFIG.reverseAcceleration) * (boosting ? CAR_CONFIG.boostAccelFactor : 1);
    const taper = throttle > 0 ? CAR_CONFIG.accelTaper : CAR_CONFIG.reverseTaper;
    car.speed += throttle * engine * Math.max(0, 1 - taper * Math.min(Math.abs(car.speed) / limit, 1) ** 2) * dt;
    coast();
  } else {
    coast();
  }
  const topSpeed = CAR_CONFIG.maxSpeed * (car.boosting > 0 ? CAR_CONFIG.boostSpeedFactor : 1);
  car.speed = Math.max(-CAR_CONFIG.reverseMaxSpeed, Math.min(topSpeed, car.speed));
  // After a boost the extra speed bleeds off instead of snapping back.
  if (car.boosting === 0 && car.speed > CAR_CONFIG.maxSpeed) car.speed = toward(car.speed, CAR_CONFIG.maxSpeed, CAR_CONFIG.boostOverspeedDecel * dt);
  const offroadLimit = CAR_CONFIG.maxSpeed * CAR_CONFIG.offroadSpeedFactor;
  if (offroad && Math.abs(car.speed) > offroadLimit) {
    const slowdown = CAR_CONFIG.maxSpeed * (1 - CAR_CONFIG.offroadSpeedFactor) / CAR_CONFIG.offroadSlowdownTime;
    car.speed = toward(car.speed, Math.sign(car.speed) * offroadLimit, slowdown * dt);
  }
}

// Steering is normalised to -1 (right) .. 1 (left) and eased toward the input.
export function updateSteering(car: CarState, controls: Controls, dt: number): void {
  const steerTarget = steerInput(controls);
  const response = steerTarget ? CAR_CONFIG.steerResponse : CAR_CONFIG.steerReturn;
  car.steering += (steerTarget - car.steering) * (1 - Math.exp(-response * dt));
}

// No turning in place; reversing turns the other way; grip caps high-speed yaw. Low speeds get a floor on
// steering so tight manoeuvres (backing out of a corner) don't need a long arc.
export function turnRate(steer: number, speed: number, drifting = false, boosting = false): number {
  const absolute = Math.abs(speed);
  const speedFactor = Math.max(
    Math.min(absolute / CAR_CONFIG.maxSpeed, 1),
    Math.min(absolute / CAR_CONFIG.lowSpeedTurnSpeed, 1) * CAR_CONFIG.lowSpeedTurnFactor,
  );
  // Boost also sharpens the steering: quicker turn-in and more grip, so the fast car still takes the bends easily.
  const boostTurn = boosting ? CAR_CONFIG.boostSteerFactor : 1;
  const requested = steer * CAR_CONFIG.maxTurnRate * speedFactor * boostTurn * Math.sign(speed)
    * (drifting ? CAR_CONFIG.driftYawBoost : 1);
  const maxYaw = CAR_CONFIG.lateralGrip * (drifting ? CAR_CONFIG.driftGripBoost : 1) * (boosting ? CAR_CONFIG.boostGripFactor : 1) / Math.max(Math.abs(speed), 0.1);
  return Math.max(-maxYaw, Math.min(maxYaw, requested));
}

function integrateLoopCar(car: CarState, controls: Controls, dt: number, respectWater: boolean): void {
  const previousSpeed = car.speed;
  const previousZ = car.z;
  const previousX = car.x;
  const frame = loopFrame(car.x, car.z);
  const currentLand = respectWater ? landInfluence(frame.latitude, car.x) : 1;
  const currentOnRoad = !respectWater
    || onRoadSurface(frame.latitude, car.x);
  // While boosting the car drives itself: full throttle, and it stays on the road with the usual road assist.
  const drive = car.boosting > 0 ? { ...controls, forward: true, back: false, brake: false, throttle: 1, reverse: 0 } : controls;
  updateBoost(car, drive, dt, currentOnRoad);
  // Nothing slows a boosting car: the off-road drag and the water drag below are skipped while boosting.
  updateSpeed(car, drive, dt, car.boosting === 0 && !currentOnRoad && currentLand >= LOOP_DRIVE.waterShoreInfluence);
  if (respectWater && car.boosting === 0 && !currentOnRoad && currentLand < LOOP_DRIVE.waterShoreInfluence) {
    const waterAmount = Math.min(1, Math.max(0,
      (LOOP_DRIVE.waterShoreInfluence - currentLand)
      / (LOOP_DRIVE.waterShoreInfluence - LOOP_DRIVE.waterStopInfluence),
    ));
    car.speed = toward(car.speed, 0, LOOP_DRIVE.waterDrag * waterAmount * dt);
  }
  car.acceleration = (car.speed - previousSpeed) / dt;
  updateSteering(car, controls, dt);
  // Drift amount for visuals/sound: handbrake turns, or hard steering at high speed.
  const highSpeedSlide = Math.abs(car.speed) > CAR_CONFIG.maxSpeed * JUICE_CONFIG.driftSpeedRatio
    && Math.abs(car.steering) > JUICE_CONFIG.driftSteer;
  car.drift = isDrifting(car, controls) || highSpeedSlide ? 1 : 0;
  const travel = (previousSpeed + car.speed) * 0.5 * dt;
  car.yawRate = turnRate(car.steering, travel / dt, isDrifting(car, controls), car.boosting > 0);
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
    || onRoadSurface(movement.latitude, movement.longitude);
  let movingDeeper = nextLand <= currentLand + 1e-7;
  // The shoreline is a wall: a car on land never drives into the water. On an angled hit
  // it is turned along the shore (smallest turn that stays dry) so it keeps going.
  const isWater = (point: { latitude: number; longitude: number }) => respectWater
    && landInfluence(point.latitude, point.longitude) < LOOP_DRIVE.waterSurfaceInfluence
    && !onRoadSurface(point.latitude, point.longitude);
  if (respectWater && currentLand >= LOOP_DRIVE.waterSurfaceInfluence && isWater(movement)) {
    let dry: typeof movement | undefined;
    let dryTurn = 0;
    for (let step = 1; step <= 12 && !dry; step++) {
      for (const side of [1, -1]) {
        const candidate = projectMovement(effectiveTravel, effectiveHalfTurn + side * step * CAR_CONFIG.shoreSlideStep);
        if (!isWater(candidate)) { dry = candidate; dryTurn = side * step * CAR_CONFIG.shoreSlideStep; break; }
      }
    }
    if (!dry) {
      car.speed = 0;
      car.yawRate = 0;
      return;
    }
    if (turnTooSharp(car, dryTurn, dt)) return;
    movement = dry;
    car.speed *= car.boosting > 0 ? 1 : 1 - CAR_CONFIG.shoreScrape * dt;
    nextLand = landInfluence(movement.latitude, movement.longitude);
    nextOnRoad = onRoadSurface(movement.latitude, movement.longitude);
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
    nextOnRoad = onRoadSurface(movement.latitude, movement.longitude);
    movingDeeper = nextLand <= currentLand + 1e-7;
  }
  let obstacle = obstacleAt(movement.latitude, movement.longitude, CAR_CONFIG.collisionRadius);
  const touchedStatic = !!obstacle && !obstacle.movable;
  // Glancing hits on trunks, houses and rocks steer the car around them instead of stopping it.
  if (obstacle && !obstacle.movable) {
    for (let step = 1; step <= 8 && obstacle; step++) {
      for (const side of [1, -1]) {
        const candidate = projectMovement(effectiveTravel, effectiveHalfTurn + side * step * CAR_CONFIG.shoreSlideStep);
        if (!obstacleAt(candidate.latitude, candidate.longitude, CAR_CONFIG.collisionRadius) && !isWater(candidate)) {
          if (turnTooSharp(car, side * step * CAR_CONFIG.shoreSlideStep, dt)) return;
          movement = candidate;
          car.speed *= car.boosting > 0 ? 1 : 1 - CAR_CONFIG.shoreScrape * dt;
          obstacle = undefined;
          break;
        }
      }
    }
  }
  // Before a head-on stop below, so a tree that was hit is never later counted as a near miss.
  trackStaticNearMiss(movement.latitude, movement.longitude, CAR_CONFIG.collisionRadius,
    facingEastNorth(movement.facing, movement.latitude, movement.longitude), Math.abs(car.speed), car.boosting > 0, touchedStatic);
  if (obstacle) {
    obstacle.impact = Math.max(obstacle.impact ?? 0, Math.abs(car.speed));
    car.speed *= -0.16;
    car.yawRate = 0;
    return;
  }
  // Traffic is solid too, but gets shoved: the hit car is told the impact, the player keeps most of its speed.
  // A move that would push deeper into a car slides along it if it can, otherwise waits this step for the
  // shoved car to clear. Moves that separate are always allowed, and any overlap is eased out.
  let ramNudge = 0;
  let closingSpeed = 0;
  const capsuleAt = (point: typeof movement) => trafficContact(point.latitude, point.longitude,
    facingEastNorth(point.facing, point.latitude, point.longitude), CAR_CONFIG.collisionHalfLength, CAR_CONFIG.trafficRadius);
  let contact = capsuleAt(movement);
  {
    // Both cars' velocities as [east, north], for the closing speed of a hit and the pace of a near miss.
    const facing = facingEastNorth(movement.facing, movement.latitude, movement.longitude);
    const other = contact?.obstacle.forward ?? [0, 0], otherSpeed = contact?.obstacle.velocity ?? 0;
    const relative = [facing[0] * car.speed - other[0] * otherSpeed, facing[1] * car.speed - other[1] * otherSpeed];
    const turnAway = contact ? facing[0] * contact.away[1] - facing[1] * contact.away[0] : 0;
    trackNearMiss(contact, Math.hypot(relative[0], relative[1]), Math.abs(car.speed), turnAway > 0 ? 1 : -1, car.boosting > 0);
    if (contact) closingSpeed = Math.max(0, -(relative[0] * contact.away[0] + relative[1] * contact.away[1]));
  }
  if (contact && contact.gap < 0) {
    const hit = contact.obstacle;
    hit.impact = Math.max(hit.impact ?? 0, Math.abs(car.speed));
    const facing = facingEastNorth(movement.facing, movement.latitude, movement.longitude);
    // Reversing, the tail leads: backing into a car is scored like driving into it.
    const kind = classifyTrafficHit(contact, car.speed < -0.5 ? [-facing[0], -facing[1]] : facing);
    // Positive when the struck car is on the player's right (the push-out direction points left).
    const turnAway = facing[0] * contact.away[1] - facing[1] * contact.away[0];
    if (!hit.ramCooldown) {
      if (kind && Math.abs(car.speed) > 3) {
        hit.hitKind = kind;
        reportTrafficHit({ kind, speed: Math.abs(car.speed), side: turnAway > 0 ? 1 : -1, boosted: car.boosting > 0, closing: closingSpeed });
      }
      // Under boost the car bulldozes through, front or side alike: it keeps nearly all its speed and the
      // struck car is thrown clear (see boostHit).
      hit.boostHit = car.boosting > 0;
      car.speed *= car.boosting > 0 ? CAR_CONFIG.boostRamSpeedKeep
        : kind === 'front' ? 0.92 : kind === 'side' ? CAR_CONFIG.sideRamSpeedKeep : CAR_CONFIG.ramSpeedKeep;
      // The struck car pushes back a little: the heading tips away from it (more when boosting into it).
      // A head-on hit gets no nudge and starts a short, stronger road assist instead, so the car usually
      // stays on the road rather than ending up facing the verge.
      const headOn = kind === 'front' && car.boosting === 0;
      ramNudge = headOn ? 0 : Math.sign(turnAway) * CAR_CONFIG.ramNudge * Math.min(Math.abs(car.speed) / CAR_CONFIG.maxSpeed, 1)
        * (car.boosting > 0 ? CAR_CONFIG.boostRamNudgeFactor : 1);
      if (headOn) car.hitAssist = CAR_CONFIG.crashAssistTime;
    }
    hit.ramCooldown = 0.5;
    const before = capsuleAt({ latitude: frame.latitude, longitude: car.x, facing: blend(frame.tangent, left, Math.cos(car.heading), Math.sin(car.heading)) });
    const floor = Math.min(0, before?.gap ?? 0) - 1e-4;
    // Under boost the player is a bulldozer: traffic never turns it, holds it or pushes it aside. It keeps its
    // line and speed, and the struck car is thrown clear (see BOOST_HIT in the scene).
    const bulldozing = car.boosting > 0;
    if (contact.gap < floor && !bulldozing) {
      let slid = false;
      // Head-on contacts only slide round with a small turn, so they don't swing the car off the road.
      const slideSteps = kind === 'front' ? 2 : 6;
      for (let step = 1; step <= slideSteps && !slid; step++) {
        for (const side of [1, -1]) {
          const candidate = projectMovement(effectiveTravel, effectiveHalfTurn + side * step * CAR_CONFIG.shoreSlideStep);
          const candidateContact = capsuleAt(candidate);
          if ((candidateContact && candidateContact.gap < floor) || isWater(candidate)
            || obstacleAt(candidate.latitude, candidate.longitude, CAR_CONFIG.collisionRadius)) continue;
          if (turnTooSharp(car, side * step * CAR_CONFIG.shoreSlideStep, dt)) return;
          movement = candidate;
          contact = candidateContact;
          slid = true;
          break;
        }
      }
      // A side clip, or anything while boosting, carries straight through (the overlap is eased out below).
      if (!slid && kind !== 'side') {
        // A frontal ram keeps the player rolling while the other car is pushed out of the way.
        // Repeatedly braking to zero here made nose-to-nose contacts feel like a hard lock.
        if (kind !== 'front') car.speed = toward(car.speed, 0, CAR_CONFIG.trafficHoldDecel * dt);
        car.yawRate = 0;
        return;
      }
    }
    if (contact && contact.gap < 0 && !bulldozing) {
      const push = -contact.gap * Math.min(1, CAR_CONFIG.trafficSeparateRate * dt);
      movement = {
        ...movement,
        latitude: movement.latitude + contact.away[1] * push / GLOBE_RADIUS,
        longitude: movement.longitude + contact.away[0] * push / (GLOBE_RADIUS * Math.max(0.2, Math.cos(movement.latitude))),
      };
    }
  }
  car.acceleration = (car.speed - previousSpeed) / dt;
  car.x = movement.longitude;
  car.z = (movement.latitude - loopLatitude(car.x)) * GLOBE_RADIUS;

  if (!respectWater || nextOnRoad || nextLand >= LOOP_DRIVE.waterSurfaceInfluence) car.waterTravel = 0;
  else if (movingDeeper) car.waterTravel = Math.min(LOOP_DRIVE.maxWaterTravel, car.waterTravel + Math.abs(effectiveTravel));
  else car.waterTravel = Math.max(0, car.waterTravel - Math.abs(effectiveTravel) * 1.8);
  const nextFrame = loopFrame(car.x, car.z);
  car.heading = Math.atan2(dot(movement.facing, cross(nextFrame.normal, nextFrame.tangent)), dot(movement.facing, nextFrame.tangent)) + ramNudge;

  car.hitAssist = Math.max(0, (car.hitAssist ?? 0) - dt);
  // Under boost the assist also reaches a little past the road's edge, to pull a wide car back on.
  const nearRoadUnderBoost = car.boosting > 0 && distanceToRoadNetwork(movement.latitude, movement.longitude) < CAR_CONFIG.boostAssistReach;
  if (respectWater && (nextOnRoad || car.hitAssist > 0 || nearRoadUnderBoost || car.boosting > 0)) assistRoad(car, controls, previousZ, dt);
  keepOnBridge(car, previousX, previousZ, dt);
  if (DRIVE_MODE.rails) keepOnRails(car, dt);
  car.distance += Math.abs(effectiveTravel);
  car.wheelTravel += effectiveTravel;
}

// Back to road: puts the car on its own side of the road at the same spot, stopped and facing along the
// road (whichever direction it was closer to facing). The globe and camera ease to the new pose.
export function recoverToRoad(car: CarState) {
  resetNearMiss();
  const side = car.z === 0 ? 1 : Math.sign(car.z);
  car.z = side * Math.min(Math.abs(car.z), CAR_CONFIG.recoverLaneOffset);
  car.heading = Math.cos(car.heading) >= 0 ? 0 : Math.PI;
  car.speed = 0;
  car.steering = 0;
  car.yawRate = 0;
  car.acceleration = 0;
  car.waterTravel = 0;
}

// A facing vector on the globe as a unit [east, north] pair at the given point.
function facingEastNorth(facing: number[], latitude: number, longitude: number): [number, number] {
  const east = Math.cos(longitude) * facing[0] - Math.sin(longitude) * facing[2];
  const north = -Math.sin(latitude) * Math.sin(longitude) * facing[0] + Math.cos(latitude) * facing[1]
    - Math.sin(latitude) * Math.cos(longitude) * facing[2];
  const length = Math.hypot(east, north) || 1;
  return [east / length, north / length];
}

// Hidden road assist: on the road the heading eases back toward the road direction when the
// player isn't steering hard, and more firmly when drifting toward the edge. Subtle by design.
function assistRoad(car: CarState, controls: Controls, previousZ: number, dt: number) {
  // While boosting, steering brings the car back to the road itself (see updateSteering), so the assist stays out
  // of the way; otherwise it would pull the heading straight back and stop the car getting across.
  const recovering = (car.hitAssist ?? 0) > 0;
  if (Math.abs(car.speed) < (recovering ? 1.5 : 4)) return;
  const along = Math.cos(car.heading) >= 0 ? 0 : Math.PI;
  const error = wrapAngle(car.heading - along);
  const steering = Math.min(1, Math.abs(steerInput(controls)));
  const towardEdge = Math.abs(car.z) > CAR_CONFIG.roadEdgeStart && Math.sign(car.z - previousZ) === Math.sign(car.z);
  // Under boost the car almost holds the road by itself: a much stronger pull that also keeps working (less)
  // while the player steers.
  const boosting = car.boosting > 0;
  const assistScale = boosting ? CAR_CONFIG.boostRoadAssistFactor : 1;
  // The bridge approach curves sharply, so for a short stretch before the deck the assist is firmer: it lines the car
  // up with the road (and the deck) even when the player isn't steering.
  const bridgeDistance = Math.abs(wrapAngle(car.x - WORLD_SETTINGS.roads.bridgeLongitude));
  const funnel = bridgeDistance < CAR_CONFIG.bridgeFunnelReach ? CAR_CONFIG.bridgeFunnelAssist * (1 - bridgeDistance / CAR_CONFIG.bridgeFunnelReach) : 0;
  const rate = (CAR_CONFIG.roadAssist * (DRIVE_MODE.rails ? RAILS.assist : 1) * (1 - steering * (boosting ? 0.6 : 1)) + (towardEdge ? CAR_CONFIG.roadEdgeAssist : 0) + funnel) * assistScale
    + (recovering ? CAR_CONFIG.crashAssist * (1 - steering * 0.5) : 0);
  car.heading = along + error * Math.exp(-rate * dt);
}

// Deflections off walls, trunks and the shore turn the car at a capped rate. If the free direction
// needs a sharper turn than that, the car turns part of the way and scrapes instead of snapping round
// (a snap would whip the camera, since the world turns to follow the car).
function turnTooSharp(car: CarState, turn: number, dt: number) {
  const allowed = CAR_CONFIG.deflectRate * dt;
  if (Math.abs(turn) <= allowed) return false;
  car.heading += Math.sign(turn) * allowed;
  car.speed *= car.boosting > 0 ? 1 : 1 - CAR_CONFIG.shoreScrape * dt;
  car.yawRate = 0;
  return true;
}

// The bridge railings are walls from both sides, and their end posts are solid. `car.z` is the offset north
// of the road's centre line, so it is converted to the true perpendicular distance before meeting the
// railing (the road crosses the bridge at an angle). An angled hit on the inside turns the car along the
// bridge so it rolls across instead of sticking.
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
function lateralScale(longitude: number) {
  const step = 1e-3;
  const slope = (loopLatitude(longitude + step) - loopLatitude(longitude - step)) / (2 * step) / Math.cos(loopLatitude(longitude));
  return 1 / Math.sqrt(1 + slope * slope);
}
// Drivable road surface for the water checks: the asphalt plus a small margin, and the whole bridge deck
// out to its railings (the deck is wider than the asphalt, and the land under it is cut away for the channel).
export function onRoadSurface(latitude: number, longitude: number) {
  if (distanceToRoadNetwork(latitude, longitude) <= LOOP_DRIVE.waterRoadMargin) return true;
  if (Math.abs(wrapAngle(longitude - WORLD_SETTINGS.roads.bridgeLongitude)) > WORLD_SETTINGS.roads.bridgeDeckHalfSpan + CAR_CONFIG.bridgeEndOverlap) return false;
  const railing = (WORLD_SETTINGS.roads.mainWidth + WORLD_SETTINGS.roads.shoulderExtra) * 0.5;
  return Math.abs(latitude - loopLatitude(longitude)) * GLOBE_RADIUS * lateralScale(longitude) <= railing;
}

function keepOnBridge(car: CarState, previousX: number, previousZ: number, dt: number) {
  const span = WORLD_SETTINGS.roads.bridgeDeckHalfSpan + CAR_CONFIG.bridgeEndOverlap;
  const onSpan = (longitude: number) => Math.abs(wrapAngle(longitude - WORLD_SETTINGS.roads.bridgeLongitude)) <= span;
  if (!onSpan(car.x)) return;
  const railing = (WORLD_SETTINGS.roads.mainWidth + WORLD_SETTINGS.roads.shoulderExtra) * 0.5;
  const inner = railing - CAR_CONFIG.trafficRadius;
  const outer = railing + CAR_CONFIG.trafficRadius;
  const scale = lateralScale(car.x);
  const side = car.z === 0 ? 1 : Math.sign(car.z);
  const lateral = Math.abs(car.z) * scale;
  const previousLateral = Math.abs(previousZ) * lateralScale(previousX);
  if (lateral <= inner || lateral >= outer + 1.5) return;
  // Driving onto the span from the bank while lined up with a railing: that's the end post.
  if (!onSpan(previousX) && lateral < outer) {
    car.x = previousX;
    car.z = previousZ;
    car.speed *= -0.16;
    return;
  }
  const fromInside = previousLateral <= inner + 1e-3 || (previousLateral < outer && lateral - inner < outer - lateral);
  if (!fromInside && lateral >= outer) return;
  car.z = side * (fromInside ? inner : outer) / scale;
  const along = Math.cos(car.heading) >= 0 ? 0 : Math.PI;
  const angle = wrapAngle(car.heading - along);
  if (Math.abs(angle) > 0.05) car.speed *= 1 - 2 * dt;
  if (fromInside) car.heading = along + angle * Math.exp(-CAR_CONFIG.bridgeStraightenRate * dt);
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
