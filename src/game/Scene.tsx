import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_CONFIG, JUICE_CONFIG, LOOP_DRIVE } from './config';
import { createDust, createSpeedLines, createTireMarks, updateDust, updateSpeedLines, updateTireMarks } from './juice';
import { playWhoosh, updateAudio } from './audio';
import { buildCarRig, createBodySpring, logModelNodes, updateBodySpring, updateCamera, updateWheels } from './carRig';
import { GLOBE_RADIUS, loopFrame, loopLatitude, spherePoint } from './globe';
import { ROAD_PATHS, distanceToRoadNetwork, landInfluence, roadPathFrame, roadPathMetric, roadSurfaceElevation, terrainElevation, terrainNormal } from './worldMap';
import { initialLoopCar, stepLoopCar } from './driving';
import { clearObstacleGroup, setObstacleGroup } from './obstacles';
import type { Obstacle } from './obstacles';
import type { CarState, Controls } from './driving';
import MiniatureWorld from './MiniatureWorld';
import { ACTIVE_QUALITY, ART_DIRECTION } from './artDirection';
import { CAR_COLORS, JITTER, PALETTE, seededRandom } from './palette';
import type { PaletteKey } from './palette';
import { bakeRoles, jitterAmount, kenneyCarKey, logMaterials, playerCarRole, resolveKenneyCar, roleMaterials, textureSampler } from './recolor';
import carTextureUrl from '../assets/kenny cars/Textures/colormap.png?url';
import playerModelUrl from '../assets/low_poly_car/low-poly-car.glb?url';
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
  glow: { radius: 1.06, intensity: 0.55, power: 2.2, drivingFade: 0.85 },
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
    return { throttle: shape(pad.buttons[7]?.value ?? 0), brake: shape(pad.buttons[6]?.value ?? 0), steer: -shape(pad.axes[0] ?? 0) };
  }
  return { throttle: 0, brake: 0, steer: 0 };
}
export type SceneProps = {
  started: boolean; paused: boolean; night: boolean; cameraMode: number; resetKey: number;
  controls: React.RefObject<Controls>; car: React.RefObject<CarState>;
  onTelemetry: (data: Telemetry) => void; onReady: () => void;
};

const localUp = new THREE.Vector3(0, 1, 0);
const localGlobeCenter = new THREE.Vector3(0, -GLOBE_RADIUS, 0);
const scenicSpawnAngles = [0.32, 0.78, 1.92, 2.55, 3.82, 4.46, 5.7] as const;
const TRAFFIC_LANE_OFFSET = 1.22;
// Just inside the road edge (half width 2.88): counts as on-road but clear of both traffic lanes.
const PARKING_OFFSET = -3.2;

const circularAngleDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Fixed start spot so the globe turn and camera move are the same every time.
const SPAWN_INDEX = 0;
const PLAYER_COLOR: PaletteKey = 'carRed';

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

const PLAYER_CAR_LENGTH = 2.4;

function surfaceAt(car: CarState) {
  const latitude = loopFrame(car.x, car.z).latitude;
  return { onRoad: distanceToRoadNetwork(latitude, car.x) < 0.7, onLand: landInfluence(latitude, car.x) >= 0.5 };
}

function PlayerCar({ car }: { car: React.RefObject<CarState> }) {
  const gltf = useLoader(GLTFLoader, playerModelUrl);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    if (CAR_CONFIG.logModelNodes) logModelNodes(clone);
    logMaterials('player car', clone);
    const jitter = jitterAmount(seededRandom(77), JITTER.cars);
    clone.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const map = (child.material as THREE.MeshStandardMaterial).map;
      if (map) {
        const baked = bakeRoles(child.geometry, textureSampler(map), playerCarRole);
        child.geometry = baked.geometry;
        child.material = roleMaterials(baked.roles, carRoleColor(PLAYER_COLOR), jitter);
      }
      child.castShadow = true;
      child.receiveShadow = true;
    });
    const rawSize = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
    clone.scale.setScalar(PLAYER_CAR_LENGTH / Math.max(rawSize.x, rawSize.z));
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    clone.position.set(-center.x, -bounds.min.y, -center.z);
    return clone;
  }, [gltf.scene]);
  const rig = useMemo(() => buildCarRig(model), [model]);
  const lastTravel = useRef<number | null>(null);
  useFrame(() => {
    const state = car.current;
    const travel = lastTravel.current === null ? 0 : state.wheelTravel - lastTravel.current;
    lastTravel.current = state.wheelTravel;
    updateWheels(rig, state.steering, Math.abs(travel) < 1 ? travel : 0);
  });
  useEffect(() => () => {
    rig.dispose();
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
      else child.material.dispose();
    });
  }, [model, rig]);
  return <primitive object={rig.frame} />;
}

