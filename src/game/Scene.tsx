import { Suspense, memo, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { JUICE_CONFIG, LOOP_DRIVE } from './config';
import { DRIVING_CONFIG as CAR_CONFIG } from './vehicleHandling';
import { BOOST_FEEL, boostTuning } from './boostTuning';
import { createDust, createSoilClods, createSpeedLines, createTireMarks, updateDust, updateSoilClods, updateSpeedLines, updateTireMarks } from './juice';
import { playBoost, playImpact, playSlowMoWhoosh, playThud, playWhoosh, updateAudio } from './audio';
import { createBodySpring, updateBodySpring, updateCamera } from './carRig';
import { GLOBE_RADIUS, loopFrame, loopLatitude, spherePoint } from './globe';
import { ROAD_PATHS, distanceToRoadNetwork, isLandAt, landInfluence, roadPathFrame, roadPathMetric, roadSurfaceElevation, terrainElevation, terrainNormal } from './worldMap';
import { DRIVE_MODE, RAILS, initialLoopCar, recoverToRoad, stepLoopCar } from './driving';
import { clearObstacleGroup, drainNearMisses, drainTrafficHits, setObstacleGroup } from './obstacles';
import type { NearMiss, Obstacle, TrafficHit } from './obstacles';
import type { CarState, Controls } from './driving';
import MiniatureWorld, { airplaneState } from './MiniatureWorld';
import IntroDepthOfField from './IntroDepthOfField';
import { cinematicState } from './cinematic';
import { nightState } from './nightState';
import { advanceCycle, nightAmount, twilight } from './dayCycle';
import { difficulty, trafficActive, trafficSwerves } from './difficulty';
import { dayLook } from './dayLook';
import { warmLight } from './warmLight';
import { nightLook } from './nightLook';
import { VISUAL_QUALITY, ACTIVE_QUALITY, ART_DIRECTION } from './artDirection';
import { adaptResolution, createResolutionState, resolutionBounds } from './renderQuality';
import { CAR_COLORS, JITTER, PALETTE, seededRandom } from './palette';
import type { PaletteKey } from './palette';
import { bakeRoles, jitterAmount, kenneyCarKey, logMaterials, resolveKenneyCar, roleMaterials, textureSampler } from './recolor';
import carTextureUrl from '../assets/kenny cars/Textures/colormap.png?url';
import PlayerVehicle from './PlayerVehicle';
import type { VehicleId } from './vehicles';
import { vehicleEffects } from './vehicleVisuals';
import taxiModelUrl from '../assets/kenny cars/taxi.obj?url';
import policeModelUrl from '../assets/kenny cars/police.obj?url';
import suvModelUrl from '../assets/kenny cars/suv.obj?url';
import vanModelUrl from '../assets/kenny cars/van.obj?url';
import ambulanceModelUrl from '../assets/kenny cars/ambulance.obj?url';
import truckModelUrl from '../assets/kenny cars/truck.obj?url';
import deliveryModelUrl from '../assets/kenny cars/delivery.obj?url';

// Atmosphere tunables. Distances are in world units; colors come from PALETTE.
const ATMOSPHERE = {
  fog: { nearFactor: 0.04, farFactor: 1.0, damping: 4 },
  glow: { radius: 1.3, intensity: 0.48, power: 1.35, drivingFade: 0.45, nightIntensity: 0.1, nightPower: 3, darkFade: 0.7 },
  light: { hemisphereIntensity: 1.1, sunIntensity: 2.0, sunColor: PALETTE.sunWarm, shadowRadius: 4, rimIntensity: 0.2 },
  post: {
    exposure: 1.05,
  },
};


export type Telemetry = { speed: number; distance: number; x: number; z: number; heading: number; offroad?: boolean; throttle?: number; boost?: number; boosting?: number };

// Standard gamepad mapping: right trigger = throttle, left trigger = brake/reverse, left stick X = steering.
function readGamepad() {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const shape = (value: number) => {
    const magnitude = Math.abs(value);
    if (magnitude < CAR_CONFIG.gamepadDeadzone) return 0;
    return Math.sign(value) * ((magnitude - CAR_CONFIG.gamepadDeadzone) / (1 - CAR_CONFIG.gamepadDeadzone)) ** CAR_CONFIG.gamepadCurve;
  };
  for (const pad of pads) {
    if (!pad) continue;
    return { throttle: shape(pad.buttons[7]?.value ?? 0), brake: shape(pad.buttons[6]?.value ?? 0), steer: -shape(pad.axes[0] ?? 0), recover: !!pad.buttons[3]?.pressed };
  }
  return { throttle: 0, brake: 0, steer: 0, recover: false };
}
export type SceneProps = {
  started: boolean; paused: boolean; mapView?: boolean; trafficEnabled?: boolean; tutorialDriving?: boolean; tutorialCamera?: boolean; mobileCamera?: boolean; boostEnabled?: boolean; vehicleId: VehicleId;
  // The run's last heart is gone: the finale (see FINALE).
  finale?: boolean;
  // Only one heart is left: the warning and its heartbeat (see cinematicState.danger / pulse).
  danger?: boolean; cameraMode: number; resetKey: number;
  controls: React.RefObject<Controls>; car: React.RefObject<CarState>;
  onTelemetry: (data: Telemetry) => void; onReady: () => void; onTrafficHit?: (hit: TrafficHit) => void; onNearMiss?: (miss: NearMiss) => void; onDrift?: (drift: DriftScore) => void; onDriftCinematic?: () => void;
};

const localUp = new THREE.Vector3(0, 1, 0);
const localGlobeCenter = new THREE.Vector3(0, -GLOBE_RADIUS, 0);
const scenicSpawnAngles = [0.32, 0.78, 1.92, 2.55, 3.82, 4.46, 5.7] as const;
const TRAFFIC_LANE_OFFSET = 1.22;
// A swaying car drifts this far (m) either side of its lane line, a full sway taking 2π / rate seconds.
const SWERVE = { width: 0.9, rate: 0.75 };
// Just inside the road edge (half width 2.88): counts as on-road but clear of both traffic lanes.
const PARKING_OFFSET = -3.2;

const circularAngleDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Fixed start spot so the globe turn and camera move are the same every time.
const SPAWN_INDEX = 0;

const carRoleColor = (body: PaletteKey) => (role: string): { key: PaletteKey; roughness?: number } => {
  switch (role) {
    case 'body': return { key: body };
    case 'window': return { key: 'windows', roughness: 0.5 };
    case 'tire': return { key: 'tires' };
    case 'light': return { key: 'carRed' };
    case 'lamp': return { key: 'carYellow' };
    case 'accent': return { key: body === 'carCream' ? 'carBlue' : 'carCream' };
    default: return { key: 'roadShoulder' };
  }
};

function KenneyCar({ modelUrl, scale = 1.35, color, jitter }: { modelUrl: string; scale?: number; color: PaletteKey; jitter: number }) {
  const source = useLoader(OBJLoader, modelUrl);
  const texture = useLoader(THREE.TextureLoader, carTextureUrl);
  const model = useMemo(() => {
    const clone = source.clone(true);
    logMaterials('kenney car', clone);
    const sample = textureSampler(texture);
    clone.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const baked = bakeRoles(child.geometry, sample, kenneyCarKey, resolveKenneyCar);
      child.geometry = baked.geometry;
      child.material = roleMaterials(baked.roles, carRoleColor(color), jitter);
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return clone;
  }, [source, texture, color, jitter]);
  useEffect(() => () => {
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
    });
  }, [model]);
  // Kenney vehicles face local +Z, while the scene's vehicle basis uses -Z as forward.
  return <primitive object={model} scale={scale * 0.729} rotation={[0, Math.PI, 0]} />;
}

function surfaceAt(car: CarState) {
  const latitude = loopFrame(car.x, car.z).latitude;
  return { onRoad: distanceToRoadNetwork(latitude, car.x) < 0.7, onLand: landInfluence(latitude, car.x) >= 0.5 };
}

// Boost flame: an additive cone out of the exhaust while boost fires, flickering in length.
function BoostFlame({ car, vehicleId }: { car: React.RefObject<CarState>; vehicleId: VehicleId }) {
  const flame = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => new THREE.ConeGeometry(0.16, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: PALETTE.accentTree, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(state => {
    const on = JUICE_CONFIG.flameEnabled && car.current.boosting > 0;
    flame.current.visible = on;
    if (!on) return;
    const flicker = 0.75 + Math.sin(state.clock.elapsedTime * 47) * 0.15 + Math.random() * 0.15;
    flame.current.scale.set(1, 1, JUICE_CONFIG.flameLength * flicker);
    material.color.set(boostTuning.flameColour);
  });
  return <mesh
    ref={flame}
    geometry={geometry}
    material={material}
    position={vehicleEffects(vehicleId).exhaust}
    visible={false}
  />;
}

// Slow enough that the change passes through dusk, rather than snapping.

// Head and tail lamps that glow at night (additive cores + soft halos), faded by the night blend.
// Night lights are warm and soft everywhere: amber headlamps and beams, like the street lamps and windows.
const WARM_LIGHT = { headlamp: '#ffa888', headlampHalo: '#ff7a5a', beam: '#ff9a78' };

function CarLamps({ blend, halfWidth, front, rear, height, rearHeight = height }: {
  blend: React.RefObject<number>; halfWidth: number; front: number; rear: number; height: number; rearHeight?: number;
}) {
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  const materials = useMemo(() => {
    const glow = (hex: string) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    return { head: glow(WARM_LIGHT.headlamp), headHalo: glow(WARM_LIGHT.headlampHalo), tail: glow(PALETTE.carRed), tailHalo: glow(PALETTE.carRed) };
  }, []);
  useEffect(() => () => { geometry.dispose(); Object.values(materials).forEach(material => material.dispose()); }, [geometry, materials]);
  useFrame(() => {
    const n = blend.current;
    materials.head.opacity = n;
    materials.headHalo.opacity = n * 0.3;
    materials.tail.opacity = n * 0.9;
    materials.tailHalo.opacity = n * 0.3;
  });
  return <group>
    {[-1, 1].map(side => <group key={side}>
      <mesh geometry={geometry} material={materials.head} position={[side * halfWidth, height, front]} scale={0.09} />
      <mesh geometry={geometry} material={materials.headHalo} position={[side * halfWidth, height, front]} scale={0.26} />
      <mesh geometry={geometry} material={materials.tail} position={[side * halfWidth, rearHeight, rear]} scale={0.07} />
      <mesh geometry={geometry} material={materials.tailHalo} position={[side * halfWidth, rearHeight, rear]} scale={0.18} />
    </group>)}
  </group>;
}

// The player's headlight beam: one spotlight (always present so the shader never recompiles), faded by night.
function HeadlightBeam({ blend }: { blend: React.RefObject<number> }) {
  const spot = useRef<THREE.SpotLight>(null!);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => { spot.current.target = target; }, [target]);
  useFrame(() => { spot.current.intensity = blend.current * 110; });
  return <>
    <spotLight ref={spot} color={WARM_LIGHT.beam} position={[0, 0.7, -1.3]} angle={0.7} penumbra={1} distance={34} decay={1.6} intensity={0} />
    <primitive object={target} position={[0, 0, -10]} />
  </>;
}

function CarModel({ car, vehicleId, active, landingCompression, landingActive, bodyRoll, nightBlend }: {
  car: React.RefObject<CarState>;
  vehicleId: VehicleId;
  active: boolean;
  landingCompression: React.RefObject<number>;
  landingActive: React.RefObject<boolean>;
  bodyRoll: React.RefObject<number>;
  nightBlend: React.RefObject<number>;
}) {
  const body = useRef<THREE.Group>(null!);
  const spring = useMemo(createBodySpring, []);
  const landing = useRef(0);
  const effects = vehicleEffects(vehicleId);
  useFrame((_, delta) => {
    const state = car.current;
    const dt = Math.min(delta, LOOP_DRIVE.maxFrameDelta);
    updateBodySpring(spring, state, dt, active && !landingActive.current, !surfaceAt(state).onRoad);
    landing.current = THREE.MathUtils.damp(landing.current, landingCompression.current, 13, dt);
    body.current.rotation.x = spring.pitch + landing.current * 0.09;
    body.current.rotation.z = spring.roll;
    body.current.rotation.y = spring.wiggle + spring.driftYaw;
    // Squash keeps volume: shorter means a little wider.
    body.current.scale.set(1 + spring.squash * 0.5, (1 - landing.current * 0.34) * (1 - spring.squash), 1 + spring.squash * 0.5);
    body.current.position.y = spring.bounce - landing.current * 0.22;
    bodyRoll.current = spring.roll;
  });
  return <group ref={body} name="carBody">
    <PlayerVehicle vehicleId={vehicleId} car={car} />
    <BoostFlame car={car} vehicleId={vehicleId} />
    <CarLamps
      blend={nightBlend}
      halfWidth={effects.lampWidth}
      front={effects.front}
      rear={effects.rear}
      height={effects.headHeight}
      rearHeight={effects.tailHeight}
    />
    <HeadlightBeam blend={nightBlend} />
  </group>;
}

