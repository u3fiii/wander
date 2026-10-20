import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Weather as WeatherKind } from './themes';
import { VISUAL_QUALITY } from './artDirection';
import { themeSettings } from './themes';

// The theme's weather: petals, leaves or snow drifting down through a box of air in front of the camera, so it
// is always around the car wherever it drives. One instanced mesh (a single draw call); a flake that leaves the
// box comes back in on the other side, so the box never empties or clumps.
const WEATHER = {
  // Sparse and faint on purpose: a hint of the theme drifting by, never a curtain in front of the road.
  count: { high: 45, mobile: 24, low: 14 },
  opacity: 0.45,
  box: 26, ahead: 8,
  petals: { size: 0.11, fall: 0.6, sway: 0.5, spin: 1.6 },
  leaves: { size: 0.13, fall: 0.85, sway: 0.7, spin: 2 },
  snow: { size: 0.07, fall: 0.8, sway: 0.25, spin: 0.6 },
};

const forward = new THREE.Vector3(), centre = new THREE.Vector3(), down = new THREE.Vector3(), matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), scale = new THREE.Vector3(), place = new THREE.Vector3();

export default function Weather({ weather, globeCentre, intensity }: {
  weather: WeatherKind; globeCentre: React.RefObject<THREE.Vector3>; intensity: React.RefObject<number>;
}) {
  const count = WEATHER.count[VISUAL_QUALITY];
  const kind = weather.kind === 'none' ? null : WEATHER[weather.kind];
  const mesh = useRef<THREE.InstancedMesh>(null);
  const state = useMemo(() => {
    const random = Math.random;
    return {
      offsets: Float32Array.from({ length: count * 3 }, () => (random() - 0.5) * WEATHER.box),
      phases: Float32Array.from({ length: count }, () => random() * Math.PI * 2),
      sizes: Float32Array.from({ length: count }, () => 0.6 + random() * 0.8),
    };
  }, [count]);
  const geometry = useMemo(() => (weather.kind === 'snow' ? new THREE.CircleGeometry(1, 5) : new THREE.PlaneGeometry(1, 0.6)), [weather.kind]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, transparent: true, opacity: WEATHER.opacity, depthWrite: false }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useEffect(() => {
    if (!mesh.current || !weather.colours.length) return;
    const colour = new THREE.Color();
    for (let index = 0; index < count; index++) mesh.current.setColorAt(index, colour.set(weather.colours[index % weather.colours.length]));
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [weather, count]);

  useFrame(({ camera, clock }, delta) => {
    if (!mesh.current || !kind) return;
    const amount = intensity.current ?? 1;
    // Tunable density (Theme tab): the first share of the flakes fall.
    mesh.current.count = Math.min(count, Math.round(count * themeSettings.weather));
    mesh.current.visible = amount > 0.02 && mesh.current.count > 0;
    if (!mesh.current.visible) return;
    material.opacity = WEATHER.opacity * amount;
    const dt = Math.min(delta, 0.05), time = clock.elapsedTime, half = WEATHER.box / 2;
    camera.getWorldDirection(forward);
    centre.copy(camera.position).addScaledVector(forward, WEATHER.ahead);
    down.copy(globeCentre.current ?? place.set(0, -1e4, 0)).sub(centre).normalize();
    const { offsets, phases, sizes } = state;
    for (let index = 0; index < count; index++) {
      const k = index * 3, phase = phases[index];
      offsets[k] += (down.x * kind.fall + Math.sin(time * 0.9 + phase) * kind.sway) * dt;
      offsets[k + 1] += down.y * kind.fall * dt;
      offsets[k + 2] += (down.z * kind.fall + Math.cos(time * 0.7 + phase) * kind.sway) * dt;
      for (let axis = 0; axis < 3; axis++) {
        if (offsets[k + axis] < -half) offsets[k + axis] += WEATHER.box;
        else if (offsets[k + axis] > half) offsets[k + axis] -= WEATHER.box;
      }
      place.set(centre.x + offsets[k], centre.y + offsets[k + 1], centre.z + offsets[k + 2]);
      euler.set(time * kind.spin + phase, phase * 2 + time * kind.spin * 0.6, phase);
      quaternion.setFromEuler(euler);
      scale.setScalar(kind.size * sizes[index]);
      mesh.current.setMatrixAt(index, matrix.compose(place, quaternion, scale));
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  if (!kind) return null;
  // Always around the camera: never culled.
  return <instancedMesh key={`${weather.kind}-${count}`} ref={mesh} args={[geometry, material, count]} frustumCulled={false} renderOrder={3} />;
}
