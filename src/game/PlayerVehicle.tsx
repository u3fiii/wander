import { useEffect, useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_CONFIG } from './config';
import { buildCarRig, logModelNodes, updateWheels } from './carRig';
import { withDraco } from './gltf';
import { JITTER, PALETTE, seededRandom } from './palette';
import { bakeRoles, jitterAmount, playerCarRole, roleMaterials, textureSampler } from './recolor';
import { VEHICLES } from './vehicles';
import type { VehicleId } from './vehicles';
import type { CarState } from './driving';
import { styleCompact } from './compactStyle';
import { prepareVehicleModel } from './vehicleModel';

// `tint` paints the body another colour (party mode: one per player).
export default function PlayerVehicle({ vehicleId, car, onReady, tint }: {
  vehicleId: VehicleId; car?: React.RefObject<CarState>; onReady?: () => void; tint?: string;
}) {
  const definition = VEHICLES.find(vehicle => vehicle.id === vehicleId)!;
  const gltf = useLoader(GLTFLoader, definition.url, withDraco);
  const { rig, ownedMaterials, ownedGeometries, ownedTextures } = useMemo(() => {
    const { model, geometries: ownedGeometries } = prepareVehicleModel(gltf.scene, vehicleId);
    const ownedMaterials = new Set<THREE.Material>();
    const ownedTextures = new Set<THREE.Texture>();
    if (CAR_CONFIG.logModelNodes) logModelNodes(model);
    const jitter = jitterAmount(seededRandom(77), JITTER.cars);
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      if (vehicleId === 'classic' && material.map) {
        const baked = bakeRoles(child.geometry, textureSampler(material.map), playerCarRole);
        child.geometry = baked.geometry;
        ownedGeometries.add(baked.geometry);
        child.material = roleMaterials(baked.roles, role => ({ key: role === 'body' || role === 'light' ? 'carRed'
          : role === 'window' ? 'windows' : role === 'tire' ? 'tires' : role === 'lamp' ? 'carYellow'
          : role === 'accent' ? 'carCream' : 'roadShoulder', roughness: role === 'window' ? 0.5 : undefined }), jitter);
        if (tint) baked.roles.forEach((role, index) => { if (role === 'body') (child.material as THREE.MeshStandardMaterial[])[index].color.set(tint); });
      } else {
        child.material = Array.isArray(child.material) ? child.material.map(item => item.clone()) : material.clone();
        if (vehicleId === 'rover') {
          for (const item of Array.isArray(child.material) ? child.material : [child.material]) {
            if (item instanceof THREE.MeshStandardMaterial && item.name === 'Glass') {
              item.color.set(PALETTE.windows);
              item.roughness = 0.3;
              item.metalness = 0.12;
            }
          }
        }
      }
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(item => ownedMaterials.add(item));
      child.castShadow = true;
      child.receiveShadow = true;
    });
    if (vehicleId === 'compact') styleCompact(model, ownedMaterials, ownedGeometries, ownedTextures);
    const wheel = definition.wheelNodes ? model.getObjectByName(definition.wheelNodes.FL) : undefined;
    const radius = wheel ? new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3()).y * 0.5 * CAR_CONFIG.bodyScale : undefined;
    const rig = buildCarRig(model, definition.wheelNodes ? {
      wheelNodeNames: definition.wheelNodes, wheelRadius: radius,
    } : undefined);
    return { rig, ownedMaterials, ownedGeometries, ownedTextures };
  }, [gltf.scene, vehicleId, definition, tint]);
  // Each mounted model owns its travel origin, so switching cars never spins the wheels by the whole run distance.
  const travel = useMemo(() => ({ last: car?.current.wheelTravel ?? 0 }), [rig, car]);
  useFrame(() => {
    if (!car) return;
    const delta = car.current.wheelTravel - travel.last;
    travel.last = car.current.wheelTravel;
    updateWheels(rig, car.current.steering, Math.abs(delta) < 1 ? delta : 0);
  });
  useEffect(() => { onReady?.(); }, [rig, onReady]);
  useEffect(() => () => {
    rig.dispose();
    // Source geometry and textures stay in useLoader's cache for the garage and future car switches.
    ownedMaterials.forEach(material => material.dispose());
    ownedGeometries.forEach(geometry => geometry.dispose());
    ownedTextures.forEach(texture => texture.dispose());
  }, [rig, ownedMaterials, ownedGeometries, ownedTextures]);
  return <primitive object={rig.frame} dispose={null} />;
}