// Seeded body colors; cars that are next to each other on the loop never share one.
function trafficColors(count: number, order: number[]) {
  const random = seededRandom(9001);
  const colors: PaletteKey[] = new Array(count);
  order.forEach((carIndex, position) => {
    const previous = position > 0 ? colors[order[position - 1]] : undefined;
    const first = position === order.length - 1 ? colors[order[0]] : undefined;
    const options = CAR_COLORS.filter(key => key !== previous && key !== first);
    colors[carIndex] = options[Math.floor(random() * options.length)];
  });
  return colors;
}

const traffic = [
  { modelUrl: taxiModelUrl, pathIndex: 0, progress: 0.12, speed: 6.2, scale: 1.26 },
  { modelUrl: policeModelUrl, pathIndex: 0, progress: 0.35, speed: 7.4, scale: 1.2 },
  { modelUrl: suvModelUrl, pathIndex: 0, progress: 0.69, speed: 5.8, scale: 1.28 },
  { modelUrl: vanModelUrl, pathIndex: 0, progress: 0.56, speed: -5.2, scale: 1.22 },
  { modelUrl: ambulanceModelUrl, pathIndex: 0, progress: 0.27, speed: -6.7, scale: 1.16 },
  { modelUrl: truckModelUrl, pathIndex: 0, progress: 0.83, speed: 4.8, scale: 1.22 },
  { modelUrl: deliveryModelUrl, pathIndex: 0, progress: 0.92, speed: -4.6, scale: 1.18 },
  // Extra cars for the busier roads of higher levels (see difficulty.ts).
  { modelUrl: taxiModelUrl, pathIndex: 0, progress: 0.47, speed: -5.6, scale: 1.26 },
  { modelUrl: suvModelUrl, pathIndex: 0, progress: 0.04, speed: -5.0, scale: 1.28 },
  { modelUrl: policeModelUrl, pathIndex: 0, progress: 0.76, speed: -6.2, scale: 1.2 },
  { modelUrl: vanModelUrl, pathIndex: 0, progress: 0.21, speed: 5.4, scale: 1.22 },
];
const TRAFFIC_COLORS = trafficColors(traffic.length, traffic.map((_, index) => index).sort((a, b) => traffic[a].progress - traffic[b].progress));
const TRAFFIC_JITTER = (() => { const random = seededRandom(9002); return traffic.map(() => jitterAmount(random, JITTER.cars)); })();

// Traffic collides as a capsule matching the Kenney cars' body (about 2.3 long, 1.1 wide).
const TRAFFIC_COLLISION = { radius: 0.55, halfLength: 0.6 };
// Basic traffic reactions: stop for the player ahead in the lane, and take a push when hit.
const NPC = {
  stopDistance: 10, minGap: 3.5, laneHalfWidth: 1.6, braking: 3, followDistance: 9, followGap: 4.5,
  pushTransfer: 0.75, spinTransfer: 0.2, maxPush: 9, shoveForward: 0.7, hitCooldown: 0.4,
  laneReturn: 2.2, pushDamping: 3.2, spinStiffness: 14, spinDamping: 3.2,
};
// Positive side hits throw the struck traffic car aside without interrupting the player.
const SIDE_HIT = {
  fling: 1.15, hop: 0.65, roll: 0.65,
  maxLateralVelocity: 3.4, maxSpinVelocity: 1.5,
};
// How hard the camera reacts to ramming a car under boost.
const BOOST_IMPACT = { shake: 0.5, fov: 9, tilt: 2.2 };
// A car hit by a boosting player is thrown clear of the lane, whatever the angle: hard to the side, up in the
// air with a big spin, and (hit from behind) punted forward, so it is out of the player's way at once.
const BOOST_HIT = { fling: 2.4, minLateralVelocity: 10, maxLateralVelocity: 15, hop: 2.2, spin: 2.5, punt: 0.8 };
// Negative hits (nose or tail into traffic) get a clean cinematic cut-in, all on real time: the camera snaps
// in toward the crash on an extreme ease-out, holds while time crawls, then glides back. The aim swings onto
// the crash, the lens tightens, the frame tilts a touch, and the depth of field locks on (see cinematic.ts).
const CRASH_CAM = {
  duration: 1.7, snap: 0.24, hold: 0.85,
  push: 0.5, lookPull: 0.7, fovPunch: 9, dutch: 0.06, slowScale: 0.18, shake: 0.35,
  // Seconds after a cut-in ends before another can start.
  rest: 1.5,
};
// A near miss reuses the cut-in with the faded, bleached grade, but the camera moves less: it is a held
// breath, not an impact. A rest after each (difficulty.nearMissRest) keeps them special: until it passes, a near
// miss only scores, with no slow motion.
const NEAR_MISS_CAM = { strength: 0.55 };
// Distances (m) around the car checked for water, for the sound of the sea.
const SEA_RINGS = [5, 10, 16];
// How close (to the camera) the plane must come to be heard, fully within `near`, not at all beyond `far`.
const PLANE_HEARD = { near: 14, far: 45 };
// A drift that lasts scores when it ends: on the road, at speed, long enough (difficulty.driftMinTime), and without
// hitting anything. Brief gaps (the slide flickering as the wheel crosses centre) up to `grace` don't end it.
// A finished drift, for scoring its quality: how long and fast, how hard into the slide (`angle`, the average
// steering 0..1), how much of it stayed on the road (`clean`, 0..1), how many times it switched sides
// (`switches`: an S-drift) and how many near misses it threaded on the way (`threaded`).
export type DriftScore = { time: number; speed: number; angle: number; clean: number; switches: number; threaded: number };
const DRIFT_SCORE = { minSpeed: 4.5, grace: 0.25, settle: 0.3 };
// Drift camera, once a slide has settled in: it swings out to the outside of the turn to show the car's
// angle, drops a little lower, widens the lens a touch and leans into the corner. All gentle, on smooth easing.
const DRIFT_CAM = { swing: 2.4, drop: 0.9, fov: 4, roll: 0.025, attack: 2.6, release: 1.8 };
// Drift cut-in: once a good drift has lasted `trigger` seconds (on the road, at speed, not under boost), the camera
// shoots up to look straight down on the car from `height` m (with the car heading up the screen; `turn` can swing
// it round the car on the way, off by default) while time slows to `slowScale` (gentler than a crash, so the slide
// still moves), holds a moment, then comes back down more slowly to land behind the car again. All on real time. `rise` and `hold` are when it is fully up and when it starts back
// down; `rest` keeps it rare.
// `pullOut` lifts the shot further by the same distance the boost camera backs away and rises (× BOOST_FEEL's
// pullBack + rise), so the overhead view opens out about as wide as a boost's.
const DRIFT_CINE = { trigger: 0.75, duration: 1.8, rise: 0.35, hold: 0.65, slowScale: 0.35, height: 13, back: 0.5, turn: 0, rest: 3.5, pullOut: 0.136 };
// The finale, when the last heart goes: time all but stops (`slowScale`), the camera goes straight up over the car,
// climbing from `startHeight` to `height` m while looking down on it and turning a full `turn` round it, over
// `duration` s (eased at both ends), and the frame takes the steel-blue end grade. It does not come back: the
// run-over card follows.
// The shot's turn and climb ease out exponentially: quick at first, then slower and slower, never quite stopping, so
// the last frame (behind the run-over card) is still creeping round by a hair. `spinEase`/`climbEase` are their time
// constants (s): most of `turn` is done in about three of them.
const FINALE = { duration: 3.4, rise: 0.7, slowScale: 0.12, startHeight: 8, height: 34, turn: Math.PI * 0.55, spinEase: 1.1, climbEase: 1.3 };
const driftCutEnvelope = (time: number) => {
  if (time < 0 || time > DRIFT_CINE.duration) return 0;
  if (time < DRIFT_CINE.rise) return 1 - Math.pow(1 - time / DRIFT_CINE.rise, 3);
  if (time < DRIFT_CINE.hold) return 1;
  return 1 - easeInOutCubic((time - DRIFT_CINE.hold) / (DRIFT_CINE.duration - DRIFT_CINE.hold));
};
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const crashEnvelope = (time: number) => {
  if (time < 0 || time > CRASH_CAM.duration) return 0;
  if (time < CRASH_CAM.snap) return easeOutExpo(time / CRASH_CAM.snap);
  if (time < CRASH_CAM.hold) return 1;
  return 1 - easeInOutCubic((time - CRASH_CAM.hold) / (CRASH_CAM.duration - CRASH_CAM.hold));
};
// Positive side hits get their own camera beat that never touches the car's motion: a quick dutch tilt that
// wobbles back, a glance toward the car being thrown, and a little FOV kick. All on real time.
const SIDE_HIT_CAMERA = {
  dutchKick: 1.1, dutchStiffness: 55, dutchDamping: 6.5, maxDutch: 0.09,
  swing: 2.2, swingDecay: 2.6, fovKick: 5, shake: 0.18,
};
// Shared game-time scale (slow motion); traffic reads it so the whole world slows together.
const gameTime = { scale: 1 };

// Cartoon hit reaction (visual only): the struck car hops, rolls away from the hit and wobbles back,
// squashes on impact and on landing. `strengthSpeed` is the hit speed that gives the full reaction.
const NPC_HIT = {
  strengthSpeed: 18,
  hopMin: 1.6, hopMax: 5.5, gravity: 22, bounce: 0.32,
  rollKick: 5, rollKickMax: 9, rollStiffness: 70, rollDamping: 6, airRollStiffness: 12, maxRoll: 0.7,
  squashKick: 5, landSquash: 0.05, squashStiffness: 220, squashDamping: 11, maxSquash: 0.22,
  halfWidth: 0.45,
};