// Boost flame: an additive cone out of the exhaust while boost fires, flickering in length.
function BoostFlame({ car }: { car: React.RefObject<CarState> }) {
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
  });
  return <mesh
    ref={flame}
    geometry={geometry}
    material={material}
    position={[0.22 * CAR_CONFIG.bodyScale, 0.42, -CAR_CONFIG.wheelRearZ * CAR_CONFIG.bodyScale + 0.2]}
    visible={false}
  />;
}

const NIGHT_FADE_RATE = 2.2;

// Head and tail lamps that glow at night (additive cores + soft halos), faded by the night blend.
function CarLamps({ blend, halfWidth, front, rear, height }: {
  blend: React.RefObject<number>; halfWidth: number; front: number; rear: number; height: number;
}) {
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  const materials = useMemo(() => {
    const glow = (hex: string) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    return { head: glow(PALETTE.roadMarking), headHalo: glow(PALETTE.roadMarking), tail: glow(PALETTE.carRed), tailHalo: glow(PALETTE.carRed) };
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
      <mesh geometry={geometry} material={materials.tail} position={[side * halfWidth, height, rear]} scale={0.07} />
      <mesh geometry={geometry} material={materials.tailHalo} position={[side * halfWidth, height, rear]} scale={0.18} />
    </group>)}
  </group>;
}

// The player's headlight beam: one spotlight (always present so the shader never recompiles), faded by night.
function HeadlightBeam({ blend }: { blend: React.RefObject<number> }) {
  const spot = useRef<THREE.SpotLight>(null!);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => { spot.current.target = target; }, [target]);
  useFrame(() => { spot.current.intensity = blend.current * 80; });
  return <>
    <spotLight ref={spot} color={PALETTE.roadMarking} position={[0, 0.7, -1.3]} angle={0.55} penumbra={0.6} distance={26} decay={1.5} intensity={0} />
    <primitive object={target} position={[0, 0, -10]} />
  </>;
}

function CarModel({ car, active, landingCompression, landingActive, bodyRoll, nightBlend }: {
  car: React.RefObject<CarState>;
  active: boolean;
  landingCompression: React.RefObject<number>;
  landingActive: React.RefObject<boolean>;
  bodyRoll: React.RefObject<number>;
  nightBlend: React.RefObject<number>;
}) {
  const body = useRef<THREE.Group>(null!);
  const spring = useMemo(createBodySpring, []);
  const landing = useRef(0);
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
    <PlayerCar car={car} />
    <BoostFlame car={car} />
    <CarLamps
      blend={nightBlend}
      halfWidth={0.36 * CAR_CONFIG.bodyScale}
      front={-(CAR_CONFIG.wheelFrontZ * CAR_CONFIG.bodyScale + 0.35)}
      rear={-CAR_CONFIG.wheelRearZ * CAR_CONFIG.bodyScale + 0.4}
      height={0.5}
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
];
const TRAFFIC_COLORS = trafficColors(traffic.length, traffic.map((_, index) => index).sort((a, b) => traffic[a].progress - traffic[b].progress));
const TRAFFIC_JITTER = (() => { const random = seededRandom(9002); return traffic.map(() => jitterAmount(random, JITTER.cars)); })();

const TRAFFIC_COLLISION_RADIUS = 1.1;
// Basic traffic reactions: stop for the player ahead in the lane, and take a push when hit.
const NPC = {
  stopDistance: 10, minGap: 3.5, laneHalfWidth: 1.6, braking: 3, followDistance: 9, followGap: 4.5,
  pushTransfer: 0.9, spinTransfer: 0.25, maxPush: 6, shoveForward: 0.7, hitCooldown: 0.4,
  laneReturn: 2.5, pushDamping: 3, spinStiffness: 12, spinDamping: 4,
};

