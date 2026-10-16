import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLOBE_RADIUS, roadLatitude, sphereNormal, spherePoint } from './globe';
import { REGIONS, ROAD_PATHS, WORLD_SETTINGS, distanceToRoadNetwork, isLandAt, landInfluence, regionInfluence, roadPathFrame, roadPoint, roadSurfaceElevation, terrainElevation, groundNormal, terrainPoint } from './worldMap';
import type { RoadPath } from './worldMap';
import { clearObstacleGroup, setObstacleGroup } from './obstacles';
import { PLANET_TERRAIN, planetNoise } from './planetTerrain';
import { ART_DIRECTION } from './artDirection';
import { FLOWER_COLORS, JITTER, PALETTE, ROOF_WEIGHTS, TREE_WEIGHTS, WALL_WEIGHTS, seededRandom, weightedPick } from './palette';
import type { PaletteKey } from './palette';
import { bakeRoles, houseRole, jitterAmount, logMaterials, paletteMaterial, planeRole, planterRole, roleMaterials, scaleRoleGeometry, textureSampler, treeRole } from './recolor';
import cityTextureUrl from '../assets/kenny city/Textures/colormap.png?url';
import buildingAUrl from '../assets/kenny city/building-type-a.obj?url';
import buildingCUrl from '../assets/kenny city/building-type-c.obj?url';
import buildingFUrl from '../assets/kenny city/building-type-f.obj?url';
import buildingHUrl from '../assets/kenny city/building-type-h.obj?url';
import buildingKUrl from '../assets/kenny city/building-type-k.obj?url';
import buildingNUrl from '../assets/kenny city/building-type-n.obj?url';
import buildingRUrl from '../assets/kenny city/building-type-r.obj?url';
import buildingUUrl from '../assets/kenny city/building-type-u.obj?url';
import planterUrl from '../assets/kenny city/planter.obj?url';
import cloudModelUrl from '../assets/low_poly_cloud/cloud.glb?url';
import japaneseGardenUrl from '../assets/japanese_bridge_garden/bridge-garden.glb?url';
import lowPolyTreesUrl from '../assets/low_poly_trees/trees.glb?url';
import mountainModelUrl from '../assets/low_poly_mountain_free/mountain.glb?url';
import ropeBridgeUrl from '../assets/old_ropebridge_low_poly/ropebridge.glb?url';
import planeModelUrl from '../assets/low_poly_plane/plane.glb?url';

const up = new THREE.Vector3(0, 1, 0);
const turn = Math.PI * 2;
// Palette sampled from EdwinRC's CC-BY-4.0 Low Poly UFO Scene road pieces.
const roadStyle = {
  asphalt: PALETTE.road,
  sidewalk: PALETTE.roadShoulder,
  edge: PALETTE.roadShoulder,
  marking: PALETTE.roadMarking,
} as const;

// Japanese garden GLB: material name -> palette role, per extracted part.
const GARDEN_ROLES: Record<string, Record<string, PaletteKey>> = {
  bridge: { 'Material.002': 'trunk', 'Material.003': 'bridgeAccent', 'Material.007': 'road' },
  rocks: { 'Material.003': 'roadShoulder' },
  groundCover: { 'Material.009': 'coastWall', 'Material.011': 'lightTree' },
  flowers: { 'Material.012': 'bridgeAccent' },
  lanterns: { 'Material.002': 'road', 'Material.004': 'accentTree', 'Material.006': 'mainTree' },
};

const mountainSites = [
  { latitude: 0.95, longitude: 4.68, scale: 4, rotation: 0.35, variant: 0 },
  { latitude: -0.87, longitude: 1.89, scale: 4.3, rotation: 1.72, variant: 1 },
  { latitude: 0.67, longitude: 3.96, scale: 3.4, rotation: 2.58, variant: 0 },
  { latitude: 0.25, longitude: 5.58, scale: 3.8, rotation: 0.92, variant: 1 },
  { latitude: -0.31, longitude: 1.98, scale: 3.2, rotation: 2.16, variant: 0 },
  { latitude: -0.31, longitude: 5.4, scale: 3.5, rotation: 1.28, variant: 1 },
] as const;

function distanceToMountainSites(latitude: number, longitude: number) {
  return Math.min(...mountainSites.map(site => {
    const longitudeDistance = Math.atan2(
      Math.sin(longitude - site.longitude),
      Math.cos(longitude - site.longitude),
    ) * Math.cos((latitude + site.latitude) * 0.5);
    return Math.hypot(latitude - site.latitude, longitudeDistance) * GLOBE_RADIUS;
  }));
}

function frameAt(latitude: number, longitude: number) {
  const normal = new THREE.Vector3(...groundNormal(latitude, longitude));
  return {
    normal,
    orientation: new THREE.Quaternion().setFromUnitVectors(up, normal),
  };
}

function snapRoadVertex(point: THREE.Vector3, elevation: number) {
  const centeredY = point.y + GLOBE_RADIUS;
  const radius = Math.hypot(point.x, centeredY, point.z);
  const scale = (GLOBE_RADIUS + elevation) / radius;
  point.set(point.x * scale, centeredY * scale - GLOBE_RADIUS, point.z * scale);
  return point;
}

function showProceduralRoad(path: RoadPath, t: number) {
  if (path.id !== 'main') return true;
  const longitude = path.longitudeAt(t);
  const distance = Math.abs(Math.atan2(
    Math.sin(longitude - WORLD_SETTINGS.roads.bridgeLongitude),
    Math.cos(longitude - WORLD_SETTINGS.roads.bridgeLongitude),
  ));
  return distance > WORLD_SETTINGS.roads.bridgeDeckHalfSpan;
}

function buildRoadBand(path: RoadPath, width: number, surfaceOffset: number, segmentVisible: (distance: number, t: number) => boolean = () => true, crossSegments = 1) {
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new THREE.Vector3();
  const edge = new THREE.Vector3();
  const previousCenter = new THREE.Vector3();
  let travelled = 0;
  for (let i = 0; i <= path.segments; i++) {
    const t = i / path.segments;
    const frame = roadPathFrame(path, t, surfaceOffset);
    const center = new THREE.Vector3(...roadPoint(path, t, surfaceOffset));
    const rowElevation = roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t)) + surfaceOffset;
    side.set(...frame.side);
    for (let cross = 0; cross <= crossSegments; cross++) {
      const distance = -width * 0.5 + width * cross / crossSegments;
      edge.copy(center).addScaledVector(side, distance);
      snapRoadVertex(edge, rowElevation);
      positions.push(edge.x, edge.y, edge.z);
    }
    if (i > 0) {
      const segmentLength = center.distanceTo(previousCenter);
      const segment = i - 1;
      const tMid = (segment + 0.5) / path.segments;
      if (segmentVisible(travelled + segmentLength * 0.5, tMid)) {
        const row = crossSegments + 1;
        for (let cross = 0; cross < crossSegments; cross++) {
          const a = segment * row + cross, b = a + 1, c = a + row, d = c + 1;
          indices.push(a, c, b, c, d, b);
        }
      }
      travelled += segmentLength;
    }
    previousCenter.copy(center);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Low-poly look for road surfaces: flat facets with a small seeded lightness change per patch.