function TrafficCar({ modelUrl, pathIndex, progress: startProgress, speed, scale, paused, enabled, progressIndex, progresses, obstacle, player, reactive, nightBlend }: typeof traffic[number] & {
  paused: boolean;
  enabled: boolean;
  progressIndex: number;
  progresses: React.RefObject<number[]>;
  obstacle: Obstacle;
  player: React.RefObject<CarState>;
  reactive: boolean;
  nightBlend: React.RefObject<number>;
}) {
  const motion = useRef({ speed: Math.abs(speed), push: 0, pushVelocity: 0, spin: 0, spinVelocity: 0, cooldown: 0 });
  const hit = useRef({ hop: 0, hopVelocity: 0, roll: 0, rollVelocity: 0, squash: 0, squashVelocity: 0 });
  const presence = useRef(enabled && trafficActive(progressIndex) ? 1 : 0);
  // Swaying in the lane (higher levels): eased in and out, with this car's own phase.
  const swerve = useRef({ amount: 0, phase: progressIndex * 1.7, time: 0 });
  const body = useRef<THREE.Group>(null!);
  const heading = useMemo(() => new THREE.Vector3(), []);
  const playerPoint = useMemo(() => new THREE.Vector3(), []);
  const toPlayer = useMemo(() => new THREE.Vector3(), []);
  const group = useRef<THREE.Group>(null!);
  const progress = useRef(startProgress);
  const path = ROAD_PATHS[pathIndex];
  const normal = useMemo(() => new THREE.Vector3(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const back = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05) * gameTime.scale;
    const m = motion.current;
    if (!paused) progress.current = (progress.current + Math.sign(speed) * m.speed * dt / roadPathMetric(path, progress.current) + 1) % 1;
    progresses.current[progressIndex] = progress.current;
    const frame = roadPathFrame(path, progress.current, 0.075);
    normal.set(...frame.normal);
    tangent.set(...frame.tangent).multiplyScalar(Math.sign(speed));
    right.crossVectors(tangent, normal).normalize();
    const sway = swerve.current;
    sway.amount = THREE.MathUtils.damp(sway.amount, trafficSwerves(progressIndex) ? 1 : 0, 0.8, Math.min(delta, 0.05));
    if (!paused) sway.time += dt;
    const swayOffset = sway.amount * SWERVE.width * Math.sin(sway.time * SWERVE.rate + sway.phase);
    group.current.position.set(...frame.point).addScaledVector(right, TRAFFIC_LANE_OFFSET + m.push + swayOffset);
    const surfaceRadius = Math.hypot(frame.point[0], frame.point[1] + GLOBE_RADIUS, frame.point[2]);
    group.current.position.sub(localGlobeCenter).normalize().multiplyScalar(surfaceRadius).add(localGlobeCenter);
    back.copy(tangent).negate();
    basis.makeBasis(right, normal, back);
    group.current.quaternion.setFromRotationMatrix(basis);

    // Where is the player relative to this car's travel direction and lane?
    const car = player.current;
    playerPoint.set(...spherePoint(loopLatitude(car.x) + car.z / GLOBE_RADIUS, car.x, 0));
    toPlayer.copy(playerPoint).sub(group.current.position);
    const ahead = toPlayer.dot(tangent);
    const lateral = toPlayer.dot(right);
    // Already overlapping the player? Keep moving so the cars separate instead of locking together.
    const blocked = reactive && enabled && ahead > 1.5 && ahead < NPC.stopDistance && Math.abs(lateral) < NPC.laneHalfWidth;
    // Fewer and calmer cars at low levels (see difficulty.ts). A car joining or leaving the road grows in or
    // shrinks away, and only collides while it is properly there.
    const active = enabled && trafficActive(progressIndex);
    presence.current = THREE.MathUtils.damp(presence.current, active ? 1 : 0, 3, Math.min(delta, 0.05));
    obstacle.inactive = presence.current < 0.6;
    group.current.visible = presence.current > 0.01;
    const cruise = Math.abs(speed) * difficulty.trafficSpeed;
    let followGap = Infinity;
    traffic.forEach((other, index) => {
      if (index === progressIndex || Math.sign(other.speed) !== Math.sign(speed) || !trafficActive(index)) return;
      const fraction = ((progresses.current[index] - progress.current) * Math.sign(speed) + 1) % 1;
      followGap = Math.min(followGap, fraction * roadPathMetric(path, progress.current));
    });
    const follow = THREE.MathUtils.clamp((followGap - NPC.followGap) / (NPC.followDistance - NPC.followGap), 0, 1);
    const targetSpeed = Math.min(
      blocked ? cruise * THREE.MathUtils.clamp((ahead - NPC.minGap) / (NPC.stopDistance - NPC.minGap), 0, 1) : cruise,
      cruise * follow,
    );
    m.speed = THREE.MathUtils.damp(m.speed, targetSpeed, NPC.braking, dt);
    m.cooldown = Math.max(0, m.cooldown - dt);
    obstacle.ramCooldown = Math.max(0, (obstacle.ramCooldown ?? 0) - dt);
    if (obstacle.impact && m.cooldown === 0) {
      const power = obstacle.impactPower ?? 1;
      const boosted = !!obstacle.boostHit;
      const side = obstacle.hitKind === 'side' && !boosted;
      const front = obstacle.hitKind === 'front' && !boosted;
      obstacle.hitKind = undefined;
      obstacle.boostHit = false;
      const fling = boosted ? BOOST_HIT.fling : side ? SIDE_HIT.fling : 1;
      const away = lateral > 0 ? -1 : 1;
      const sideways = Math.min(1, Math.abs(lateral) / NPC.laneHalfWidth);
      m.pushVelocity += away * obstacle.impact * NPC.pushTransfer * Math.max(sideways, 0.35) * fling;
      m.spinVelocity += away * obstacle.impact * NPC.spinTransfer * fling;
      if (side) {
        // Cap the initial shove so high-speed overlaps read as a firm nudge, not a launch.
        m.pushVelocity = THREE.MathUtils.clamp(m.pushVelocity, -SIDE_HIT.maxLateralVelocity * power, SIDE_HIT.maxLateralVelocity * power);
        m.spinVelocity = THREE.MathUtils.clamp(m.spinVelocity, -SIDE_HIT.maxSpinVelocity * power, SIDE_HIT.maxSpinVelocity * power);
      }
      if (front) {
        // A frontal hit should clear the lane without stopping either car abruptly.
        m.pushVelocity = THREE.MathUtils.clamp(m.pushVelocity, -4.4 * power, 4.4 * power);
      }
      if (boosted) {
        const direction = m.pushVelocity === 0 ? away : Math.sign(m.pushVelocity);
        m.pushVelocity = direction * THREE.MathUtils.clamp(Math.abs(m.pushVelocity), BOOST_HIT.minLateralVelocity * power, BOOST_HIT.maxLateralVelocity * power);
        m.spinVelocity += direction * BOOST_HIT.spin * power;
      }
      // A rear hit shoves the car forward (punted hard under boost); a frontal hit slows it while steering it clear.
      m.speed = ahead < 0 ? m.speed + obstacle.impact * (boosted ? BOOST_HIT.punt : NPC.shoveForward * (1 - sideways)) : m.speed * (front ? 0.72 : 0.3);
      m.cooldown = NPC.hitCooldown;
      const strength = THREE.MathUtils.clamp(obstacle.impact / NPC_HIT.strengthSpeed, 0, 1);
      const h = hit.current;
      h.hopVelocity = Math.max(h.hopVelocity, THREE.MathUtils.lerp(NPC_HIT.hopMin, NPC_HIT.hopMax, strength) * (boosted ? BOOST_HIT.hop : side ? SIDE_HIT.hop : 1));
      // Tip away from the hit: the body is shoved while the tyres grip, so the roof leans the way it's pushed
      // (+z roll lifts the right side). A rear hit still gets a little roll so it reads as a bump.
      h.rollVelocity += -away * THREE.MathUtils.lerp(NPC_HIT.rollKick, NPC_HIT.rollKickMax, strength) * Math.max(sideways, 0.3) * (side ? SIDE_HIT.roll : 1);
      h.squashVelocity -= NPC_HIT.squashKick * (0.4 + strength);
    }
    obstacle.impact = 0;
    m.pushVelocity += (-m.push * NPC.laneReturn - m.pushVelocity * NPC.pushDamping) * dt;
    m.push = THREE.MathUtils.clamp(m.push + m.pushVelocity * dt, -NPC.maxPush, NPC.maxPush);
    m.spinVelocity += (-m.spin * NPC.spinStiffness - m.spinVelocity * NPC.spinDamping) * dt;
    m.spin += m.spinVelocity * dt;
    group.current.rotateY(m.spin);
    const h = hit.current;
    h.hopVelocity -= NPC_HIT.gravity * dt;
    h.hop += h.hopVelocity * dt;
    if (h.hop <= 0) {
      h.hop = 0;
      if (h.hopVelocity < -1.5) {
        h.squashVelocity += h.hopVelocity * NPC_HIT.landSquash * 10;
        h.hopVelocity = -h.hopVelocity * NPC_HIT.bounce;
      } else h.hopVelocity = 0;
    }
    const rollStiffness = h.hop > 0 ? NPC_HIT.airRollStiffness : NPC_HIT.rollStiffness;
    h.rollVelocity += (-h.roll * rollStiffness - h.rollVelocity * NPC_HIT.rollDamping) * dt;
    h.roll = THREE.MathUtils.clamp(h.roll + h.rollVelocity * dt, -NPC_HIT.maxRoll, NPC_HIT.maxRoll);
    h.squashVelocity += (-h.squash * NPC_HIT.squashStiffness - h.squashVelocity * NPC_HIT.squashDamping) * dt;
    h.squash = THREE.MathUtils.clamp(h.squash + h.squashVelocity * dt, -NPC_HIT.maxSquash, NPC_HIT.maxSquash);
    // Roll pivots on the low-side wheels, so lift the body by the roll so it never digs into the road.
    body.current.position.y = h.hop + Math.abs(Math.sin(h.roll)) * NPC_HIT.halfWidth;
    body.current.rotation.z = h.roll;
    const grow = THREE.MathUtils.smoothstep(presence.current, 0, 1);
    body.current.scale.set((1 - h.squash * 0.5) * grow, (1 + h.squash) * grow, (1 - h.squash * 0.5) * grow);
    // Keep this car's collision circle on its current position (planet centre is localGlobeCenter).
    const p = group.current.position;
    const r = Math.hypot(p.x - localGlobeCenter.x, p.y - localGlobeCenter.y, p.z - localGlobeCenter.z);
    obstacle.latitude = Math.asin(THREE.MathUtils.clamp((p.y - localGlobeCenter.y) / r, -1, 1));
    obstacle.longitude = Math.atan2(p.x - localGlobeCenter.x, p.z - localGlobeCenter.z);
    // Facing (including the hit spin) as an [east, north] unit vector for the capsule.
    heading.set(0, 0, -1).applyQuaternion(group.current.quaternion);
    const lat = obstacle.latitude, lon = obstacle.longitude;
    const east = Math.cos(lon) * heading.x - Math.sin(lon) * heading.z;
    const north = -Math.sin(lat) * Math.sin(lon) * heading.x + Math.cos(lat) * heading.y - Math.sin(lat) * Math.cos(lon) * heading.z;
    const length = Math.hypot(east, north) || 1;
    obstacle.forward = [east / length, north / length];
    obstacle.velocity = paused ? 0 : m.speed;
  });
  return <group ref={group} visible={enabled}><group ref={body}>
    <KenneyCar modelUrl={modelUrl} scale={scale} color={TRAFFIC_COLORS[progressIndex]} jitter={TRAFFIC_JITTER[progressIndex]} />
    <CarLamps blend={nightBlend} halfWidth={0.4} front={-1.15} rear={1.1} height={0.45} />
  </group></group>;
}

function Traffic({ paused, enabled, progresses, player, reactive, nightBlend }: { paused: boolean; enabled: boolean; progresses: React.RefObject<number[]>; player: React.RefObject<CarState>; reactive: boolean; nightBlend: React.RefObject<number> }) {
  const obstacles = useMemo<Obstacle[]>(() => traffic.map(() => ({ latitude: 0, longitude: 0, radius: TRAFFIC_COLLISION.radius, halfLength: TRAFFIC_COLLISION.halfLength, forward: [0, 1] as [number, number], movable: true, inactive: true })), []);
  useEffect(() => {
    setObstacleGroup('traffic', obstacles);
    return () => clearObstacleGroup('traffic');
  }, [obstacles]);
  return <>{traffic.map((car, index) => <TrafficCar key={`${car.modelUrl}-${index}`} {...car} paused={paused} enabled={enabled} progressIndex={index} progresses={progresses} obstacle={obstacles[index]} player={player} reactive={reactive} nightBlend={nightBlend} />)}</>;
}