function TrafficCar({ modelUrl, pathIndex, progress: startProgress, speed, scale, paused, progressIndex, progresses, obstacle, player, reactive, nightBlend }: typeof traffic[number] & {
  paused: boolean;
  progressIndex: number;
  progresses: React.RefObject<number[]>;
  obstacle: Obstacle;
  player: React.RefObject<CarState>;
  reactive: boolean;
  nightBlend: React.RefObject<number>;
}) {
  const motion = useRef({ speed: Math.abs(speed), push: 0, pushVelocity: 0, spin: 0, spinVelocity: 0, cooldown: 0 });
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
    const dt = Math.min(delta, 0.05);
    const m = motion.current;
    if (!paused) progress.current = (progress.current + Math.sign(speed) * m.speed * dt / roadPathMetric(path, progress.current) + 1) % 1;
    progresses.current[progressIndex] = progress.current;
    const frame = roadPathFrame(path, progress.current, 0.075);
    normal.set(...frame.normal);
    tangent.set(...frame.tangent).multiplyScalar(Math.sign(speed));
    right.crossVectors(tangent, normal).normalize();
    group.current.position.set(...frame.point).addScaledVector(right, TRAFFIC_LANE_OFFSET + m.push);
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
    const blocked = reactive && ahead > 1.5 && ahead < NPC.stopDistance && Math.abs(lateral) < NPC.laneHalfWidth;
    const cruise = Math.abs(speed);
    let followGap = Infinity;
    traffic.forEach((other, index) => {
      if (index === progressIndex || Math.sign(other.speed) !== Math.sign(speed)) return;
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
      const away = lateral > 0 ? -1 : 1;
      const sideways = Math.min(1, Math.abs(lateral) / NPC.laneHalfWidth);
      m.pushVelocity += away * obstacle.impact * NPC.pushTransfer * Math.max(sideways, 0.35);
      m.spinVelocity += away * obstacle.impact * NPC.spinTransfer;
      // A hit from behind shoves the car forward; a hit from the front stops it dead.
      m.speed = ahead < 0 ? m.speed + obstacle.impact * NPC.shoveForward * (1 - sideways) : m.speed * 0.3;
      m.cooldown = NPC.hitCooldown;
    }
    obstacle.impact = 0;
    m.pushVelocity += (-m.push * NPC.laneReturn - m.pushVelocity * NPC.pushDamping) * dt;
    m.push = THREE.MathUtils.clamp(m.push + m.pushVelocity * dt, -NPC.maxPush, NPC.maxPush);
    m.spinVelocity += (-m.spin * NPC.spinStiffness - m.spinVelocity * NPC.spinDamping) * dt;
    m.spin += m.spinVelocity * dt;
    group.current.rotateY(m.spin);
    // Keep this car's collision circle on its current position (planet centre is localGlobeCenter).
    const p = group.current.position;
    const r = Math.hypot(p.x - localGlobeCenter.x, p.y - localGlobeCenter.y, p.z - localGlobeCenter.z);
    obstacle.latitude = Math.asin(THREE.MathUtils.clamp((p.y - localGlobeCenter.y) / r, -1, 1));
    obstacle.longitude = Math.atan2(p.x - localGlobeCenter.x, p.z - localGlobeCenter.z);
  });
  return <group ref={group}><KenneyCar modelUrl={modelUrl} scale={scale} color={TRAFFIC_COLORS[progressIndex]} jitter={TRAFFIC_JITTER[progressIndex]} /><CarLamps blend={nightBlend} halfWidth={0.4} front={-1.15} rear={1.1} height={0.45} /></group>;
}

function Traffic({ paused, progresses, player, reactive, nightBlend }: { paused: boolean; progresses: React.RefObject<number[]>; player: React.RefObject<CarState>; reactive: boolean; nightBlend: React.RefObject<number> }) {
  const obstacles = useMemo<Obstacle[]>(() => traffic.map(() => ({ latitude: 0, longitude: 0, radius: TRAFFIC_COLLISION_RADIUS, movable: true })), []);
  useEffect(() => {
    setObstacleGroup('traffic', obstacles);
    return () => clearObstacleGroup('traffic');
  }, [obstacles]);
  return <>{traffic.map((car, index) => <TrafficCar key={`${car.modelUrl}-${index}`} {...car} paused={paused} progressIndex={index} progresses={progresses} obstacle={obstacles[index]} player={player} reactive={reactive} nightBlend={nightBlend} />)}</>;
}

