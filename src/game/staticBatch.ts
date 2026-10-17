import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static batching: the world is built from hundreds of separately placed meshes, each with its own material
// (colours are jittered per house, per tree), which costs a draw call each, twice over with shadows. Once the
// world has loaded this merges every static mesh into a few big ones: each material's colour is baked into
// vertex colours, so everything sharing the same surface (roughness, shading, texture…) draws together. The
// globe is cut into sectors so the parts out of view are still skipped. Anything that changes at run time is
// left as it is: glowing (emissive), transparent or custom-shader materials, instanced or skinned meshes, and
// whole subtrees marked `userData.dynamic`. The originals are hidden, not removed; `undo` restores them.
const SECTORS = { longitude: 8, latitude: 4 };
type Surface = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;

function batchable(material: THREE.Material): material is Surface {
  const surface = material as Surface;
  if (!(surface instanceof THREE.MeshStandardMaterial || surface instanceof THREE.MeshLambertMaterial || surface instanceof THREE.MeshPhongMaterial)) return false;
  if (surface.transparent || surface.opacity < 1 || surface.alphaTest > 0 || surface.userData.noBatch) return false;
  if (surface.emissive.getHex() !== 0 || surface.normalMap || surface.alphaMap || surface.lightMap || surface.aoMap) return false;
  if (surface.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return false;
  return !(surface instanceof THREE.MeshStandardMaterial) || (!surface.roughnessMap && !surface.metalnessMap);
}
function signature(material: Surface) {
  const standard = material as THREE.MeshStandardMaterial, phong = material as THREE.MeshPhongMaterial;
  return [material.type, material.side, material.flatShading, material.map?.uuid ?? '', material.fog, material.wireframe,
    material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits, material.depthTest, material.depthWrite,
    standard.roughness?.toFixed(2), standard.metalness?.toFixed(2), phong.shininess?.toFixed(0)].join('|');
}

// One material group of a mesh as plain, non-indexed geometry in the batch root's space, with its colour baked in.
function piece(geometry: THREE.BufferGeometry, start: number, count: number, material: Surface, toRoot: THREE.Matrix4) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.getAttribute('position');
  const end = Math.min(position.count, start + count);
  const slice = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number) => {
    const out = new Float32Array((end - start) * size);
    for (let i = start; i < end; i++) for (let c = 0; c < size; c++) out[(i - start) * size + c] = attribute.getComponent(i, c);
    return new THREE.BufferAttribute(out, size);
  };
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', slice(position, 3));
  const normal = flat.getAttribute('normal');
  if (normal) out.setAttribute('normal', slice(normal, 3)); else out.computeVertexNormals();
  if (material.map) {
    const uv = flat.getAttribute('uv');
    if (!uv) return null;
    out.setAttribute('uv', slice(uv, 2));
  }
  const colours = new Float32Array((end - start) * 3);
  const source = material.vertexColors ? flat.getAttribute('color') : undefined;
  for (let i = start; i < end; i++) {
    const k = (i - start) * 3;
    colours[k] = material.color.r * (source ? source.getX(i) : 1);
    colours[k + 1] = material.color.g * (source ? source.getY(i) : 1);
    colours[k + 2] = material.color.b * (source ? source.getZ(i) : 1);
  }
  out.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  if (flat !== geometry) flat.dispose();
  out.applyMatrix4(toRoot);
  return out;
}

export function batchStatic(root: THREE.Object3D, globeCenter: THREE.Vector3) {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { material: Surface; geometries: THREE.BufferGeometry[]; cast: boolean; receive: boolean; order: number }>();
  const hidden: THREE.Mesh[] = [];
  const toRoot = new THREE.Matrix4(), centre = new THREE.Vector3();
  const visit = (object: THREE.Object3D) => {
    if (object.userData.dynamic || !object.visible) return;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && mesh.geometry.getAttribute('position')) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.every(batchable)) {
        const geometry = mesh.geometry;
        const groups = Array.isArray(mesh.material) && geometry.groups.length
          ? geometry.groups
          : [{ start: 0, count: geometry.index ? geometry.index.count : geometry.getAttribute('position').count, materialIndex: 0 }];
        toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
        const pieces = groups.map(group => {
          const material = materials[group.materialIndex ?? 0] as Surface;
          return { material, geometry: piece(geometry, group.start, group.count, material, toRoot) };
        });
        if (pieces.every(p => p.geometry)) {
          for (const { material, geometry: part } of pieces) {
            part!.computeBoundingBox();
            part!.boundingBox!.getCenter(centre).sub(globeCenter).normalize();
            const sector = `${Math.floor((Math.atan2(centre.x, centre.z) / (2 * Math.PI) + 0.5) * SECTORS.longitude)}:${Math.floor((Math.asin(THREE.MathUtils.clamp(centre.y, -1, 1)) / Math.PI + 0.5) * SECTORS.latitude)}`;
            const key = `${signature(material)}#${mesh.castShadow}${mesh.receiveShadow}#${mesh.renderOrder}#${sector}`;
            const bucket = buckets.get(key) ?? { material, geometries: [], cast: mesh.castShadow, receive: mesh.receiveShadow, order: mesh.renderOrder };
            bucket.geometries.push(part!);
            buckets.set(key, bucket);
          }
          hidden.push(mesh);
          return;
        }
      }
    }
    object.children.forEach(visit);
  };
  root.children.forEach(visit);

  const batches = new THREE.Group();
  batches.name = 'static-batches';
  const made: { mesh: THREE.Mesh; material: THREE.Material }[] = [];
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries, false);
    bucket.geometries.forEach(geometry => geometry.dispose());
    if (!merged) continue;
    const material = bucket.material.clone();
    material.color.set(0xffffff);
    material.vertexColors = true;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    mesh.renderOrder = bucket.order;
    merged.computeBoundingSphere();
    batches.add(mesh);
    made.push({ mesh, material });
  }
  hidden.forEach(mesh => { mesh.visible = false; });
  root.add(batches);
  return {
    stats: { meshes: hidden.length, batches: made.length },
    undo() {
      root.remove(batches);
      made.forEach(({ mesh, material }) => { mesh.geometry.dispose(); material.dispose(); });
      hidden.forEach(mesh => { mesh.visible = true; });
    },
  };
}
