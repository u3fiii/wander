import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareVehicleModel } from './vehicleModel.ts';
import { buildCarRig, updateWheels } from './carRig.ts';

test('Rover real wheels keep their shape and axle positions after FBX normalization and steering', async () => {
  const bytes = readFileSync(new URL('../assets/Range Rover by IvOfficial - 8zk4o6nALW.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const data = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  // This test checks transforms, not browser image decoding. Retain all source geometry/transforms.
  delete data.images; delete data.textures;
  data.materials.forEach((material: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }) => {
    if (material.pbrMetallicRoughness) delete material.pbrMetallicRoughness.baseColorTexture;
  });
  data.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength).toString('base64')}`;
  const previous = globalThis.ProgressEvent;
  globalThis.ProgressEvent = class extends Event {
    constructor(type: string, init: ProgressEventInit) { super(type); Object.assign(this, init); }
  } as typeof ProgressEvent;
  try {
    const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
    const { model, geometries } = prepareVehicleModel(scene, 'rover');
    const names = { FL: 'Tire1', FR: 'Tire3', RL: 'Tire2', RR: 'Tire4' };
    for (const name of Object.values(names)) assert.ok(model.getObjectByName(name), name);
    const rig = buildCarRig(model, { wheelNodeNames: names, wheelRadius: 0.23 });
    rig.frame.updateMatrixWorld(true);
    const wheelCount = Object.values(rig.spin).reduce((count, pivot) => count + pivot.children.length, 0);
    assert.equal(wheelCount, 4, 'must use four real wheels, no placeholders');
    const centers = Object.values(rig.spin).map(pivot => pivot.getWorldPosition(new THREE.Vector3()));
    const spare = model.getObjectByName('Spare_Tire')!;
    assert.ok(spare, 'spare tyre stays attached to the chassis');
    const sparePosition = spare.getWorldPosition(new THREE.Vector3());
    updateWheels(rig, 0.7, 0.3);
    rig.frame.updateMatrixWorld(true);
    Object.values(rig.spin).forEach((pivot, index) => {
      assert.ok(pivot.getWorldPosition(new THREE.Vector3()).distanceTo(centers[index]) < 1e-7);
      const scale = pivot.children[0].getWorldScale(new THREE.Vector3());
      assert.ok(Math.abs(scale.x - scale.y) < 1e-7 && Math.abs(scale.y - scale.z) < 1e-7, 'wheel transform must be uniform');
    });
    assert.ok(spare.getWorldPosition(new THREE.Vector3()).distanceTo(sparePosition) < 1e-7);
    rig.dispose(); geometries.forEach(geometry => geometry.dispose());
  } finally { globalThis.ProgressEvent = previous; }
});
