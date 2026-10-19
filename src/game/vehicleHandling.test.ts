import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CAR_CONFIG } from './config.ts';
import { DRIVE_MODE, emptyControls, initialLoopCar, stepLoopCar, turnRate, updateSpeed, updateSteering } from './driving.ts';
import { clearObstacleGroup, drainTrafficHits, setObstacleGroup } from './obstacles.ts';
import type { Obstacle } from './obstacles.ts';
import { loopFrame } from './globe.ts';
import { DRIVING_CONFIG, resetActiveVehicle, setActiveVehicle, vehicleConfig } from './vehicleHandling.ts';
import type { VehicleId } from './vehicleHandling.ts';

afterEach(() => { resetActiveVehicle(); DRIVE_MODE.rails = false; clearObstacleGroup('vehicle-profile-test'); drainTrafficHits(); });

function accelerate(id: VehicleId, seconds: number) {
  setActiveVehicle(id);
  const car = initialLoopCar();
  for (let i = 0; i < seconds * 120; i++) updateSpeed(car, { ...emptyControls(), forward: true }, 1 / 120);
  return car.speed;
}

test('compact launches quicker, while the heavy cruiser has the higher sustained speed', () => {
  assert.ok(accelerate('compact', 1) > accelerate('classic', 1));
  assert.ok(accelerate('classic', 60) > accelerate('compact', 60) * 1.12);
});

test('compact reacts to steering sooner and corners tighter at the same speed', () => {
  const response = (id: VehicleId) => {
    setActiveVehicle(id);
    const car = initialLoopCar();
    updateSteering(car, { ...emptyControls(), left: true }, 0.15);
    return { steer: car.steering, turn: turnRate(0.5, 8) };
  };
  const compact = response('compact'), classic = response('classic');
  assert.ok(compact.steer > classic.steer * 1.2);
  assert.ok(compact.turn > classic.turn);
});

test('compact stops in less distance at the same entry speed', () => {
  const stopDistance = (id: VehicleId) => {
    setActiveVehicle(id);
    const car = initialLoopCar(); car.speed = 12;
    let distance = 0;
    for (let i = 0; car.speed > 0 && i < 1000; i++) {
      updateSpeed(car, { ...emptyControls(), brake: true }, 1 / 120);
      distance += car.speed / 120;
    }
    assert.equal(car.speed, 0);
    return distance;
  };
  assert.ok(stopDistance('compact') < stopDistance('classic') * 0.8);
});

test('at the same collision speed classic sends a stronger shove and loses less speed', () => {
  const collide = (id: VehicleId) => {
    setActiveVehicle(id);
    const car = initialLoopCar(); car.speed = 10;
    const frame = loopFrame(car.x, car.z);
    const npc: Obstacle = { latitude: frame.latitude, longitude: car.x, radius: 0.55,
      halfLength: 0.6, movable: true, forward: [0, 1] };
    setObstacleGroup('vehicle-profile-test', [npc]);
    stepLoopCar(car, emptyControls(), 1 / 120);
    clearObstacleGroup('vehicle-profile-test');
    assert.ok(npc.impact && npc.impact > 0, 'must actually contact traffic');
    return { impulse: npc.impact!, retained: car.speed, power: npc.impactPower! };
  };
  const classic = collide('classic'), compact = collide('compact');
  assert.ok(classic.impulse > compact.impulse * 1.8);
  assert.ok(classic.retained > compact.retained);
  assert.ok(classic.power > compact.power);
});

test('switching repeatedly never compounds tuning and live baseline edits still apply', () => {
  const original = CAR_CONFIG.maxSpeed;
  try {
    for (let i = 0; i < 40; i++) { setActiveVehicle('classic'); setActiveVehicle('compact'); }
    assert.equal(CAR_CONFIG.maxSpeed, original);
    assert.equal(DRIVING_CONFIG.maxSpeed, original * 0.87);
    CAR_CONFIG.maxSpeed = original + 1;
    assert.equal(DRIVING_CONFIG.maxSpeed, (original + 1) * 0.87);
    const activeSpeed = DRIVING_CONFIG.maxSpeed;
    assert.ok(vehicleConfig('classic').maxSpeed > activeSpeed);
    assert.equal(DRIVING_CONFIG.maxSpeed, activeSpeed, 'preview must not select a different car');
  } finally { CAR_CONFIG.maxSpeed = original; }
});

test('the speed difference also applies to mobile rails driving', () => {
  DRIVE_MODE.rails = true;
  const drive = (id: VehicleId) => {
    setActiveVehicle(id);
    const car = initialLoopCar();
    for (let i = 0; i < 360; i++) stepLoopCar(car, { ...emptyControls(), forward: true }, 1 / 120);
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.heading));
    return car.speed;
  };
  assert.ok(drive('classic') > drive('compact'));
});

test('Rover trades road agility for the best dirt traction and traffic resistance', () => {
  const rover = vehicleConfig('rover'), classic = vehicleConfig('classic'), compact = vehicleConfig('compact');
  assert.ok(rover.maxSpeed < classic.maxSpeed);
  assert.ok(rover.steerResponse < classic.steerResponse && rover.steerResponse < compact.steerResponse);
  assert.ok(rover.brakeDecel < classic.brakeDecel);
  assert.ok(rover.ramSpeedKeep > classic.ramSpeedKeep);
  const offroadSpeed = (id: VehicleId) => {
    setActiveVehicle(id);
    const car = initialLoopCar(); car.speed = 14;
    for (let i = 0; i < 1200; i++) updateSpeed(car, { ...emptyControls(), forward: true }, 1 / 120, true);
    return car.speed;
  };
  assert.ok(offroadSpeed('rover') > offroadSpeed('classic') * 1.2);
});