// `cellsPerRow` groups triangles into patches (2 triangles per quad, `cross` quads per row,
// `rowsPerPatch` rows per patch) so the variation reads as broad facets rather than noise.
function facetRoadSurface(geometry: THREE.BufferGeometry, amount: number, seed: number, cross = 1, rowsPerPatch = 1) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const random = seededRandom(seed);
  const patches = new Map<string, number>();
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let triangle = 0; triangle < count / 3; triangle++) {
    const quad = Math.floor(triangle / 2);
    const key = `${Math.floor(Math.floor(quad / cross) / rowsPerPatch)}:${quad % cross}`;
    if (!patches.has(key)) patches.set(key, 1 + (random() * 2 - 1) * amount);
    const factor = patches.get(key)!;
    for (let vertex = 0; vertex < 3; vertex++) colors.set([factor, factor, factor], (triangle * 3 + vertex) * 3);
  }
  flat.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  if (flat !== geometry) geometry.dispose();
  return flat;
}

function buildRoadSlab(path: RoadPath, width: number) {
  const top = buildRoadBand(path, width, 0.065, (_, t) => showProceduralRoad(path, t), 8);
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new THREE.Vector3(), point = new THREE.Vector3();
  for (let i = 0; i <= path.segments; i++) {
    const t = i / path.segments;
    const centerElevation = roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t));
    side.set(...roadPathFrame(path, t).side);
    for (const offset of [0.065, -WORLD_SETTINGS.roads.surfaceLift + 0.006]) for (const direction of [-1, 1]) {
      point.set(...roadPoint(path, t, offset)).addScaledVector(side, direction * width * 0.5);
      snapRoadVertex(point, centerElevation + offset);
      positions.push(point.x, point.y, point.z);
    }
    if (i < path.segments) {
      const segmentMidpoint = (i + 0.5) / path.segments;
      if (!showProceduralRoad(path, segmentMidpoint)) continue;
      const a = i * 4, n = a + 4;
      indices.push(a, n, a + 2, n, n + 2, a + 2);
      indices.push(a + 1, a + 3, n + 1, n + 1, a + 3, n + 3);
    }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  walls.setIndex(indices);
  walls.computeVertexNormals();
  return { top, walls };
}

