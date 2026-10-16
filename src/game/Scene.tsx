import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_CONFIG, LOOP_DRIVE } from './config';
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


export type Telemetry = { speed: number; distance: number; x: number; z: number; heading: number };
export type SceneProps = {
  started: boolean; paused: boolean; night: boolean; cameraMode: number; resetKey: number;
  controls: React.RefObject<Controls>; car: React.RefObject<CarState>;
  onTelemetry: (data: Telemetry) => void; onReady: () => void;
};

const localUp = new THREE.Vector3(0, 1, 0);
const localGlobeCenter = new THREE.Vector3(0, -GLOBE_RADIUS, 0);
const scenicSpawnAngles = [0.32, 0.78, 1.92, 2.55, 3.82, 4.46, 5.7] as const;
const TRAFFIC_LANE_OFFSET = 1.22;
const SPAWN_LANE_OFFSET = -TRAFFIC_LANE_OFFSET;
const LANDING_HEIGHT = 4.6;

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

function CarModel({ car, active, landingCompression, landingActive }: {
  car: React.RefObject<CarState>;
  active: boolean;
  landingCompression: React.RefObject<number>;
  landingActive: React.RefObject<boolean>;
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
    body.current.scale.y = 1 - landing.current * 0.34;
    body.current.position.y = spring.bounce - landing.current * 0.22;
  });
  return <group ref={body} name="carBody"><PlayerCar car={car} /></group>;
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
  stopDistance: 10, minGap: 3.5, laneHalfWidth: 2.4, braking: 3, followDistance: 9, followGap: 4.5,
  pushTransfer: 0.9, spinTransfer: 0.25, maxPush: 6, shoveForward: 0.7, hitCooldown: 0.4,
  laneReturn: 2.5, pushDamping: 3, spinStiffness: 12, spinDamping: 4,
};

