import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from './palette';

const WARM_LIGHT = { headlamp: '#ffa888', headlampHalo: '#ff7a5a', beam: '#ff9a78' };

export function CarLamps({ blend, halfWidth, front, rear, height, rearHeight = height }: {
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
export function HeadlightBeam({ blend }: { blend: React.RefObject<number> }) {
  const spot = useRef<THREE.SpotLight>(null!);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => { spot.current.target = target; }, [target]);
  useFrame(() => { spot.current.intensity = blend.current * 110; });
  return <>
    <spotLight ref={spot} color={WARM_LIGHT.beam} position={[0, 0.7, -1.3]} angle={0.7} penumbra={1} distance={34} decay={1.6} intensity={0} />
    <primitive object={target} position={[0, 0, -10]} />
  </>;
}

