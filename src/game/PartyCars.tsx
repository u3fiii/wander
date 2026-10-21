import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loopFrame, spherePoint } from './globe';
import { distanceToRoadNetwork, roadSurfaceElevation, terrainElevation, terrainNormal } from './worldMap';
import PlayerVehicle from './PlayerVehicle';
import { CarLamps, HeadlightBeam } from './CarLights';
import { vehicleEffects } from './vehicleVisuals';
import type { CarState } from './driving';
import type { PartyRun } from './party';

// Half the body's width: a lean pivots on the low-side wheels, so the body is lifted by it and never digs in.
const HALF_WIDTH = 0.45;

const up = new THREE.Vector3(), tangent = new THREE.Vector3(), north = new THREE.Vector3(), right = new THREE.Vector3(), back = new THREE.Vector3();
const basis = new THREE.Matrix4(), target = new THREE.Quaternion();

// Places a car on the globe from its loop coordinates, the same way the scene places the player's car.
function poseCar(group: THREE.Group, car: CarState, dt: number, snap: boolean) {
  const frame = loopFrame(car.x, car.z);
  const onRoad = distanceToRoadNetwork(frame.latitude, car.x) < 0.7;
  const elevation = (onRoad ? roadSurfaceElevation(frame.latitude, car.x) : terrainElevation(frame.latitude, car.x)) + (onRoad ? 0.075 : 0.025);
  group.position.set(...spherePoint(frame.latitude, car.x, elevation));
  up.set(...terrainNormal(frame.latitude, car.x));
  tangent.set(...frame.tangent);
  tangent.addScaledVector(up, -tangent.dot(up)).normalize();
  north.crossVectors(up, tangent).normalize();
  tangent.multiplyScalar(Math.cos(car.heading)).addScaledVector(north, Math.sin(car.heading)).normalize();
  right.crossVectors(tangent, up);
  back.copy(tangent).negate();
  basis.makeBasis(right, up, back);
  target.setFromRotationMatrix(basis);
  if (snap) group.quaternion.copy(target);
  else group.quaternion.slerp(target, 1 - Math.exp(-11 * dt));
}

// A car's reaction to hits (party.ts PartyFx) on its model: the hop, the lean and the squash. With no party running, it
// leaves the model as it is.
export function PartyBody({ run, index, children }: { run?: React.RefObject<PartyRun | null>; index: number; children: React.ReactNode }) {
  const body = useRef<THREE.Group>(null!);
  useFrame(() => {
    const fx = run?.current?.players[index]?.fx;
    const b = body.current;
    if (!fx) { b.position.y = 0; b.rotation.z = 0; b.scale.setScalar(1); return; }
    b.position.y = fx.lift + Math.abs(Math.sin(fx.roll)) * HALF_WIDTH;
    b.rotation.z = fx.roll;
    b.scale.set(1 + fx.squash * 0.5, 1 - fx.squash, 1 + fx.squash * 0.5);
  });
  return <group ref={body}>{children}</group>;
}

function PartyCar({ run, index, nightBlend }: { run: React.RefObject<PartyRun | null>; index: number; nightBlend: React.RefObject<number> }) {
  const group = useRef<THREE.Group>(null!);
  const player = run.current!.players[index];
  const effects = vehicleEffects('classic');
  // PlayerVehicle reads the car for its wheels; the player's car object is swapped each round, so follow it.
  const car = useMemo(() => ({ current: player.car }), [player]);
  const lastCar = useRef<CarState | null>(null);
  useFrame((_, delta) => {
    const current = run.current?.players[index];
    if (!current || !group.current) return;
    car.current = current.car;
    group.current.visible = !current.out;
    poseCar(group.current, current.car, Math.min(delta, 0.05), lastCar.current !== current.car);
    lastCar.current = current.car;
  });
  return <group ref={group}><PartyBody run={run} index={index}>
    <Suspense fallback={null}><PlayerVehicle vehicleId="classic" car={car} tint={player.colour} /></Suspense>
    <CarLamps blend={nightBlend} halfWidth={effects.lampWidth} front={effects.front} rear={effects.rear} height={effects.headHeight} rearHeight={effects.tailHeight} />
    <HeadlightBeam blend={nightBlend} />
  </PartyBody></group>;
}

// The other players' cars (player 1 is the scene's own car). Lives inside the globe group.
export default function PartyCars({ run, count, nightBlend }: { run: React.RefObject<PartyRun | null>; count: number; nightBlend: React.RefObject<number> }) {
  return <>{Array.from({ length: Math.max(0, count - 1) }, (_, i) => <PartyCar key={i + 1} run={run} index={i + 1} nightBlend={nightBlend} />)}</>;
}
