import * as THREE from 'three';

// Horizon culling: the camera only ever sees one side of the planet, but the far side still lies inside the view
// frustum (the frustum runs on through the globe), so three.js draws it, shadows and all. Each frame every mesh
// on the planet whose bounding sphere is wholly hidden behind the globe is taken off the render layer (layers, not
// `visible`, so it never fights the game's own show/hide code), and put back as soon as it comes over the horizon.
// The globe is treated as a slightly smaller ball (`inset`), and every object as a slightly bigger one (`margin`),
// so nothing near the horizon (or casting a shadow over it) blinks out.
export const HORIZON_CULL = { inset: 1.5, margin: 2 };

const toCentre = new THREE.Vector3(), toObject = new THREE.Vector3();

// True when a sphere (`centre`, `radius`) is completely hidden from `eye` behind a ball (`globeCentre`,
// `globeRadius`): the sight line to it passes through the ball with room to spare, and enters the ball before
// reaching the sphere.
export function hiddenBehindGlobe(eye: THREE.Vector3, centre: THREE.Vector3, radius: number, globeCentre: THREE.Vector3, globeRadius: number) {
  toObject.subVectors(centre, eye);
  const distance = toObject.length();
  if (distance <= radius) return false;
  toObject.divideScalar(distance);
  toCentre.subVectors(globeCentre, eye);
  const along = toCentre.dot(toObject);
  const miss = Math.sqrt(Math.max(0, toCentre.lengthSq() - along * along));
  if (miss + radius >= globeRadius) return false;
  const entry = along - Math.sqrt(globeRadius * globeRadius - miss * miss);
  return entry > 0 && entry < distance - radius;
}

const sphere = new THREE.Sphere();

// Walks `root` (skipping hidden branches) and sets each mesh's render layer. Returns how many were culled.
export function cullBehindGlobe(root: THREE.Object3D, eye: THREE.Vector3, globeCentre: THREE.Vector3, globeRadius: number) {
  const occluder = globeRadius - HORIZON_CULL.inset;
  let culled = 0;
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return;
    const mesh = object as THREE.Mesh;
    // Anything that opted out of frustum culling (bounds that change at run time) opts out of this too.
    if ((mesh.isMesh || (object as THREE.Points).isPoints) && object.frustumCulled && !object.userData.noHorizonCull) {
      const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh ? mesh as THREE.InstancedMesh : null;
      if (instanced && !instanced.boundingSphere) instanced.computeBoundingSphere();
      if (!instanced && !mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      sphere.copy(instanced ? instanced.boundingSphere! : mesh.geometry.boundingSphere!);
      sphere.center.applyMatrix4(object.matrixWorld);
      const radius = sphere.radius * object.matrixWorld.getMaxScaleOnAxis() + HORIZON_CULL.margin;
      if (hiddenBehindGlobe(eye, sphere.center, radius, globeCentre, occluder)) { object.layers.disableAll(); culled++; }
      else object.layers.set(0);
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return culled;
}
