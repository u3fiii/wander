import * as THREE from 'three';
import { CAR_CONFIG, JUICE_CONFIG } from './config.ts';
import { PALETTE } from './palette.ts';
import type { CarState } from './driving.ts';

export type WheelKey = 'FL' | 'FR' | 'RL' | 'RR';
const WHEELS: WheelKey[] = ['FL', 'FR', 'RL', 'RR'];
// [side, axle] in model space: +x is the car's left, +z its front.
const WHEEL_LAYOUT: Record<WheelKey, [number, number]> = { FL: [1, 1], FR: [-1, 1], RL: [1, -1], RR: [-1, -1] };
const TURN = Math.PI * 2;
const SPRING_STEP = 1 / 120;

export type CarRig = {
  // Holds the chassis and wheels in model space and turns them to face the vehicle's -z.
  frame: THREE.Group;
  steer: Record<'FL' | 'FR', THREE.Group>;
  spin: Record<WheelKey, THREE.Group>;
  dispose: () => void;
};

export function logModelNodes(model: THREE.Object3D) {
  model.traverse(node => console.log(`[car model] ${node.type} "${node.name}" parent="${node.parent?.name ?? ''}"`));
}

function placeholderWheelFactory() {
  const r = CAR_CONFIG.wheelRadius;
  const w = CAR_CONFIG.wheelWidth;
  const geometries = [
    new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2),
    new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.04, 10).rotateZ(Math.PI / 2),
    new THREE.BoxGeometry(w * 1.08, r * 0.16, r * 1.15),
  ];
  const materials = [
    new THREE.MeshStandardMaterial({ color: PALETTE.tires, roughness: 0.92, metalness: 0, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: PALETTE.carCream, roughness: 0.85, metalness: 0, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: PALETTE.roadShoulder, roughness: 0.85, metalness: 0, flatShading: true }),
  ];
  const create = () => {
    const wheel = new THREE.Group();
    geometries.forEach((geometry, index) => {
      const mesh = new THREE.Mesh(geometry, materials[index]);
      mesh.castShadow = true;
      wheel.add(mesh);
    });
    return wheel;
  };
  const dispose = () => { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); };
  return { create, dispose };
}

// carBody > frame > chassis + wheel{FL,FR}_steer > _spin, wheel{RL,RR}_spin.
// Wheels named in CAR_CONFIG.wheelNodeNames are moved out of the chassis; otherwise placeholders are used.
export function buildCarRig(chassis: THREE.Object3D): CarRig {
  const frame = new THREE.Group();
  frame.name = 'carFrame';
  frame.rotation.y = Math.PI;
  frame.scale.setScalar(CAR_CONFIG.bodyScale);
  chassis.name = chassis.name || 'chassis';
  frame.add(chassis);
  frame.updateMatrixWorld(true);
  const placeholders = placeholderWheelFactory();
  const steer = {} as CarRig['steer'];
  const spin = {} as CarRig['spin'];
  for (const key of WHEELS) {
    const [side, axle] = WHEEL_LAYOUT[key];
    const realWheel = CAR_CONFIG.wheelNodeNames[key] ? chassis.getObjectByName(CAR_CONFIG.wheelNodeNames[key]) : undefined;
    const center = realWheel
      ? frame.worldToLocal(new THREE.Box3().setFromObject(realWheel).getCenter(new THREE.Vector3()))
      : new THREE.Vector3(side * CAR_CONFIG.wheelHalfTrack, CAR_CONFIG.wheelRadius, axle > 0 ? CAR_CONFIG.wheelFrontZ : CAR_CONFIG.wheelRearZ);
    const spinPivot = new THREE.Group();
    spinPivot.name = `wheel${key}_spin`;
    if (axle > 0) {
      const steerPivot = new THREE.Group();
      steerPivot.name = `wheel${key}_steer`;
      steerPivot.position.copy(center);
      steerPivot.add(spinPivot);
      frame.add(steerPivot);
      steer[key as 'FL' | 'FR'] = steerPivot;
    } else {
      spinPivot.position.copy(center);
      frame.add(spinPivot);
    }
    frame.updateMatrixWorld(true);
    if (realWheel) spinPivot.attach(realWheel);
    else spinPivot.add(placeholders.create());
    spin[key] = spinPivot;
  }
  return { frame, steer, spin, dispose: placeholders.dispose };
}

export function updateWheels(rig: CarRig, steer: number, travel: number) {
  const roll = travel / CAR_CONFIG.wheelRadius;
  for (const key of WHEELS) rig.spin[key].rotation.x = (rig.spin[key].rotation.x + roll) % TURN;
  rig.steer.FL.rotation.y = steer * CAR_CONFIG.maxWheelSteerAngle;
  rig.steer.FR.rotation.y = steer * CAR_CONFIG.maxWheelSteerAngle;
}

export type BodySpring = {
  roll: number; rollVelocity: number;
  pitch: number; pitchVelocity: number;
  bounce: number; bounceVelocity: number;
  squash: number; squashVelocity: number;
  wiggle: number; wiggleVelocity: number;
  driftYaw: number; driftVelocity: number;
  lastAcceleration: number; lastBoosting: number;
};
export const createBodySpring = (): BodySpring => ({
  roll: 0, rollVelocity: 0, pitch: 0, pitchVelocity: 0, bounce: 0, bounceVelocity: 0,
  squash: 0, squashVelocity: 0, wiggle: 0, wiggleVelocity: 0, driftYaw: 0, driftVelocity: 0,
  lastAcceleration: 0, lastBoosting: 0,
});