function TrafficCar({ modelUrl, pathIndex, progress: startProgress, speed, scale, paused, progressIndex, progresses, obstacle, player, reactive }: typeof traffic[number] & {
  paused: boolean;
  progressIndex: number;
  progresses: React.RefObject<number[]>;
  obstacle: Obstacle;
  player: React.RefObject<CarState>;
  reactive: boolean;
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
  return <group ref={group}><KenneyCar modelUrl={modelUrl} scale={scale} color={TRAFFIC_COLORS[progressIndex]} jitter={TRAFFIC_JITTER[progressIndex]} /></group>;
}

function Traffic({ paused, progresses, player, reactive }: { paused: boolean; progresses: React.RefObject<number[]>; player: React.RefObject<CarState>; reactive: boolean }) {
  const obstacles = useMemo<Obstacle[]>(() => traffic.map(() => ({ latitude: 0, longitude: 0, radius: TRAFFIC_COLLISION_RADIUS, movable: true })), []);
  useEffect(() => {
    setObstacleGroup('traffic', obstacles);
    return () => clearObstacleGroup('traffic');
  }, [obstacles]);
  return <>{traffic.map((car, index) => <TrafficCar key={`${car.modelUrl}-${index}`} {...car} paused={paused} progressIndex={index} progresses={progresses} obstacle={obstacles[index]} player={player} reactive={reactive} />)}</>;
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
  const lastSpawnIndex = useRef(-1);
  const wasStarted = useRef(false);
  const landingHeight = useRef(0);
  const landingVelocity = useRef(0);
  const landingCompression = useRef(0);
  const landingActive = useRef(false);
  const landingReleased = useRef(false);
  const landingCameraBlend = useRef(0);
  const globeAligned = useRef(false);
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
    gl.toneMappingExposure = props.night ? ART_DIRECTION.night.exposure : ATMOSPHERE.post.exposure;
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
  useEffect(() => {
    const spawnIndex = SPAWN_INDEX;
    lastSpawnIndex.current = spawnIndex;
    props.car.current = { ...initialLoopCar(), x: scenicSpawnAngles[spawnIndex], z: SPAWN_LANE_OFFSET };
    smoothedElevation.current = null;
    poseInitialized.current = false;
    landingHeight.current = props.started ? LANDING_HEIGHT + (spawnIndex % 3) * 0.3 : 0;
    landingVelocity.current = 0;
    landingCompression.current = 0;
    landingActive.current = props.started;
    landingReleased.current = false;
    wasOnRoad.current = null;
  }, [props.resetKey, props.car]);
  useEffect(() => {
    if (props.started && !wasStarted.current) {
      const spawnIndex = SPAWN_INDEX;
      lastSpawnIndex.current = spawnIndex;
      props.car.current = { ...initialLoopCar(), x: scenicSpawnAngles[spawnIndex], z: SPAWN_LANE_OFFSET };
      smoothedElevation.current = null;
      landingHeight.current = LANDING_HEIGHT + (lastSpawnIndex.current % 3) * 0.3;
      landingVelocity.current = 0;
      landingCompression.current = 0;
      landingActive.current = true;
      landingReleased.current = false;
      poseInitialized.current = false;
      wasOnRoad.current = null;
    } else if (!props.started) {
      landingHeight.current = 0;
      landingVelocity.current = 0;
      landingCompression.current = 0;
      landingActive.current = false;
      landingReleased.current = false;
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
    let globeAlignmentError = 0;
    if (props.started) {
      const targetRotation = -car.x;
      const rotationError = Math.atan2(Math.sin(targetRotation - rotation.current), Math.cos(targetRotation - rotation.current));
      globeAlignmentError = Math.abs(rotationError);
      if (globeAlignmentError < 0.03) globeAligned.current = true;
      rotation.current += rotationError * (1 - Math.exp(-2 * dt));
    } else {
      globeAligned.current = false;
    }
    zoomProgress.current = THREE.MathUtils.damp(
      zoomProgress.current,
      props.started && globeAligned.current ? 1 : 0,
      props.started ? 1.45 : 1.2,
      dt,
    );
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
    if (props.started) {
      pitch.current = THREE.MathUtils.damp(pitch.current, 0, 9, dt);
      introPan.current.x = THREE.MathUtils.damp(introPan.current.x, 0, 9, dt);
      introPan.current.y = THREE.MathUtils.damp(introPan.current.y, 0, 9, dt);
    }
    globeGroup.current.position.set(introPan.current.x, -GLOBE_RADIUS + introPan.current.y, 0);
    globeGroup.current.rotation.y = rotation.current + settle * ARRIVAL.yaw;
    globeGroup.current.rotation.x = pitch.current + settle * ARRIVAL.pitch + Math.sin(Math.PI * introZoom.current) * WHEEL_ZOOM.tilt;
    if (props.started && !props.paused && !landingActive.current) stepLoopCar(car, props.controls.current, dt, true);

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

    vehiclePosition.copy(vehicle.current.position).applyAxisAngle(localUp, rotation.current);
    groundVehiclePosition.applyAxisAngle(localUp, rotation.current);
    vehicleTangent.applyAxisAngle(localUp, rotation.current);
    surfaceUp.copy(vehicleUp).applyAxisAngle(localUp, rotation.current);
    const lightStyle = props.night ? ART_DIRECTION.night : ART_DIRECTION.day;
    fog.color.set(props.night ? lightStyle.fogColor : PALETTE.haze);
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
    const offRoadDriving = props.started && !props.paused && !onRoad && landInfluence(latitude, car.x) >= 0.5;
    roughShake.current = THREE.MathUtils.damp(
      roughShake.current,
      offRoadDriving ? (Math.abs(car.speed) / CAR_CONFIG.maxSpeed) * 0.05 : 0,
      8,
      dt,
    );
    const rumble = Math.sin(arrivalTime.current * 21) * 0.6 + Math.sin(arrivalTime.current * 33 + 1.7) * 0.4;
    camera.position.addScaledVector(surfaceUp, rumble * roughShake.current);
    smoothedLook.lerp(desiredLook, ease);
    targetCameraUp.copy(localUp).lerp(surfaceUp, zoom).normalize();
    smoothedUp.lerp(targetCameraUp, 1 - Math.exp(-6 * dt)).normalize();
    camera.up.copy(smoothedUp);
    camera.lookAt(smoothedLook);
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = THREE.MathUtils.lerp(48, drivingFov, zoom) - Math.sin(Math.PI * zoom) * 5;
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, CAR_CONFIG.fovSmoothing, dt);
      const introScreenOffset = 0.43;
      const centeredFilmOffset = introScreenOffset
        * camera.getFilmWidth()
        * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
        * camera.aspect;
      camera.filmOffset = centeredFilmOffset * (1 - zoom) * (1 - settle);
      camera.updateProjectionMatrix();
    }

    telemetryTime.current += dt;
    if (telemetryTime.current > 0.1) {
      props.onTelemetry({ ...car, speed: Math.abs(car.speed) * 3.6 });
      telemetryTime.current = 0;
    }
  });

  return <>
    <ambientLight
      intensity={props.night ? ART_DIRECTION.night.ambientIntensity : ART_DIRECTION.day.ambientIntensity}
      color={props.night ? ART_DIRECTION.night.ambientColor : ART_DIRECTION.day.ambientColor}
    />
    <hemisphereLight args={[
      props.night ? ART_DIRECTION.night.skyFillColor : PALETTE.lightDaySkyFill,
      props.night ? ART_DIRECTION.night.groundFillColor : PALETTE.land,
      props.night ? ART_DIRECTION.night.hemisphereIntensity : ATMOSPHERE.light.hemisphereIntensity,
    ]} />
    <directionalLight
      ref={sun}
      position={sunOverviewPosition}
      intensity={props.night ? ART_DIRECTION.night.sunIntensity : ATMOSPHERE.light.sunIntensity}
      color={props.night ? ART_DIRECTION.night.sunColor : ATMOSPHERE.light.sunColor}
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
    <directionalLight
      position={[58, 18, -48]}
      target-position={[0, -GLOBE_RADIUS, 0]}
      intensity={props.night ? ART_DIRECTION.night.rimIntensity : ATMOSPHERE.light.rimIntensity}
      color={props.night ? ART_DIRECTION.night.rimColor : ART_DIRECTION.day.rimColor}
    />
    <directionalLight
      position={[18, -38, -62]}
      target-position={[0, -GLOBE_RADIUS, 0]}
      intensity={props.night ? 0.12 : 0.24}
      color={props.night ? ART_DIRECTION.night.bounceColor : ART_DIRECTION.day.bounceColor}
    />
    <group ref={globeGroup} position={[0, -GLOBE_RADIUS, 0]}>
      <AtmosphereGlow amount={glowAmount} />
      <group ref={scaleGroup} position={[0, GLOBE_RADIUS, 0]}>
        <MiniatureWorld zoom={zoomProgress} />
        <Traffic paused={props.paused} progresses={trafficProgresses} player={props.car} reactive={props.started} />
        <group ref={vehicle}><CarModel car={props.car} active={props.started && !props.paused} landingCompression={landingCompression} landingActive={landingActive} /></group>
      </group>
    </group>
  </>;
}

export default function Scene(props: SceneProps) {
  return <Canvas shadows dpr={[1, ACTIVE_QUALITY.maxDpr]} camera={{ position: [0, 40, 94], fov: 48, near: 0.1, far: 400 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => gl.setClearAlpha(0)}>
    <Suspense fallback={null}><DrivingScene {...props} /></Suspense>
  </Canvas>;
}
