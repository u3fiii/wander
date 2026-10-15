import { BLOCKS, DRIVE } from './config.ts';

export type CarState = { x: number; z: number; heading: number; speed: number; steering: number; distance: number };
export type Controls = { forward: boolean; back: boolean; left: boolean; right: boolean; brake: boolean };
export const emptyControls = (): Controls => ({ forward: false, back: false, left: false, right: false, brake: false });
export const initialCar = (): CarState => ({ ...DRIVE.spawn, speed: 0, steering: 0, distance: 0 });
const toward = (n: number, target: number, amount: number) => n < target ? Math.min(n + amount, target) : Math.max(n - amount, target);

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
  car.x = nx; car.z = nz;
  return false;
}