const bumps = (distance: number) => Math.sin(distance * 2.3) * 0.6 + Math.sin(distance * 5.1 + 1.3) * 0.4;

// Semi-implicit spring-damper, substepped so the overshoot is the same at any frame rate.
export function updateBodySpring(spring: BodySpring, car: CarState, dt: number, active: boolean, offroad: boolean) {
  const speedRatio = THREE.MathUtils.clamp(car.speed / CAR_CONFIG.maxSpeed, -1, 1);
  const rollTarget = active ? -car.steering * speedRatio * CAR_CONFIG.maxRoll : 0;
  const pitchTarget = active
    ? THREE.MathUtils.clamp(car.acceleration * CAR_CONFIG.pitchPerAccel, -CAR_CONFIG.maxPitch, CAR_CONFIG.maxPitch)
    : 0;
  const bumpTarget = active
    ? CAR_CONFIG.bumpHeight * (offroad ? CAR_CONFIG.offroadBumpFactor : 1) * Math.abs(speedRatio) * bumps(car.distance)
    : 0;
  spring.bounceVelocity -= Math.abs(car.acceleration - spring.lastAcceleration) * CAR_CONFIG.bounceKick;
  spring.lastAcceleration = car.acceleration;
  // Squash pulse when boost fires, small random squashes over off-road bumps.
  if (active && car.boosting && !spring.lastBoosting) spring.squashVelocity += JUICE_CONFIG.squashImpulse;
  if (active && offroad && Math.random() < dt * 4 * Math.abs(speedRatio)) spring.squashVelocity += JUICE_CONFIG.squashImpulse * 0.35;
  spring.lastBoosting = car.boosting;
  const wiggleTarget = active ? car.yawRate * JUICE_CONFIG.wiggleFactor : 0;
  const driftTarget = active && car.drift ? car.steering * JUICE_CONFIG.driftAngleMax : 0;
  const steps = Math.max(1, Math.ceil(dt / SPRING_STEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    spring.rollVelocity += (CAR_CONFIG.rollStiffness * (rollTarget - spring.roll) - CAR_CONFIG.rollDamping * spring.rollVelocity) * h;
    spring.roll += spring.rollVelocity * h;
    spring.pitchVelocity += (CAR_CONFIG.pitchStiffness * (pitchTarget - spring.pitch) - CAR_CONFIG.pitchDamping * spring.pitchVelocity) * h;
    spring.pitch += spring.pitchVelocity * h;
    spring.bounceVelocity += (CAR_CONFIG.bounceStiffness * (bumpTarget - spring.bounce) - CAR_CONFIG.bounceDamping * spring.bounceVelocity) * h;
    spring.bounce += spring.bounceVelocity * h;
    spring.squashVelocity += (-JUICE_CONFIG.squashStiffness * spring.squash - JUICE_CONFIG.squashDamping * spring.squashVelocity) * h;
    spring.squash = THREE.MathUtils.clamp(spring.squash + spring.squashVelocity * h, -JUICE_CONFIG.maxSquash, JUICE_CONFIG.maxSquash);
    spring.wiggleVelocity += (JUICE_CONFIG.wiggleStiffness * (wiggleTarget - spring.wiggle) - JUICE_CONFIG.wiggleDamping * spring.wiggleVelocity) * h;
    spring.wiggle += spring.wiggleVelocity * h;
    spring.driftVelocity += (JUICE_CONFIG.driftStiffness * (driftTarget - spring.driftYaw) - JUICE_CONFIG.driftDamping * spring.driftVelocity) * h;
    spring.driftYaw += spring.driftVelocity * h;
  }
}

// Writes the follow-camera position and look target; returns the target FOV.
export function updateCamera(
  position: THREE.Vector3, look: THREE.Vector3,
  ground: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3,
  cameraMode: number, speed: number, landingBlend: number, landingHeight: number,
) {
  const top = cameraMode === 1;
  const distance = THREE.MathUtils.lerp(top ? CAR_CONFIG.topCameraDistance : CAR_CONFIG.cameraDistance, 9.8, landingBlend);
  const height = THREE.MathUtils.lerp(
    top ? CAR_CONFIG.topCameraHeight : CAR_CONFIG.cameraHeight + Math.abs(speed) * CAR_CONFIG.cameraHeightPerSpeed,
    11.8,
    landingBlend,
  );
  const lookAhead = THREE.MathUtils.lerp(top ? CAR_CONFIG.topCameraLookAhead : CAR_CONFIG.cameraLookAhead, 4.2, landingBlend);
  position.copy(ground).addScaledVector(forward, -distance).addScaledVector(up, height);
  look.copy(ground).addScaledVector(forward, lookAhead).addScaledVector(up, 1.2 + landingHeight * 0.18);
  return CAR_CONFIG.baseFov + CAR_CONFIG.speedFovBoost * Math.min(Math.abs(speed) / CAR_CONFIG.maxSpeed, 1);
}