function buildRoadOuterWalls(path: RoadPath) {
  const outerWidth = path.width + WORLD_SETTINGS.roads.shoulderExtra;
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new THREE.Vector3();
  const top = new THREE.Vector3();
  const bottom = new THREE.Vector3();
  for (let index = 0; index <= path.segments; index++) {
    const t = index / path.segments;
    const centerElevation = roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t));
    side.set(...roadPathFrame(path, t).side);
    for (const direction of [-1, 1]) {
      top.set(...roadPoint(path, t, 0.082)).addScaledVector(side, direction * outerWidth * 0.5);
      snapRoadVertex(top, centerElevation + 0.082);
      bottom.copy(top);
      snapRoadVertex(bottom, centerElevation - WORLD_SETTINGS.roads.surfaceLift + 0.006);
      positions.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z);
    }
    if (index < path.segments) {
      const segmentMidpoint = (index + 0.5) / path.segments;
      if (!showProceduralRoad(path, segmentMidpoint)) continue;
      const current = index * 4;
      const next = current + 4;
      indices.push(current, next, current + 1, next, next + 1, current + 1);
      indices.push(current + 2, current + 3, next + 2, next + 2, current + 3, next + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildRoadEdges(path: RoadPath) {
  const outerWidth = path.width + WORLD_SETTINGS.roads.shoulderExtra;
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new THREE.Vector3(), point = new THREE.Vector3();
  for (let i = 0; i <= path.segments; i++) {
    const t = i / path.segments;
    const frame = roadPathFrame(path, t, 0.082);
    const center = new THREE.Vector3(...roadPoint(path, t, 0.082));
    const rowElevation = roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t)) + 0.082;
    side.set(...frame.side);
    for (const distance of [-outerWidth * 0.5, -path.width * 0.5, path.width * 0.5, outerWidth * 0.5]) {
      point.copy(center).addScaledVector(side, distance);
      snapRoadVertex(point, rowElevation);
      positions.push(point.x, point.y, point.z);
    }
    if (i < path.segments) {
      const segmentMidpoint = (i + 0.5) / path.segments;
      if (!showProceduralRoad(path, segmentMidpoint)) continue;
      const a = i * 4, next = a + 4;
      indices.push(a, next, a + 1, next, next + 1, a + 1);
      indices.push(a + 2, next + 2, a + 3, next + 2, next + 3, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildRoadLine(path: RoadPath) {
  return buildRoadBand(path, 0.22, 0.09, (distance, t) => {
    const clearOfEnds = path.closed || (t > 0.075 && t < 0.925);
    return clearOfEnds && showProceduralRoad(path, t) && distance % 3.4 < 1.9;
  });
}

// Trapezoid support under the road: wide at the deck, narrower at the bottom, sunk below sea level
// so water and cliffs read as the road's base. The bridge span stays open.
const ROAD_SUPPORT = { bottomDepth: -2.4, bottomWidth: 1.7, topInset: 1.0 };

function buildRoadSupport(path: RoadPath, width: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new THREE.Vector3(), top = new THREE.Vector3(), bottom = new THREE.Vector3();
  const rowVertices = (t: number) => {
    const frame = roadPathFrame(path, t);
    const center = new THREE.Vector3(...roadPoint(path, t));
    const elevation = roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t));
    side.set(...frame.side);
    const out: THREE.Vector3[] = [];
    for (const direction of [-1, 1]) {
      top.copy(center).addScaledVector(side, direction * width * 0.5 * ROAD_SUPPORT.topInset);
      snapRoadVertex(top, elevation);
      bottom.copy(center).addScaledVector(side, direction * width * 0.5 * ROAD_SUPPORT.bottomWidth);
      snapRoadVertex(bottom, ROAD_SUPPORT.bottomDepth);
      out.push(top.clone(), bottom.clone());
    }
    return out; // [leftTop, leftBottom, rightTop, rightBottom]
  };
  let previous = rowVertices(0);
  for (let i = 1; i <= path.segments; i++) {
    const current = rowVertices(i / path.segments);
    const midpoint = (i - 0.5) / path.segments;
    if (showProceduralRoad(path, midpoint)) {
      for (const [a, b, c, d] of [[0, 1, 2, 3], [2, 3, 0, 1]] as const) {
        // left side: (leftTop, leftBottom) ; right side: (rightTop, rightBottom)
        const quad = [previous[a], previous[b], current[a], current[b]];
        const base = positions.length / 3;
        quad.forEach(v => positions.push(v.x, v.y, v.z));
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    previous = current;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function LoopRoad() {
  const roads = useMemo(() => ROAD_PATHS.map(path => {
    const asphalt = buildRoadSlab(path, path.width);
    return { path, shoulderGeometry: facetRoadSurface(buildRoadEdges(path), 0.035, 12), shoulderWalls: buildRoadOuterWalls(path), asphaltGeometry: facetRoadSurface(asphalt.top, 0.05, 11, 8, 4), asphaltWalls: asphalt.walls, centerline: buildRoadLine(path), support: buildRoadSupport(path, path.width) };
  }), []);
  useEffect(() => () => {
    roads.forEach(road => { road.shoulderGeometry.dispose(); road.shoulderWalls.dispose(); road.asphaltGeometry.dispose(); road.asphaltWalls.dispose(); road.centerline.dispose(); road.support.dispose(); });
  }, [roads]);
  return <>
    {roads.map((road, roadIndex) => <group key={road.path.id}>
      <mesh geometry={road.shoulderGeometry} receiveShadow renderOrder={1}>
        <meshStandardMaterial color={roadStyle.sidewalk} roughness={0.94} metalness={0} side={THREE.DoubleSide} vertexColors flatShading />
      </mesh>
      <mesh geometry={road.support} receiveShadow castShadow renderOrder={0}>
        <meshStandardMaterial color={PALETTE.coastWall} roughness={0.95} metalness={0} flatShading side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={road.shoulderWalls} receiveShadow renderOrder={1}>
        <meshStandardMaterial color={roadStyle.edge} roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={road.asphaltWalls} receiveShadow renderOrder={2}><meshStandardMaterial color={roadStyle.asphalt} roughness={0.95} metalness={0} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={road.asphaltGeometry} receiveShadow renderOrder={2}>
        <meshStandardMaterial color={roadStyle.asphalt} roughness={ART_DIRECTION.materials.asphaltRoughness} side={THREE.DoubleSide} vertexColors flatShading polygonOffset polygonOffsetFactor={-2 - roadIndex} polygonOffsetUnits={-2 - roadIndex} />
      </mesh>
      <mesh geometry={road.centerline} renderOrder={4}>
        <meshStandardMaterial color={roadStyle.marking} roughness={0.9} metalness={0} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
      </mesh>
    </group>)}
  </>;
}

function JapaneseBridgeGarden() {
  const gltf = useLoader(GLTFLoader, japaneseGardenUrl);
  const { bridge, rocks, groundCover, flowers, lanterns } = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    logMaterials('japanese garden', gltf.scene);
    const extractPart = (name: string, roles: Record<string, PaletteKey>) => {
      const original = gltf.scene.getObjectByName(name);
      if (!original) throw new Error(`Missing Japanese garden part: ${name}`);
      const part = original.clone(true);
      part.matrix.copy(original.matrixWorld);
      part.matrix.decompose(part.position, part.quaternion, part.scale);
      part.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const paint = (material: THREE.Material) => paletteMaterial(roles[material.name] ?? 'roadShoulder', { side: material.side });
        child.material = Array.isArray(child.material) ? child.material.map(paint) : paint(child.material);
        child.castShadow = true;
        child.receiveShadow = true;
      });
      part.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(part);
      const center = bounds.getCenter(new THREE.Vector3());
      part.position.x -= center.x;
      part.position.y -= bounds.min.y;
      part.position.z -= center.z;
      return part;
    };
    return {
      bridge: extractPart('Cube005', GARDEN_ROLES.bridge),
      rocks: ['Cube009', 'Cube002', 'Cube003', 'Cube006', 'Cube007', 'Cube008', 'Cube010', 'Cube011', 'Cube012', 'Cube013', 'Icosphere002'].map(name => extractPart(name, GARDEN_ROLES.rocks)),
      groundCover: ['Circle001', 'Circle002', 'Circle003', 'Circle004', 'Circle005', 'Circle006', 'Circle007', 'Circle008', 'Circle009', 'Circle010', 'Circle011', 'Circle012', 'Circle013', 'Circle014', 'Plane001', 'Plane002', 'Plane004', 'Plane005'].map(name => extractPart(name, GARDEN_ROLES.groundCover)),
      flowers: ['Succulent', 'Succulent001', 'Succulent002', 'Succulent003', 'Succulent004', 'Succulent005'].map(name => extractPart(name, GARDEN_ROLES.flowers)),
      lanterns: ['Cylinder002', 'Cylinder012', 'Cylinder013'].map(name => extractPart(name, GARDEN_ROLES.lanterns)),
    };
  }, [gltf.scene]);
  const bridgePose = useMemo(() => {
    const longitude = WORLD_SETTINGS.roads.bridgeLongitude;
    const path = ROAD_PATHS[0];
    const overlap = turn / path.segments;
    const halfSpan = WORLD_SETTINGS.roads.bridgeDeckHalfSpan + overlap;
    const startT = (longitude - halfSpan) / turn;
    const endT = (longitude + halfSpan) / turn;
    const start = new THREE.Vector3(...roadPoint(path, startT, 0.065));
    const end = new THREE.Vector3(...roadPoint(path, endT, 0.065));
    const tangent = end.clone().sub(start).normalize();
    const planetCenter = new THREE.Vector3(0, -GLOBE_RADIUS, 0);
    const normal = start.clone().sub(planetCenter).normalize()
      .add(end.clone().sub(planetCenter).normalize()).normalize();
    const side = tangent.clone().cross(normal).normalize();
    normal.copy(side).cross(tangent).normalize();
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, normal, side));
    const bounds = new THREE.Box3().setFromObject(bridge);
    const size = bounds.getSize(new THREE.Vector3());
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    // The imported deck's driving surface is 0.11 units above its local base
    // at both ends. Align that surface with the actual road endpoints.
    midpoint.addScaledVector(normal, -0.11);
    return {
      position: midpoint.toArray() as [number, number, number],
      orientation,
      scale: [
        start.distanceTo(end) / size.x,
        1,
        (path.width + WORLD_SETTINGS.roads.shoulderExtra) / size.z,
      ] as [number, number, number],
    };
  }, [bridge]);
  const decorations = useMemo(() => {
    const flowerRandom = seededRandom(31);
    const scatter = (
      models: THREE.Object3D[], count: number, phase: number,
      minScale: number, maxScale: number, roadClearance = 4.3,
    ) => {
      const placements: Array<{
        object: THREE.Object3D; position: [number, number, number]; orientation: THREE.Quaternion;
        rotation: number; scale: number; latitude: number; longitude: number;
      }> = [];
      for (let index = 0; index < count * 12 && placements.length < count; index++) {
        const sequence = index + phase * 17;
        const angle = sequence * 2.399963;
        const latitude = Math.asin(THREE.MathUtils.clamp(-0.9 + ((sequence * 73 + 29) % 181) / 181 * 1.8, -0.96, 0.96));
        const longitude = (sequence * 2.399963 + phase) % turn;
        if (landInfluence(latitude, longitude) < 0.8 || distanceToRoadNetwork(latitude, longitude) < roadClearance) continue;
        if (distanceToMountainSites(latitude, longitude) < 5.5) continue;
        const variation = ((sequence * 29) % 97) / 97;
        placements.push({
          object: models[placements.length % models.length].clone(true),
          latitude,
          longitude,
          position: terrainPoint(latitude, longitude, 0.045),
          orientation: frameAt(latitude, longitude).orientation,
          rotation: (angle * 1.37) % turn,
          scale: minScale + (maxScale - minScale) * variation,
        });
      }
      return placements;
    };
    return [
      ...scatter(rocks, 120, 1, 0.48, 0.82, 4.7),
      ...scatter(groundCover, 260, 4, 0.8, 1.35, 4.15),
      ...scatter(flowers, 45, 7, 0.7, 1.1, 4.4).map(flower => {
        const key = FLOWER_COLORS[Math.floor(flowerRandom() * FLOWER_COLORS.length)];
        flower.object.traverse(child => { if (child instanceof THREE.Mesh) child.material = paletteMaterial(key); });
        return flower;
      }),
      ...scatter(lanterns, 6, 11, 0.68, 0.9, 3.9),
    ];
  }, [flowers, groundCover, lanterns, rocks]);
  useEffect(() => () => {
    [bridge, ...rocks, ...groundCover, ...flowers, ...lanterns].forEach(object => object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
      else child.material.dispose();
    }));
  }, [bridge, flowers, groundCover, lanterns, rocks]);
  return <>
    <group position={bridgePose.position} quaternion={bridgePose.orientation} scale={bridgePose.scale}>
      <primitive object={bridge} />
    </group>
    {decorations.map((decoration, index) => <group key={`garden-${index}`} position={decoration.position} quaternion={decoration.orientation}>
      <group rotation-y={decoration.rotation} scale={decoration.scale}><primitive object={decoration.object} /></group>
    </group>)}
  </>;
}

