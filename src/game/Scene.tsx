import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMERA, STOPS } from './config';
import { initialCar, isBlocked, stepCar } from './driving';
import type { CarState, Controls } from './driving';
import { boxes, trees, signs } from './world';
import type { Box, Sign } from './world';

export type Telemetry = { speed: number; distance: number; x: number; z: number; heading: number };
export type SceneProps = {
  started: boolean; paused: boolean; night: boolean; cameraMode: number; resetKey: number;
  controls: React.RefObject<Controls>; car: React.RefObject<CarState>; stop: number;
  onTelemetry: (data: Telemetry) => void; onStop: () => void; onReady: () => void;
};

function BoxBatch({ items, color }: { items: Box[]; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    items.forEach((item, i) => {
      dummy.position.set(...item.p); dummy.scale.set(...item.s); dummy.rotation.set(0, item.r ?? 0, 0);
      dummy.updateMatrix(); ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
    <boxGeometry /><meshStandardMaterial color={color} roughness={0.88} />
  </instancedMesh>;
}
function Trees() {
  const trunk = useRef<THREE.InstancedMesh>(null!);
  const leaves = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D(); const color = new THREE.Color();
    trees.forEach((t, i) => {
      dummy.position.set(t.x, 2.6 * t.scale, t.z); dummy.scale.set(0.4 * t.scale, 5.2 * t.scale, 0.4 * t.scale);
      dummy.updateMatrix(); trunk.current.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, 6.2 * t.scale, t.z); dummy.scale.set(2.65 * t.scale, 3.4 * t.scale, 2.65 * t.scale);
      dummy.rotation.y = i * 2.3; dummy.updateMatrix(); leaves.current.setMatrixAt(i, dummy.matrix);
      leaves.current.setColorAt(i, color.set(['#788749', '#8a9456', '#647c47', '#9c9b58'][i % 4]));
    });
    trunk.current.instanceMatrix.needsUpdate = true; leaves.current.instanceMatrix.needsUpdate = true;
    if (leaves.current.instanceColor) leaves.current.instanceColor.needsUpdate = true;
    trunk.current.computeBoundingSphere(); leaves.current.computeBoundingSphere();
  }, []);
  return <>
    <instancedMesh ref={trunk} args={[undefined, undefined, trees.length]} castShadow><cylinderGeometry args={[0.7, 1, 1, 6]} /><meshStandardMaterial color="#837259" /></instancedMesh>
    <instancedMesh ref={leaves} args={[undefined, undefined, trees.length]} castShadow receiveShadow><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial roughness={1} flatShading /></instancedMesh>
  </>;
}
function ShopSign({ sign }: { sign: Sign }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = sign.color; ctx.fillRect(0, 0, 768, 128);
    ctx.strokeStyle = '#d9c99f'; ctx.lineWidth = 3; ctx.strokeRect(9, 9, 750, 110);
    ctx.fillStyle = '#f7eed7'; ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 69px Vazirmatn, sans-serif'; ctx.fillText(sign.text, 384, 65);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; return map;
  }, [sign]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={[sign.x, sign.y, sign.z]} rotation={[0, sign.rotation ?? 0, 0]}><planeGeometry args={[sign.width, 1.65]} /><meshStandardMaterial map={texture} roughness={0.8} /></mesh>;
}
function Azadi() {
  const geometry = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-7, 0); s.lineTo(-4.7, 0); s.quadraticCurveTo(-3.1, 7.5, 0, 10.1);
    s.quadraticCurveTo(3.1, 7.5, 4.7, 0); s.lineTo(7, 0); s.lineTo(3.1, 16); s.lineTo(-3.1, 16); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false, curveSegments: 12 });
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <group position={[-27, 0.45, 27]}>
    <mesh position={[0, 0.2, 0]} receiveShadow><boxGeometry args={[20, 0.4, 17]} /><meshStandardMaterial color="#e1d6bd" /></mesh>
    <mesh geometry={geometry} position={[0, 0.4, -1.5]} castShadow receiveShadow><meshStandardMaterial color="#f4e5c5" roughness={0.8} /></mesh>
    <mesh geometry={geometry} position={[-1.5, 0.4, 0]} rotation={[0, Math.PI / 2, 0]} castShadow><meshStandardMaterial color="#e7d5b3" roughness={0.8} /></mesh>
    <mesh position={[0, 16.6, 0]}><boxGeometry args={[6.8, 0.5, 6.8]} /><meshStandardMaterial color="#e6d2ae" /></mesh>
    {[-2, -1, 0, 1, 2].map(x => <mesh key={x} position={[x, 14.4, 3.42]}><boxGeometry args={[0.22, 2.4, 0.06]} /><meshStandardMaterial color="#8d9d91" /></mesh>)}
  </group>;
}
function Mountains() {
  return <group>
    {Array.from({ length: 12 }, (_, i) => {
      const h = 36 + Math.sin(i * 2.1) * 16;
      return <group key={i} position={[(i - 5.5) * 39, 0, -225 - (i % 3) * 15]}>
        <mesh position={[0, h / 2 - 2, 0]} rotation={[0, i, 0]}><coneGeometry args={[49, h, 5]} /><meshStandardMaterial color={i % 2 ? '#a9a99a' : '#a0a89e'} flatShading /></mesh>
        {h > 42 && <mesh position={[0, h - 7, 0]} rotation={[0, i, 0]}><coneGeometry args={[10, 10, 5]} /><meshStandardMaterial color="#e2dfcf" flatShading /></mesh>}
      </group>;
    })}
    <group position={[110, 0, -170]}>
      <mesh position={[0, 24, 0]}><cylinderGeometry args={[0.8, 2, 48, 8]} /><meshStandardMaterial color="#adac96" /></mesh>
      <mesh position={[0, 48, 0]}><cylinderGeometry args={[3.5, 5.5, 8, 8]} /><meshStandardMaterial color="#909d95" /></mesh>
      <mesh position={[0, 57, 0]}><cylinderGeometry args={[0.12, 0.6, 14, 6]} /><meshStandardMaterial color="#a2a491" /></mesh>
    </group>
  </group>;
}
function World() {
  const batches = useMemo(() => {
    const groups: Record<string, Box[]> = {};
    boxes.forEach(box => (groups[box.c] ??= []).push(box)); return Object.entries(groups);
  }, []);
  return <group>
    <mesh position={[0, -0.2, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[1400, 1400]} /><meshStandardMaterial color="#b4b099" /></mesh>
    {batches.map(([color, items]) => <BoxBatch key={color} color={color} items={items} />)}
    <Trees /><Azadi /><Mountains />
    {signs.map((sign, i) => <ShopSign key={i} sign={sign} />)}
  </group>;
}

function Part({ position, size, color, rotation }: { position: [number, number, number]; size: [number, number, number]; color: string; rotation?: [number, number, number] }) {
  return <mesh position={position} rotation={rotation} castShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.48} metalness={0.12} /></mesh>;
}
function CarModel({ car, night }: { car: React.RefObject<CarState>; night: boolean }) {
  const wheels = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    wheels.current.children.forEach((wheel, i) => {
      if (i < 2) wheel.rotation.y = car.current.steering * 0.35;
      wheel.children[0].rotation.x -= car.current.speed * dt / 0.38;
    });
    body.current.rotation.z = THREE.MathUtils.damp(body.current.rotation.z, -car.current.steering * car.current.speed * 0.0017, 5, dt);
  });
  return <group>
    <group ref={body}>
      <Part position={[0, 0.69, 0]} size={[1.86, 0.53, 4.1]} color="#398e91" />
      <Part position={[0, 0.94, -1.42]} size={[1.85, 0.2, 1.15]} color="#54a3a1" />
      <Part position={[0, 0.95, 1.55]} size={[1.84, 0.18, 0.85]} color="#54a3a1" />
      <Part position={[0, 1.28, 0.1]} size={[1.62, 0.68, 1.95]} color="#293e3c" />
      <Part position={[0, 1.66, 0.17]} size={[1.68, 0.13, 1.83]} color="#e7dec5" />
      <Part position={[0, 1.24, -0.91]} size={[1.52, 0.66, 0.06]} color="#759d9b" rotation={[-0.22, 0, 0]} />
      <Part position={[0, 1.24, 1.08]} size={[1.51, 0.63, 0.06]} color="#6c9290" rotation={[0.25, 0, 0]} />
      {[-1, 1].map(side => <group key={side}>
        <Part position={[side * 0.82, 1.28, 0.16]} size={[0.05, 0.65, 0.1]} color="#e4dbc3" />
        <Part position={[side * 0.84, 1.28, -0.78]} size={[0.08, 0.65, 0.1]} color="#e4dbc3" />
        <Part position={[side * 0.84, 1.28, 1.03]} size={[0.08, 0.65, 0.1]} color="#e4dbc3" />
        <Part position={[side * 0.96, 0.74, 0]} size={[0.03, 0.05, 3.6]} color="#d4d7c8" />
        <Part position={[side * 1.04, 1.15, -0.68]} size={[0.26, 0.16, 0.24]} color="#d9dbc9" />
        <Part position={[side * 0.95, 0.96, 0.6]} size={[0.04, 0.05, 0.25]} color="#e5dcc1" />
        <mesh position={[side * 0.66, 0.82, -2.07]}><boxGeometry args={[0.46, 0.25, 0.05]} /><meshStandardMaterial color="#fff0b2" emissive="#ffce79" emissiveIntensity={night ? 3 : 0.4} /></mesh>
        <mesh position={[side * 0.68, 0.81, 2.07]}><boxGeometry args={[0.37, 0.2, 0.04]} /><meshStandardMaterial color="#c64e32" emissive="#ff351d" emissiveIntensity={night ? 1.7 : 0.2} /></mesh>
      </group>)}
      <Part position={[0, 0.55, -2.1]} size={[1.9, 0.16, 0.12]} color="#d2d6cb" />
      <Part position={[0, 0.55, 2.1]} size={[1.9, 0.16, 0.12]} color="#d2d6cb" />
      <Part position={[0, 0.82, -2.08]} size={[0.7, 0.22, 0.04]} color="#283f3d" />
      <Part position={[0, 0.74, 2.11]} size={[0.48, 0.14, 0.025]} color="#f3efdc" />
    </group>
    <group ref={wheels}>{[-1.28, 1.3].flatMap(z => [-1, 1].map(side => <group key={`${z}${side}`} position={[side * 0.91, 0.4, z]}>
      <group>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.39, 0.39, 0.27, 16]} /><meshStandardMaterial color="#29302e" roughness={0.96} /></mesh>
        <mesh position={[side * 0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.23, 0.23, 0.025, 12]} /><meshStandardMaterial color="#c7c9bc" metalness={0.6} roughness={0.3} /></mesh>
      </group>
    </group>))}</group>
    {night && <pointLight position={[0, 1.2, -3]} color="#ffdaa0" intensity={22} distance={19} />}
  </group>;
}
function Marker({ stop }: { stop: number }) {
  const group = useRef<THREE.Group>(null!);
  const point = STOPS[stop];
  useFrame(({ clock }) => { if (group.current) group.current.position.y = 2.6 + Math.sin(clock.elapsedTime * 2) * 0.25; });
  if (!point) return null;
  return <group position={[point.x, 0, point.z]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}><ringGeometry args={[2.5, 2.9, 48]} /><meshBasicMaterial color="#f4cb77" side={THREE.DoubleSide} /></mesh>
    <group ref={group}>
      <mesh rotation={[0, 0, Math.PI]}><coneGeometry args={[0.55, 0.9, 4]} /><meshStandardMaterial color="#f3c772" emissive="#dca751" emissiveIntensity={0.3} /></mesh>
    </group>
  </group>;
}
function DrivingScene(props: SceneProps) {
  const vehicle = useRef<THREE.Group>(null!);
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const smoothedLook = useMemo(() => new THREE.Vector3(0, 1, 15), []);
  const tick = useRef(0);
  const lastStop = useRef(-1);
  useEffect(() => { props.onReady(); }, [props.onReady]);
  useEffect(() => {
    props.car.current = initialCar(); lastStop.current = -1;
    camera.position.set(4.2, 11, 51); smoothedLook.set(4.5, 1, 27);
  }, [props.resetKey, camera, props.car, smoothedLook]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05); const car = props.car.current;
    if (props.started && !props.paused) stepCar(car, props.controls.current, dt);
    vehicle.current.position.set(car.x, 0.08, car.z); vehicle.current.rotation.y = car.heading;
    if (!props.started && props.cameraMode === 0) {
      target.set(car.x + 0.7, 11, car.z + 16); lookAt.set(car.x + 1, 1, car.z - 8);
    } else if (props.cameraMode === 1) {
      target.set(car.x + 12, 36, car.z + 21); lookAt.set(car.x, 0, car.z - 3);
    } else {
      let distance = CAMERA.followDistance + Math.abs(car.speed) * 0.12;
      // Shorten the boom at corners so the view does not enter a building.
      for (let d = 2; d <= distance; d += 0.5) {
        if (isBlocked(car.x + Math.sin(car.heading) * d, car.z + Math.cos(car.heading) * d)) { distance = Math.max(2, d - 1); break; }
      }
      target.set(car.x + Math.sin(car.heading) * distance, CAMERA.followHeight, car.z + Math.cos(car.heading) * distance);
      lookAt.set(car.x - Math.sin(car.heading) * 5, 1.1, car.z - Math.cos(car.heading) * 5);
    }
    const ease = 1 - Math.exp(-CAMERA.smoothing * dt);
    camera.position.lerp(target, ease); smoothedLook.lerp(lookAt, ease); camera.lookAt(smoothedLook);
    const stop = STOPS[props.stop];
    if (props.started && !props.paused && stop && lastStop.current !== props.stop && Math.hypot(car.x - stop.x, car.z - stop.z) < 4) {
      lastStop.current = props.stop; props.onStop();
    }
    tick.current += dt;
    if (tick.current > 0.1) { props.onTelemetry({ ...car, speed: Math.abs(car.speed) * 3.6 }); tick.current = 0; }
  });
  return <>
    <color attach="background" args={[props.night ? '#182c3c' : '#d9d8bd']} />
    <fog attach="fog" args={[props.night ? '#182c3c' : '#d9d8bd', props.night ? 85 : 130, props.night ? 270 : 470]} />
    <ambientLight intensity={props.night ? 0.65 : 1.15} color={props.night ? '#90b5dd' : '#ffefd4'} />
    <hemisphereLight args={[props.night ? '#a5bee4' : '#f8edcf', '#7a8875', props.night ? 0.65 : 1.4]} />
    <directionalLight position={[-55, 95, 45]} intensity={props.night ? 0.65 : 3.3} color={props.night ? '#b0c9ed' : '#ffe0a5'} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-140} shadow-camera-right={140} shadow-camera-top={140} shadow-camera-bottom={-140} shadow-camera-near={1} shadow-camera-far={340} shadow-bias={-0.0006} shadow-normalBias={0.09} />
    <World />
    <group ref={vehicle}><CarModel car={props.car} night={props.night} /></group>
    {props.started && <Marker stop={props.stop} />}
  </>;
}

export default function Scene(props: SceneProps) {
  return <Canvas shadows dpr={[1, 1.6]} camera={{ position: [19, 17, 55], fov: 48, near: 0.1, far: 600 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
    <Suspense fallback={null}><DrivingScene {...props} /></Suspense>
  </Canvas>;
}
