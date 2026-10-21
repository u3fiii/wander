import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static batching: the world is built from hundreds of separately placed meshes, each with its own material
// (colours are jittered per house, per tree), which costs a draw call each, twice over with shadows. Once the
// world has loaded this merges every static mesh into a few big ones: each material's colour is baked into
// vertex colours, so everything sharing the same surface (roughness, shading, texture…) draws together. The
// globe is cut into sectors so the parts out of view are still skipped. Anything that changes at run time is
// left as it is: glowing (emissive), transparent or custom-shader materials, instanced or skinned meshes, and
// whole subtrees marked `userData.dynamic`. The originals are hidden, and every branch left with nothing to draw
// is taken out of the scene graph (kept aside, not disposed): the globe turns every frame, so three.js would
// otherwise recompute and walk thousands of hidden objects each frame for nothing. `undo` puts it all back.
// Sectors are about 12 m across (on the radius-30 globe): small enough that the frustum and horizon culling
// can skip most of the planet when the camera is close, big enough to keep the draw calls few.
const SECTORS = { latitude: 8, equatorLongitude: 16 };
export function sectorOf(direction: THREE.Vector3) {
  const latitude = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
  const band = Math.min(SECTORS.latitude - 1, Math.floor((latitude / Math.PI + 0.5) * SECTORS.latitude));
  const bandMiddle = ((band + 0.5) / SECTORS.latitude - 0.5) * Math.PI;
  const columns = Math.max(3, Math.round(SECTORS.equatorLongitude * Math.cos(bandMiddle)));
  const column = Math.min(columns - 1, Math.floor((Math.atan2(direction.x, direction.z) / (2 * Math.PI) + 0.5) * columns));
  return `${band}:${column}`;
}
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
// `slot` (with `retint`): every vertex's retint slot, from the source's own `themeSlot` attribute or else `slot`.
function piece(geometry: THREE.BufferGeometry, start: number, count: number, material: Surface, toRoot: THREE.Matrix4, slot: number | null) {
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
  if (slot !== null) {
    const own = flat.getAttribute('themeSlot');
    out.setAttribute('themeSlot', own ? slice(own, 1) : new THREE.BufferAttribute(new Float32Array(end - start).fill(slot), 1));
  }
  out.applyMatrix4(toRoot);
  return out;
}

