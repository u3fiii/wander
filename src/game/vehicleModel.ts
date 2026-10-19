import * as THREE from 'three';
import type { VehicleId } from './vehicleHandling.ts';

export function prepareVehicleModel(source: THREE.Object3D, id: VehicleId) {
  const geometries = new Set<THREE.BufferGeometry>();
  let model = source.clone(true);
  if (id === 'rover') {
    // The Rover's wheels inherit rotated, nonuniform FBX scales. Bake each mesh into a common coordinate
    // system before pivoting it, otherwise steering/rolling would stretch the tyres or move them off the axles.
    model = new THREE.Group();
    source.updateMatrixWorld(true);
    source.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
      geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, child.material);
      mesh.name = child.name;
      model.add(mesh);
    });
  }
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(2.4 / Math.max(size.x, size.z));
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);
  model.updateMatrixWorld(true);
  return { model, geometries };
}