function buildFacetedLand() {
  const base = new THREE.IcosahedronGeometry(
    GLOBE_RADIUS + PLANET_TERRAIN.landHeight,
    PLANET_TERRAIN.detail,
  );
  const source = base.index ? base.toNonIndexed() : base;
  const attribute = source.getAttribute('position');
  const topPositions: number[] = [];
  const topColors: number[] = [];
  const edges = new Map<string, { count: number; a: THREE.Vector3; b: THREE.Vector3; centroid: THREE.Vector3 }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const baseColor = new THREE.Color(PLANET_TERRAIN.landColor);
  const edgeKey = (start: THREE.Vector3, end: THREE.Vector3) => {
    const vertexKey = (point: THREE.Vector3) => `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`;
    const first = vertexKey(start), second = vertexKey(end);
    return first < second ? `${first}|${second}` : `${second}|${first}`;
  };
  const registerEdge = (start: THREE.Vector3, end: THREE.Vector3, facetCentroid: THREE.Vector3) => {
    const key = edgeKey(start, end);
    const existing = edges.get(key);
    if (existing) existing.count += 1;
    else edges.set(key, { count: 1, a: start.clone(), b: end.clone(), centroid: facetCentroid.clone() });
  };
  for (let index = 0; index < attribute.count; index += 3) {
    a.fromBufferAttribute(attribute, index);
    b.fromBufferAttribute(attribute, index + 1);
    c.fromBufferAttribute(attribute, index + 2);
    centroid.copy(a).add(b).add(c).normalize();
    const latitude = Math.asin(THREE.MathUtils.clamp(centroid.y, -1, 1));
    const longitude = Math.atan2(centroid.x, centroid.z);
    if (!isLandAt(latitude, longitude)) continue;
    topPositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const variation = (planetNoise(centroid.x * 7.1, centroid.y * 7.1, centroid.z * 7.1) - 0.5)
      * PLANET_TERRAIN.facetLightnessVariation * 2;
    const facetColor = baseColor.clone().offsetHSL(0, 0, variation);
    for (let vertex = 0; vertex < 3; vertex++) topColors.push(facetColor.r, facetColor.g, facetColor.b);
    registerEdge(a, b, centroid); registerEdge(b, c, centroid); registerEdge(c, a, centroid);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(topPositions, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(topColors, 3));
  top.computeVertexNormals();

  // Coast walls get a sloped bevel strip at the top so the shoreline isn't a hard 90-degree edge.
  // Each shoreline vertex shares one outward direction (averaged over its edges) so strips meet without gaps.
  const bevel = PLANET_TERRAIN.landHeight * COAST_BEVEL;
  const topRadius = GLOBE_RADIUS + PLANET_TERRAIN.landHeight;
  const vertexKey = (point: THREE.Vector3) => `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`;
  const outward = new Map<string, THREE.Vector3>();
  const boundary = [...edges.values()].filter(edge => edge.count === 1);
  const direction = new THREE.Vector3(), mid = new THREE.Vector3(), perpendicular = new THREE.Vector3();
  boundary.forEach(edge => {
    direction.subVectors(edge.b, edge.a);
    mid.addVectors(edge.a, edge.b).multiplyScalar(0.5);
    perpendicular.crossVectors(direction, mid).normalize();
    if (perpendicular.dot(mid.clone().sub(edge.centroid.clone().multiplyScalar(topRadius))) < 0) perpendicular.negate();
    for (const point of [edge.a, edge.b]) {
      const key = vertexKey(point);
      const sum = outward.get(key) ?? new THREE.Vector3();
      outward.set(key, sum.add(perpendicular));
    }
  });
  const offsetAt = (point: THREE.Vector3) => {
    const normal = point.clone().normalize();
    const out = (outward.get(vertexKey(point)) ?? new THREE.Vector3()).clone();
    out.addScaledVector(normal, -out.dot(normal)).normalize();
    return { normal, out };
  };
  const wallPositions: number[] = [];
  const push = (...points: THREE.Vector3[]) => points.forEach(point => wallPositions.push(point.x, point.y, point.z));
  boundary.forEach(edge => {
    const A = offsetAt(edge.a), B = offsetAt(edge.b);
    const midA = A.normal.clone().multiplyScalar(topRadius - bevel).addScaledVector(A.out, bevel);
    const midB = B.normal.clone().multiplyScalar(topRadius - bevel).addScaledVector(B.out, bevel);
    const lowA = A.normal.clone().multiplyScalar(GLOBE_RADIUS).addScaledVector(A.out, bevel);
    const lowB = B.normal.clone().multiplyScalar(GLOBE_RADIUS).addScaledVector(B.out, bevel);
    push(edge.a, midA, edge.b, edge.b, midA, midB);
    push(midA, lowA, midB, midB, lowA, lowB);
  });
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
  walls.computeVertexNormals();
  source.dispose();
  if (source !== base) base.dispose();
  return { top, walls };
}

const TREE_TRUNK_SCALE = 0.35;
const TREE_TRUNK_RADIUS = 0.45;

const COAST_BEVEL = 0.35;

const OCEAN_WAVE = { amplitude: 0.14, shallowTint: 0.5 };

function Ocean() {
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(GLOBE_RADIUS, PLANET_TERRAIN.detail).toNonIndexed(), []);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color(PALETTE.oceanShallow) },
    uAmplitude: { value: OCEAN_WAVE.amplitude },
  }), []);
  const material = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color: PALETTE.oceanDeep,
      roughness: ART_DIRECTION.materials.waterRoughness,
      metalness: 0,
      flatShading: true,
    });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmplitude;\nvarying float vWave;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 dir = normalize(position);
          float wave = sin(dir.x * 5.0 + uTime * 0.9) * 0.5
            + sin(dir.z * 7.0 - uTime * 0.7 + dir.y * 3.0) * 0.35
            + sin(dir.y * 9.0 + uTime * 1.3) * 0.15;
          vWave = wave;
          transformed += dir * wave * uAmplitude;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uShallow;\nvarying float vWave;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, smoothstep(0.1, 0.6, vWave) * ${OCEAN_WAVE.shallowTint.toFixed(2)});`);
    };
    return material;
  }, [uniforms]);
  useFrame(state => { uniforms.uTime.value = state.clock.elapsedTime; });
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <mesh position={[0, -GLOBE_RADIUS, 0]} geometry={geometry} material={material} receiveShadow />;
}

function Terrain() {
  const geometry = useMemo(buildFacetedLand, []);
  useEffect(() => () => { geometry.top.dispose(); geometry.walls.dispose(); }, [geometry]);
  return <>
    <Ocean />
    <group position={[0, -GLOBE_RADIUS, 0]}>
      <mesh geometry={geometry.top} receiveShadow castShadow>
        <meshStandardMaterial vertexColors roughness={0.94} flatShading />
      </mesh>
      <mesh geometry={geometry.walls} receiveShadow castShadow>
        <meshStandardMaterial color={PLANET_TERRAIN.coastWallColor} roughness={1} flatShading side={THREE.DoubleSide} />
      </mesh>
    </group>
  </>;
}

type CityColors = { roof: PaletteKey; wall: PaletteKey; bush: PaletteKey; jitter: number };

const cityRoleColor = (colors: CityColors) => (role: string): { key: PaletteKey; roughness?: number } => {
  switch (role) {
    case 'roof': return { key: colors.roof };
    case 'wall': return { key: colors.wall };
    case 'window': return { key: 'windows', roughness: 0.5 };
    case 'door': return { key: 'doorsTrim' };
    case 'bush': return { key: colors.bush };
    case 'soil': return { key: 'trunk' };
    case 'pot': return { key: 'roofWarmBrown' };
    default: return { key: 'roadShoulder' };
  }
};

function CityAsset({ modelUrl, latitude, longitude, scale = 3.4, rotation = 0, colors, planter = false }: {
  modelUrl: string; latitude: number; longitude: number; scale?: number; rotation?: number; colors: CityColors; planter?: boolean;
}) {
  const source = useLoader(OBJLoader, modelUrl);
  const texture = useLoader(THREE.TextureLoader, cityTextureUrl);
  const model = useMemo(() => {
    const clone = source.clone(true);
    logMaterials(planter ? 'kenney planter' : 'kenney building', clone);
    const sample = textureSampler(texture);
    clone.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const baked = bakeRoles(child.geometry, sample, planter ? planterRole : houseRole);
      child.geometry = baked.geometry;
      child.material = roleMaterials(baked.roles, cityRoleColor(colors), colors.jitter);
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return clone;
  }, [source, texture, colors, planter]);
  const position = useMemo(() => terrainPoint(latitude, longitude, 0.12), [latitude, longitude]);
  const orientation = useMemo(() => frameAt(latitude, longitude).orientation, [latitude, longitude]);
  useEffect(() => () => {
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
    });
  }, [model]);
  return <group position={position} quaternion={orientation}>
    <group rotation-y={rotation}><primitive object={model} scale={scale} /></group>
  </group>;
}

const BUILDINGS = [
  { modelUrl: buildingAUrl, lon: 0.34, side: 1, distance: 10.1, scale: 3.6, rotation: Math.PI },
  { modelUrl: buildingCUrl, lon: 0.59, side: 1, distance: 10.5, scale: 3.5, rotation: Math.PI },
  { modelUrl: buildingFUrl, lon: 0.84, side: 1, distance: 10.2, scale: 3.25, rotation: Math.PI },
  { modelUrl: buildingHUrl, lon: 1.1, side: 1, distance: 10.1, scale: 3.7, rotation: Math.PI },
  { modelUrl: buildingKUrl, lon: 0.36, side: -1, distance: 9.8, scale: 3.5, rotation: 0 },
  { modelUrl: buildingNUrl, lon: 0.61, side: -1, distance: 9.7, scale: 3.1, rotation: 0 },
  { modelUrl: buildingRUrl, lon: 0.86, side: -1, distance: 9.8, scale: 3.55, rotation: 0 },
  { modelUrl: buildingUUrl, lon: 1.1, side: -1, distance: 9.5, scale: 3.25, rotation: 0 },
].slice(0, WORLD_SETTINGS.regions.buildingDensity);
const NEIGHBOUR_DISTANCE = 9;

function Town() {
  const houses = useMemo(() => {
    const random = seededRandom(1207);
    const placed: Array<{ point: THREE.Vector3; roof: PaletteKey }> = [];
    return BUILDINGS.map(building => {
      const latitude = roadLatitude(building.lon, 1) + building.side * building.distance / GLOBE_RADIUS;
      const point = new THREE.Vector3(...spherePoint(latitude, building.lon, 0));
      const neighbourRoofs = new Set(placed.filter(other => other.point.distanceTo(point) < NEIGHBOUR_DISTANCE).map(other => other.roof));
      const roof = weightedPick(random, ROOF_WEIGHTS, neighbourRoofs);
      placed.push({ point, roof });
      const colors: CityColors = {
        roof,
        wall: weightedPick(random, WALL_WEIGHTS),
        bush: random() < 0.7 ? 'mainTree' : 'lightTree',
        jitter: jitterAmount(random, JITTER.houses),
      };
      return { ...building, latitude, colors };
    });
  }, []);
  const planters = useMemo(() => {
    const random = seededRandom(733);
    return [0.61, 0.86].map((longitude, index) => ({
      longitude,
      latitude: roadLatitude(longitude, 1) + (index ? -4.0 : 4.0) / GLOBE_RADIUS,
      colors: { roof: 'roofWarmBrown', wall: 'wallCream', bush: random() < 0.7 ? 'mainTree' : 'lightTree', jitter: jitterAmount(random, JITTER.houses) } as CityColors,
    }));
  }, []);
  useEffect(() => {
    setObstacleGroup('houses', houses.map(house => ({ latitude: house.latitude, longitude: house.lon, radius: 3.2 })));
    return () => clearObstacleGroup('houses');
  }, [houses]);
  return <>
    {houses.map((house, index) => <CityAsset
      key={index}
      modelUrl={house.modelUrl}
      latitude={house.latitude}
      longitude={house.lon}
      scale={house.scale}
      rotation={house.rotation}
      colors={house.colors}
    />)}
    {planters.map(planter => <CityAsset
      key={`planter-${planter.longitude}`}
      modelUrl={planterUrl}
      latitude={planter.latitude}
      longitude={planter.longitude}
      scale={3.2}
      rotation={planter.longitude}
      colors={planter.colors}
      planter
    />)}
  </>;
}

function LowPolyTrees() {
  const gltf = useLoader(GLTFLoader, lowPolyTreesUrl);
  const templates = useMemo(() => {
    logMaterials('low poly trees', gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    return Array.from({ length: 12 }, (_, index) => {
      const original = gltf.scene.getObjectByName(`_${index + 1}_tree`);
      if (!original) throw new Error(`Missing low-poly tree model ${index + 1}`);
      const tree = original.clone(true);
      tree.matrix.copy(original.matrixWorld);
      tree.matrix.decompose(tree.position, tree.quaternion, tree.scale);
      tree.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const map = (Array.isArray(child.material) ? child.material[0] : child.material as THREE.MeshStandardMaterial).map;
        const baked = bakeRoles(child.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.mainTree), treeRole);
        child.geometry = baked.geometry;
        scaleRoleGeometry(child.geometry, baked.roles, 'trunk', TREE_TRUNK_SCALE);
        child.userData.roles = baked.roles;
        child.castShadow = true;
        child.receiveShadow = true;
      });
      tree.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(tree);
      const center = bounds.getCenter(new THREE.Vector3());
      const height = Math.max(0.001, bounds.max.y - bounds.min.y);
      tree.position.x -= center.x;
      tree.position.y -= bounds.min.y;
      tree.position.z -= center.z;
      const normalized = new THREE.Group();
      normalized.add(tree);
      normalized.scale.setScalar(1 / height);
      const size = bounds.getSize(new THREE.Vector3());
      normalized.userData.conifer = height / Math.max(size.x, size.z) > 2;
      normalized.userData.bush = height / Math.max(size.x, size.z) < 1.15;
      return normalized;
    });
  }, [gltf.scene]);
  const placements = useMemo(() => {
    const random = seededRandom(4242);
    // Every instance draws from the 70/10/10/10 tree palette. Variation stays
    // within each hue family, while upper and lower foliage shift in lightness.
    const paintTree = (object: THREE.Object3D) => {
      const leaves = weightedPick(random, TREE_WEIGHTS);
      const jitter = jitterAmount(random, JITTER.trees);
      const hueJitter = jitterAmount(random, 0.01);
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.material = (child.userData.roles as string[]).map(role => {
          const foliage = role.startsWith('leaves');
          const depth = role === 'leaves-upper' ? 0.05 : role === 'leaves-lower' ? -0.05 : 0;
          const key: PaletteKey = foliage ? leaves : role === 'birch' ? 'birchTrunk' : 'trunk';
          return paletteMaterial(key, {
            jitter: jitter + depth,
            hueJitter,
            roughness: 0.92,
            vertexColors: true,
          });
        });
      });
      return object;
    };
    const forest = REGIONS.find(region => region.id === 'forest')!;
    const city = REGIONS.find(region => region.id === 'city')!;
    const items: Array<{
      object: THREE.Object3D; position: [number, number, number]; orientation: THREE.Quaternion;
      rotation: number; scale: number; latitude: number; longitude: number;
    }> = [];
    for (let index = 0; index < 1400 && items.length < 130; index++) {
      const longitude = (index * 2.399963 + 0.47) % turn;
      const latitude = Math.asin(THREE.MathUtils.clamp(
        -0.9 + ((index * 73 + 29) % 181) / 181 * 1.8,
        -0.96,
        0.96,
      ));
      if (landInfluence(latitude, longitude) < 0.8 || distanceToRoadNetwork(latitude, longitude) < 6.4) continue;
      if (distanceToMountainSites(latitude, longitude) < 5.5) continue;
      if (regionInfluence(forest, latitude, longitude) > 0.28) continue;
      if (regionInfluence(city, latitude, longitude) > 0.72) continue;
      items.push({
        latitude,
        longitude,
        object: paintTree(templates[(index * 5 + 2) % templates.length].clone(true)),
        position: terrainPoint(latitude, longitude, 0.035),
        orientation: frameAt(latitude, longitude).orientation,
        rotation: (index * 1.731) % turn,
        scale: 2.4 + ((index * 37) % 23) / 23 * 1.7,
      });
    }
    let forestTrees = 0;
    for (let index = 0; index < WORLD_SETTINGS.regions.treeDensity * 8
      && forestTrees < WORLD_SETTINGS.regions.treeDensity; index++) {
      const angle = (index + 3) * 2.399963;
      const radius = 0.14 + ((index * 43 + 19) % 101) / 101 * 0.68;
      const latitude = forest.latitude + Math.sin(angle) * radius * forest.latitudeRadius;
      const longitude = forest.longitude
        + Math.cos(angle) * radius * forest.longitudeRadius / Math.max(0.35, Math.cos(forest.latitude));
      if (landInfluence(latitude, longitude) < 0.8 || distanceToRoadNetwork(latitude, longitude) < 5.1) continue;
      if (distanceToMountainSites(latitude, longitude) < 5.5) continue;
      items.push({
        latitude,
        longitude,
        object: paintTree(templates[(index * 5 + 2) % templates.length].clone(true)),
        position: terrainPoint(latitude, longitude, 0.035),
        orientation: frameAt(latitude, longitude).orientation,
        rotation: (angle * 1.31) % turn,
        scale: 2.4 + ((index * 31) % 17) / 17 * 1.7,
      });
      forestTrees++;
    }
    return items;
  }, [templates]);
  useEffect(() => () => templates.forEach(tree => tree.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
    else child.material.dispose();
  })), [templates]);
  useEffect(() => {
    // Only the trunk blocks; bushes are drive-through.
    setObstacleGroup('trees', placements
      .filter(tree => !tree.object.userData.bush)
      .map(tree => ({ latitude: tree.latitude, longitude: tree.longitude, radius: TREE_TRUNK_RADIUS })));
    return () => clearObstacleGroup('trees');
  }, [placements]);
  return <>{placements.map((tree, index) => <group key={`low-poly-tree-${index}`} position={tree.position} quaternion={tree.orientation}>
    <group rotation-y={tree.rotation} scale={tree.scale}><primitive object={tree.object} /></group>
  </group>)}</>;
}

// Spans a narrow strait away from the road; ends sit on the land on both shores.
const ROPE_BRIDGE = { from: [-0.465, 1.253], to: [-0.3898, 1.0005] } as const;

function RopeBridge() {
  const gltf = useLoader(GLTFLoader, ropeBridgeUrl);
  const placement = useMemo(() => {
    const model = gltf.scene.clone(true);
    logMaterials('rope bridge', model);
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const map = (child.material as THREE.MeshStandardMaterial).map;
      const baked = bakeRoles(child.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.trunk), () => 'wood');
      child.geometry = baked.geometry;
      child.material = roleMaterials(baked.roles, () => ({ key: 'trunk' })).map(material => { material.side = THREE.DoubleSide; return material; });
      child.castShadow = true;
      child.receiveShadow = true;
    });
    const bounds = new THREE.Box3().setFromObject(model);
    const start = new THREE.Vector3(...terrainPoint(ROPE_BRIDGE.from[0], ROPE_BRIDGE.from[1]));
    const end = new THREE.Vector3(...terrainPoint(ROPE_BRIDGE.to[0], ROPE_BRIDGE.to[1]));
    const along = end.clone().sub(start).normalize();
    const middle = start.clone().add(end).multiplyScalar(0.5);
    const upward = middle.clone().sub(new THREE.Vector3(0, -GLOBE_RADIUS, 0)).normalize();
    upward.addScaledVector(along, -upward.dot(along)).normalize();
    const side = new THREE.Vector3().crossVectors(along, upward);
    const center = bounds.getCenter(new THREE.Vector3());
    // The model spans +x with its posts' feet at the bottom of its bounds; sink them slightly.
    model.position.set(-center.x, -bounds.min.y - 0.12, -center.z);
    return {
      model,
      position: middle.toArray() as [number, number, number],
      orientation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, upward, side)),
      scale: start.distanceTo(end) / (bounds.max.x - bounds.min.x),
    };
  }, [gltf.scene]);
  return <group position={placement.position} quaternion={placement.orientation} scale={placement.scale}>
    <primitive object={placement.model} />
  </group>;
}

// A small plane that wanders the globe: gentle turns, banking, and slow altitude changes above the peaks.
const PLANE = {
  wingspan: 6.5, speed: 3.2, minAltitude: 5, maxAltitude: 7.5,
  maxTurnRate: 0.32, turnSmoothing: 0.8, altitudeSmoothing: 0.35, maxBank: 0.42, climbPitch: 0.3,
  retargetMin: 3.5, retargetMax: 8, straightChance: 0.35, propellerSpeed: 38,
};
const planeRoleColor = (role: string): { key: PaletteKey; roughness?: number } => {
  switch (role) {
    case 'body': return { key: 'carCream' };
    case 'accent': return { key: 'carBlue' };
    case 'light': return { key: 'carRed' };
    case 'tire': return { key: 'tires' };
    default: return { key: 'roadShoulder' };
  }
};

function Airplane() {
  const gltf = useLoader(GLTFLoader, planeModelUrl);
  const group = useRef<THREE.Group>(null!);
  const plane = useMemo(() => {
    const model = gltf.scene.clone(true);
    logMaterials('plane', model);
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const map = (child.material as THREE.MeshStandardMaterial).map;
      const baked = bakeRoles(child.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.carCream), planeRole);
      child.geometry = baked.geometry;
      child.material = roleMaterials(baked.roles, planeRoleColor);
      child.castShadow = true;
    });
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    model.position.sub(bounds.getCenter(new THREE.Vector3()));
    model.updateMatrixWorld(true);
    // Spin the propeller around its own hub, along the nose (+z).
    const propeller = model.getObjectByName('Propeller')!;
    const hub = propeller.parent!.worldToLocal(new THREE.Box3().setFromObject(propeller).getCenter(new THREE.Vector3()));
    const pivot = new THREE.Group();
    pivot.position.copy(hub);
    propeller.parent!.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(propeller);
    const size = bounds.getSize(new THREE.Vector3());
    return { model, pivot, scale: PLANE.wingspan / size.x };
  }, [gltf.scene]);
  const flight = useMemo(() => {
    const position = new THREE.Vector3(...sphereNormal(0.55, 2.4));
    const heading = new THREE.Vector3(0, 1, 0).cross(position).normalize();
    return { position, heading, turn: 0, turnTarget: 0.15, altitude: 6, altitudeTarget: 6, timer: 4 };
  }, []);
  const temp = useMemo(() => ({
    left: new THREE.Vector3(), basis: new THREE.Matrix4(), attitude: new THREE.Quaternion(), euler: new THREE.Euler(0, 0, 0, 'XZY'),
    next: new THREE.Vector3(), center: new THREE.Vector3(0, -GLOBE_RADIUS, 0),
  }), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const f = flight;
    f.timer -= dt;
    if (f.timer <= 0) {
      f.timer = THREE.MathUtils.lerp(PLANE.retargetMin, PLANE.retargetMax, Math.random());
      f.turnTarget = Math.random() < PLANE.straightChance ? 0 : (Math.random() * 2 - 1) * PLANE.maxTurnRate;
      f.altitudeTarget = THREE.MathUtils.lerp(PLANE.minAltitude, PLANE.maxAltitude, Math.random());
    }
    f.turn = THREE.MathUtils.damp(f.turn, f.turnTarget, PLANE.turnSmoothing, dt);
    const previousAltitude = f.altitude;
    f.altitude = THREE.MathUtils.damp(f.altitude, f.altitudeTarget, PLANE.altitudeSmoothing, dt);
    const climb = (f.altitude - previousAltitude) / dt;
    const radius = GLOBE_RADIUS + PLANET_TERRAIN.landHeight + f.altitude;
    const arc = PLANE.speed * dt / radius;
    temp.next.copy(f.position).multiplyScalar(Math.cos(arc)).addScaledVector(f.heading, Math.sin(arc));
    f.heading.multiplyScalar(Math.cos(arc)).addScaledVector(f.position, -Math.sin(arc));
    f.position.copy(temp.next).normalize();
    f.heading.applyAxisAngle(f.position, f.turn * dt);
    f.heading.addScaledVector(f.position, -f.heading.dot(f.position)).normalize();
    group.current.position.copy(f.position).multiplyScalar(radius).add(temp.center);
    temp.left.crossVectors(f.position, f.heading);
    temp.basis.makeBasis(temp.left, f.position, f.heading);
    // Left turns bank the left wing down; climbing lifts the nose.
    temp.euler.set(-THREE.MathUtils.clamp(climb * PLANE.climbPitch, -0.2, 0.2), 0, -(f.turn / PLANE.maxTurnRate) * PLANE.maxBank);
    group.current.quaternion.setFromRotationMatrix(temp.basis).multiply(temp.attitude.setFromEuler(temp.euler));
    plane.pivot.rotation.z += PLANE.propellerSpeed * dt;
  });
  return <group ref={group}><primitive object={plane.model} scale={plane.scale} /></group>;
}

function LowPolyMountains() {
  const gltf = useLoader(GLTFLoader, mountainModelUrl);
  const templates = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const original = gltf.scene.getObjectByName('Mountain');
    if (!original) throw new Error('Missing low-poly mountain model');
    const mountain = original.clone(true);
    mountain.matrix.copy(original.matrixWorld);
    mountain.matrix.decompose(mountain.position, mountain.quaternion, mountain.scale);
    mountain.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = Array.isArray(child.material)
        ? child.material.map(material => material.clone())
        : child.material.clone();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        // Mountain_A is the rock, Mountain_B the snow caps on its peaks.
        material.color.set(child.name.startsWith('Mountain_B') ? PALETTE.wallWarmWhite : PALETTE.land);
        material.roughness = 0.95;
        material.metalness = 0;
        material.flatShading = true;
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      });
      child.castShadow = true;
      child.receiveShadow = true;
    });
    mountain.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mountain);
    const center = bounds.getCenter(new THREE.Vector3());
    const height = Math.max(0.001, bounds.max.y - bounds.min.y);
    mountain.position.x -= center.x;
    mountain.position.y -= bounds.min.y;
    mountain.position.z -= center.z;
    return [1, -1].map(mirror => {
      const normalized = new THREE.Group();
      normalized.add(mirror > 0 ? mountain : mountain.clone(true));
      normalized.scale.set(mirror / height, 1 / height, 1 / height);
      return normalized;
    });
  }, [gltf.scene]);
  const placements = useMemo(() => mountainSites
    .slice(0, WORLD_SETTINGS.regions.mountainDensity)
    .map((site, index) => ({
      ...site,
      object: templates[site.variant].clone(true),
      position: terrainPoint(site.latitude, site.longitude, -0.07 * site.scale),
      orientation: frameAt(site.latitude, site.longitude).orientation,
      key: `mountain-${index}`,
    })), [templates]);
  useEffect(() => () => templates.forEach(mountain => mountain.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
    else child.material.dispose();
  })), [templates]);
  useEffect(() => {
    setObstacleGroup('mountains', placements.map(mountain => ({ latitude: mountain.latitude, longitude: mountain.longitude, radius: 2.6 * mountain.scale })));
    return () => clearObstacleGroup('mountains');
  }, [placements]);
  return <>{placements.map(mountain => <group
    key={mountain.key}
    position={mountain.position}
    quaternion={mountain.orientation}
  >
    <group rotation-y={mountain.rotation} scale={mountain.scale}>
      <primitive object={mountain.object} />
    </group>
  </group>)}</>;
}

function Coast() {
  const coast = REGIONS.find(region => region.id === 'coast')!;
  const flowers = Array.from({ length: 22 }, (_, i) => {
    const angle = i * 2.399;
    const radius = 0.24 + (i % 7) * 0.055;
    const latitude = coast.latitude + Math.sin(angle) * radius * coast.latitudeRadius;
    const longitude = coast.longitude + Math.cos(angle) * radius * coast.longitudeRadius / Math.max(0.35, Math.cos(coast.latitude));
    return { latitude, longitude, position: terrainPoint(latitude, longitude, 0.16), color: PALETTE[FLOWER_COLORS[i % FLOWER_COLORS.length]] };
  }).filter((flower, i) => i % 3 !== 0 && landInfluence(flower.latitude, flower.longitude) >= 0.8 && distanceToRoadNetwork(flower.latitude, flower.longitude) > 2.2);
  return <>
    {flowers.map((flower, i) => <mesh key={i} position={flower.position} scale={0.42}>
      <icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={flower.color} roughness={0.9} metalness={0} />
    </mesh>)}
  </>;
}

const cloudPlacements = [
  { latitude: 0.68, longitude: 0.02, altitude: 10.8, scale: [0.085, 0.068, 0.076], rotation: 0.35 },
  { latitude: -0.22, longitude: 0.92, altitude: 12.4, scale: [0.064, 0.055, 0.072], rotation: 1.7 },
  { latitude: 0.18, longitude: 1.72, altitude: 9.6, scale: [0.105, 0.076, 0.082], rotation: 2.55 },
  { latitude: -0.76, longitude: 2.34, altitude: 11.7, scale: [0.073, 0.06, 0.09], rotation: 0.92 },
  { latitude: 0.92, longitude: 2.92, altitude: 13.2, scale: [0.058, 0.05, 0.066], rotation: 2.1 },
  { latitude: 0.32, longitude: 3.66, altitude: 10.5, scale: [0.092, 0.07, 0.072], rotation: 1.25 },
  { latitude: -0.48, longitude: 4.16, altitude: 12.8, scale: [0.055, 0.047, 0.064], rotation: 2.86 },
  { latitude: 0.72, longitude: 4.78, altitude: 9.9, scale: [0.078, 0.058, 0.088], rotation: 0.58 },
  { latitude: -0.88, longitude: 5.38, altitude: 11.2, scale: [0.068, 0.052, 0.074], rotation: 1.94 },
  { latitude: 0.04, longitude: 5.92, altitude: 13.6, scale: [0.098, 0.072, 0.078], rotation: 2.42 },
] as const;

const CLOUD_DRIFT = { minSpeed: 0.003, speedRange: 0.006, foregroundSpeed: 0.02, foregroundOpacity: 0.85 };
const FOREGROUND_CLOUDS = [
  { position: [0, 40, 72] as const, scale: 0.09 },
  { position: [-26, 34, 60] as const, scale: 0.07 },
];

function CloudLayer({ zoom }: { zoom: RefObject<number> }) {
  const gltf = useLoader(GLTFLoader, cloudModelUrl);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: PALETTE.clouds, roughness: 0.95, metalness: 0, flatShading: true,
  }), []);
  const foregroundMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: PALETTE.clouds, roughness: 0.95, metalness: 0, flatShading: true,
    transparent: true, opacity: CLOUD_DRIFT.foregroundOpacity, depthWrite: false,
  }), []);
  const source = useMemo(() => {
    const model = gltf.scene.clone(true);
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = material;
      child.castShadow = false;
      child.receiveShadow = false;
    });
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    return model;
  }, [gltf.scene, material]);
  const clouds = useMemo(() => cloudPlacements.map((cloud, index) => {
    const normal = new THREE.Vector3(...spherePoint(cloud.latitude, cloud.longitude, 0)).sub(new THREE.Vector3(0, -GLOBE_RADIUS, 0)).normalize();
    const orientation = new THREE.Quaternion().setFromUnitVectors(up, normal);
    orientation.multiply(new THREE.Quaternion().setFromAxisAngle(up, cloud.rotation));
    return {
      ...cloud,
      object: source.clone(true),
      position: spherePoint(cloud.latitude, cloud.longitude, cloud.altitude),
      orientation,
      key: `cloud-${index}`,
    };
  }), [source]);
  const drift = useMemo(() => cloudPlacements.map((_, index) => (index % 2 ? -1 : 1)
    * (CLOUD_DRIFT.minSpeed + ((index * 0.37) % 1) * CLOUD_DRIFT.speedRange)), []);
  const orbits = useRef<THREE.Group[]>([]);
  const foreground = useRef<THREE.Group>(null!);
  const foregroundClouds = useMemo(() => FOREGROUND_CLOUDS.map(cloud => {
    const object = source.clone(true);
    object.traverse(child => { if (child instanceof THREE.Mesh) child.material = foregroundMaterial; });
    return { ...cloud, object };
  }), [source, foregroundMaterial]);
  useEffect(() => () => { material.dispose(); foregroundMaterial.dispose(); }, [material, foregroundMaterial]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    orbits.current.forEach((orbit, index) => { if (orbit) orbit.rotation.y += dt * drift[index]; });
    foreground.current.rotation.y += dt * CLOUD_DRIFT.foregroundSpeed;
    foregroundMaterial.opacity = CLOUD_DRIFT.foregroundOpacity * (1 - zoom.current);
  });
  return <>
    {clouds.map((cloud, index) => <group key={cloud.key} ref={el => { if (el) orbits.current[index] = el; }}>
      <group position={cloud.position} quaternion={cloud.orientation} scale={cloud.scale}>
        <primitive object={cloud.object} />
      </group>
    </group>)}
    <group ref={foreground}>
      {foregroundClouds.map((cloud, index) => <group key={`foreground-${index}`} position={cloud.position} scale={cloud.scale}>
        <primitive object={cloud.object} />
      </group>)}
    </group>
  </>;
}

export default function MiniatureWorld({ zoom }: { zoom: RefObject<number> }) {
  return <group>
    <Terrain />
    <JapaneseBridgeGarden />
    <LoopRoad />
    <LowPolyMountains /><Town /><LowPolyTrees /><Coast /><RopeBridge /><Airplane />
    <CloudLayer zoom={zoom} />
  </group>;
}