// `lightweight` (weaker devices): the merged meshes are shaded with Lambert instead of the physically based
// standard material. For this matte low-poly world they look all but the same, and cost far less per pixel.
function lambertCopy(source: Surface) {
  if (source instanceof THREE.MeshLambertMaterial) return source.clone();
  return new THREE.MeshLambertMaterial({
    map: source.map, side: source.side, flatShading: source.flatShading, fog: source.fog, wireframe: source.wireframe,
    polygonOffset: source.polygonOffset, polygonOffsetFactor: source.polygonOffsetFactor, polygonOffsetUnits: source.polygonOffsetUnits,
    depthTest: source.depthTest, depthWrite: source.depthWrite,
  });
}
// `retint` (themes.ts): each piece is given a retint slot per vertex, and `prepare` sets up the merged materials
// to use it.
export type Retint = { slotFor: (material: THREE.Material) => number; prepare: (material: THREE.Material) => void };
export function batchStatic(root: THREE.Object3D, globeCenter: THREE.Vector3, { lightweight = false, retint }: { lightweight?: boolean; retint?: Retint } = {}) {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { material: Surface; geometries: THREE.BufferGeometry[]; cast: boolean; receive: boolean; order: number }>();
  const hidden: THREE.Mesh[] = [];
  // Meshes with only some materials batchable (a house whose window glass glows at night): the rest are merged,
  // and the mesh keeps drawing just its other groups, through a geometry that shares the original's buffers.
  const trimmed: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[] = [];
  const toRoot = new THREE.Matrix4(), centre = new THREE.Vector3();
  const visit = (object: THREE.Object3D) => {
    if (object.userData.dynamic || !object.visible) return;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && mesh.geometry.getAttribute('position')) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const geometry = mesh.geometry;
      const groups = Array.isArray(mesh.material) && geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: geometry.index ? geometry.index.count : geometry.getAttribute('position').count, materialIndex: 0 }];
      toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
      const pieces = groups.map(group => {
        const material = materials[group.materialIndex ?? 0];
        return { group, material, geometry: batchable(material) ? piece(geometry, group.start, group.count, material, toRoot, retint ? retint.slotFor(material) : null) : null };
      });
      const merged = pieces.filter(p => p.geometry);
      // Splitting a single-material mesh gains nothing; one with a group left over keeps the leftover.
      if (merged.length && (merged.length === pieces.length || Array.isArray(mesh.material))) {
        for (const { material, geometry: part } of merged) {
          part!.computeBoundingBox();
          part!.boundingBox!.getCenter(centre).sub(globeCenter).normalize();
          const sector = sectorOf(centre);
          const key = `${signature(material as Surface)}#${mesh.castShadow}${mesh.receiveShadow}#${mesh.renderOrder}#${sector}`;
          const bucket = buckets.get(key) ?? { material: material as Surface, geometries: [], cast: mesh.castShadow, receive: mesh.receiveShadow, order: mesh.renderOrder };
          bucket.geometries.push(part!);
          buckets.set(key, bucket);
        }
        if (merged.length === pieces.length) { hidden.push(mesh); return; }
        const rest = new THREE.BufferGeometry();
        for (const name in geometry.attributes) rest.setAttribute(name, geometry.attributes[name]);
        rest.setIndex(geometry.index);
        pieces.filter(p => !p.geometry).forEach(({ group }) => rest.addGroup(group.start, group.count, group.materialIndex));
        rest.boundingSphere = geometry.boundingSphere;
        rest.boundingBox = geometry.boundingBox;
        trimmed.push({ mesh, geometry });
        mesh.geometry = rest;
      } else merged.forEach(p => p.geometry!.dispose());
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
    const material = lightweight ? lambertCopy(bucket.material) : bucket.material.clone();
    material.color.set(0xffffff);
    material.vertexColors = true;
    retint?.prepare(material);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    mesh.renderOrder = bucket.order;
    merged.computeBoundingSphere();
    batches.add(mesh);
    made.push({ mesh, material });
  }
  hidden.forEach(mesh => { mesh.visible = false; });
  const detached = detachEmpty(root, new Set(hidden));
  root.add(batches);
  return {
    stats: { meshes: hidden.length, trimmed: trimmed.length, batches: made.length, detached: detached.length },
    undo() {
      root.remove(batches);
      made.forEach(({ mesh, material }) => { mesh.geometry.dispose(); material.dispose(); });
      detached.reverse().forEach(({ object, parent, index }) => { parent.children.splice(Math.min(index, parent.children.length), 0, object); object.parent = parent; });
      hidden.forEach(mesh => { mesh.visible = true; });
      trimmed.forEach(({ mesh, geometry }) => { mesh.geometry = geometry; });
    },
  };
}

// Takes out of the scene graph every branch under `root` with nothing left to draw: it held meshes that were merged
// (`merged`), and nothing else (no other mesh, light or other renderable, nothing hidden that the game might show
// later, nothing dynamic). A branch with nothing merged in it is left alone, even if it is empty for now: its model
// may still be loading. Returns where each one was, for putting it back.
function detachEmpty(root: THREE.Object3D, merged: Set<THREE.Object3D>) {
  const detached: { object: THREE.Object3D; parent: THREE.Object3D; index: number }[] = [];
  // How many merged meshes the branch holds, or -1 if it holds anything that must stay.
  const mergedIn = (object: THREE.Object3D): number => {
    if (object.userData.dynamic) return -1;
    const own = merged.has(object) ? 1 : 0;
    const plain = object.type === 'Group' || object.type === 'Object3D' || (object as THREE.Bone).isBone;
    if (!own && !(plain && object.visible)) return -1;
    let count = own;
    for (const child of object.children) {
      const inside = mergedIn(child);
      if (inside < 0) return -1;
      count += inside;
    }
    return count;
  };
  const walk = (parent: THREE.Object3D) => {
    for (let index = parent.children.length - 1; index >= 0; index--) {
      const child = parent.children[index];
      if (mergedIn(child) > 0) {
        parent.children.splice(index, 1);
        child.parent = null;
        detached.push({ object: child, parent, index });
      } else walk(child);
    }
  };
  walk(root);
  return detached;
}