const ARRIVAL = { duration: 2.6, yaw: -1.1, pitch: 0.5, zoom: 0.62 };
const WHEEL_ZOOM = { closer: 0.23, duration: 0.55, tilt: 0.12 };
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function AtmosphereGlow({ amount }: { amount: React.RefObject<number> }) {
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(PALETTE.atmosphere) },
    uIntensity: { value: ATMOSPHERE.glow.intensity },
    uPower: { value: ATMOSPHERE.glow.power },
    uFade: { value: 1 },
  }), []);
  useFrame(() => { uniforms.uFade.value = amount.current; });
  return <mesh>
    <sphereGeometry args={[GLOBE_RADIUS * ATMOSPHERE.glow.radius, 64, 48]} />
    <shaderMaterial
      uniforms={uniforms}
      transparent
      depthWrite={false}
      side={THREE.BackSide}
      blending={THREE.AdditiveBlending}
      vertexShader={`varying vec3 vNormal;
        void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
      fragmentShader={`uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uPower;
        uniform float uFade;
        varying vec3 vNormal;
        void main() {
          float rim = clamp(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
          gl_FragColor = vec4(uColor, pow(rim, uPower) * uIntensity * uFade);
        }`}
    />
  </mesh>;
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
  const rotation = useRef(Math.PI * 140 / 180);
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
  const nightBlend = useRef(props.night ? 1 : 0);
  const ambientLight = useRef<THREE.AmbientLight>(null!);
  const hemisphereLight = useRef<THREE.HemisphereLight>(null!);
  const rimLight = useRef<THREE.DirectionalLight>(null!);
  const bounceLight = useRef<THREE.DirectionalLight>(null!);
  const lightColors = useMemo(() => {
    const c = (hex: string) => new THREE.Color(hex);
    const day = ART_DIRECTION.day, night = ART_DIRECTION.night;
    return {
      dayAmbient: c(day.ambientColor), nightAmbient: c(night.ambientColor),
      daySky: c(PALETTE.lightDaySkyFill), nightSky: c(night.skyFillColor),
      dayGround: c(PALETTE.land), nightGround: c(night.groundFillColor),
      daySun: c(ATMOSPHERE.light.sunColor), nightSun: c(night.sunColor),
      dayRim: c(day.rimColor), nightRim: c(night.rimColor),
      dayBounce: c(day.bounceColor), nightBounce: c(night.bounceColor),
      dayFog: c(PALETTE.haze), nightFog: c(night.fogColor),
    };
  }, []);
  const pedals = useRef({ throttle: 0, brake: 0 });
  const bodyRoll = useRef(0);
  const fovKick = useRef(0);
  const trauma = useRef(0);
  const cameraLag = useRef(0);
  const wasBoosting = useRef(0);
  const tireMarks = useMemo(createTireMarks, []);
  const speedLines = useMemo(createSpeedLines, []);
  const dust = useMemo(createDust, []);
  useEffect(() => () => { tireMarks.dispose(); speedLines.dispose(); dust.dispose(); }, [tireMarks, speedLines, dust]);
  const roughShake = useRef(0);
  const wasOnRoad = useRef<boolean | null>(null);
  const telemetryTime = useRef(0);
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
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
  }, [gl, props.night]);
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
    props.car.current = { ...initialLoopCar(), x: scenicSpawnAngles[SPAWN_INDEX], z: PARKING_OFFSET };
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
    if (!props.started && wasStarted.current) {
      const euler = new THREE.Euler().setFromQuaternion(globeQuat, 'XYZ');
      rotation.current = euler.y;
      pitch.current = euler.x;
    }
    wasStarted.current = props.started;
  }, [props.started]);
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
    const dt = Math.min(delta, 0.05);
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
    if (!props.started && zoomProgress.current < 0.02 && !dragging.current) rotation.current += dt * 0.11;
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
    let throttle = Math.max(pedals.current.throttle, pad.throttle);
    if (keys.gentle) throttle = Math.min(throttle, CAR_CONFIG.gentleThrottleCap);
    const keySteer = Number(keys.left) - Number(keys.right);
    const driveControls = {
      ...keys,
      throttle,
      reverse: Math.max(pedals.current.brake, pad.brake),
      steer: Math.abs(pad.steer) > Math.abs(keySteer) ? pad.steer : keySteer,
    };
    const intro = !props.started && zoomProgress.current < 0.02;
    if ((props.started || intro) && !props.paused && !landingActive.current) stepLoopCar(car, driveControls, dt, true);

    const carFrame = loopFrame(car.x, car.z);
    const latitude = carFrame.latitude;
    const onRoad = distanceToRoadNetwork(latitude, car.x) < 0.7;
    if (wasOnRoad.current !== null && wasOnRoad.current !== onRoad && !landingActive.current) {
      landingCompression.current = Math.max(landingCompression.current, onRoad ? 0.11 : 0.2);
    }
    wasOnRoad.current = onRoad;
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
    // Day/night cross-fade: every light, the fog and exposure blend over ~1.5s instead of switching.
    nightBlend.current = THREE.MathUtils.damp(nightBlend.current, props.night ? 1 : 0, NIGHT_FADE_RATE, dt);
    const n = nightBlend.current;
    const day = ART_DIRECTION.day, night = ART_DIRECTION.night;
    ambientLight.current.intensity = THREE.MathUtils.lerp(day.ambientIntensity, night.ambientIntensity, n);
    ambientLight.current.color.lerpColors(lightColors.dayAmbient, lightColors.nightAmbient, n);
    hemisphereLight.current.intensity = THREE.MathUtils.lerp(ATMOSPHERE.light.hemisphereIntensity, night.hemisphereIntensity, n);
    hemisphereLight.current.color.lerpColors(lightColors.daySky, lightColors.nightSky, n);
    hemisphereLight.current.groundColor.lerpColors(lightColors.dayGround, lightColors.nightGround, n);
    sun.current.intensity = THREE.MathUtils.lerp(ATMOSPHERE.light.sunIntensity, night.sunIntensity, n);
    sun.current.color.lerpColors(lightColors.daySun, lightColors.nightSun, n);
    rimLight.current.intensity = THREE.MathUtils.lerp(ATMOSPHERE.light.rimIntensity, night.rimIntensity, n);
    rimLight.current.color.lerpColors(lightColors.dayRim, lightColors.nightRim, n);
    bounceLight.current.intensity = THREE.MathUtils.lerp(0.24, 0.12, n);
    bounceLight.current.color.lerpColors(lightColors.dayBounce, lightColors.nightBounce, n);
    fog.color.lerpColors(lightColors.dayFog, lightColors.nightFog, n);
    gl.toneMappingExposure = THREE.MathUtils.lerp(ATMOSPHERE.post.exposure, night.exposure, n);
    const cameraDistance = camera.position.distanceTo(globeCenter);
    const fogEase = 1 - Math.exp(-ATMOSPHERE.fog.damping * dt);
    fog.near = THREE.MathUtils.lerp(fog.near, cameraDistance - GLOBE_RADIUS * ATMOSPHERE.fog.nearFactor, fogEase);
    fog.far = THREE.MathUtils.lerp(fog.far, cameraDistance + GLOBE_RADIUS * ATMOSPHERE.fog.farFactor, fogEase);
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
    const drivingFov = updateCamera(
      gameCamera, gameLook, groundVehiclePosition, vehicleTangent, surfaceUp,
      props.cameraMode, car.speed, landingCameraBlend.current, landingHeight.current,
    );
    // Camera falls back on hard acceleration and catches up afterwards.
    cameraLag.current = THREE.MathUtils.damp(cameraLag.current, THREE.MathUtils.clamp(car.acceleration * JUICE_CONFIG.cameraLag, -2, 2), JUICE_CONFIG.cameraLagStiffness, dt);
    gameCamera.addScaledVector(vehicleTangent, -cameraLag.current);
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
    const ease = 1 - Math.exp(-CAR_CONFIG.cameraSmoothing * dt);
    camera.position.lerp(desiredCamera, ease);
    // Never let the smoothed camera cut through the planet.
    cameraOffset.copy(camera.position).sub(globeCenter);
    const minimumRadius = GLOBE_RADIUS + 4;
    if (cameraOffset.length() < minimumRadius) camera.position.copy(globeCenter).addScaledVector(cameraOffset.normalize(), minimumRadius);
    const offRoadDriving = props.started && !props.paused && !onRoad && landInfluence(latitude, car.x) >= 0.5;
    roughShake.current = THREE.MathUtils.damp(
      roughShake.current,
      offRoadDriving ? (Math.abs(car.speed) / CAR_CONFIG.maxSpeed) * 0.05 : 0,
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
      playWhoosh();
    }
    if (driving && car.acceleration < -JUICE_CONFIG.hardBrakeAccel) trauma.current = Math.max(trauma.current, JUICE_CONFIG.shakeBrake);
    if (offRoadDriving) trauma.current = Math.max(trauma.current, JUICE_CONFIG.shakeBump * Math.min(Math.abs(car.speed) / CAR_CONFIG.maxSpeed, 1));
    fovKick.current = THREE.MathUtils.damp(fovKick.current, 0, JUICE_CONFIG.fovKickDecay, dt);
    const shake = trauma.current * trauma.current * JUICE_CONFIG.shakeMax * zoom;
    const t = arrivalTime.current;
    camera.position.addScaledVector(surfaceUp, Math.sin(t * 61) * shake);
    camera.position.addScaledVector(vehicleTangent, Math.sin(t * 47 + 1.3) * shake * 0.6);
    smoothedLook.lerp(desiredLook, ease);
    targetCameraUp.copy(localUp).lerp(surfaceUp, zoom).normalize();
    smoothedUp.lerp(targetCameraUp, 1 - Math.exp(-6 * dt)).normalize();
    camera.up.copy(smoothedUp);
    camera.lookAt(smoothedLook);
    camera.rotateZ(-bodyRoll.current * JUICE_CONFIG.cameraRollFactor * zoom);
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = THREE.MathUtils.lerp(48, drivingFov + fovKick.current, zoom) - Math.sin(Math.PI * zoom) * 5;
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, CAR_CONFIG.fovSmoothing, dt);
      const introScreenOffset = 0.43;
      const centeredFilmOffset = introScreenOffset
        * camera.getFilmWidth()
        * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
        * camera.aspect;
      camera.filmOffset = centeredFilmOffset * (1 - zoom) * (1 - settle);
      camera.updateProjectionMatrix();
    }

    updateTireMarks(tireMarks, dt, vehicle.current, car, driving);
    updateDust(dust, dt, vehicle.current, car, throttle, driving);
    updateSpeedLines(speedLines, dt, camera, car.speed, driving && zoom > 0.9);
    updateAudio(Math.abs(car.speed) / CAR_CONFIG.maxSpeed, throttle, car.drift, driving);
    telemetryTime.current += dt;
    if (telemetryTime.current > 0.1) {
      props.onTelemetry({ ...car, speed: Math.abs(car.speed) * 3.6, offroad: props.started && !onRoad, throttle, boost: car.boost, boosting: car.boosting });
      telemetryTime.current = 0;
    }
  });

  return <>
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
    <directionalLight ref={bounceLight} position={[18, -38, -62]} target-position={[0, -GLOBE_RADIUS, 0]} intensity={0.24} color={ART_DIRECTION.day.bounceColor} />
    <primitive object={speedLines.group} />
    <group ref={globeGroup} position={[0, -GLOBE_RADIUS, 0]}>
      <AtmosphereGlow amount={glowAmount} />
      <group ref={scaleGroup} position={[0, GLOBE_RADIUS, 0]}>
        <MiniatureWorld zoom={zoomProgress} />
        <Traffic paused={props.paused} progresses={trafficProgresses} player={props.car} reactive={props.started} nightBlend={nightBlend} />
        <group ref={vehicle}><CarModel car={props.car} active={props.started && !props.paused} landingCompression={landingCompression} landingActive={landingActive} bodyRoll={bodyRoll} nightBlend={nightBlend} /></group>
        <primitive object={tireMarks.mesh} />
        <primitive object={dust.mesh} />
      </group>
    </group>
  </>;
}

export default function Scene(props: SceneProps) {
  return <Canvas shadows dpr={[1, ACTIVE_QUALITY.maxDpr]} camera={{ position: [0, 40, 94], fov: 48, near: 0.1, far: 400 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => gl.setClearAlpha(0)}>
    <Suspense fallback={null}><DrivingScene {...props} /></Suspense>
  </Canvas>;
}