const ARRIVAL = { duration: 2.6, yaw: -1.1, pitch: 0.5, zoom: 0.62 };
const COACH_CAMERA = { height: 23, enter: 2.2, exitDuration: 5, arcLift: 1.6 };
const WHEEL_ZOOM = { closer: 0.23, duration: 0.55, tilt: 0.12 };
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// At night the white haze would read as a grey dome on the dark sky, so it fades to a thin, faint blue rim.
function AtmosphereGlow({ amount, night }: { amount: React.RefObject<number>; night: React.RefObject<number> }) {
  const [dayColor, nightColor] = useMemo(() => [new THREE.Color(PALETTE.atmosphere), new THREE.Color(PALETTE.lightNightSkyFill)], []);
  const uniforms = useMemo(() => ({
    uColor: { value: dayColor.clone() },
    uIntensity: { value: ATMOSPHERE.glow.intensity },
    uPower: { value: ATMOSPHERE.glow.power },
    uFade: { value: 1 },
    // How far round the back of the shell the globe's silhouette sits, so the glow peaks right at the globe.
    uEdge: { value: Math.sqrt(1 - 1 / ATMOSPHERE.glow.radius ** 2) },
  }), [dayColor]);
  useFrame(() => {
    const n = night.current;
    // The sky turns purple before the night lighting blend is complete, so taper the halo's opacity as dusk deepens.
    uniforms.uFade.value = amount.current * (1 - n * ATMOSPHERE.glow.darkFade);
    uniforms.uColor.value.copy(dayColor).lerp(nightColor, n);
    uniforms.uIntensity.value = THREE.MathUtils.lerp(ATMOSPHERE.glow.intensity * dayLook.glow, ATMOSPHERE.glow.nightIntensity * nightLook.glow, n);
    uniforms.uPower.value = THREE.MathUtils.lerp(ATMOSPHERE.glow.power, ATMOSPHERE.glow.nightPower, n);
  });
  return <mesh renderOrder={-1}>
    <sphereGeometry args={[GLOBE_RADIUS * ATMOSPHERE.glow.radius, 64, 48]} />
    <shaderMaterial
      uniforms={uniforms}
      transparent
      depthWrite={false}
      depthTest
      side={THREE.BackSide}
      blending={THREE.AdditiveBlending}
      vertexShader={`varying vec3 vNormal;
        void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
      fragmentShader={`uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uPower;
        uniform float uFade;
        varying vec3 vNormal;
        uniform float uEdge;
        void main() {
          // 1 at the globe's silhouette, falling smoothly to 0 at the shell's own edge (no hard outer ring).
          float rim = clamp(-vNormal.z / uEdge, 0.0, 1.0);
          gl_FragColor = vec4(uColor, pow(rim, uPower) * uIntensity * uFade);
        }`}
    />
  </mesh>;
}

// Meteors: bright streaks crossing the upper sky in camera space, so the globe cannot occlude them.
const METEORS = { count: 4, distance: 220, gapMin: 3, gapMax: 7, lifeMin: 1.1, lifeMax: 1.6, travel: 150, width: 2.4, brightness: 1.8 };

function buildMeteorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 8;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.7, 'rgba(255,240,215,0.35)');
  gradient.addColorStop(1, 'rgba(255,252,240,1)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 8);
  return new THREE.CanvasTexture(canvas);
}

function Meteors() {
  const { camera, size } = useThree();
  const texture = useMemo(buildMeteorTexture, []);
  const meshes = useMemo(() => Array.from({ length: METEORS.count }, () => {
    const material = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1, 1, 1).multiplyScalar(METEORS.brightness), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    return mesh;
  }), [texture]);
  const state = useMemo(() => meshes.map(() => ({ time: -1, life: 1, start: new THREE.Vector3(), direction: new THREE.Vector3(), length: 1 })), [meshes]);
  const next = useRef(3);
  useEffect(() => {
    meshes.forEach(mesh => camera.add(mesh));
    return () => { meshes.forEach(mesh => { camera.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }); texture.dispose(); };
  }, [camera, meshes, texture]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    next.current -= dt;
    if (next.current <= 0) {
      next.current = METEORS.gapMin + Math.random() * (METEORS.gapMax - METEORS.gapMin);
      const free = state.findIndex(item => item.time < 0);
      if (free >= 0) {
        // Keep each streak in the upper part of the view, outside the globe's silhouette.
        const halfHeight = METEORS.distance * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
        const halfWidth = halfHeight * size.width / size.height;
        const centre = new THREE.Vector3((Math.random() * 2 - 1) * halfWidth * 0.58, halfHeight * (0.48 + Math.random() * 0.28), -METEORS.distance);
        const direction = new THREE.Vector3((0.7 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1), -(0.25 + Math.random() * 0.35), 0).normalize();
        const item = state[free];
        item.time = 0;
        item.life = METEORS.lifeMin + Math.random() * (METEORS.lifeMax - METEORS.lifeMin);
        item.direction.copy(direction);
        item.start.copy(centre).addScaledVector(direction, -METEORS.travel / 2);
        item.length = 10 + Math.random() * 8;
      }
    }
    meshes.forEach((mesh, index) => {
      const item = state[index];
      if (item.time < 0) { mesh.visible = false; return; }
      item.time += dt;
      const t = item.time / item.life;
      if (t >= 1) { item.time = -1; mesh.visible = false; return; }
      // Fast in, slow out; the tail flares as the head crosses, then fades.
      const progress = 1 - Math.pow(1 - t, 2.2);
      const fade = Math.sin(Math.PI * Math.min(t * 1.25, 1)) * (1 - t * 0.6);
      mesh.visible = true;
      mesh.position.copy(item.start).addScaledVector(item.direction, progress * METEORS.travel);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), item.direction);
      mesh.scale.set(item.length, METEORS.width, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, fade) * 0.9;
    });
  });
  return null;
}

function DrivingScene(props: SceneProps) {
  const vehicle = useRef<THREE.Group>(null!);
  const globeGroup = useRef<THREE.Group>(null!);
  const scaleGroup = useRef<THREE.Group>(null!);
  const { camera, gl, scene } = useThree();
  // Keep the intro camera aimed through the globe's center. The asymmetric
  // composition is created with lens shift below, so the spherical silhouette
  // stays circular instead of becoming an off-axis perspective ellipse.
  const introCamera = useMemo(() => new THREE.Vector3(0, 40, 94), []);
  const introLook = useMemo(() => new THREE.Vector3(0, -GLOBE_RADIUS, 0), []);
  const gameCamera = useMemo(() => new THREE.Vector3(), []);
  const gameLook = useMemo(() => new THREE.Vector3(), []);
  const coachCamera = useMemo(() => new THREE.Vector3(), []);
  const coachLook = useMemo(() => new THREE.Vector3(), []);
  const coachCameraBlend = useRef(0);
  const coachCameraWasTarget = useRef(false);
  const coachCameraExitStart = useRef(0);
  const coachCameraExitElapsed = useRef(0);
  const desiredCamera = useMemo(() => new THREE.Vector3(), []);
  const desiredLook = useMemo(() => new THREE.Vector3(), []);
  const globeCenter = useMemo(() => new THREE.Vector3(0, -GLOBE_RADIUS, 0), []);
  const cameraStartDirection = useMemo(() => new THREE.Vector3(), []);
  const cameraEndDirection = useMemo(() => new THREE.Vector3(), []);
  const cameraArc = useMemo(() => new THREE.Quaternion(), []);
  const cameraArcStep = useMemo(() => new THREE.Quaternion(), []);
  const smoothedLook = useMemo(() => introLook.clone(), [introLook]);
  const smoothedUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const surfaceUp = useMemo(() => new THREE.Vector3(), []);
  const vehiclePosition = useMemo(() => new THREE.Vector3(), []);
  const groundVehiclePosition = useMemo(() => new THREE.Vector3(), []);
  const vehicleUp = useMemo(() => new THREE.Vector3(), []);
  const vehicleTangent = useMemo(() => new THREE.Vector3(), []);
  const vehicleNorth = useMemo(() => new THREE.Vector3(), []);
  const vehicleRight = useMemo(() => new THREE.Vector3(), []);
  const vehicleBack = useMemo(() => new THREE.Vector3(), []);
  const vehicleBasis = useMemo(() => new THREE.Matrix4(), []);
  const targetVehicleQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const targetCameraUp = useMemo(() => new THREE.Vector3(), []);
  const rotation = useRef(Math.PI * -100 / 180);
  const pitch = useRef(0);
  const introPan = useRef(new THREE.Vector2());
  const dragging = useRef(false);
  const panning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const zoomProgress = useRef(0);
  const smoothedElevation = useRef<number | null>(null);
  const poseInitialized = useRef(false);
  const readied = useRef(false);
  const introZoom = useRef(0);
  const introZoomTarget = useRef(0);
  const introZoomFrom = useRef(0);
  const introZoomClock = useRef(0);
  const introZoomCta = useRef(0);
  const glowAmount = useRef(1);
  const arrivalTime = useRef(0);
  const trafficProgresses = useRef(traffic.map(car => car.progress));
  const wasStarted = useRef(false);
  const landingHeight = useRef(0);
  const landingVelocity = useRef(0);
  const landingCompression = useRef(0);
  const landingActive = useRef(false);
  const landingReleased = useRef(false);
  const landingCameraBlend = useRef(0);
  const introEuler = useMemo(() => new THREE.Euler(0, 0, 0, 'XYZ'), []);
  const introQuat = useMemo(() => new THREE.Quaternion(), []);
  const driveQuat = useMemo(() => new THREE.Quaternion(), []);
  const globeQuat = useMemo(() => new THREE.Quaternion(), []);
  const globeReady = useRef(false);
  const cameraOffset = useMemo(() => new THREE.Vector3(), []);
  const nightBlend = useRef(nightAmount());
  // Low-sun colours around sunset and sunrise: the sunlight and the haze it lights up.
  const [sunsetLight, sunsetFog] = useMemo(() => [new THREE.Color('#ff9a5a'), new THREE.Color('#e9a48a')], []);
  const ambientLight = useRef<THREE.AmbientLight>(null!);
  const hemisphereLight = useRef<THREE.HemisphereLight>(null!);
  const rimLight = useRef<THREE.DirectionalLight>(null!);
  const bounceLight = useRef<THREE.DirectionalLight>(null!);
  const cornerLight = useRef<THREE.PointLight>(null!);
  const cornerDir = useMemo(() => new THREE.Vector3(), []);
  const cornerSide = useMemo(() => new THREE.Vector3(), []);
  const cornerUp = useMemo(() => new THREE.Vector3(), []);
  const cornerHsl = useMemo(() => ({ h: 0, s: 0, l: 0 }), []);
  const cornerClock = useRef(0);
  const [neutralSun, amberSun, daySunColour, hazeColour, dayFogColour] = useMemo(() => [
    new THREE.Color('#fffaf2'), new THREE.Color('#ffb25e'), new THREE.Color(), new THREE.Color('#ebeee2'), new THREE.Color(),
  ], []);
  const [neutralMoon, coolMoon, nightMoonColour, nightHazeColour, nightFogColour] = useMemo(() => [
    new THREE.Color('#e8eeff'), new THREE.Color('#8fb2ff'), new THREE.Color(), new THREE.Color('#5a6f88'), new THREE.Color(),
  ], []);
  const lightColors = useMemo(() => {
    const c = (hex: string) => new THREE.Color(hex);
    const day = ART_DIRECTION.day, night = ART_DIRECTION.night;
    return {
      dayAmbient: c(day.ambientColor), nightAmbient: c(night.ambientColor),
      daySky: c(PALETTE.lightDaySkyFill), nightSky: c(night.skyFillColor),
      dayGround: c(PALETTE.land), nightGround: c(night.groundFillColor),
      daySun: c(ATMOSPHERE.light.sunColor), nightSun: c(night.sunColor),
      dayRim: c(day.rimColor), nightRim: c(night.rimColor),
      boostRim: c(PALETTE.boostRim),
      dayBounce: c(day.bounceColor), nightBounce: c(night.bounceColor),
      dayFog: c(PALETTE.haze), nightFog: c(night.fogColor),
    };
  }, []);
  const pedals = useRef({ throttle: 0, brake: 0 });
  const bodyRoll = useRef(0);
  const fovKick = useRef(0);
  const trauma = useRef(0);
  const crashTime = useRef(-1);
  const crashSide = useRef(1);
  // Whether the current cut-in is a cool (hard side) hit, which gets the faded, bleached grade instead of the red.
  const crashCool = useRef(false);
  const coolBlend = useRef(0);
  // How hard the cut-in moves the camera: 1 for a crash, less for a near miss.
  const crashStrength = useRef(1);
  const nearMissRest = useRef(0);
  const seaCheck = useRef(0);
  const driftCutTime = useRef(-1);
  // Rails mode cruising: a clock for its rhythm and the eased cruise level it gives.
  const cruiseClock = useRef(0);
  const cruise = useRef(0.8);
  const driftCutRest = useRef(0);
  const driftCutLevel = useRef(0);
  const driftOrbit = useRef(0);
  const driftApplied = useMemo(() => new THREE.Vector3(), []);
  const driftTop = useMemo(() => new THREE.Vector3(), []);
  const finaleTime = useRef(-1);
  // The last-heart warning: eases in and out with `danger`, and its heartbeat is a double beat ("lub-dub") every
  // 0.9 s on real time, so it is the same on every device.
  const dangerLevel = useRef(0);
  const dangerClock = useRef(0);
  const finaleLevel = useRef(0);
  const finaleApplied = useMemo(() => new THREE.Vector3(), []);
  const finaleSpot = useMemo(() => new THREE.Vector3(), []);
  const finaleOffset = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { finaleTime.current = props.finale ? 0 : -1; }, [props.finale]);
  const driftOffset = useMemo(() => new THREE.Vector3(), []);
  const seaNear = useRef(0);
  const driftRun = useRef({ time: 0, speed: 0, gap: 0, offroad: 0, spoiled: false, steer: 0, side: 0, switches: 0, threaded: 0 });
  const driftHold = useRef(0);
  const driftSide = useRef(0);
  const crashRest = useRef(0);
  const crashLevel = useRef(0);
  const crashApplied = useMemo(() => new THREE.Vector3(), []);
  const crashFovApplied = useRef(0);
  const crashLook = useMemo(() => new THREE.Vector3(), []);
  const cameraLag = useRef(0);
  const wasBoosting = useRef(0);
  const boostCameraPulse = useRef(0);
  const dutch = useRef(0);
  const boostHold = useRef(0);
  const cameraSpeed = useRef(0);
  const cameraAcceleration = useRef(0);
  const boostBack = useMemo(() => new THREE.Vector3(), []);
  const dutchVelocity = useRef(0);
  const lookSwing = useRef(0);
  const boostAtmosphere = useRef(0);
  const tireMarks = useMemo(createTireMarks, []);
  const rearAxle = useMemo(() => ({ halfTrack: 0, rearZ: 0 }), []);
  const wheelEffects = useMemo(() => vehicleEffects(props.vehicleId), [props.vehicleId]);
  const speedLines = useMemo(createSpeedLines, []);
  const dust = useMemo(createDust, []);
  const soilClods = useMemo(createSoilClods, []);
  useEffect(() => () => { tireMarks.dispose(); speedLines.dispose(); dust.dispose(); soilClods.dispose(); }, [tireMarks, speedLines, dust, soilClods]);
  const roughShake = useRef(0);
  const wasOnRoad = useRef<boolean | null>(null);
  const telemetryTime = useRef(0);
  const padRecoverHeld = useRef(false);
  const sun = useRef<THREE.DirectionalLight>(null!);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const sunOverviewPosition = useMemo(() => new THREE.Vector3(-52, 78, 62), []);
  const sunLocalPosition = useMemo(() => new THREE.Vector3(), []);
  const sunPlanarDirection = useMemo(() => new THREE.Vector3(), []);
  const fog = useMemo(() => new THREE.Fog(
    ART_DIRECTION.day.fogColor,
    ART_DIRECTION.atmosphere.overviewNear,
    ART_DIRECTION.atmosphere.overviewFar,
  ), []);

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.type = THREE.PCFShadowMap;
  }, [gl]);
  useEffect(() => {
    scene.fog = fog;
    sun.current.target = sunTarget;
    scene.add(sunTarget);
    return () => {
      if (scene.fog === fog) scene.fog = null;
      scene.remove(sunTarget);
    };
  }, [fog, scene, sunTarget]);
  // The car waits parked at the road edge (out of the traffic lanes); no drop-in launch.
  const parkCar = () => {
    props.car.current = { ...initialLoopCar(), x: scenicSpawnAngles[SPAWN_INDEX], z: props.started && props.tutorialDriving ? 0 : PARKING_OFFSET };
    smoothedElevation.current = null;
    poseInitialized.current = false;
    landingHeight.current = 0;
    landingVelocity.current = 0;
    landingCompression.current = 0;
    landingActive.current = false;
    landingReleased.current = true;
    wasOnRoad.current = null;
  };
  useEffect(parkCar, [props.resetKey, props.car]);
  useEffect(() => {
    // Leaving the drive: keep the car where it is and start the intro spin from the globe's current
    // angle, so the globe doesn't turn away to somewhere else before spinning.
    if (props.started && !wasStarted.current && props.tutorialDriving) {
      // Begin the steering lesson already aligned with the centre of the road.
      props.car.current.z = 0;
      props.car.current.heading = 0;
      props.car.current.steering = 0;
    }
    if (!props.started && wasStarted.current) {
      const euler = new THREE.Euler().setFromQuaternion(globeQuat, 'XYZ');
      rotation.current = euler.y;
      pitch.current = euler.x;
    }
    wasStarted.current = props.started;
  }, [props.started, props.tutorialDriving, props.car]);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.style.cursor = props.started ? 'default' : 'grab';
    const down = (event: PointerEvent) => {
      if (props.started || zoomProgress.current > 0.02 || event.button !== 0) return;
      dragging.current = true;
      panning.current = event.shiftKey;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const move = (event: PointerEvent) => {
      if (!dragging.current || props.started) return;
      const dx = event.clientX - lastPointer.current.x;
      const dy = event.clientY - lastPointer.current.y;
      if (panning.current) {
        introPan.current.x = THREE.MathUtils.clamp(introPan.current.x + dx * 0.035, -10, 10);
        introPan.current.y = THREE.MathUtils.clamp(introPan.current.y - dy * 0.035, -7, 7);
      } else {
        rotation.current += dx * 0.006;
      }
      lastPointer.current = { x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      panning.current = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = props.started ? 'default' : 'grab';
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    const wheel = (event: WheelEvent) => {
      if (props.started || Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      const target = event.deltaY < 0 ? 1 : 0;
      if (target === introZoomTarget.current) return;
      introZoomFrom.current = introZoom.current;
      introZoomTarget.current = target;
      introZoomClock.current = 0;
    };
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', wheel);
      canvas.style.cursor = '';
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [gl, props.started]);

  useFrame((_, delta) => {
    const realDt = Math.min(delta, 0.05);
    // Crash cut-in clock (real time) and its slow motion (the only thing that bends game time).
    crashRest.current = Math.max(0, crashRest.current - realDt);
    nearMissRest.current = Math.max(0, nearMissRest.current - realDt);
    crashStrength.current = THREE.MathUtils.damp(crashStrength.current, crashCool.current ? NEAR_MISS_CAM.strength : 1, 6, realDt);
    if (crashTime.current >= 0) {
      crashTime.current += realDt;
      if (crashTime.current > CRASH_CAM.duration) { crashTime.current = -1; crashRest.current = CRASH_CAM.rest; }
    }
    crashLevel.current = crashEnvelope(crashTime.current);
    // The drift cut-in's clock: a crash during it hands over to the crash (the drift one lets go at once).
    driftCutRest.current = Math.max(0, driftCutRest.current - realDt);
    if (driftCutTime.current >= 0) {
      if (crashTime.current >= 0) driftCutTime.current = Math.max(driftCutTime.current, DRIFT_CINE.hold);
      driftCutTime.current += realDt;
      if (driftCutTime.current > DRIFT_CINE.duration) { driftCutTime.current = -1; driftCutRest.current = DRIFT_CINE.rest; }
    }
    driftCutLevel.current = driftCutEnvelope(driftCutTime.current);
    cinematicState.driftCut = driftCutLevel.current;
    if (finaleTime.current >= 0) finaleTime.current += realDt;
    dangerLevel.current = THREE.MathUtils.damp(dangerLevel.current, props.danger && props.started && !props.paused ? 1 : 0, 3, realDt);
    dangerClock.current += realDt;
    const beat = (dangerClock.current % 0.9) / 0.9;
    const lub = Math.exp(-Math.pow((beat - 0.05) / 0.045, 2));
    const dub = 0.7 * Math.exp(-Math.pow((beat - 0.24) / 0.05, 2));
    cinematicState.danger = dangerLevel.current;
    cinematicState.pulse = Math.min(1, lub + dub) * dangerLevel.current;
    finaleLevel.current = finaleTime.current < 0 ? 0 : easeInOutCubic(Math.min(1, finaleTime.current / FINALE.rise));
    cinematicState.finale = finaleLevel.current;
    // No slow motion while boosting, even if a cut-in started just before: the boost never pauses.
    gameTime.scale = props.car.current.boosting > 0 ? 1 : Math.min(THREE.MathUtils.lerp(1, CRASH_CAM.slowScale, crashLevel.current), THREE.MathUtils.lerp(1, DRIFT_CINE.slowScale, driftCutLevel.current));
    // The finale slows time whatever else is going on (a boost included).
    if (finaleLevel.current > 0) gameTime.scale = Math.min(gameTime.scale, THREE.MathUtils.lerp(1, FINALE.slowScale, finaleLevel.current));
    cinematicState.crash = crashLevel.current;
    // Which look the cut-in has (red or cool) changes smoothly, never in one frame: in a long tussle the hits
    // alternate between head-on and side, and an instant switch made the red grade and the contrast blink.
    coolBlend.current = THREE.MathUtils.damp(coolBlend.current, crashCool.current ? 1 : 0, 6, realDt);
    cinematicState.cool = coolBlend.current * crashLevel.current;
    const dt = realDt * gameTime.scale;
    if (!readied.current) { readied.current = true; props.onReady(); }
    arrivalTime.current += dt;
    const settle = 1 - easeOutCubic(Math.min(arrivalTime.current / ARRIVAL.duration, 1));
    if (props.started) {
      introZoom.current = THREE.MathUtils.damp(introZoom.current, 0, 6, dt);
      introZoomTarget.current = 0;
      introZoomFrom.current = 0;
      introZoomClock.current = WHEEL_ZOOM.duration;
    } else {
      introZoomClock.current += dt;
      const zoomT = easeInOutCubic(Math.min(introZoomClock.current / WHEEL_ZOOM.duration, 1));
      introZoom.current = THREE.MathUtils.lerp(introZoomFrom.current, introZoomTarget.current, zoomT);
    }
    document.documentElement.style.setProperty('--intro-zoom', introZoom.current.toFixed(4));
    introZoomCta.current = THREE.MathUtils.damp(introZoomCta.current, introZoom.current, 7, dt);
    document.documentElement.style.setProperty('--intro-zoom-cta', introZoomCta.current.toFixed(4));
    const car = props.car.current;
    boostAtmosphere.current = THREE.MathUtils.damp(
      boostAtmosphere.current,
      props.started && !props.paused ? car.boosting : 0,
      car.boosting > 0 ? 3.2 : 2.4,
      realDt,
    );
    const sky = gl.domElement.parentElement;
    if (sky) {
      const boostStrength = boostAtmosphere.current;
      sky.style.setProperty('--boost-violet', PALETTE.boostViolet);
      sky.style.setProperty('--boost-pink', PALETTE.boostPink);
      sky.style.setProperty('--boost-violet-strength', `${(boostStrength * 29).toFixed(1)}%`);
      sky.style.setProperty('--boost-pink-strength', `${(boostStrength * 34).toFixed(1)}%`);
      sky.style.setProperty('--boost-light-x', `${(50 + Math.sin(arrivalTime.current * 0.8) * 17).toFixed(1)}%`);
    }
    const globeAlignmentError = globeQuat.angleTo(driveQuat);
    zoomProgress.current = THREE.MathUtils.damp(zoomProgress.current, props.started ? 1 : 0, props.started ? 1.45 : 1.2, dt);
    const cameraPhase = THREE.MathUtils.clamp((zoomProgress.current - 0.1) / 0.9, 0, 1);
    const zoom = cameraPhase * cameraPhase * cameraPhase * (cameraPhase * (cameraPhase * 6 - 15) + 10);
    landingCameraBlend.current = THREE.MathUtils.damp(
      landingCameraBlend.current,
      landingActive.current ? 1 : 0,
      landingActive.current ? 4.8 : 1.8,
      dt,
    );
    if (landingActive.current) {
      // Release only after the globe has faced the spawn and the camera has
      // nearly reached its close landing shot. This prevents a mid-orbit drop.
      if (!landingReleased.current && cameraPhase >= 0.82 && globeAlignmentError < 0.08) landingReleased.current = true;
      if (landingReleased.current) {
        landingVelocity.current -= 24 * dt;
        landingHeight.current += landingVelocity.current * dt;
        if (landingHeight.current <= 0) {
          const impactSpeed = Math.max(0, -landingVelocity.current);
          landingHeight.current = 0;
          if (impactSpeed > 1.35) {
            landingVelocity.current = impactSpeed * 0.34;
            landingCompression.current = Math.max(
              landingCompression.current,
              THREE.MathUtils.clamp(impactSpeed / 24, 0.12, 0.46),
            );
          } else {
            landingVelocity.current = 0;
            landingActive.current = false;
          }
        }
      }
    }
    landingCompression.current = THREE.MathUtils.damp(landingCompression.current, 0, 6.5, dt);
    scaleGroup.current.scale.setScalar(1);
    // The idle spin is for the start screen; the map holds still so the player can find their way.
    if (!props.started && !props.mapView && zoomProgress.current < 0.02 && !dragging.current) rotation.current += dt * 0.11;
    // After a drive the globe may be tilted; ease it back upright slowly in the intro.
    if (!props.started && !dragging.current) pitch.current = THREE.MathUtils.damp(pitch.current, 0, 0.6, dt);
    if (props.started) {
      pitch.current = THREE.MathUtils.damp(pitch.current, 0, 9, dt);
      introPan.current.x = THREE.MathUtils.damp(introPan.current.x, 0, 9, dt);
      introPan.current.y = THREE.MathUtils.damp(introPan.current.y, 0, 9, dt);
    }
    globeGroup.current.position.set(introPan.current.x, -GLOBE_RADIUS + introPan.current.y, 0);
    introEuler.set(pitch.current + settle * ARRIVAL.pitch + Math.sin(Math.PI * introZoom.current) * WHEEL_ZOOM.tilt, rotation.current + settle * ARRIVAL.yaw, 0, 'XYZ');
    introQuat.setFromEuler(introEuler);
    // Keys ramp toward full pedal; a gamepad is already analog. The larger input wins.
    const keys = props.controls.current;
    const ramp = (value: number, held: boolean, up: number, down: number) => (held ? Math.min(1, value + dt / up) : Math.max(0, value - dt / down));
    pedals.current.throttle = ramp(pedals.current.throttle, keys.forward, CAR_CONFIG.throttleRampUpTime, CAR_CONFIG.throttleRampDownTime);
    pedals.current.brake = ramp(pedals.current.brake, keys.back, CAR_CONFIG.brakeRampUpTime, CAR_CONFIG.brakeRampDownTime);
    const pad = readGamepad();
    // Gamepad Y: back to road (once per press).
    if (pad.recover && !padRecoverHeld.current && props.started && !props.paused) recoverToRoad(car);
    padRecoverHeld.current = pad.recover;
    let throttle = Math.max(pedals.current.throttle, pad.throttle);
    // Rails mode (touch screens): the car drives itself; the player only steers.
    // Rails mode: the car cruises on its own, but never flat out. A slow, uneven rhythm (a few overlapping waves)
    // keeps it between about 55% and 100% of top speed, easing off in the bends and as the wheel turns hard.
    if (DRIVE_MODE.rails && props.started && !props.finale) {
      cruiseClock.current += realDt;
      const t = cruiseClock.current;
      const waves = 0.8 + 0.14 * Math.sin(t * 0.11) + 0.08 * Math.sin(t * 0.29 + 1.3) + 0.04 * Math.sin(t * 0.63 + 0.4);
      const bend = 1 - 0.3 * Math.min(1, Math.abs(car.steering));
      cruise.current = THREE.MathUtils.damp(cruise.current, THREE.MathUtils.clamp(waves * bend, 0.55, 1), 1.5, realDt);
      throttle = Math.max(throttle, RAILS.autoThrottle * cruise.current);
    }
    if (keys.gentle) throttle = Math.min(throttle, CAR_CONFIG.gentleThrottleCap);
    const keySteer = Number(keys.left) - Number(keys.right);
    const driveControls = {
      ...keys,
      throttle,
      reverse: Math.max(pedals.current.brake, pad.brake),
      steer: [pad.steer, keySteer, keys.steer ?? 0].reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0),
    };
    const intro = !props.started && zoomProgress.current < 0.02;
    if ((props.started || intro) && !props.paused && !landingActive.current) stepLoopCar(car, driveControls, dt, true, !!props.tutorialDriving && props.started, !!props.boostEnabled);
    // Two cinematic beats share the slow-motion cut-in:
    // - the red one for a real smash: the cars come together fast (closing speed, so ramming an oncoming car
    //   counts far more than nudging one ahead, and a glancing scrape barely counts at all);
    // - the faded grey one for a near miss: flashing past a car at speed with only a hair between them.
    // Never under boost: then the car just bulldozes through without a pause. Every other hit gets the light
    // side beat. A cut-in always plays through and fades out cleanly, and the next one can only start after a
    // short rest (re-triggering during a tussle made the grade pulse on and off).
    const cutInFree = crashTime.current < 0 && crashRest.current <= 0;
    for (const hit of drainTrafficHits()) {
      if (driftRun.current.time > 0) driftRun.current.spoiled = true;
      const smash = !hit.boosted && hit.closing >= JUICE_CONFIG.crashCinematicClosing;
      let cinematic = false;
      if (smash) {
        cinematic = crashTime.current >= 0 || crashRest.current <= 0;
        if (crashTime.current < 0 && crashRest.current <= 0) {
          crashTime.current = 0;
          crashSide.current = hit.side;
          crashCool.current = false;
          coolBlend.current = 0;
          crashStrength.current = 1;
        } else if (crashTime.current >= 0) {
          // A smash during a near-miss cut-in (the car clipped the next one) turns it red, smoothly.
          crashCool.current = false;
        }
        trauma.current = Math.min(1, trauma.current + CRASH_CAM.shake);
        // The red slow motion keeps the short synthesised whoosh; the recorded one is for near misses only.
        playWhoosh();
        playThud(Math.max(1, Math.min(1.5, hit.closing / JUICE_CONFIG.crashCinematicClosing)));
      } else if (hit.boosted) {
        // A boost hit: no slow motion (the boost never pauses), so the punch is all in the hit itself — a hard
        // shake, a lens kick, a sharp tilt and a heavy boom.
        dutchVelocity.current += -hit.side * SIDE_HIT_CAMERA.dutchKick * BOOST_IMPACT.tilt;
        fovKick.current += BOOST_IMPACT.fov;
        trauma.current = Math.min(1, trauma.current + BOOST_IMPACT.shake);
        playImpact();
      } else {
        dutchVelocity.current += -hit.side * SIDE_HIT_CAMERA.dutchKick;
        lookSwing.current = hit.side * SIDE_HIT_CAMERA.swing;
        fovKick.current += SIDE_HIT_CAMERA.fovKick;
        trauma.current = Math.min(1, trauma.current + SIDE_HIT_CAMERA.shake);
        playThud(Math.max(0.35, Math.min(1, hit.speed / 12)));
      }
      props.onTrafficHit?.({ ...hit, cinematic });
    }
    for (const miss of drainNearMisses()) {
      if (driftRun.current.time > 0) driftRun.current.threaded++;
      if (cutInFree && crashTime.current < 0 && nearMissRest.current <= 0 && props.started) {
        crashTime.current = 0;
        crashSide.current = miss.side;
        crashCool.current = true;
        coolBlend.current = 1;
        crashStrength.current = NEAR_MISS_CAM.strength;
        nearMissRest.current = difficulty.nearMissRest;
        playSlowMoWhoosh();
        miss.cinematic = true;
      } else if (props.started) playSlowMoWhoosh(0.6);
      if (props.started) props.onNearMiss?.(miss);
    }

    const carFrame = loopFrame(car.x, car.z);
    const latitude = carFrame.latitude;
    const onRoad = distanceToRoadNetwork(latitude, car.x) < 0.7;
    if (wasOnRoad.current !== null && wasOnRoad.current !== onRoad && !landingActive.current) {
      landingCompression.current = Math.max(landingCompression.current, onRoad ? 0.11 : 0.2);
      if (props.started && Math.abs(car.speed) > 2) playThud(onRoad ? 0.5 : 1);
    }
    wasOnRoad.current = onRoad;
    const drifting = props.started && !props.paused && car.drift > 0 && Math.abs(car.speed) > DRIFT_SCORE.minSpeed;
    const run = driftRun.current;
    if (drifting) {
      run.time += dt; run.speed += Math.abs(car.speed) * dt; run.gap = 0;
      run.steer += Math.min(1, Math.abs(car.steering)) * dt;
      // Swinging firmly from one side to the other mid-slide is a switchback.
      if (Math.abs(car.steering) > 0.45) {
        const side = Math.sign(car.steering);
        if (run.side && side !== run.side) run.switches++;
        run.side = side;
      }
      if (!onRoad) run.offroad += dt;
    } else if (run.time > 0 && (run.gap += dt) > DRIFT_SCORE.grace) {
      if (!run.spoiled && run.time >= difficulty.driftMinTime && run.offroad < run.time * 0.3) props.onDrift?.({ time: run.time, speed: run.speed / run.time, angle: run.steer / run.time, clean: 1 - run.offroad / run.time, switches: run.switches, threaded: run.threaded });
      Object.assign(run, { time: 0, speed: 0, gap: 0, offroad: 0, spoiled: false, steer: 0, side: 0, switches: 0, threaded: 0 });
    }
    if (drifting && run.time > DRIFT_CINE.trigger && run.offroad < run.time * 0.7 && driftCutTime.current < 0 && driftCutRest.current <= 0
      && crashTime.current < 0 && car.boosting === 0) {
      driftCutTime.current = 0;
      driftOrbit.current = 0;
      playSlowMoWhoosh(0.7);
      props.onDriftCinematic?.();
    }
    const driftShown = drifting && run.time > DRIFT_SCORE.settle;
    driftHold.current = THREE.MathUtils.damp(driftHold.current, driftShown ? 1 : 0, driftShown ? DRIFT_CAM.attack : DRIFT_CAM.release, realDt);
    if (drifting) driftSide.current = THREE.MathUtils.damp(driftSide.current, Math.sign(car.steering), 4, realDt);
    const elevation = onRoad ? roadSurfaceElevation(latitude, car.x) : terrainElevation(latitude, car.x);
    const targetElevation = elevation + (onRoad ? 0.075 : 0.025);
    smoothedElevation.current = smoothedElevation.current === null
      ? targetElevation
      : THREE.MathUtils.damp(smoothedElevation.current, targetElevation, 8, dt);
    groundVehiclePosition.set(...spherePoint(latitude, car.x, smoothedElevation.current));
    vehicle.current.position.set(...spherePoint(latitude, car.x, smoothedElevation.current + landingHeight.current));
    vehicleUp.set(...terrainNormal(latitude, car.x));
    vehicleTangent.set(...carFrame.tangent);
    vehicleTangent.addScaledVector(vehicleUp, -vehicleTangent.dot(vehicleUp)).normalize();
    vehicleNorth.crossVectors(vehicleUp, vehicleTangent).normalize();
    vehicleTangent.multiplyScalar(Math.cos(car.heading)).addScaledVector(vehicleNorth, Math.sin(car.heading)).normalize();
    vehicleRight.crossVectors(vehicleTangent, vehicleUp);
    vehicleBack.copy(vehicleTangent).negate();
    vehicleBasis.makeBasis(vehicleRight, vehicleUp, vehicleBack);
    targetVehicleQuaternion.setFromRotationMatrix(vehicleBasis);
    if (!poseInitialized.current) {
      vehicle.current.quaternion.copy(targetVehicleQuaternion);
      poseInitialized.current = true;
    } else {
      vehicle.current.quaternion.slerp(targetVehicleQuaternion, 1 - Math.exp(-11 * dt));
    }

    // Globe orientation: in the intro it follows the idle spin/drag; while driving it turns so the car
    // sits on top of the planet facing away from the camera (the inverse of the car's local pose).
    // Slerping one quaternion takes the shortest turn, so the zoom-in is a straight dolly, not an orbit.
    driveQuat.copy(targetVehicleQuaternion).invert();
    if (!globeReady.current) { globeQuat.copy(introQuat); globeReady.current = true; }
    // On exit, keep the driving orientation until the camera has pulled back, then turn to the intro spin;
    // turning earlier swings the car (and the camera chasing it) around the planet.
    globeQuat.slerp(props.started ? driveQuat : introQuat, 1 - Math.exp(-(props.started ? 2.6 : 3) * dt));
    if (!props.started && globeQuat.angleTo(introQuat) < 0.002) globeQuat.copy(introQuat);
    globeGroup.current.quaternion.copy(globeQuat);

    vehiclePosition.copy(vehicle.current.position).sub(globeCenter).applyQuaternion(globeQuat).add(globeCenter);
    groundVehiclePosition.sub(globeCenter).applyQuaternion(globeQuat).add(globeCenter);
    vehicleTangent.applyQuaternion(globeQuat);
    surfaceUp.copy(vehicleUp).applyQuaternion(globeQuat);
    // Time of day: one slow clock (dayCycle.ts) that runs while driving. Every light, the fog and the exposure
    // follow its night blend, and the sun turns warm and low-feeling around sunset and sunrise.
    advanceCycle(realDt, props.started && !props.paused);
    nightBlend.current = nightAmount();
    const golden = twilight();
    const n = nightBlend.current;
    nightState.blend = n;
    const day = ART_DIRECTION.day, night = ART_DIRECTION.night;
    // Daytime values come from the Day look panel (dayLook); night keeps its own.
    daySunColour.copy(neutralSun).lerp(amberSun, dayLook.sunWarmth);
    dayFogColour.copy(lightColors.dayFog).lerp(hazeColour, dayLook.haze * 0.5);
    // Night values come from the Night tab of the same panel (nightLook).
    nightMoonColour.copy(neutralMoon).lerp(coolMoon, nightLook.moonCool);
    nightFogColour.copy(lightColors.nightFog).lerp(nightHazeColour, nightLook.haze * 0.5);
    ambientLight.current.intensity = THREE.MathUtils.lerp(day.ambientIntensity * dayLook.skyLight, night.ambientIntensity * nightLook.skyLight, n);
    ambientLight.current.color.lerpColors(lightColors.dayAmbient, lightColors.nightAmbient, n);
    hemisphereLight.current.intensity = THREE.MathUtils.lerp(ATMOSPHERE.light.hemisphereIntensity * dayLook.skyLight, night.hemisphereIntensity * nightLook.skyLight, n);
    hemisphereLight.current.color.lerpColors(lightColors.daySky, lightColors.nightSky, n);
    hemisphereLight.current.groundColor.lerpColors(lightColors.dayGround, lightColors.nightGround, n);
    sun.current.intensity = THREE.MathUtils.lerp(ATMOSPHERE.light.sunIntensity * dayLook.sunStrength, night.sunIntensity * nightLook.moonStrength, n);
    sun.current.color.lerpColors(daySunColour, nightMoonColour, n).lerp(sunsetLight, golden * 0.55);
    rimLight.current.intensity = THREE.MathUtils.lerp(ATMOSPHERE.light.rimIntensity, night.rimIntensity, n) + boostAtmosphere.current * 0.12;
    rimLight.current.color.lerpColors(lightColors.dayRim, lightColors.nightRim, n).lerp(lightColors.boostRim, boostAtmosphere.current * 0.32);
    bounceLight.current.intensity = THREE.MathUtils.lerp(0.24, 0.12, n);
    bounceLight.current.color.lerpColors(lightColors.dayBounce, lightColors.nightBounce, n);
    // The warm corner light (warmLight.ts): placed round the globe relative to the view, so it always comes from the
    // same corner of the screen, `front` of the way toward the camera. Its strength is the brightness at the nearest
    // point of the globe, whatever the distance; `reach` sets how far across the globe it fades out.
    cornerSide.setFromMatrixColumn(camera.matrixWorld, 0);
    cornerUp.setFromMatrixColumn(camera.matrixWorld, 1);
    const cornerAngle = THREE.MathUtils.degToRad(warmLight.angle);
    cornerDir.copy(cornerSide).multiplyScalar(Math.cos(cornerAngle)).addScaledVector(cornerUp, Math.sin(cornerAngle));
    cornerSide.copy(camera.position).sub(globeCenter).normalize();
    cornerDir.lerp(cornerSide, THREE.MathUtils.clamp(warmLight.front, -1, 1)).normalize();
    cornerLight.current.position.copy(globeCenter).addScaledVector(cornerDir, GLOBE_RADIUS * warmLight.distance);
    const cornerGap = GLOBE_RADIUS * (warmLight.distance - 1);
    cornerLight.current.distance = cornerGap + GLOBE_RADIUS * warmLight.reach;
    cornerLight.current.intensity = THREE.MathUtils.lerp(warmLight.strength, warmLight.nightStrength, n) * Math.max(1, cornerGap * cornerGap);
    cornerLight.current.color.set(warmLight.colour);
    // While driving, its colour wanders slowly round its neighbours on the colour wheel (two slow swings laid over each
    // other, so it never quite repeats), easing in with the zoom so the start screen keeps the picked colour.
    if (props.started && !props.paused) cornerClock.current += realDt;
    const wander = (2 * Math.PI * cornerClock.current) / Math.max(1, warmLight.driftPeriod);
    const hueShift = (Math.sin(wander) * 0.7 + Math.sin(wander * 0.43 + 1.3) * 0.3) * warmLight.hueDrift * zoomProgress.current;
    cornerLight.current.color.getHSL(cornerHsl);
    cornerLight.current.color.setHSL((cornerHsl.h + hueShift / 360 + 1) % 1, cornerHsl.s, cornerHsl.l);
    fog.color.lerpColors(dayFogColour, nightFogColour, n).lerp(sunsetFog, golden * 0.35);
    gl.toneMappingExposure = THREE.MathUtils.lerp(dayLook.exposure, nightLook.exposure, n);
    const cameraDistance = camera.position.distanceTo(globeCenter);
    const fogEase = 1 - Math.exp(-ATMOSPHERE.fog.damping * dt);
    fog.near = THREE.MathUtils.lerp(fog.near, cameraDistance - GLOBE_RADIUS * ATMOSPHERE.fog.nearFactor, fogEase);
    // Haze pulls the far edge of the fog in by day (up to about two thirds closer).
    const farFactor = ATMOSPHERE.fog.farFactor * THREE.MathUtils.lerp(1 - 0.65 * dayLook.haze, 1 - 0.65 * nightLook.haze, n);
    fog.far = THREE.MathUtils.lerp(fog.far, cameraDistance + GLOBE_RADIUS * farFactor, fogEase);
    glowAmount.current = 1 - zoomProgress.current * ATMOSPHERE.glow.drivingFade;
    // Follow the local tangent plane while driving so the sun keeps a gentle
    // three-quarter angle even when the car reaches another side of the globe.
    sunPlanarDirection.set(-0.72, 0.16, 0.68).projectOnPlane(surfaceUp).normalize();
    sunLocalPosition.copy(groundVehiclePosition)
      .addScaledVector(surfaceUp, 58)
      .addScaledVector(sunPlanarDirection, 40);
    sun.current.position.copy(sunOverviewPosition).lerp(sunLocalPosition, zoom);
    sunTarget.position.copy(globeCenter).lerp(groundVehiclePosition, zoom);
    sunTarget.updateMatrixWorld();
    // The camera reads a smoothed speed and acceleration: hard braking (or the acceleration flickering near a
    // stop) would otherwise move its targets in steps and make the pull-in look choppy.
    cameraSpeed.current = THREE.MathUtils.damp(cameraSpeed.current, Math.abs(car.speed), 3, dt);
    cameraAcceleration.current = THREE.MathUtils.damp(cameraAcceleration.current, car.acceleration, 5, dt);
    const drivingFov = updateCamera(
      gameCamera, gameLook, groundVehiclePosition, vehicleTangent, surfaceUp,
      props.cameraMode, cameraSpeed.current, landingCameraBlend.current, landingHeight.current, !!props.mobileCamera,
    );
    // Camera falls back on hard acceleration and catches up afterwards.
    cameraLag.current = THREE.MathUtils.damp(cameraLag.current, THREE.MathUtils.clamp(cameraAcceleration.current * JUICE_CONFIG.cameraLag, -2, 2), JUICE_CONFIG.cameraLagStiffness, dt);
    gameCamera.addScaledVector(vehicleTangent, -cameraLag.current);
    // The first steering lesson looks straight down from above the car; as the lesson ends, orbit smoothly back
    // to the normal chase view rather than replacing the camera in a single frame.
    const coachTarget = props.started && props.tutorialCamera ? 1 : 0;
    if (coachTarget) {
      coachCameraWasTarget.current = true;
      coachCameraBlend.current = THREE.MathUtils.damp(coachCameraBlend.current, 1, COACH_CAMERA.enter, realDt);
    } else {
      if (coachCameraWasTarget.current) {
        coachCameraWasTarget.current = false;
        coachCameraExitStart.current = coachCameraBlend.current;
        coachCameraExitElapsed.current = 0;
      }
      if (coachCameraExitElapsed.current < COACH_CAMERA.exitDuration && coachCameraExitStart.current > 0) {
        coachCameraExitElapsed.current = Math.min(COACH_CAMERA.exitDuration, coachCameraExitElapsed.current + realDt);
        const progress = coachCameraExitElapsed.current / COACH_CAMERA.exitDuration;
        coachCameraBlend.current = coachCameraExitStart.current * (1 - THREE.MathUtils.smoothstep(progress, 0, 1));
      }
    }
    const coachMix = THREE.MathUtils.smoothstep(coachCameraBlend.current, 0, 1);
    if (coachMix > 0.001) {
      coachCamera.copy(groundVehiclePosition)
        .addScaledVector(surfaceUp, COACH_CAMERA.height);
      coachLook.copy(groundVehiclePosition)
        .addScaledVector(surfaceUp, 0.15);
      gameCamera.lerp(coachCamera, coachMix).addScaledVector(surfaceUp, Math.sin(Math.PI * coachMix) * COACH_CAMERA.arcLift);
      gameLook.lerp(coachLook, coachMix);
    }
    cameraStartDirection.copy(introCamera).sub(globeCenter);
    cameraEndDirection.copy(gameCamera).sub(globeCenter);
    const startRadius = cameraStartDirection.length();
    const endRadius = cameraEndDirection.length();
    cameraStartDirection.normalize();
    cameraEndDirection.normalize();
    cameraArc.setFromUnitVectors(cameraStartDirection, cameraEndDirection);
    cameraArcStep.identity().slerp(cameraArc, zoom);
    const cinematicLift = Math.sin(Math.PI * zoom) * 4.5;
    desiredCamera.copy(cameraStartDirection)
      .applyQuaternion(cameraArcStep)
      .multiplyScalar((THREE.MathUtils.lerp(startRadius, endRadius, zoom) + cinematicLift) * (1 - settle * (1 - ARRIVAL.zoom)) * (1 - introZoom.current * WHEEL_ZOOM.closer))
      .add(globeCenter);
    desiredLook.copy(introLook).lerp(gameLook, zoom);
    boostCameraPulse.current = THREE.MathUtils.damp(boostCameraPulse.current, 0, JUICE_CONFIG.boostCameraPulseDecay, realDt);
    desiredCamera.addScaledVector(vehicleTangent, -boostCameraPulse.current * JUICE_CONFIG.boostCameraPullback * zoom);
    desiredLook.addScaledVector(vehicleTangent, boostCameraPulse.current * JUICE_CONFIG.boostCameraLookAhead * zoom);
    const boosting = props.started && !props.paused && car.boosting > 0;
    boostHold.current = THREE.MathUtils.damp(boostHold.current, boosting ? 1 : 0, boosting ? BOOST_FEEL.attack : BOOST_FEEL.release, realDt);
    const boostLift = easeInOutCubic(boostHold.current) * zoom;
    desiredCamera.addScaledVector(boostBack.copy(desiredCamera).sub(desiredLook).normalize(), boostLift * BOOST_FEEL.pullBack);
    desiredCamera.addScaledVector(surfaceUp, boostLift * BOOST_FEEL.rise);
    const driftLook = easeInOutCubic(driftHold.current) * zoom;
    cinematicState.drift = driftLook;
    desiredCamera.addScaledVector(vehicleRight, driftSide.current * driftLook * DRIFT_CAM.swing);
    desiredCamera.addScaledVector(surfaceUp, -driftLook * DRIFT_CAM.drop);
    const ease = 1 - Math.exp(-CAR_CONFIG.cameraSmoothing * dt);
    // The crash cut-in is laid on top of the smoothed camera each frame (taken off again before smoothing),
    // so its extreme ease-out reads crisply instead of being softened by the follow lag.
    camera.position.sub(crashApplied);
    camera.position.sub(driftApplied);
    camera.position.sub(finaleApplied);
    camera.position.lerp(desiredCamera, ease);
    // Never let the smoothed camera cut through the planet.
    cameraOffset.copy(camera.position).sub(globeCenter);
    const minimumRadius = GLOBE_RADIUS + 4;
    if (cameraOffset.length() < minimumRadius) camera.position.copy(globeCenter).addScaledVector(cameraOffset.normalize(), minimumRadius);
    const offRoadDriving = props.started && !props.paused && !onRoad && landInfluence(latitude, car.x) >= 0.5;
    roughShake.current = THREE.MathUtils.damp(
      roughShake.current,
      offRoadDriving ? (Math.abs(car.speed) / CAR_CONFIG.maxSpeed) * 0.085 : 0,
      8,
      dt,
    );
    const rumble = Math.sin(arrivalTime.current * 21) * 0.6 + Math.sin(arrivalTime.current * 33 + 1.7) * 0.4;
    camera.position.addScaledVector(surfaceUp, rumble * roughShake.current);
    // Trauma shake: kicks on boost start, hard braking and bumps, decaying quickly (strength = trauma^2).
    const driving = props.started && !props.paused;
    const boostStarted = driving && car.boosting > 0 && wasBoosting.current === 0;
    wasBoosting.current = car.boosting;
    trauma.current = Math.max(0, trauma.current - JUICE_CONFIG.shakeDecay * dt);
    if (boostStarted) {
      trauma.current = Math.min(1, trauma.current + JUICE_CONFIG.shakeBoost);
      fovKick.current += JUICE_CONFIG.boostFovKick;
      boostCameraPulse.current = 1;
      playBoost();
    }
    if (driving && cameraAcceleration.current < -JUICE_CONFIG.hardBrakeAccel && Math.abs(car.speed) > 8) trauma.current = Math.max(trauma.current, JUICE_CONFIG.shakeBrake);
    if (offRoadDriving) trauma.current = Math.max(trauma.current, JUICE_CONFIG.shakeBump * Math.min(Math.abs(car.speed) / CAR_CONFIG.maxSpeed, 1));
    fovKick.current = THREE.MathUtils.damp(fovKick.current, 0, JUICE_CONFIG.fovKickDecay, dt);
    const shake = trauma.current * trauma.current * JUICE_CONFIG.shakeMax * zoom;
    const t = arrivalTime.current;
    camera.position.addScaledVector(surfaceUp, Math.sin(t * 61) * shake);
    camera.position.addScaledVector(vehicleTangent, Math.sin(t * 47 + 1.3) * shake * 0.6);
    // Boost vibration: a fine, steady hum rather than a shake.
    const hum = boostHold.current * BOOST_FEEL.vibration * zoom;
    camera.position.addScaledVector(surfaceUp, (Math.sin(t * 71) * 0.6 + Math.sin(t * 113 + 0.7) * 0.4) * hum);
    camera.position.addScaledVector(vehicleRight, Math.sin(t * 89 + 2.1) * hum * 0.7);
    const crash = crashLevel.current;
    if (vehicle.current) vehicle.current.getWorldPosition(cinematicState.focus).addScaledVector(surfaceUp, 0.5);
    crashApplied.copy(cinematicState.focus).sub(camera.position).multiplyScalar(crash * crashStrength.current * CRASH_CAM.push * zoom);
    camera.position.add(crashApplied);
    // Drift cut-in: laid over the camera the same way, toward a spot straight above the car, circling slowly.
    const driftCut = driftCutLevel.current * zoom;
    // The turn round the car: done quickly on the way up, held at the top, then unwound on the slower way down.
    const cutTime = driftCutTime.current;
    if (cutTime >= 0) {
      driftOrbit.current = DRIFT_CINE.turn * (cutTime < DRIFT_CINE.rise ? 1 - Math.pow(1 - cutTime / DRIFT_CINE.rise, 3)
        : cutTime < DRIFT_CINE.hold ? 1 : 1 - easeInOutCubic(Math.min(1, (cutTime - DRIFT_CINE.hold) / (DRIFT_CINE.duration - DRIFT_CINE.hold))));
    }
    driftOffset.copy(vehicleTangent).negate().applyAxisAngle(surfaceUp, driftOrbit.current).multiplyScalar(DRIFT_CINE.back);
    driftTop.copy(groundVehiclePosition).addScaledVector(surfaceUp, DRIFT_CINE.height + DRIFT_CINE.pullOut * (BOOST_FEEL.pullBack + BOOST_FEEL.rise)).add(driftOffset);
    driftApplied.copy(driftTop).sub(camera.position).multiplyScalar(driftCut);
    camera.position.add(driftApplied);
    // The finale's orbit, laid over the camera the same way: lifted, at a distance, swinging slowly round the car.
    const finale = finaleLevel.current * zoom;
    const shotTime = Math.max(0, finaleTime.current);
    const spin = 1 - Math.exp(-shotTime / FINALE.spinEase), climb = 1 - Math.exp(-shotTime / FINALE.climbEase);
    // Straight above the car (a hair behind it, so "up" on screen stays defined), rising as the shot goes on.
    finaleOffset.copy(vehicleTangent).applyAxisAngle(surfaceUp, spin * FINALE.turn);
    finaleSpot.copy(groundVehiclePosition).addScaledVector(surfaceUp, THREE.MathUtils.lerp(FINALE.startHeight, FINALE.height, climb)).addScaledVector(finaleOffset, -0.05);
    finaleApplied.copy(finaleSpot).sub(camera.position).multiplyScalar(finale);
    camera.position.add(finaleApplied);
    // Side-hit glance toward the thrown car.
    lookSwing.current = THREE.MathUtils.damp(lookSwing.current, 0, SIDE_HIT_CAMERA.swingDecay, realDt);
    desiredLook.addScaledVector(vehicleRight, lookSwing.current * zoom);
    smoothedLook.lerp(desiredLook, ease);
    targetCameraUp.copy(localUp).lerp(surfaceUp, zoom).lerp(vehicleTangent, coachMix).normalize();
    smoothedUp.lerp(targetCameraUp, 1 - Math.exp(-6 * dt)).normalize();
    camera.up.copy(smoothedUp);
    // Looking straight down, "up" on screen is the way the car is heading (turning with the orbit).
    if (driftCut > 0) camera.up.lerp(driftOffset.normalize().negate(), driftCut).normalize();
    crashLook.copy(smoothedLook).lerp(cinematicState.focus, crash * crashStrength.current * CRASH_CAM.lookPull * zoom).lerp(groundVehiclePosition, Math.max(driftCut, finale));
    // Looking straight down, "up" on screen turns with the shot: the world swings round under the camera, slower and slower.
    if (finale > 0) camera.up.lerp(finaleOffset, finale).normalize();
    camera.lookAt(crashLook);
    camera.rotateZ(-bodyRoll.current * JUICE_CONFIG.cameraRollFactor * zoom);
    camera.rotateZ(driftSide.current * driftLook * DRIFT_CAM.roll);
    camera.rotateZ(-crashSide.current * crash * crashStrength.current * CRASH_CAM.dutch * zoom);
    // Boost tremor: a quick nodding tilt, layered with a finer, faster one.
    camera.rotateX((Math.sin(t * BOOST_FEEL.tiltRate) * BOOST_FEEL.tilt + Math.sin(t * BOOST_FEEL.tiltFineRate + 1.1) * BOOST_FEEL.tiltFine) * boostHold.current * zoom);
    dutchVelocity.current += (-dutch.current * SIDE_HIT_CAMERA.dutchStiffness - dutchVelocity.current * SIDE_HIT_CAMERA.dutchDamping) * realDt;
    dutch.current = THREE.MathUtils.clamp(dutch.current + dutchVelocity.current * realDt, -SIDE_HIT_CAMERA.maxDutch, SIDE_HIT_CAMERA.maxDutch);
    camera.rotateZ(dutch.current * zoom);
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = THREE.MathUtils.lerp(48, drivingFov + fovKick.current + driftLook * DRIFT_CAM.fov, zoom) - Math.sin(Math.PI * zoom) * 5;
      // The crash lens punch sits on top of the smoothed FOV, like the cut-in on the position.
      camera.fov = THREE.MathUtils.damp(camera.fov - crashFovApplied.current, targetFov, CAR_CONFIG.fovSmoothing, dt);
      crashFovApplied.current = -crashLevel.current * crashStrength.current * CRASH_CAM.fovPunch * zoom;
      camera.fov += crashFovApplied.current;
      const introScreenOffset = 0.43;
      const centeredFilmOffset = introScreenOffset
        * camera.getFilmWidth()
        * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
        * camera.aspect;
      camera.filmOffset = centeredFilmOffset * (1 - zoom) * (1 - settle);
      camera.updateProjectionMatrix();
    }

    rearAxle.halfTrack = wheelEffects.halfTrack;
    rearAxle.rearZ = wheelEffects.rearAxle;
    updateTireMarks(tireMarks, dt, vehicle.current, car, driving, rearAxle);
    updateDust(dust, dt, vehicle.current, car, throttle, driving, rearAxle);
    updateSoilClods(soilClods, dt, vehicle.current, car, offRoadDriving, rearAxle);
    // The red crash cut-in gets the strong focus lines; the near-miss one doesn't.
    updateSpeedLines(speedLines, dt, camera, car.speed, driving && zoom > 0.9, crashLevel.current * (1 - coolBlend.current), realDt);
    // How near the sea the car is: the share of water in rings around it (checked a few times a second). On the
    // globe screen the whole planet is in view, so the sea is faintly there.
    seaCheck.current -= realDt;
    if (seaCheck.current <= 0) {
      seaCheck.current = 0.25;
      let water = 0;
      for (const radius of SEA_RINGS) for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2;
        if (!isLandAt(latitude + Math.sin(angle) * radius / GLOBE_RADIUS, car.x + Math.cos(angle) * radius / (GLOBE_RADIUS * Math.max(0.2, Math.cos(latitude))))) water++;
      }
      seaNear.current = props.started ? Math.min(1, (water / (SEA_RINGS.length * 8)) * 1.6) : 0.3;
    }
    updateAudio({ speedRatio: Math.abs(car.speed) / CAR_CONFIG.maxSpeed, throttle, drift: car.drift, active: driving, timeScale: gameTime.scale, acceleration: car.acceleration, offroad: !onRoad, sea: seaNear.current,
      // The plane is heard by the camera: full within PLANE_HEARD.near, gone beyond PLANE_HEARD.far.
      plane: 1 - THREE.MathUtils.smoothstep(camera.position.distanceTo(airplaneState.position), PLANE_HEARD.near, PLANE_HEARD.far) });
    telemetryTime.current += dt;
    if (telemetryTime.current > 0.1) {
      props.onTelemetry({ ...car, speed: Math.abs(car.speed) * 3.6, offroad: props.started && !onRoad, throttle, boost: car.boost, boosting: car.boosting });
      telemetryTime.current = 0;
    }
  });

  return <>
    <IntroDepthOfField zoom={zoomProgress} globe={globeGroup} vehicle={vehicle} car={props.car} active={props.started && !props.paused} />
    <ambientLight ref={ambientLight} intensity={ART_DIRECTION.day.ambientIntensity} color={ART_DIRECTION.day.ambientColor} />
    <hemisphereLight ref={hemisphereLight} args={[PALETTE.lightDaySkyFill, PALETTE.land, ATMOSPHERE.light.hemisphereIntensity]} />
    <directionalLight
      ref={sun}
      position={sunOverviewPosition}
      intensity={ATMOSPHERE.light.sunIntensity}
      color={ATMOSPHERE.light.sunColor}
      castShadow
      shadow-mapSize={[ACTIVE_QUALITY.shadowMapSize, ACTIVE_QUALITY.shadowMapSize]}
      shadow-camera-near={ART_DIRECTION.shadows.near}
      shadow-camera-far={ART_DIRECTION.shadows.far}
      shadow-camera-left={-ART_DIRECTION.shadows.extent}
      shadow-camera-right={ART_DIRECTION.shadows.extent}
      shadow-camera-top={ART_DIRECTION.shadows.extent}
      shadow-camera-bottom={-ART_DIRECTION.shadows.extent}
      shadow-bias={ART_DIRECTION.shadows.bias}
      shadow-normalBias={ART_DIRECTION.shadows.normalBias}
      shadow-radius={ATMOSPHERE.light.shadowRadius}
    />
    <directionalLight ref={rimLight} position={[58, 18, -48]} target-position={[0, -GLOBE_RADIUS, 0]} intensity={ATMOSPHERE.light.rimIntensity} color={ART_DIRECTION.day.rimColor} />
    <pointLight ref={cornerLight} decay={2} />
    <directionalLight ref={bounceLight} position={[18, -38, -62]} target-position={[0, -GLOBE_RADIUS, 0]} intensity={0.24} color={ART_DIRECTION.day.bounceColor} />
    <primitive object={speedLines.group} />
    <Meteors />
    <group ref={globeGroup} position={[0, -GLOBE_RADIUS, 0]}>
      <AtmosphereGlow amount={glowAmount} night={nightBlend} />
      <group ref={scaleGroup} position={[0, GLOBE_RADIUS, 0]}>
        <MiniatureWorld zoom={zoomProgress} />
        <Suspense fallback={null}><Traffic paused={props.paused} enabled={props.trafficEnabled !== false} progresses={trafficProgresses} player={props.car} reactive={props.started} nightBlend={nightBlend} /></Suspense>
        <group ref={vehicle}><CarModel car={props.car} vehicleId={props.vehicleId} active={props.started && !props.paused} landingCompression={landingCompression} landingActive={landingActive} bodyRoll={bodyRoll} nightBlend={nightBlend} /><MapPin show={!!props.mapView} /></group>
        <primitive object={tireMarks.mesh} />
        <primitive object={dust.mesh} />
        <primitive object={soilClods.mesh} />
      </group>
    </group>
  </>;
}

// Map view: a gold pin bobbing above the car, so the player can find themselves on the globe. It grows in as
// the map opens and shrinks away on the way back to the road.
function MapPin({ show }: { show: boolean }) {
  const pin = useRef<THREE.Group>(null!);
  const size = useRef(0);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4b544', fog: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state, delta) => {
    size.current = THREE.MathUtils.damp(size.current, show ? 1 : 0, 5, Math.min(delta, 0.05));
    pin.current.visible = size.current > 0.01;
    pin.current.scale.setScalar(2.4 * size.current);
    pin.current.position.y = 2.6 + Math.sin(state.clock.elapsedTime * 3) * 0.35;
  });
  return <group ref={pin} visible={false}>
    <mesh material={material} position={[0, 0.55, 0]}><sphereGeometry args={[0.42, 12, 8]} /></mesh>
    <mesh material={material} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.3, 0.9, 10]} /></mesh>
  </group>;
}

// Frame pacing: frames are drawn on demand at most 60 times a second (30 while paused), so a 120 Hz screen
// doesn't make the GPU do twice the work for no visible gain.
function FrameLimiter({ fps }: { fps: number }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    let frame = 0, last = 0;
    const interval = 1000 / fps;
    const tick = (now: number) => {
      if (now - last >= interval - 2) { last = now; invalidate(); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fps, invalidate]);
  return null;
}

// Adaptive resolution: every couple of seconds of driving, if frames have been coming slowly the pixel density
// steps down (to the quality profile's floor), and after a good while of smooth frames it steps back up. The
// current value is kept outside React so a re-render of the canvas never resets it.
const deviceResolution = () => resolutionBounds(ACTIVE_QUALITY, typeof window === 'undefined' ? 1 : window.devicePixelRatio);
const resolution = { dpr: deviceResolution().initial };
function AdaptiveResolution({ active }: { active: boolean }) {
  const setDpr = useThree(state => state.setDpr);
  const stats = useRef(createResolutionState());
  const bounds = useRef(deviceResolution());
  useEffect(() => {
    const resize = () => {
      bounds.current = deviceResolution();
      resolution.dpr = THREE.MathUtils.clamp(resolution.dpr, bounds.current.min, bounds.current.max);
      setDpr(resolution.dpr);
      Object.assign(stats.current, createResolutionState());
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [setDpr]);
  useFrame((_, delta) => {
    const next = adaptResolution(stats.current, delta, active && !document.hidden, resolution.dpr, bounds.current);
    if (Math.abs(next - resolution.dpr) > 0.01) { resolution.dpr = next; setDpr(next); }
  });
  return null;
}

// `?stats` in the address: a small panel with frames per second, draw calls and triangles per frame (all
// passes: shadows, depth, colour), pixel density and quality tier. For measuring on real devices.
function RenderStats() {
  const gl = useThree(state => state.gl);
  const panel = useRef<HTMLDivElement | null>(null);
  const totals = useRef({ frames: 0, time: 0, calls: 0, triangles: 0 });
  useEffect(() => {
    gl.info.autoReset = false;
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;padding:6px 9px;border-radius:8px;background:#000c;color:#9f9;font:11px/1.4 ui-monospace,monospace;white-space:pre;pointer-events:none';
    document.body.appendChild(div);
    panel.current = div;
    return () => { div.remove(); gl.info.autoReset = true; };
  }, [gl]);
  useFrame(() => { gl.info.reset(); }, -1000);
  useFrame((_, delta) => {
    const t = totals.current;
    t.frames++; t.time += delta; t.calls += gl.info.render.calls; t.triangles += gl.info.render.triangles;
    if (t.time < 1 || !panel.current) return;
    panel.current.textContent = `${Math.round(t.frames / t.time)} fps · ${VISUAL_QUALITY} · dpr ${resolution.dpr.toFixed(2)}\n${gl.domElement.width} × ${gl.domElement.height} pixels\n${Math.round(t.calls / t.frames)} draw calls · ${Math.round(t.triangles / t.frames / 1000)}k triangles`;
    Object.assign(t, { frames: 0, time: 0, calls: 0, triangles: 0 });
  }, 1000);
  return null;
}
const SHOW_STATS = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stats');

// Memoised: the HUD re-renders often (speed, score), and none of that should reach the 3D scene.
export default memo(function Scene(props: SceneProps) {
  return <Canvas shadows frameloop="demand" dpr={resolution.dpr} camera={{ position: [0, 40, 94], fov: 48, near: 0.1, far: 400 }} gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => gl.setClearAlpha(0)}>
    <FrameLimiter fps={props.paused ? 30 : 60} />
    <AdaptiveResolution active={!props.paused} />
    {SHOW_STATS && <RenderStats />}
    <Suspense fallback={null}><DrivingScene {...props} /></Suspense>
  </Canvas>;
});
