import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLOBE_RADIUS, roadLatitude, sphereNormal, spherePoint } from './globe';
import { MOUNTAIN_SITES, REGIONS, ROAD_PATHS, WORLD_SETTINGS, distanceToRoadNetwork, isLandAt, landInfluence, regionInfluence, roadPathFrame, roadPoint, roadSurfaceElevation, terrainElevation, groundNormal, terrainPoint } from './worldMap';
import type { RoadPath } from './worldMap';
import { clearObstacleGroup, obstacleAt, setObstacleGroup } from './obstacles';
import { nightState } from './nightState';
import { PLANET_TERRAIN, planetNoise } from './planetTerrain';
import { ART_DIRECTION } from './artDirection';
import { FLOWER_COLORS, JITTER, PALETTE, ROOF_WEIGHTS, TREE_WEIGHTS, WALL_WEIGHTS, seededRandom, weightedPick } from './palette';
import type { PaletteKey } from './palette';
import type { FaceSample } from './recolor';
import { bakeRoles, houseRole, jitterAmount, logMaterials, paletteMaterial, planeRole, planterRole, roleMaterials, textureSampler, treeRole } from './recolor';
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
import treeLargeUrl from '../assets/kenny city/tree-large.obj?url';
import treeSmallUrl from '../assets/kenny city/tree-small.obj?url';
import pathStonesUrl from '../assets/kenny city/path-stones-long.obj?url';
import cloudModelUrl from '../assets/low_poly_cloud/cloud.glb?url';
import japaneseGardenUrl from '../assets/japanese_bridge_garden/bridge-garden.glb?url';
import lowPolyTreesUrl from '../assets/low_poly_trees/trees.glb?url';
import mountainModelUrl from '../assets/low_poly_mountain_free/mountain.glb?url';
import ropeBridgeUrl from '../assets/old_ropebridge_low_poly/ropebridge.glb?url';
import wellUrl from '../assets/low_poly_well/well.glb?url';
import boatUrl from '../assets/boat/temp_export.dae?url';
import swimRingUrl from '../assets/float_low_poly/float.glb?url';
import bouldersUrl from '../assets/rock_low_poly/rocks.glb?url';
import fieldUrl from '../assets/football_field_free/field.glb?url';
import islandUrl from '../assets/island/island.glb?url';
import fishingBoatUrl from '../assets/fishing_boat/boat.glb?url';
import streetLightsUrl from '../assets/simple_collection_of_low_poly_street_lights/street-lights.glb?url';
import streetPropsUrl from '../assets/simple_low_poly_street_props_v2/street-props.glb?url';
import streetWorkUrl from '../assets/simple_low_poly_street_work_stuff/scene.gltf?url';
import planeModelUrl from '../assets/low_poly_plane/plane.glb?url';
import medievalHouseUrl from '../assets/low_poly_medieval_house/scene.gltf?url';

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

const mountainSites = MOUNTAIN_SITES;

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
    const crossingGap = path.id === 'main' && nearCrossing(path.longitudeAt(t), STREET_DETAIL.crossing.depth / 2 + STREET_DETAIL.crossing.stopGap + 0.6);
    return clearOfEnds && showProceduralRoad(path, t) && !crossingGap && distance % 3.4 < 1.9;
  });
}

// Street detail: a raised, segmented curb along both edges of the asphalt (painted black and white blocks where
// the road runs through the village, plain light concrete elsewhere), solid white edge lines, and zebra
// crossings with stop lines in the village. All visual only.
const STREET_DETAIL = {
  curb: { width: 0.24, height: 0.13, samplesPerBlock: 3, concrete: '#c9c5b6', paint: ['#f2ede0', '#2f3338'] as const },
  edgeLine: { inset: 0.32, width: 0.13 },
  crossings: [1.75, 3.25], // in house spacings from the start of the village street
  crossing: { depth: 2.6, bar: 0.5, gap: 0.45, margin: 0.35, stopLine: 0.3, stopGap: 1.1 },
};
const crossingLongitudes = () => STREET_DETAIL.crossings.map(at => TOWN.fromLongitude + at * TOWN.spacing / GLOBE_RADIUS);
const nearCrossing = (longitude: number, reach: number) => crossingLongitudes()
  .some(crossing => Math.abs(Math.atan2(Math.sin(longitude - crossing), Math.cos(longitude - crossing))) * GLOBE_RADIUS < reach);

// A thin flat strip lying on the road surface, `lateral` metres from the centre line.
function buildRoadStripe(path: RoadPath, lateral: number, width: number, lift: number) {
  const positions: number[] = [];
  const side = new THREE.Vector3(), point = new THREE.Vector3();
  let previous: THREE.Vector3[] | null = null;
  for (let i = 0; i <= path.segments; i++) {
    const t = i / path.segments;
    const elevation = roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t)) + lift;
    const centre = new THREE.Vector3(...roadPoint(path, t, lift));
    side.set(...roadPathFrame(path, t).side);
    const row = [-1, 1].map(edge => snapRoadVertex(point.copy(centre).addScaledVector(side, lateral + edge * width * 0.5), elevation).clone());
    if (previous && showProceduralRoad(path, (i - 0.5) / path.segments)) {
      positions.push(...previous[0].toArray(), ...row[0].toArray(), ...previous[1].toArray());
      positions.push(...previous[1].toArray(), ...row[0].toArray(), ...row[1].toArray());
    }
    previous = row;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildCurbs(path: RoadPath) {
  const { width, height, samplesPerBlock, concrete, paint } = STREET_DETAIL.curb;
  const city = REGIONS.find(region => region.id === 'city')!;
  const positions: number[] = [];
  const colors: number[] = [];
  const concreteColor = new THREE.Color(concrete), paintColors = paint.map(hex => new THREE.Color(hex));
  const corner = (t: number, lateral: number, lift: number) => {
    const elevation = roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t)) + lift;
    const side = new THREE.Vector3(...roadPathFrame(path, t).side);
    return snapRoadVertex(new THREE.Vector3(...roadPoint(path, t, lift)).addScaledVector(side, lateral), elevation);
  };
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) => {
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray());
    for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b);
  };
  const blocks = Math.floor(path.segments / samplesPerBlock);
  for (let block = 0; block < blocks; block++) {
    const t0 = block * samplesPerBlock / path.segments;
    // Leave a hairline joint between blocks so they read as separate stones.
    const t1 = ((block + 1) * samplesPerBlock - 0.12) / path.segments;
    if (!showProceduralRoad(path, t0) || !showProceduralRoad(path, t1)) continue;
    const latitude = path.latitudeAt(t0), longitude = path.longitudeAt(t0);
    const inTown = regionInfluence(city, latitude, longitude) > 0.5;
    for (const direction of [-1, 1]) {
      const inner = direction * path.width * 0.5, outer = direction * (path.width * 0.5 + width);
      const color = inTown ? paintColors[block % 2] : concreteColor.clone().offsetHSL(0, 0, ((block * 37) % 7 - 3) * 0.008);
      const base = 0.06, top = base + height;
      const [i0, i1, o0, o1] = [corner(t0, inner, top), corner(t1, inner, top), corner(t0, outer, top), corner(t1, outer, top)];
      const [ib0, ib1, ob0, ob1] = [corner(t0, inner, base), corner(t1, inner, base), corner(t0, outer, base), corner(t1, outer, base)];
      quad(i0, i1, o1, o0, color);
      quad(ib0, ib1, i1, i0, color.clone().multiplyScalar(0.9));
      quad(o0, o1, ob1, ob0, color.clone().multiplyScalar(0.85));
      quad(ib0, i0, o0, ob0, color.clone().multiplyScalar(0.8));
      quad(i1, ib1, ob1, o1, color.clone().multiplyScalar(0.8));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Zebra crossings (bars running with the traffic) and a stop line before each, in both directions.
function buildCrossings(path: RoadPath) {
  const { depth, bar, gap, margin, stopLine, stopGap } = STREET_DETAIL.crossing;
  const positions: number[] = [];
  const lift = 0.092;
  const at = (t: number, along: number, lateral: number) => {
    const frame = roadPathFrame(path, t);
    const point = new THREE.Vector3(...roadPoint(path, t, lift))
      .addScaledVector(new THREE.Vector3(...frame.tangent), along).addScaledVector(new THREE.Vector3(...frame.side), lateral);
    return snapRoadVertex(point, roadSurfaceElevation(path.latitudeAt(t), path.longitudeAt(t)) + lift);
  };
  const rect = (t: number, along0: number, along1: number, lateral0: number, lateral1: number) => {
    const a = at(t, along0, lateral0), b = at(t, along1, lateral0), c = at(t, along1, lateral1), d = at(t, along0, lateral1);
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray());
  };
  const half = path.width * 0.5 - margin;
  for (const longitude of crossingLongitudes()) {
    const t = ((longitude / turn) % 1 + 1) % 1;
    const count = Math.floor((half * 2 + gap) / (bar + gap));
    const start = -((count * (bar + gap) - gap) / 2);
    for (let k = 0; k < count; k++) rect(t, -depth / 2, depth / 2, start + k * (bar + gap), start + k * (bar + gap) + bar);
    // Stop lines across each lane, before the crossing in its direction of travel.
    rect(t, depth / 2 + stopGap, depth / 2 + stopGap + stopLine, -half, 0);
    rect(t, -depth / 2 - stopGap - stopLine, -depth / 2 - stopGap, 0, half);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
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
    const edgeLines = [-1, 1].map(direction => buildRoadStripe(path, direction * (path.width * 0.5 - STREET_DETAIL.edgeLine.inset), STREET_DETAIL.edgeLine.width, 0.09));
    return {
      path, shoulderGeometry: facetRoadSurface(buildRoadEdges(path), 0.035, 12), shoulderWalls: buildRoadOuterWalls(path),
      asphaltGeometry: facetRoadSurface(asphalt.top, 0.05, 11, 8, 4), asphaltWalls: asphalt.walls, centerline: buildRoadLine(path),
      support: buildRoadSupport(path, path.width), curbs: buildCurbs(path), edgeLines, crossings: buildCrossings(path),
    };
  }), []);
  useEffect(() => () => {
    roads.forEach(road => {
      [road.shoulderGeometry, road.shoulderWalls, road.asphaltGeometry, road.asphaltWalls, road.centerline, road.support, road.curbs, road.crossings, ...road.edgeLines]
        .forEach(geometry => geometry.dispose());
    });
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
      {[...road.edgeLines, road.crossings].map((geometry, index) => <mesh key={`marking-${index}`} geometry={geometry} renderOrder={4}>
        <meshStandardMaterial color={roadStyle.marking} roughness={0.9} metalness={0} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
      </mesh>)}
      <mesh geometry={road.curbs} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0} flatShading />
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
        if (landInfluence(latitude, longitude) < 0.8 || distanceToRoadNetwork(latitude, longitude) < roadClearance || nearField(latitude, longitude)) continue;
        if (distanceToMountainSites(latitude, longitude) < 5.5 || nearBeach(latitude, longitude)) continue;
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

// The beach: on the east shore across the rope bridge, the land facets touching the sea turn to sand (ring 0)
// and the row behind them to a sand-grass mix (ring 1). Trees and grass keep off it; umbrellas, towels and
// loungers line the shore, turned to face the water.
// The sand runs down the bay shore from the rope bridge and on along the land's northern edge (two areas).
const BEACH = { keepClear: 3.2, areas: [[0.22, 5.34, 0.34], [0.5, 5.64, 0.3]] as Array<[number, number, number]> };
type BeachFacet = { latitude: number; longitude: number; direction: THREE.Vector3; toSea: THREE.Vector3; ring: 0 | 1 };
let beachCache: BeachFacet[] | null = null;
const facetKey = (direction: THREE.Vector3) => `${direction.x.toFixed(3)},${direction.y.toFixed(3)},${direction.z.toFixed(3)}`;

function beachFacets() {
  if (beachCache) return beachCache;
  const geometry = new THREE.IcosahedronGeometry(1, PLANET_TERRAIN.detail);
  const position = geometry.getAttribute('position');
  const vertexKey = (index: number) => `${position.getX(index).toFixed(5)},${position.getY(index).toFixed(5)},${position.getZ(index).toFixed(5)}`;
  const facets: Array<{ direction: THREE.Vector3; latitude: number; longitude: number; land: boolean; neighbours: number[] }> = [];
  const byEdge = new Map<string, number[]>();
  const areas = BEACH.areas.map(([latitude, longitude, radius]) => ({ centre: new THREE.Vector3(...sphereNormal(latitude, longitude)), radius }));
  const within = (direction: THREE.Vector3, margin: number) => areas.some(area => direction.angleTo(area.centre) < area.radius + margin);
  for (let index = 0; index < position.count; index += 3) {
    const direction = new THREE.Vector3();
    for (let k = 0; k < 3; k++) direction.add(new THREE.Vector3(position.getX(index + k), position.getY(index + k), position.getZ(index + k)));
    direction.normalize();
    const latitude = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    const longitude = Math.atan2(direction.x, direction.z);
    const near = within(direction, 0.2);
    facets.push({ direction, latitude, longitude, land: near && isLandAt(latitude, longitude), neighbours: [] });
    for (let k = 0; k < 3; k++) {
      const a = vertexKey(index + k), b = vertexKey(index + (k + 1) % 3);
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      byEdge.set(edge, [...(byEdge.get(edge) ?? []), facets.length - 1]);
    }
  }
  geometry.dispose();
  byEdge.forEach(pair => { if (pair.length === 2) { facets[pair[0]].neighbours.push(pair[1]); facets[pair[1]].neighbours.push(pair[0]); } });
  const inRegion = (index: number) => within(facets[index].direction, 0);
  const sand = new Set<number>();
  const result: BeachFacet[] = [];
  facets.forEach((facet, index) => {
    if (!facet.land || !inRegion(index)) return;
    const sea = facet.neighbours.filter(n => !facets[n].land && within(facets[n].direction, 0.2));
    if (!sea.length || distanceToRoadNetwork(facet.latitude, facet.longitude) < 6) return;
    const toSea = new THREE.Vector3();
    sea.forEach(n => toSea.add(facets[n].direction.clone().sub(facet.direction)));
    toSea.projectOnPlane(facet.direction).normalize();
    sand.add(index);
    result.push({ latitude: facet.latitude, longitude: facet.longitude, direction: facet.direction, toSea, ring: 0 });
  });
  facets.forEach((facet, index) => {
    if (!facet.land || sand.has(index) || !inRegion(index) || !facet.neighbours.some(n => sand.has(n))) return;
    result.push({ latitude: facet.latitude, longitude: facet.longitude, direction: facet.direction, toSea: new THREE.Vector3(), ring: 1 });
  });
  beachCache = result;
  return result;
}

// Sand facets by direction key, for colouring the land mesh.
function beachRings() {
  return new Map(beachFacets().map(facet => [facetKey(facet.direction), facet.ring] as const));
}

// Whether a point is on (or right by) the sand, where trees and ground cover keep off.
function nearBeach(latitude: number, longitude: number) {
  const point = new THREE.Vector3(...sphereNormal(latitude, longitude));
  return beachFacets().some(facet => point.angleTo(facet.direction) * GLOBE_RADIUS < BEACH.keepClear);
}

const BEACH_PROPS = {
  umbrellaColors: [['bridgeAccent', 'flowerCream'], ['carBlue', 'flowerCream'], ['carYellow', 'flowerCream'], ['carMint', 'flowerCream']] satisfies Array<[PaletteKey, PaletteKey]>,
  towelColors: ['carRed', 'carBlue', 'carYellow', 'carMint', 'flowerCream'] satisfies PaletteKey[],
  umbrellaRadius: 1.15, poleHeight: 1.75, tilt: 0.13, inland: 0.6, spread: 1.0,
};

function buildUmbrella(stripeA: PaletteKey, stripeB: PaletteKey) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, BEACH_PROPS.poleHeight, 6).translate(0, BEACH_PROPS.poleHeight / 2, 0), paletteMaterial('doorsTrim'));
  const canopyGeometry = new THREE.ConeGeometry(BEACH_PROPS.umbrellaRadius, 0.5, 8, 1, true).toNonIndexed().translate(0, BEACH_PROPS.poleHeight, 0);
  const a = new THREE.Color(PALETTE[stripeA]), b = new THREE.Color(PALETTE[stripeB]);
  const colors: number[] = [];
  const triangles = canopyGeometry.getAttribute('position').count / 3;
  for (let t = 0; t < triangles; t++) {
    const color = Math.floor(t / 2) % 2 ? b : a;
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  }
  canopyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const canopy = new THREE.Mesh(canopyGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }));
  for (const mesh of [pole, canopy]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
  return group;
}

function buildTowel(color: PaletteKey) {
  const towel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.04, 1.9).translate(0, 0.02, 0), paletteMaterial(color, { roughness: 1 }));
  towel.receiveShadow = true;
  return towel;
}

function buildLounger() {
  const group = new THREE.Group();
  const frame = paletteMaterial('wallWarmWhite');
  const legs = paletteMaterial('trunk');
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 1.3).translate(0, 0.34, 0.2), frame);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.75), frame);
  back.position.set(0, 0.55, -0.7);
  back.rotation.x = 0.8;
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.08).translate(0, 0.15, 0.8), legs);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.08).translate(0, 0.15, -0.4), legs);
  for (const mesh of [seat, back, front, rear]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
  return group;
}

function Beach() {
  const props = useMemo(() => {
    const placed: Array<{ object: THREE.Object3D; position: [number, number, number]; orientation: THREE.Quaternion; latitude: number; longitude: number; solid: boolean }> = [];
    beachFacets().filter(facet => facet.ring === 0).forEach((facet, index) => {
      const normal = new THREE.Vector3(...groundNormal(facet.latitude, facet.longitude));
      const forward = facet.toSea.clone().projectOnPlane(normal).normalize();
      const along = new THREE.Vector3().crossVectors(normal, forward);
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, normal, forward));
      const centre = new THREE.Vector3(...terrainPoint(facet.latitude, facet.longitude));
      const put = (object: THREE.Object3D, across: number, toward: number, yaw = 0, solid = false) => {
        const spot = toLatLon(centre.clone().addScaledVector(along, across).addScaledVector(forward, toward));
        const rotation = orientation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
        placed.push({ object, position: terrainPoint(spot.latitude, spot.longitude, 0.02), orientation: rotation, latitude: spot.latitude, longitude: spot.longitude, solid });
      };
      const [stripeA, stripeB] = BEACH_PROPS.umbrellaColors[index % BEACH_PROPS.umbrellaColors.length];
      const umbrella = buildUmbrella(stripeA, stripeB);
      umbrella.rotation.x = BEACH_PROPS.tilt;
      const umbrellaHolder = new THREE.Group();
      umbrellaHolder.add(umbrella);
      put(umbrellaHolder, -BEACH_PROPS.spread * 0.6, -BEACH_PROPS.inland, 0, true);
      if (index % 3 === 2) {
        put(buildLounger(), BEACH_PROPS.spread * 0.5, -BEACH_PROPS.inland - 0.2, Math.PI, true);
        put(buildLounger(), BEACH_PROPS.spread * 1.45, -BEACH_PROPS.inland - 0.2, Math.PI, true);
      } else {
        put(buildTowel(BEACH_PROPS.towelColors[index % BEACH_PROPS.towelColors.length]), BEACH_PROPS.spread * 0.7, -BEACH_PROPS.inland + 0.1, 0.12 * ((index % 2) * 2 - 1));
      }
    });
    return placed;
  }, []);
  useEffect(() => {
    setObstacleGroup('beach', props.filter(prop => prop.solid).map(prop => ({ latitude: prop.latitude, longitude: prop.longitude, radius: 0.5 })));
    return () => clearObstacleGroup('beach');
  }, [props]);
  useEffect(() => () => props.forEach(prop => prop.object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
  })), [props]);
  return <>{props.map((prop, index) => <group key={`beach-${index}`} position={prop.position} quaternion={prop.orientation}><primitive object={prop.object} /></group>)}</>;
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
  const sandColor = new THREE.Color(PALETTE.sand);
  const sandRings = beachRings();
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
  const keyOf = (point: THREE.Vector3) => `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`;
  const landFacets: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
  const landAtVertex = new Map<string, number>();
  for (let index = 0; index < attribute.count; index += 3) {
    a.fromBufferAttribute(attribute, index);
    b.fromBufferAttribute(attribute, index + 1);
    c.fromBufferAttribute(attribute, index + 2);
    centroid.copy(a).add(b).add(c).normalize();
    const latitude = Math.asin(THREE.MathUtils.clamp(centroid.y, -1, 1));
    const longitude = Math.atan2(centroid.x, centroid.z);
    if (!isLandAt(latitude, longitude)) continue;
    landFacets.push([a.clone(), b.clone(), c.clone(), centroid.clone()]);
    for (const point of [a, b, c]) landAtVertex.set(keyOf(point), (landAtVertex.get(keyOf(point)) ?? 0) + 1);
  }
  // Chamfer the sharp tips: where a lone land triangle forms a point in the sea (its tip vertex touches no
  // other land), the point is cut off flat, so the coast keeps its shape without needle-like corners.
  const radius = GLOBE_RADIUS + PLANET_TERRAIN.landHeight;
  const triangles: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
  landFacets.forEach(([p0, p1, p2, facetCentroid]) => {
    const corners = [p0, p1, p2];
    const tip = corners.findIndex(point => landAtVertex.get(keyOf(point)) === 1);
    if (tip < 0) { triangles.push([p0, p1, p2, facetCentroid]); return; }
    const tipPoint = corners[tip], next = corners[(tip + 1) % 3], previous = corners[(tip + 2) % 3];
    const cutNext = tipPoint.clone().lerp(next, COAST_CHAMFER).setLength(radius);
    const cutPrevious = tipPoint.clone().lerp(previous, COAST_CHAMFER).setLength(radius);
    triangles.push([cutNext, next, previous, facetCentroid], [cutNext, previous, cutPrevious, facetCentroid]);
  });
  triangles.forEach(([q0, q1, q2, facetCentroid]) => {
    topPositions.push(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z, q2.x, q2.y, q2.z);
    const variation = (planetNoise(facetCentroid.x * 7.1, facetCentroid.y * 7.1, facetCentroid.z * 7.1) - 0.5)
      * PLANET_TERRAIN.facetLightnessVariation * 2;
    const ring = sandRings.get(facetKey(facetCentroid.clone().normalize()));
    const facetColor = baseColor.clone().lerp(sandColor, ring === 0 ? 1 : ring === 1 ? 0.45 : 0).offsetHSL(0, 0, variation);
    for (let vertex = 0; vertex < 3; vertex++) topColors.push(facetColor.r, facetColor.g, facetColor.b);
    registerEdge(q0, q1, facetCentroid); registerEdge(q1, q2, facetCentroid); registerEdge(q2, q0, facetCentroid);
  });
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

// Stump/log models (almost no foliage) are drawn smaller so they sit in scale beside the trees.
const STUMP_SCALE = 0.45;
// The forest region is planted densely; the rest of the land gets the scattered trees.
const FOREST_TREES = 110;
const TREE_TRUNK_RADIUS = 0.45;

const COAST_BEVEL = 0.35;
// How much of a sharp coastal tip is cut off, as a share of its two edges.
const COAST_CHAMFER = 0.3;

// Low-poly sea: flat icosahedron facets (a little bigger than the land's) that rise and fall with a few
// slow, overlapping swells, so the facets catch the light differently as the waves roll by. The surface sits
// slightly above the coast walls' base so even the troughs never open a gap under them.
const OCEAN_WAVE = { detail: 4, lift: 0.14, amplitude: 0.1, speed: 0.55, crestTint: 0.18 };

function Ocean() {
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(GLOBE_RADIUS + OCEAN_WAVE.lift, OCEAN_WAVE.detail), []);
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
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmplitude;\nflat varying float vWave;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 dir = normalize(position);
          float t = uTime * ${OCEAN_WAVE.speed.toFixed(2)};
          float wave = sin(dir.x * 11.0 + dir.z * 4.0 + t * 1.3) * 0.45
            + sin(dir.z * 13.0 - dir.y * 6.0 - t * 1.1) * 0.35
            + sin(dir.y * 17.0 + dir.x * 9.0 + t * 1.7) * 0.2;
          vWave = wave;
          transformed += dir * wave * uAmplitude;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uShallow;\nflat varying float vWave;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, smoothstep(0.15, 0.85, vWave) * ${OCEAN_WAVE.crestTint.toFixed(2)});`);
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

// `planter` models (planters, trees) are split into foliage / soil / pot; `stone` models are drawn all in stone.
// Lit windows glow warm after dark (each house is lit or not, so the village doesn't look uniform).
const WINDOW_GLOW = { color: '#ffc77a', intensity: 2.2 };

function CityAsset({ modelUrl, latitude, longitude, scale = 3.4, orientation, colors, planter = false, stone = false, sink = 0, windowsLit = false }: {
  modelUrl: string; latitude: number; longitude: number; scale?: number; orientation: THREE.Quaternion; colors: CityColors;
  planter?: boolean; stone?: boolean; sink?: number; windowsLit?: boolean;
}) {
  const source = useLoader(OBJLoader, modelUrl);
  const texture = useLoader(THREE.TextureLoader, cityTextureUrl);
  const { model, windows } = useMemo(() => {
    const clone = source.clone(true);
    logMaterials(planter ? 'kenney planter' : 'kenney building', clone);
    const sample = textureSampler(texture);
    const windows: THREE.MeshStandardMaterial[] = [];
    clone.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const baked = bakeRoles(child.geometry, sample, stone ? () => 'stone' : planter ? planterRole : houseRole);
      child.geometry = baked.geometry;
      const materials = roleMaterials(baked.roles, cityRoleColor(colors), colors.jitter);
      if (windowsLit) baked.roles.forEach((role, index) => {
        if (role !== 'window') return;
        materials[index].emissive.set(WINDOW_GLOW.color);
        windows.push(materials[index]);
      });
      child.material = materials;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return { model: clone, windows };
  }, [source, texture, colors, planter, stone, windowsLit]);
  useFrame(() => { for (const material of windows) material.emissiveIntensity = nightState.blend * WINDOW_GLOW.intensity; });
  const position = useMemo(() => terrainPoint(latitude, longitude, 0.05 - sink), [latitude, longitude, sink]);
  useEffect(() => () => {
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
    });
  }, [model]);
  return <group position={position} quaternion={orientation}>
    <primitive object={model} scale={scale} />
  </group>;
}

// The village: houses line both sides of the road through the city region, staggered, each set back
// from the road and turned so its front (+z) faces the street. Spots whose footprint would touch water
// or the road are pushed back a little, and dropped if they still don't fit.
const TOWN = {
  fromLongitude: 0.22,
  toLongitude: 1.28,
  spacing: 7.6,
  setback: 7.6,
  setbackJitter: 0.6,
  maxPushBack: 3,
  yawJitter: 0.07,
  footprint: 2.9,
  roadGap: 1.9,
  planterSetback: 5.4,
  // Front gardens: path centre distance from the road centre, path and tree sizes, gap between house and tree.
  pathSetback: 5.3,
  pathScale: 6,
  largeTreeScale: 5,
  smallTreeScale: 5.2,
  treeGap: 1.1,
};
const HOUSE_MODELS = [
  { modelUrl: buildingAUrl, scale: 3.6 }, { modelUrl: buildingKUrl, scale: 3.5 },
  { modelUrl: buildingCUrl, scale: 3.5 }, { modelUrl: buildingNUrl, scale: 3.1 },
  { modelUrl: buildingFUrl, scale: 3.25 }, { modelUrl: buildingRUrl, scale: 3.55 },
  { modelUrl: buildingHUrl, scale: 3.7 }, { modelUrl: buildingUUrl, scale: 3.25 },
];
const NEIGHBOUR_DISTANCE = 9;

const toLatLon = (point: THREE.Vector3) => {
  const local = point.clone().setY(point.y + GLOBE_RADIUS);
  return { latitude: Math.asin(THREE.MathUtils.clamp(local.y / local.length(), -1, 1)), longitude: Math.atan2(local.x, local.z) };
};

// A spot set back `distance` from the road at longitude `roadLongitude`, facing the road.
function streetSpot(roadLongitude: number, side: number, distance: number, yaw: number) {
  const frame = roadPathFrame(ROAD_PATHS[0], roadLongitude / turn);
  const roadCenter = new THREE.Vector3(...frame.point);
  const sideVector = new THREE.Vector3(...frame.side).multiplyScalar(side);
  const { latitude, longitude } = toLatLon(roadCenter.clone().addScaledVector(sideVector, distance));
  const normal = new THREE.Vector3(...groundNormal(latitude, longitude));
  const forward = sideVector.clone().negate().projectOnPlane(normal).normalize().applyAxisAngle(normal, yaw);
  const right = new THREE.Vector3().crossVectors(normal, forward);
  const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, normal, forward));
  return { latitude, longitude, orientation };
}

function footprintFits(latitude: number, longitude: number, radius: number) {
  for (let k = 0; k <= 8; k++) {
    const angle = k * Math.PI / 4;
    const reach = k === 8 ? 0 : radius / GLOBE_RADIUS;
    const sampleLatitude = latitude + Math.sin(angle) * reach;
    const sampleLongitude = longitude + Math.cos(angle) * reach / Math.max(0.3, Math.cos(latitude));
    if (landInfluence(sampleLatitude, sampleLongitude) < 0.75) return false;
    if (distanceToRoadNetwork(sampleLatitude, sampleLongitude) < TOWN.roadGap) return false;
  }
  return true;
}

// How far the ground under a building's footprint drops below its centre (the land is flat facets, so a wide
// base can hang over a facet edge or the coast bevel). Samples the corners and edge midpoints of a
// halfWidth × halfDepth rectangle in the building's own frame; returns the largest drop (>= 0).
function footprintDrop(latitude: number, longitude: number, orientation: THREE.Quaternion, halfWidth: number, halfDepth: number) {
  const centre = new THREE.Vector3(...terrainPoint(latitude, longitude));
  const normal = new THREE.Vector3(...groundNormal(latitude, longitude));
  const offset = new THREE.Vector3();
  let drop = 0;
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    offset.set(x * halfWidth, 0, z * halfDepth).applyQuaternion(orientation);
    const sample = toLatLon(centre.clone().add(offset));
    const ground = new THREE.Vector3(...terrainPoint(sample.latitude, sample.longitude));
    drop = Math.max(drop, -ground.sub(centre).dot(normal));
  }
  return drop;
}
const HOUSE_HALF_EXTENT = { width: 3.1, depth: 2.4 };
// A spot whose footprint drops more than this (over water or down the coast wall) is rejected.
const MAX_FOOTPRINT_DROP = 0.45;

function Town() {
  const { houses, planters, paths, trees } = useMemo(() => {
    const random = seededRandom(1207);
    const placed: Array<{ point: THREE.Vector3; roof: PaletteKey }> = [];
    const houses: Array<{ modelUrl: string; scale: number; latitude: number; longitude: number; orientation: THREE.Quaternion; colors: CityColors; sink: number; windowsLit: boolean }> = [];
    const gaps: Array<{ longitude: number; side: number }> = [];
    const paths: Array<{ latitude: number; longitude: number; orientation: THREE.Quaternion; sink: number }> = [];
    const trees: Array<{ latitude: number; longitude: number; orientation: THREE.Quaternion; modelUrl: string; scale: number; colors: CityColors }> = [];
    const step = TOWN.spacing / GLOBE_RADIUS;
    let modelIndex = 0;
    for (const side of [1, -1]) {
      for (let roadLongitude = TOWN.fromLongitude + (side < 0 ? step / 2 : 0); roadLongitude <= TOWN.toLongitude; roadLongitude += step) {
        const base = TOWN.setback + (random() * 2 - 1) * TOWN.setbackJitter;
        const yaw = (random() * 2 - 1) * TOWN.yawJitter;
        let spot = null;
        for (let push = 0; push <= TOWN.maxPushBack && !spot; push += 1) {
          const candidate = streetSpot(roadLongitude, side, base + push, yaw);
          if (!footprintFits(candidate.latitude, candidate.longitude, TOWN.footprint)) continue;
          const drop = footprintDrop(candidate.latitude, candidate.longitude, candidate.orientation, HOUSE_HALF_EXTENT.width, HOUSE_HALF_EXTENT.depth);
          if (drop <= MAX_FOOTPRINT_DROP) spot = { ...candidate, sink: drop };
        }
        if (!spot) { gaps.push({ longitude: roadLongitude, side }); continue; }
        const point = new THREE.Vector3(...spherePoint(spot.latitude, spot.longitude, 0));
        const neighbourRoofs = new Set(placed.filter(other => other.point.distanceTo(point) < NEIGHBOUR_DISTANCE).map(other => other.roof));
        const roof = weightedPick(random, ROOF_WEIGHTS, neighbourRoofs);
        placed.push({ point, roof });
        // Front garden: a stone path from the road to the door, a large tree beside the house, and on every
        // other house a small tree on the far side too. Each is only placed if it sits on land clear of the road.
        const house = spot;
        const besideHouse = (across: number, back: number) => {
          const centre = new THREE.Vector3(...terrainPoint(house.latitude, house.longitude));
          return toLatLon(centre.add(new THREE.Vector3(across, 0, back).applyQuaternion(house.orientation)));
        };
        const path = streetSpot(roadLongitude, side, TOWN.pathSetback, yaw);
        if (landInfluence(path.latitude, path.longitude) >= 0.75 && distanceToRoadNetwork(path.latitude, path.longitude) > 1.2) {
          paths.push({ ...path, sink: footprintDrop(path.latitude, path.longitude, path.orientation, 0.5, 1.2) });
        }
        const treeSide = random() < 0.5 ? 1 : -1;
        const gardenTrees: Array<[number, string, number]> = [[treeSide, treeLargeUrl, TOWN.largeTreeScale]];
        if (houses.length % 2 === 0) gardenTrees.push([-treeSide, treeSmallUrl, TOWN.smallTreeScale]);
        for (const [across, modelUrl, scale] of gardenTrees) {
          const at = besideHouse(across * (HOUSE_HALF_EXTENT.width + TOWN.treeGap), -0.8 - random() * 0.8);
          if (!footprintFits(at.latitude, at.longitude, 0.8)) continue;
          trees.push({ ...at, modelUrl, scale: scale * (0.9 + random() * 0.2), orientation: frameAt(at.latitude, at.longitude).orientation, colors: { roof: 'roofWarmBrown', wall: 'wallCream', bush: random() < 0.6 ? 'mainTree' : 'darkTree', jitter: jitterAmount(random, JITTER.trees) } });
        }
        houses.push({
          ...HOUSE_MODELS[modelIndex++ % HOUSE_MODELS.length],
          ...spot,
          windowsLit: (houses.length * 7 + 3) % 4 !== 0,
          colors: {
            roof,
            wall: weightedPick(random, WALL_WEIGHTS),
            bush: random() < 0.7 ? 'mainTree' : 'lightTree',
            jitter: jitterAmount(random, JITTER.houses),
          },
        });
      }
    }
    // Planters sit by the road at the start and end of the street, and in any spot left without a house.
    const planterSpots = [
      { longitude: TOWN.fromLongitude - step * 0.6, side: 1 },
      { longitude: TOWN.toLongitude + step * 0.2, side: -1 },
      ...gaps,
    ];
    const planters = planterSpots.map(({ longitude, side }) => {
      const spot = streetSpot(longitude, side, TOWN.planterSetback, 0);
      return {
        ...spot,
        sink: footprintDrop(spot.latitude, spot.longitude, spot.orientation, 1.2, 1.2),
        colors: { roof: 'roofWarmBrown', wall: 'wallCream', bush: random() < 0.7 ? 'mainTree' : 'lightTree', jitter: jitterAmount(random, JITTER.houses) } as CityColors,
      };
    }).filter(planter => footprintFits(planter.latitude, planter.longitude, 1) && planter.sink <= MAX_FOOTPRINT_DROP && !nearField(planter.latitude, planter.longitude));
    return { houses, planters, paths, trees };
  }, []);
  useEffect(() => {
    setObstacleGroup('houses', houses.map(house => ({ latitude: house.latitude, longitude: house.longitude, radius: 3.2 })));
    setObstacleGroup('town-trees', trees.map(tree => ({ latitude: tree.latitude, longitude: tree.longitude, radius: TREE_TRUNK_RADIUS })));
    return () => { clearObstacleGroup('houses'); clearObstacleGroup('town-trees'); };
  }, [houses, trees]);
  return <>
    {houses.map((house, index) => <CityAsset
      key={index}
      modelUrl={house.modelUrl}
      latitude={house.latitude}
      longitude={house.longitude}
      scale={house.scale}
      orientation={house.orientation}
      colors={house.colors}
      sink={house.sink}
      windowsLit={house.windowsLit}
    />)}
    {planters.map((planter, index) => <CityAsset
      key={`planter-${index}`}
      modelUrl={planterUrl}
      latitude={planter.latitude}
      longitude={planter.longitude}
      scale={3.2}
      orientation={planter.orientation}
      colors={planter.colors}
      sink={planter.sink}
      planter
    />)}
    {paths.map((path, index) => <CityAsset
      key={`path-${index}`}
      modelUrl={pathStonesUrl}
      latitude={path.latitude}
      longitude={path.longitude}
      scale={TOWN.pathScale}
      orientation={path.orientation}
      colors={{ roof: 'roofWarmBrown', wall: 'wallCream', bush: 'mainTree', jitter: 0 }}
      sink={path.sink}
      stone
    />)}
    {trees.map((tree, index) => <CityAsset
      key={`town-tree-${index}`}
      modelUrl={tree.modelUrl}
      latitude={tree.latitude}
      longitude={tree.longitude}
      scale={tree.scale}
      orientation={tree.orientation}
      colors={tree.colors}
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
      let leafFaces = 0, allFaces = 0;
      tree.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const map = (Array.isArray(child.material) ? child.material[0] : child.material as THREE.MeshStandardMaterial).map;
        const baked = bakeRoles(child.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.mainTree), treeRole);
        child.geometry = baked.geometry;
        baked.geometry.groups.forEach(group => {
          allFaces += group.count;
          if (baked.roles[group.materialIndex!].startsWith('leaves')) leafFaces += group.count;
        });
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
      normalized.userData.stump = leafFaces / Math.max(allFaces, 1) < 0.15;
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
      if (distanceToMountainSites(latitude, longitude) < 5.5 || nearBeach(latitude, longitude)) continue;
      if (Math.hypot(latitude - WELL.latitude, (longitude - WELL.longitude) * Math.cos(latitude)) * GLOBE_RADIUS < 3) continue;
      if (regionInfluence(forest, latitude, longitude) > 0.28 || nearField(latitude, longitude)) continue;
      if (regionInfluence(city, latitude, longitude) > 0.72) continue;
      items.push({
        latitude,
        longitude,
        object: paintTree(templates[(index * 5 + 2) % templates.length].clone(true)),
        position: terrainPoint(latitude, longitude, 0.035),
        orientation: frameAt(latitude, longitude).orientation,
        rotation: (index * 1.731) % turn,
        scale: (2.4 + ((index * 37) % 23) / 23 * 1.7) * (templates[(index * 5 + 2) % templates.length].userData.stump ? STUMP_SCALE : 1),
      });
    }
    let forestTrees = 0;
    for (let index = 0; index < FOREST_TREES * 8 && forestTrees < FOREST_TREES; index++) {
      const angle = (index + 3) * 2.399963;
      const radius = 0.14 + ((index * 43 + 19) % 101) / 101 * 0.68;
      const latitude = forest.latitude + Math.sin(angle) * radius * forest.latitudeRadius;
      const longitude = forest.longitude
        + Math.cos(angle) * radius * forest.longitudeRadius / Math.max(0.35, Math.cos(forest.latitude));
      if (landInfluence(latitude, longitude) < 0.8 || distanceToRoadNetwork(latitude, longitude) < 5.1 || nearField(latitude, longitude)) continue;
      if (distanceToMountainSites(latitude, longitude) < 5.5 || nearBeach(latitude, longitude)) continue;
      items.push({
        latitude,
        longitude,
        object: paintTree(templates[(index * 5 + 2) % templates.length].clone(true)),
        position: terrainPoint(latitude, longitude, 0.035),
        orientation: frameAt(latitude, longitude).orientation,
        rotation: (angle * 1.31) % turn,
        scale: (2.4 + ((index * 31) % 17) / 17 * 1.7) * (templates[(index * 5 + 2) % templates.length].userData.stump ? STUMP_SCALE : 1),
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
// Spans the strait between the northern peninsula and the eastern shore, in plain view from the intro camera.
// Long spans stretch the model lengthwise only, so the posts and deck keep their natural size.
const ROPE_BRIDGE = { from: [0.75, 5.023], to: [0.495, 5.352], naturalLength: 7.5 } as const;

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
    const lengthScale = start.distanceTo(end) / (bounds.max.x - bounds.min.x);
    const crossScale = Math.min(lengthScale, ROPE_BRIDGE.naturalLength / (bounds.max.x - bounds.min.x));
    return {
      model,
      position: middle.toArray() as [number, number, number],
      orientation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, upward, side)),
      scale: [lengthScale, crossScale, crossScale] as [number, number, number],
    };
  }, [gltf.scene]);
  return <group position={placement.position} quaternion={placement.orientation} scale={placement.scale}>
    <primitive object={placement.model} />
  </group>;
}

// A stone well in the open meadow of the northern peninsula; solid like the houses.
const WELL = { latitude: 0.8, longitude: 4.35, height: 4.2, rotation: 0.6, radius: 2.2 } as const;
const wellRoleColor = (name: string): PaletteKey => {
  if (name.startsWith('plane')) return 'roofAccent';
  if (name.startsWith('stone')) return 'roadShoulder';
  if (name === 'water' || name.startsWith('blue')) return 'oceanDeep';
  if (name.startsWith('grey')) return 'roadShoulder';
  if (name.startsWith('dark')) return 'tires';
  if (name === 'wood2' || name === 'Material.001') return 'doorsTrim';
  return 'trunk';
};

function Well() {
  const gltf = useLoader(GLTFLoader, wellUrl);
  const placement = useMemo(() => {
    const model = gltf.scene.clone(true);
    logMaterials('well', model);
    // The model's water is a wide flat disc below everything else: it set the model's bottom, so the stone ring
    // floated above the ground. It is left out, and the well stands on its stones.
    const water: THREE.Object3D[] = [];
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const name = (child.material as THREE.Material).name;
      if (name === 'water') { water.push(child); return; }
      child.material = paletteMaterial(wellRoleColor(name), { jitter: name === 'wood3' ? 0.04 : name === 'plane2' ? -0.06 : 0 });
      child.castShadow = true;
      child.receiveShadow = true;
    });
    water.forEach(child => child.removeFromParent());
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);
    return {
      model,
      position: terrainPoint(WELL.latitude, WELL.longitude, -0.6),
      orientation: frameAt(WELL.latitude, WELL.longitude).orientation,
      scale: WELL.height / (bounds.max.y - bounds.min.y),
    };
  }, [gltf.scene]);
  useEffect(() => {
    setObstacleGroup('well', [{ latitude: WELL.latitude, longitude: WELL.longitude, radius: WELL.radius }]);
    return () => clearObstacleGroup('well');
  }, []);
  return <group position={placement.position} quaternion={placement.orientation}>
    <group rotation-y={WELL.rotation} scale={placement.scale}><primitive object={placement.model} /></group>
  </group>;
}

// A small medieval cottage in the meadow between the football pitch and the well.
// Keep its supplied textured material; bend its broad footprint to follow the globe.
const MEADOW_HOUSE = { latitude: 0.22, longitude: 5.53, height: 3.8, rotation: -0.45, radius: 3.4 } as const;

function MeadowHouse() {
  const gltf = useLoader(GLTFLoader, medievalHouseUrl);
  const placement = useMemo(() => {
    const model = gltf.scene.clone(true);
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = 0.9;
          material.metalness = 0;
        }
      });
    });
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);
    // The model is wider than it is deep; its front faces toward the nearby open meadow.
    const scale = MEADOW_HOUSE.height / size.y;
    const object = bendToGlobe(model, MEADOW_HOUSE.rotation, scale);
    return {
      object,
      position: terrainPoint(MEADOW_HOUSE.latitude, MEADOW_HOUSE.longitude, 0.04),
      orientation: frameAt(MEADOW_HOUSE.latitude, MEADOW_HOUSE.longitude).orientation,
    };
  }, [gltf.scene]);
  useEffect(() => {
    setObstacleGroup('meadow-house', [{ latitude: MEADOW_HOUSE.latitude, longitude: MEADOW_HOUSE.longitude, radius: MEADOW_HOUSE.radius }]);
    return () => clearObstacleGroup('meadow-house');
  }, []);
  return <group position={placement.position} quaternion={placement.orientation}><primitive object={placement.object} /></group>;
}

// Street furniture from the two "simple low poly" packs, used sparingly: classic lamps along the village
// street, at both ends of the road bridge and by the beach, plus a few benches, bins and mailboxes. At night
// the lamp heads light up with a small halo and a faceted pool of warm light on the ground beneath them.
const STREET = {
  lampScale: 1.3, lampSetback: 4.5, propScale: 1.1, benchSetback: 5.3, mailboxSetback: 4.7,
  lampColor: '#ffc27a', headGlow: 1.9,
  // Six faint, closely spaced steps fading to nothing: velvety and soft, yet still faceted like the world.
  pool: { radii: [0.8, 1.4, 2.0, 2.6, 3.2, 3.8], strength: [0.15, 0.125, 0.095, 0.066, 0.038, 0.015], segments: 12, lift: 0.06 },
};

type PropTemplate = { object: THREE.Object3D; head: THREE.Vector3 };

// One model from a pack, re-based so its foot (a lamp's pole base) sits at the origin, with the
// position of its top (a lamp's head) measured relative to that foot.
function extractStreetProp(scene: THREE.Object3D, name: string, prepare: (mesh: THREE.Mesh) => void): PropTemplate {
  scene.updateMatrixWorld(true);
  // GLTFLoader strips dots and other reserved characters from node names ("cono.004" loads as "cono004").
  const original = scene.getObjectByName(name) ?? scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  if (!original) throw new Error(`Missing street prop ${name}`);
  const object = original.clone(true);
  original.matrixWorld.decompose(object.position, object.quaternion, object.scale);
  const holder = new THREE.Group();
  holder.add(object);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const height = box.max.y - box.min.y;
  const foot = new THREE.Vector3(), top = new THREE.Vector3(), vertex = new THREE.Vector3();
  let footCount = 0, topCount = 0;
  holder.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      if (vertex.y < box.min.y + height * 0.12) { foot.add(vertex); footCount++; }
      if (vertex.y > box.max.y - height * 0.18) { top.add(vertex); topCount++; }
    }
    prepare(child);
    child.castShadow = true;
    child.receiveShadow = true;
  });
  foot.divideScalar(Math.max(footCount, 1));
  top.divideScalar(Math.max(topCount, 1));
  object.position.x -= foot.x; object.position.y -= box.min.y; object.position.z -= foot.z;
  return { object: holder, head: new THREE.Vector3(top.x - foot.x, top.y - box.min.y, top.z - foot.z) };
}

function streetPropRole({ hue, saturation, lightness }: FaceSample): PaletteKey {
  if (saturation > 0.3) {
    if (hue >= 15 && hue < 45 && lightness < 0.6) return 'trunk';
    if (hue < 15 || hue >= 340) return 'carRed';
    if (hue < 65) return 'carYellow';
    if (hue < 170) return 'mainTree';
    if (hue < 260) return 'carBlue';
    return 'bridgeAccent';
  }
  if (lightness > 0.75) return 'wallWarmWhite';
  if (lightness < 0.3) return 'tires';
  return 'roadShoulder';
}

function buildLightPool() {
  const { radii, strength, segments, lift } = STREET.pool;
  const warm = new THREE.Color(STREET.lampColor);
  const positions: number[] = [];
  const colors: number[] = [];
  const at = (radius: number, k: number) => [Math.cos(k / segments * Math.PI * 2) * radius, lift, Math.sin(k / segments * Math.PI * 2) * radius];
  const face = (a: number[], b: number[], c: number[], level: number) => {
    positions.push(...a, ...b, ...c);
    const color = warm.clone().multiplyScalar(strength[level]);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  for (let k = 0; k < segments; k++) {
    face([0, lift, 0], at(radii[0], k + 1), at(radii[0], k), 0);
    for (let ring = 1; ring < radii.length; ring++) {
      face(at(radii[ring - 1], k), at(radii[ring - 1], k + 1), at(radii[ring], k), ring);
      face(at(radii[ring - 1], k + 1), at(radii[ring], k + 1), at(radii[ring], k), ring);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function StreetFurniture() {
  const lightsGltf = useLoader(GLTFLoader, streetLightsUrl);
  const propsGltf = useLoader(GLTFLoader, streetPropsUrl);
  const shared = useMemo(() => {
    const lampHead = new THREE.MeshStandardMaterial({ color: PALETTE.flowerCream, emissive: STREET.lampColor, emissiveIntensity: 0, roughness: 0.6, flatShading: true });
    const pole = paletteMaterial('tires', { roughness: 0.7 });
    const pool = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,214,150,0.8)');
    gradient.addColorStop(0.25, 'rgba(255,190,120,0.35)');
    gradient.addColorStop(0.6, 'rgba(255,170,100,0.1)');
    gradient.addColorStop(1, 'rgba(255,160,90,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const glow = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    return { lampHead, pole, pool, glow, poolGeometry: buildLightPool() };
  }, []);
  const templates = useMemo(() => {
    const lamp = (name: string) => extractStreetProp(lightsGltf.scene, name, mesh => {
      mesh.material = (mesh.material as THREE.Material).name === 'white_emiting' ? shared.lampHead : shared.pole;
    });
    const prop = (name: string) => extractStreetProp(propsGltf.scene, name, mesh => {
      const map = (mesh.material as THREE.MeshStandardMaterial).map;
      const baked = bakeRoles(mesh.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.roadShoulder), streetPropRole);
      mesh.geometry = baked.geometry;
      mesh.material = roleMaterials(baked.roles, role => ({ key: role as PaletteKey }));
    });
    return {
      townLamp: lamp('classic_street_light_2'),
      beachLamp: lamp('street_light_2'),
      bench: prop('banco_x_3_smooth'),
      bin: prop('papelera_smooth_support'),
      mailbox: prop('correos_yellow'),
    };
  }, [lightsGltf.scene, propsGltf.scene, shared]);
  const placed = useMemo(() => {
    type Item = { object: THREE.Object3D; position: [number, number, number]; orientation: THREE.Quaternion; latitude: number; longitude: number; radius: number };
    const items: Item[] = [];
    const pools: Array<{ position: [number, number, number]; orientation: THREE.Quaternion }> = [];
    const glows: Array<[number, number, number]> = [];
    const step = TOWN.spacing / GLOBE_RADIUS;
    const onLand = (latitude: number, longitude: number) => landInfluence(latitude, longitude) >= 0.75;
    const put = (template: PropTemplate, spot: { latitude: number; longitude: number; orientation: THREE.Quaternion }, scale: number, yaw: number, radius: number) => {
      if (!onLand(spot.latitude, spot.longitude)) return undefined;
      const object = template.object.clone(true);
      const holder = new THREE.Group();
      holder.add(object);
      object.rotation.y = yaw;
      holder.scale.setScalar(scale);
      items.push({ object: holder, position: terrainPoint(spot.latitude, spot.longitude, 0.02), orientation: spot.orientation, latitude: spot.latitude, longitude: spot.longitude, radius });
      return items[items.length - 1];
    };
    const lampAt = (template: PropTemplate, spot: { latitude: number; longitude: number; orientation: THREE.Quaternion }) => {
      // Turn the lamp so its arm (head offset) reaches toward local +z, over the road.
      const arm = Math.atan2(template.head.x, template.head.z);
      const item = put(template, spot, STREET.lampScale, -arm, 0.35);
      if (!item) return;
      const reach = Math.hypot(template.head.x, template.head.z) * STREET.lampScale;
      const base = new THREE.Vector3(...item.position);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(spot.orientation);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(spot.orientation);
      const head = base.clone().addScaledVector(up, template.head.y * STREET.lampScale - 0.15).addScaledVector(forward, reach);
      glows.push(head.toArray() as [number, number, number]);
      const below = toLatLon(head);
      const onRoad = distanceToRoadNetwork(below.latitude, below.longitude) < 1.2;
      const ground = onRoad
        ? spherePoint(below.latitude, below.longitude, roadSurfaceElevation(below.latitude, below.longitude))
        : terrainPoint(below.latitude, below.longitude);
      const normal = new THREE.Vector3(...sphereNormal(below.latitude, below.longitude));
      pools.push({ position: ground, orientation: new THREE.Quaternion().setFromUnitVectors(up.set(0, 1, 0), normal) });
    };
    // Village street: lamps on alternating sides between the houses.
    [[1, 1.5], [-1, 2], [1, 3.5], [-1, 4]].forEach(([side, at]) => {
      lampAt(templates.townLamp, streetSpot(TOWN.fromLongitude + step * at - step / 2, side, STREET.lampSetback, 0));
    });
    // Road bridge: one lamp at each end, on opposite sides.
    const bridgeEnd = WORLD_SETTINGS.roads.bridgeDeckHalfSpan + 0.035;
    lampAt(templates.townLamp, streetSpot(WORLD_SETTINGS.roads.bridgeLongitude - bridgeEnd, 1, STREET.lampSetback, 0));
    lampAt(templates.townLamp, streetSpot(WORLD_SETTINGS.roads.bridgeLongitude + bridgeEnd, -1, STREET.lampSetback, 0));
    // Benches with a bin beside them, and a mailbox by two front paths.
    [[1, 1], [-1, 3.5]].forEach(([side, at]) => {
      const roadLongitude = TOWN.fromLongitude + step * at;
      put(templates.bench, streetSpot(roadLongitude, side, STREET.benchSetback, 0), STREET.propScale, Math.PI / 2, 0.9);
      put(templates.bin, streetSpot(roadLongitude + 1.9 / GLOBE_RADIUS, side, STREET.benchSetback, 0), STREET.propScale, 0, 0.4);
    });
    [[1, 0], [-1, 2.5]].forEach(([side, at]) => {
      put(templates.mailbox, streetSpot(TOWN.fromLongitude + step * at + 1.5 / GLOBE_RADIUS, side, STREET.mailboxSetback, 0), STREET.propScale, 0, 0.4);
    });
    // Beach: a lamp where the rope bridge lands, and a bench with a bin looking out to sea.
    const shore = beachFacets().filter(facet => facet.ring === 0);
    const landing = toLatLon(new THREE.Vector3(...terrainPoint(ROPE_BRIDGE.to[0], ROPE_BRIDGE.to[1])));
    lampAt(templates.beachLamp, { ...landing, latitude: landing.latitude - 1.6 / GLOBE_RADIUS, orientation: frameAt(landing.latitude - 1.6 / GLOBE_RADIUS, landing.longitude).orientation });
    if (shore.length > 1) {
      const facet = shore[1];
      const normal = new THREE.Vector3(...groundNormal(facet.latitude, facet.longitude));
      const forward = facet.toSea.clone().projectOnPlane(normal).normalize();
      const along = new THREE.Vector3().crossVectors(normal, forward);
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, normal, forward));
      const centre = new THREE.Vector3(...terrainPoint(facet.latitude, facet.longitude));
      const spotAt = (across: number) => ({ ...toLatLon(centre.clone().addScaledVector(forward, -2.6).addScaledVector(along, across)), orientation });
      put(templates.bench, spotAt(0), STREET.propScale, Math.PI / 2, 0.9);
      put(templates.bin, spotAt(1.9), STREET.propScale, 0, 0.4);
    }
    return { items, pools, glows };
  }, [templates]);
  useEffect(() => {
    setObstacleGroup('street', placed.items.map(item => ({ latitude: item.latitude, longitude: item.longitude, radius: item.radius })));
    return () => clearObstacleGroup('street');
  }, [placed]);
  useEffect(() => () => {
    shared.lampHead.dispose(); shared.pole.dispose(); shared.pool.dispose(); shared.poolGeometry.dispose();
    shared.glow.map?.dispose(); shared.glow.dispose();
  }, [shared]);
  const glowGroup = useRef<THREE.Group>(null!);
  useFrame(() => {
    const n = nightState.blend;
    shared.lampHead.emissiveIntensity = n * 3.4;
    shared.pool.opacity = n;
    shared.glow.opacity = n * 0.8;
    glowGroup.current.visible = n > 0.01;
  });
  return <>
    {placed.items.map((item, index) => <group key={`street-${index}`} position={item.position} quaternion={item.orientation}><primitive object={item.object} /></group>)}
    <group ref={glowGroup}>
      {placed.pools.map((pool, index) => <mesh key={`pool-${index}`} geometry={shared.poolGeometry} material={shared.pool} position={pool.position} quaternion={pool.orientation} renderOrder={2} />)}
      {placed.glows.map((position, index) => <sprite key={`glow-${index}`} material={shared.glow} position={position} scale={[STREET.headGlow, STREET.headGlow, 1]} />)}
    </group>
  </>;
}

// A compact roadworks detail on the town road: two barriers and a pair of cones,
// kept on the verge so they add life without narrowing the drivable lane.
const STREET_WORK = { roadLongitudes: [0.45, 0.59], side: -1, setback: 5.35, barrierScale: 0.85, coneScale: 0.9 } as const;

function StreetWork() {
  const gltf = useLoader(GLTFLoader, streetWorkUrl);
  const placed = useMemo(() => {
    const prepare = (mesh: THREE.Mesh) => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const map = (material as THREE.MeshStandardMaterial).map;
      const baked = bakeRoles(mesh.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.roadShoulder), streetPropRole);
      mesh.geometry = baked.geometry;
      mesh.material = roleMaterials(baked.roles, role => ({ key: role as PaletteKey }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    };
    const barrier = extractStreetProp(gltf.scene, 'valla_nueva', prepare);
    const cone = extractStreetProp(gltf.scene, 'cono.004', prepare);
    const items: Array<{ object: THREE.Object3D; position: [number, number, number]; orientation: THREE.Quaternion; latitude: number; longitude: number }> = [];
    const place = (template: PropTemplate, roadLongitude: number, setback: number, scale: number, yaw: number) => {
      const spot = streetSpot(roadLongitude, STREET_WORK.side, setback, 0);
      if (landInfluence(spot.latitude, spot.longitude) < 0.75) return;
      const object = template.object.clone(true);
      object.rotation.y = yaw;
      object.scale.setScalar(scale);
      items.push({ object, position: terrainPoint(spot.latitude, spot.longitude, 0.035), orientation: spot.orientation, latitude: spot.latitude, longitude: spot.longitude });
    };
    STREET_WORK.roadLongitudes.forEach(longitude => place(barrier, longitude, STREET_WORK.setback, STREET_WORK.barrierScale, Math.PI / 2));
    place(cone, STREET_WORK.roadLongitudes[0] - 0.065, STREET_WORK.setback + 0.35, STREET_WORK.coneScale, 0);
    place(cone, STREET_WORK.roadLongitudes[1] + 0.065, STREET_WORK.setback + 0.35, STREET_WORK.coneScale, 0);
    return items;
  }, [gltf.scene]);
  useEffect(() => {
    setObstacleGroup('street-work', placed.map(item => ({ latitude: item.latitude, longitude: item.longitude, radius: 0.35 })));
    return () => clearObstacleGroup('street-work');
  }, [placed]);
  return <>{placed.map((item, index) => <group key={`street-work-${index}`} position={item.position} quaternion={item.orientation}><primitive object={item.object} /></group>)}</>;
}

// A wooden rowboat moored a few metres off the sunbathing beach. It rides the same swells as the sea shader:
// it lifts with the average swell under its hull and tips with the water's slope from bow to stern and side to
// side (exaggerated a little), with a slow rocking on top, and it drifts round its mooring and swings its bow.
const BOAT = {
  latitude: 0.22, longitude: 5.16, length: 5.6, beam: 1.7, draft: 0.05, heading: 0.8,
  waveFollow: 1.8, heave: 0.06, roll: 0.075, pitch: 0.04, rollPeriod: 3.3, pitchPeriod: 5.1,
  drift: [0.8, 0.5], driftSpeed: [0.11, 0.07], swing: 0.25, swingSpeed: 0.09,
};

// Height of the sea's swell at a direction from the planet centre, matching the Ocean vertex shader.
function oceanSwell(direction: THREE.Vector3, time: number) {
  const t = time * OCEAN_WAVE.speed;
  const wave = Math.sin(direction.x * 11 + direction.z * 4 + t * 1.3) * 0.45
    + Math.sin(direction.z * 13 - direction.y * 6 - t * 1.1) * 0.35
    + Math.sin(direction.y * 17 + direction.x * 9 + t * 1.7) * 0.2;
  return GLOBE_RADIUS + OCEAN_WAVE.lift + wave * OCEAN_WAVE.amplitude;
}

function Boat() {
  const collada = useLoader(ColladaLoader, boatUrl);
  const group = useRef<THREE.Group>(null!);
  const model = useMemo(() => {
    const boat = collada!.scene.clone(true);
    const shade: Record<string, number> = { material_1: -0.12, __auto_1: 0, material_2: 0.08 };
    boat.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const name = (Array.isArray(child.material) ? child.material[0] : child.material).name;
      child.material = paletteMaterial('trunk', { jitter: shade[name] ?? 0, side: THREE.DoubleSide });
      child.castShadow = true;
      child.receiveShadow = true;
    });
    boat.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(boat);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(boat);
    boat.position.set(-centre.x, -bounds.min.y, -centre.z);
    // Lengthwise along local z, sitting `draft` deep in the water.
    if (size.x > size.z) holder.rotation.y = Math.PI / 2;
    holder.scale.setScalar(BOAT.length / Math.max(size.x, size.z));
    holder.position.y = -BOAT.draft;
    return holder;
  }, [collada]);
  const mooring = useMemo(() => new THREE.Vector3(...sphereNormal(BOAT.latitude, BOAT.longitude)), []);
  const base = useMemo(() => frameAt(BOAT.latitude, BOAT.longitude).orientation, []);
  const work = useMemo(() => ({
    // The hull's own bow and beam directions (the model lies along local z, turned by the heading).
    forward: new THREE.Vector3(Math.sin(BOAT.heading), 0, Math.cos(BOAT.heading)).applyQuaternion(base),
    side: new THREE.Vector3(Math.cos(BOAT.heading), 0, -Math.sin(BOAT.heading)).applyQuaternion(base),
    direction: new THREE.Vector3(), sample: new THREE.Vector3(), centre: new THREE.Vector3(0, -GLOBE_RADIUS, 0),
    tilt: new THREE.Euler(), tiltQuaternion: new THREE.Quaternion(),
  }), [base]);
  useEffect(() => () => model.traverse(child => {
    if (child instanceof THREE.Mesh) (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
  }), [model]);
  useFrame(state => {
    const time = state.clock.elapsedTime;
    const { forward, side, direction, sample, centre, tilt, tiltQuaternion } = work;
    // Drift round the mooring.
    direction.copy(mooring)
      .addScaledVector(forward, Math.sin(time * BOAT.driftSpeed[0]) * BOAT.drift[0] / GLOBE_RADIUS)
      .addScaledVector(side, Math.sin(time * BOAT.driftSpeed[1] + 1) * BOAT.drift[1] / GLOBE_RADIUS)
      .normalize();
    const swellAt = (along: number, across: number) => oceanSwell(sample.copy(direction)
      .addScaledVector(forward, along / GLOBE_RADIUS).addScaledVector(side, across / GLOBE_RADIUS).normalize(), time);
    const bow = swellAt(BOAT.length / 2, 0), stern = swellAt(-BOAT.length / 2, 0);
    const right = swellAt(0, BOAT.beam / 2), left = swellAt(0, -BOAT.beam / 2);
    const middle = oceanSwell(direction, time);
    const height = (bow + stern + right + left + middle) / 5 + Math.sin(time * 1.6) * BOAT.heave;
    group.current.position.copy(direction).multiplyScalar(height).add(centre);
    const pitch = -Math.atan((bow - stern) / BOAT.length) * BOAT.waveFollow + Math.sin(time * Math.PI * 2 / BOAT.pitchPeriod + 1) * BOAT.pitch;
    const roll = Math.atan((right - left) / BOAT.beam) * BOAT.waveFollow + Math.sin(time * Math.PI * 2 / BOAT.rollPeriod) * BOAT.roll;
    tilt.set(pitch, BOAT.heading + Math.sin(time * BOAT.swingSpeed) * BOAT.swing, roll, 'YXZ');
    group.current.quaternion.copy(base).multiply(tiltQuaternion.setFromEuler(tilt));
  });
  return <group ref={group}><primitive object={model} /></group>;
}

// Swim rings for the beach: one lying on the sand by the towels, one floating just off the shore, riding the
// swell and slowly turning.
const SWIM_RING = { diameter: 1.05, offshore: 2.6, bob: 0.025, spin: 0.15 };

function BeachFloats() {
  const gltf = useLoader(GLTFLoader, swimRingUrl);
  const floating = useRef<THREE.Group>(null!);
  const template = useMemo(() => {
    const ring = gltf.scene.clone(true);
    ring.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const name = (child.material as THREE.Material).name;
      child.material = paletteMaterial(name === 'Material.001' ? 'carRed' : 'wallWarmWhite', { roughness: 0.55 });
      child.castShadow = true;
      child.receiveShadow = true;
    });
    ring.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(ring);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(ring);
    ring.position.set(-centre.x, -bounds.min.y, -centre.z);
    holder.scale.setScalar(SWIM_RING.diameter / Math.max(size.x, size.z));
    return holder;
  }, [gltf.scene]);
  const spots = useMemo(() => {
    const shore = beachFacets().filter(facet => facet.ring === 0);
    if (shore.length < 3) return null;
    const onSand = shore[0], offshore = shore[2];
    const sandCentre = new THREE.Vector3(...terrainPoint(onSand.latitude, onSand.longitude));
    const sandNormal = new THREE.Vector3(...groundNormal(onSand.latitude, onSand.longitude));
    const along = new THREE.Vector3().crossVectors(sandNormal, onSand.toSea);
    const lying = toLatLon(sandCentre.addScaledVector(along, 2.2).addScaledVector(onSand.toSea, -0.2));
    const water = new THREE.Vector3(...sphereNormal(offshore.latitude, offshore.longitude))
      .addScaledVector(offshore.toSea, SWIM_RING.offshore / GLOBE_RADIUS).normalize();
    return {
      lying: { position: terrainPoint(lying.latitude, lying.longitude, 0.01), orientation: frameAt(lying.latitude, lying.longitude).orientation },
      water,
      waterOrientation: new THREE.Quaternion().setFromUnitVectors(up, water),
    };
  }, []);
  const [onSand, inWater] = useMemo(() => [template.clone(true), template.clone(true)], [template]);
  const spin = useMemo(() => new THREE.Quaternion(), []);
  useEffect(() => () => template.traverse(child => {
    if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose();
  }), [template]);
  useFrame(state => {
    if (!spots) return;
    const time = state.clock.elapsedTime;
    const height = oceanSwell(spots.water, time) - 0.1 + Math.sin(time * 1.7 + 2) * SWIM_RING.bob;
    floating.current.position.copy(spots.water).multiplyScalar(height).add(new THREE.Vector3(0, -GLOBE_RADIUS, 0));
    floating.current.quaternion.copy(spots.waterOrientation).multiply(spin.setFromAxisAngle(up, time * SWIM_RING.spin));
  });
  if (!spots) return null;
  return <>
    <group position={spots.lying.position} quaternion={spots.lying.orientation}><primitive object={onSand} /></group>
    <group ref={floating}><primitive object={inWater} /></group>
  </>;
}

// Big rocks and boulders from the "Rock low poly" pack: clustered through the forest and the open peninsula
// beside it (one big stone with a couple of smaller ones), a few around the mountains' feet, along the coasts
// and out in the meadows. Placed after the trees and houses so they keep clear of them, sunk a little into the
// ground with a slight tilt. Big stones are solid; small ones can be driven over.
const BOULDERS = {
  rocks: ['Cube', 'Cube.001', 'Cube.002', 'Cube.003', 'Cube.004', 'Cube.005', 'Cube.006', 'Cube.007', 'Cube.008', 'Cube.009', 'Cube.010', 'Cube.011', 'Cube.012', 'Cube.013', 'Cube.014'],
  boulders: ['Cylinder', 'Cylinder.001', 'Cylinder.002', 'Cylinder.003', 'Cylinder.004', 'Cylinder.005', 'Cylinder.007', 'Cylinder.008'],
  areas: [
    { region: 'forest', clusters: 16, boulders: 5 },
  ],
  peninsula: { latitude: 0.72, longitude: 3.95, latitudeRadius: 0.36, longitudeRadius: 0.7, clusters: 9, boulders: 3 },
  mountainRocks: 3, coastRocks: 10, meadowRocks: 8,
  tones: [-0.06, 0, 0.06],
  solidSize: 1.1,
  seed: 5150,
};

function Boulders() {
  const gltf = useLoader(GLTFLoader, bouldersUrl);
  const { templates, materials } = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const materials = BOULDERS.tones.map(jitter => paletteMaterial('roadShoulder', { jitter, vertexColors: true, roughness: 1 }));
    const extract = (name: string) => {
      // GLTFLoader strips dots from node names ("Cube.001" loads as "Cube001").
      const original = gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
      if (!original) throw new Error(`Missing rock ${name}`);
      const rock = original.clone(true);
      original.matrixWorld.decompose(rock.position, rock.quaternion, rock.scale);
      rock.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const map = (child.material as THREE.MeshStandardMaterial).map;
        child.geometry = bakeRoles(child.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.roadShoulder), () => 'rock').geometry;
        child.castShadow = true;
        child.receiveShadow = true;
      });
      const holder = new THREE.Group();
      holder.add(rock);
      holder.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(holder);
      const size = bounds.getSize(new THREE.Vector3());
      const centre = bounds.getCenter(new THREE.Vector3());
      rock.position.x -= centre.x; rock.position.y -= bounds.min.y; rock.position.z -= centre.z;
      holder.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
      return holder;
    };
    return { templates: { rocks: BOULDERS.rocks.map(extract), boulders: BOULDERS.boulders.map(extract) }, materials };
  }, [gltf.scene]);
  // Placed once the trees, houses and mountains have registered their footprints, so rocks never overlap them.
  const [placed, setPlaced] = useState<Array<{ object: THREE.Object3D; position: [number, number, number]; orientation: THREE.Quaternion; latitude: number; longitude: number; size: number }>>([]);
  useEffect(() => {
    let state = BOULDERS.seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const items: typeof placed = [];
    const city = REGIONS.find(region => region.id === 'city')!;
    const clear = (latitude: number, longitude: number, size: number) =>
      landInfluence(latitude, longitude) >= 0.9
      && distanceToRoadNetwork(latitude, longitude) > 3.5 + size
      && !nearBeach(latitude, longitude)
      && !nearField(latitude, longitude)
      && regionInfluence(city, latitude, longitude) < 0.5
      && !obstacleAt(latitude, longitude, size * 0.6 + 0.6)
      && !items.some(item => Math.hypot(item.latitude - latitude, (item.longitude - longitude) * Math.cos(latitude)) * GLOBE_RADIUS < (item.size + size) * 0.45);
    const add = (latitude: number, longitude: number, size: number, boulder: boolean) => {
      if (!clear(latitude, longitude, size)) return false;
      const pool = boulder ? templates.boulders : templates.rocks;
      const object = pool[Math.floor(random() * pool.length)].clone(true);
      const material = materials[Math.floor(random() * materials.length)];
      object.traverse(child => { if (child instanceof THREE.Mesh) child.material = material; });
      const holder = new THREE.Group();
      holder.add(object);
      object.rotation.set((random() - 0.5) * 0.25, random() * Math.PI * 2, (random() - 0.5) * 0.25);
      holder.scale.setScalar(size);
      items.push({ object: holder, latitude, longitude, size, position: terrainPoint(latitude, longitude, -0.14 * size), orientation: frameAt(latitude, longitude).orientation });
      return true;
    };
    const around = (latitude: number, longitude: number, reach: number) => {
      const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * reach / GLOBE_RADIUS;
      return [latitude + Math.sin(angle) * distance, longitude + Math.cos(angle) * distance / Math.max(0.3, Math.cos(latitude))] as const;
    };
    const cluster = (latitude: number, longitude: number) => {
      if (!add(latitude, longitude, 1.4 + random() * 1.1, false)) return;
      const extra = 1 + Math.floor(random() * 3);
      for (let k = 0; k < extra; k++) add(...around(latitude, longitude, 2.6), 0.5 + random() * 0.6, false);
    };
    const scatterIn = (latitude: number, longitude: number, latitudeRadius: number, longitudeRadius: number, clusters: number, boulders: number) => {
      for (let attempt = 0, made = 0; attempt < clusters * 12 && made < clusters; attempt++) {
        const angle = random() * Math.PI * 2, reach = Math.sqrt(random()) * 0.9;
        const before = items.length;
        cluster(latitude + Math.sin(angle) * reach * latitudeRadius, longitude + Math.cos(angle) * reach * longitudeRadius / Math.max(0.35, Math.cos(latitude)));
        if (items.length > before) made++;
      }
      for (let attempt = 0, made = 0; attempt < boulders * 12 && made < boulders; attempt++) {
        const angle = random() * Math.PI * 2, reach = Math.sqrt(random()) * 0.85;
        if (add(latitude + Math.sin(angle) * reach * latitudeRadius, longitude + Math.cos(angle) * reach * longitudeRadius / Math.max(0.35, Math.cos(latitude)), 2.6 + random() * 1.6, true)) made++;
      }
    };
    const forest = REGIONS.find(region => region.id === 'forest')!;
    scatterIn(forest.latitude, forest.longitude, forest.latitudeRadius, forest.longitudeRadius, BOULDERS.areas[0].clusters, BOULDERS.areas[0].boulders);
    const peninsula = BOULDERS.peninsula;
    scatterIn(peninsula.latitude, peninsula.longitude, peninsula.latitudeRadius, peninsula.longitudeRadius, peninsula.clusters, peninsula.boulders);
    // A few stones round each mountain's foot.
    MOUNTAIN_SITES.forEach(site => {
      for (let k = 0, made = 0; k < 20 && made < BOULDERS.mountainRocks; k++) {
        const angle = random() * Math.PI * 2, distance = (site.scale * 1.6 + 1.5 + random() * 2.5) / GLOBE_RADIUS;
        if (add(site.latitude + Math.sin(angle) * distance, site.longitude + Math.cos(angle) * distance / Math.max(0.3, Math.cos(site.latitude)), 0.7 + random() * 0.9, false)) made++;
      }
    });
    // Stones near the shore and out in the meadows, anywhere on land.
    for (let attempt = 0, coast = 0, meadow = 0; attempt < 3000 && (coast < BOULDERS.coastRocks || meadow < BOULDERS.meadowRocks); attempt++) {
      const latitude = Math.asin(random() * 1.9 - 0.95), longitude = random() * turn;
      const land = landInfluence(latitude, longitude);
      const shore = land >= 0.9 && [0, 1, 2, 3].some(k => landInfluence(latitude + Math.sin(k * Math.PI / 2) * 2.2 / GLOBE_RADIUS, longitude + Math.cos(k * Math.PI / 2) * 2.2 / GLOBE_RADIUS) < 0.5);
      if (shore && coast < BOULDERS.coastRocks) { if (add(latitude, longitude, 0.8 + random() * 1.1, false)) coast++; }
      else if (!shore && meadow < BOULDERS.meadowRocks && random() < 0.3) { if (add(latitude, longitude, 0.9 + random() * 1.2, false)) meadow++; }
    }
    setPlaced(items);
  }, [templates, materials]);
  useEffect(() => {
    setObstacleGroup('boulders', placed.filter(item => item.size >= BOULDERS.solidSize).map(item => ({ latitude: item.latitude, longitude: item.longitude, radius: item.size * 0.5 })));
    return () => clearObstacleGroup('boulders');
  }, [placed]);
  useEffect(() => () => materials.forEach(material => material.dispose()), [materials]);
  return <>{placed.map((item, index) => <group key={`boulder-${index}`} position={item.position} quaternion={item.orientation}><primitive object={item.object} /></group>)}</>;
}

// A small football pitch in the open meadow of the forest peninsula: the model's pitch, goals and benches (its
// big square base and tall enclosure are left out), laid east-west and bent to the globe's curve so its corners
// don't float. The goals are solid; the grass can be driven over. Trees and stones keep off it.
// The pitch stands on a low concrete plinth raised `lift` above the ground (its sides run `footing` metres down
// into the land), so the faceted ground never pokes through the grass.
const FIELD = { latitude: 1.07, longitude: 3.645, length: 7.7, lift: 0.5, footing: 1.4, plinthMargin: 1.04, keepClear: 6, dropNodes: ['Object_8', 'Object_112'], pitchNodes: ['Object_4', 'Object_6'] };

// Field colours chosen to harmonise with the world rather than copy it: a fresher green pitch (with mowing stripes)
// and warm white lines, warm stone walls, and coral seats echoing the village roofs.
function fieldRole(pitch: boolean) {
  return ({ hue, saturation, lightness }: FaceSample): PaletteKey => {
    if (lightness > 0.78) return 'wallWarmWhite';
    // The pitch is one colour: its baked dark shading (the circles) is dropped, and only its white lines are kept.
    if (pitch) return 'pitchOrange';
    if (hue >= 60 && hue < 170 && saturation > 0.2) return 'pitchOrange';
    if (hue >= 12 && hue < 50 && saturation > 0.25) return 'roofAccent';
    if (saturation > 0.4 && (hue < 12 || hue >= 340)) return 'roofAccent';
    if (lightness < 0.18) return 'doorsTrim';
    return 'fieldStone';
  };
}
// Lighter and darker bands across the pitch grass, like a mown lawn (only the green faces are touched).
function mowingStripes(geometry: THREE.BufferGeometry, roles: string[]) {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  if (!color) return;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const long = box.max.x - box.min.x >= box.max.z - box.min.z ? 'x' : 'z';
  const span = long === 'x' ? box.max.x - box.min.x : box.max.z - box.min.z;
  geometry.groups.forEach(group => {
    if (roles[group.materialIndex!] !== 'pitchOrange') return;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const along = ((long === 'x' ? position.getX(i) + position.getX(i + 1) + position.getX(i + 2) : position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
        - (long === 'x' ? box.min.x : box.min.z)) / (span || 1);
      const factor = Math.floor(along * 10) % 2 === 0 ? 1.07 : 0.94;
      for (let k = 0; k < 3; k++) color.setXYZ(i + k, color.getX(i + k) * factor, color.getY(i + k) * factor, color.getZ(i + k) * factor);
    }
  });
  color.needsUpdate = true;
}

// The winding stone path from the main road to the pitch: from the road's edge nearest the pitch it meanders
// (a smooth curve through a few side-stepped points) to the pitch's near side, rising onto the plinth at the end.
const FIELD_PATH = { width: 1.7, wiggle: [1.8, -2.2, 1.4], samples: 70, ramp: 2.4, keepClear: 1.8 };
let fieldPathCache: Array<{ latitude: number; longitude: number; along: number }> | null = null;

function fieldPath() {
  if (fieldPathCache) return fieldPathCache;
  const target = new THREE.Vector3(...sphereNormal(FIELD.latitude, FIELD.longitude));
  const path = ROAD_PATHS[0];
  let best = { t: 0, angle: Infinity };
  for (let i = 0; i < path.segments; i++) {
    const t = i / path.segments;
    const angle = new THREE.Vector3(...sphereNormal(path.latitudeAt(t), path.longitudeAt(t))).angleTo(target);
    if (angle < best.angle) best = { t, angle };
  }
  const frame = roadPathFrame(path, best.t);
  const roadDirection = new THREE.Vector3(...sphereNormal(frame.latitude, frame.longitude));
  const side = new THREE.Vector3(...frame.side);
  if (side.dot(target.clone().sub(roadDirection)) < 0) side.negate();
  const start = roadDirection.clone().addScaledVector(side, (path.width * 0.5 + WORLD_SETTINGS.roads.shoulderExtra * 0.5 + 0.4) / GLOBE_RADIUS).normalize();
  const toRoad = start.clone().sub(target).projectOnPlane(target).normalize();
  const end = target.clone().addScaledVector(toRoad, FIELD.length * 0.42 / GLOBE_RADIUS).normalize();
  const across = new THREE.Vector3().crossVectors(target, toRoad).normalize();
  const points = [start];
  FIELD_PATH.wiggle.forEach((offset, index) => {
    const share = (index + 1) / (FIELD_PATH.wiggle.length + 1);
    points.push(start.clone().lerp(end, share).addScaledVector(across, offset / GLOBE_RADIUS).normalize());
  });
  points.push(end);
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  fieldPathCache = curve.getSpacedPoints(FIELD_PATH.samples).map((point, index) => {
    point.normalize();
    return { latitude: Math.asin(THREE.MathUtils.clamp(point.y, -1, 1)), longitude: Math.atan2(point.x, point.z), along: index / FIELD_PATH.samples };
  });
  return fieldPathCache;
}

const nearField = (latitude: number, longitude: number) =>
  Math.hypot(latitude - FIELD.latitude, Math.atan2(Math.sin(longitude - FIELD.longitude), Math.cos(longitude - FIELD.longitude)) * Math.cos(latitude)) * GLOBE_RADIUS < FIELD.keepClear
  || fieldPath().some(point => Math.hypot(latitude - point.latitude, Math.atan2(Math.sin(longitude - point.longitude), Math.cos(longitude - point.longitude)) * Math.cos(latitude)) * GLOBE_RADIUS < FIELD_PATH.keepClear);

function FieldPath() {
  const { paving, stones } = useMemo(() => {
    const points = fieldPath();
    const length = points.length;
    let pathLength = 0;
    for (let i = 1; i < length; i++) {
      pathLength += new THREE.Vector3(...sphereNormal(points[i].latitude, points[i].longitude))
        .angleTo(new THREE.Vector3(...sphereNormal(points[i - 1].latitude, points[i - 1].longitude))) * GLOBE_RADIUS;
    }
    const rampStart = Math.max(0, 1 - FIELD_PATH.ramp / Math.max(pathLength, 0.001));
    const positions: number[] = [];
    const colors: number[] = [];
    const tones = [PALETTE.pavingLight, PALETTE.pavingDark, PALETTE.fieldStone].map(hex => new THREE.Color(hex));
    const random = seededRandom(808);
    const edges = points.map((point, index) => {
      const next = points[Math.min(index + 1, length - 1)], previous = points[Math.max(index - 1, 0)];
      const here = new THREE.Vector3(...sphereNormal(point.latitude, point.longitude));
      const forward = new THREE.Vector3(...sphereNormal(next.latitude, next.longitude)).sub(new THREE.Vector3(...sphereNormal(previous.latitude, previous.longitude))).projectOnPlane(here).normalize();
      const across = new THREE.Vector3().crossVectors(here, forward).normalize();
      const lift = 0.07 + FIELD.lift * THREE.MathUtils.smoothstep(point.along, rampStart, 1);
      return [-1, 0, 1].map(side => {
        const direction = here.clone().addScaledVector(across, side * FIELD_PATH.width * 0.5 / GLOBE_RADIUS).normalize();
        const latitude = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)), longitude = Math.atan2(direction.x, direction.z);
        return { position: new THREE.Vector3(...terrainPoint(latitude, longitude, lift)), latitude, longitude };
      });
    });
    // Paving: two stones across, one per sample along, each its own warm stone tone.
    for (let index = 0; index < length - 1; index++) {
      for (let lane = 0; lane < 2; lane++) {
        const a = edges[index][lane].position, b = edges[index][lane + 1].position, c = edges[index + 1][lane + 1].position, d = edges[index + 1][lane].position;
        const tone = tones[Math.floor(random() * tones.length)].clone().offsetHSL(0, 0, (random() - 0.5) * 0.05);
        positions.push(...a.toArray(), ...c.toArray(), ...b.toArray(), ...a.toArray(), ...d.toArray(), ...c.toArray());
        for (let k = 0; k < 6; k++) colors.push(tone.r, tone.g, tone.b);
      }
    }
    const paving = new THREE.BufferGeometry();
    paving.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    paving.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    paving.computeVertexNormals();
    // Small rocks lining both sides, every couple of samples.
    const stones: Array<{ position: [number, number, number]; orientation: THREE.Quaternion; scale: [number, number, number]; tone: number }> = [];
    for (let index = 1; index < length - 3; index += 2) {
      for (const side of [0, 2]) {
        if (random() < 0.3) continue;
        const edge = edges[index][side];
        const normal = new THREE.Vector3(...groundNormal(edge.latitude, edge.longitude));
        const orientation = new THREE.Quaternion().setFromUnitVectors(up, normal).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 0.3, random() * Math.PI * 2, random() * 0.3)));
        const size = 0.18 + random() * 0.2;
        stones.push({ position: edge.position.toArray() as [number, number, number], orientation, scale: [size * 1.3, size * 0.7, size], tone: Math.floor(random() * 3) });
      }
    }
    return { paving, stones };
  }, []);
  const [pavingMaterial, stoneGeometry, stoneMaterials] = useMemo(() => [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    new THREE.IcosahedronGeometry(1, 0),
    [-0.06, 0, 0.06].map(jitter => paletteMaterial('roadShoulder', { jitter, roughness: 1 })),
  ] as const, []);
  useEffect(() => () => { paving.dispose(); pavingMaterial.dispose(); stoneGeometry.dispose(); stoneMaterials.forEach(material => material.dispose()); }, [paving, pavingMaterial, stoneGeometry, stoneMaterials]);
  return <>
    <mesh geometry={paving} material={pavingMaterial} receiveShadow />
    {stones.map((stone, index) => <mesh key={`path-stone-${index}`} geometry={stoneGeometry} material={stoneMaterials[stone.tone]} position={stone.position} quaternion={stone.orientation} scale={stone.scale} castShadow receiveShadow />)}
  </>;
}

function FootballField() {
  const gltf = useLoader(GLTFLoader, fieldUrl);
  const placement = useMemo(() => {
    const field = gltf.scene.clone(true);
    field.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      if (FIELD.dropNodes.includes(child.name)) { child.visible = false; return; }
      const map = (child.material as THREE.MeshStandardMaterial).map;
      const baked = bakeRoles(child.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.wallWarmWhite), fieldRole(FIELD.pitchNodes.includes(child.name)));
      child.geometry = baked.geometry;
      child.material = roleMaterials(baked.roles, role => ({ key: role as PaletteKey }));
      if (FIELD.pitchNodes.includes(child.name)) mowingStripes(child.geometry, baked.roles);
      child.castShadow = true;
      child.receiveShadow = true;
    });
    // Remove the hidden parts so they don't count towards the size or get bent.
    const hidden: THREE.Object3D[] = [];
    field.traverse(child => { if (!child.visible) hidden.push(child); });
    hidden.forEach(child => child.removeFromParent());
    field.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(field);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(field);
    field.position.set(-centre.x, -bounds.min.y, -centre.z);
    // Plinth under the pitch (in the model's units, so it scales and bends with it).
    const scaleToWorld = FIELD.length / Math.max(size.x, size.z);
    const plinthHeight = (FIELD.lift + FIELD.footing) / scaleToWorld;
    const plinth = new THREE.Mesh(
      // Its top sits a hair under the pitch so the grass always draws over it.
      new THREE.BoxGeometry(size.x * FIELD.plinthMargin, plinthHeight, size.z * FIELD.plinthMargin, 14, 1, 10).translate(0, -plinthHeight / 2 - 0.06 / scaleToWorld, 0),
      // Box faces: +x, -x, +y (top), -y, +z, -z. The top is grass (it shows through the gaps in the model's pitch).
      [0, 1, 2, 3, 4, 5].map(side => paletteMaterial(side === 2 ? 'pitchOrange' : 'fieldStone', { roughness: 0.95 })),
    );
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    holder.add(plinth);
    // The supplied pitch model has no working floodlights, so add four compact
    // corner masts with inward-facing heads and real, soft spot lights.
    const towerScale = scaleToWorld;
    const mastHeight = 2.55 / towerScale;
    const mastGeometry = new THREE.CylinderGeometry(0.065 / towerScale, 0.11 / towerScale, mastHeight, 6);
    const housingGeometry = new THREE.BoxGeometry(0.62 / towerScale, 0.23 / towerScale, 0.34 / towerScale);
    const lensGeometry = new THREE.BoxGeometry(0.48 / towerScale, 0.12 / towerScale, 0.035 / towerScale);
    const mastMaterial = paletteMaterial('roadShoulder', { roughness: 0.9 });
    const housingMaterial = paletteMaterial('tires', { roughness: 0.85 });
    const lensMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.flowerCream, emissive: PALETTE.flowerCream, emissiveIntensity: 0, roughness: 0.72 });
    const spots: THREE.SpotLight[] = [];
    const cornerX = size.x * 0.46, cornerZ = size.z * 0.46;
    for (const x of [-cornerX, cornerX]) for (const z of [-cornerZ, cornerZ]) {
      const mast = new THREE.Mesh(mastGeometry, mastMaterial);
      mast.position.set(x, mastHeight * 0.5, z);
      mast.castShadow = true;
      holder.add(mast);
      const head = new THREE.Group();
      head.position.set(x, mastHeight, z);
      head.rotation.y = Math.atan2(-x, -z);
      const housing = new THREE.Mesh(housingGeometry, housingMaterial);
      housing.position.set(0, 0, -0.08 / towerScale);
      housing.castShadow = true;
      head.add(housing);
      const lens = new THREE.Mesh(lensGeometry, lensMaterial);
      lens.position.set(0, 0, 0.105 / towerScale);
      head.add(lens);
      holder.add(head);
      const spot = new THREE.SpotLight(PALETTE.flowerCream, 0, 10 / towerScale, 0.72, 0.72, 2);
      spot.position.set(x, mastHeight - 0.08 / towerScale, z);
      spot.target.position.set(0, 0.12 / towerScale, 0);
      holder.add(spot, spot.target);
      spots.push(spot);
    }
    // Lay the pitch's long side east-west.
    const normal = new THREE.Vector3(...groundNormal(FIELD.latitude, FIELD.longitude));
    const along = new THREE.Vector3(Math.cos(FIELD.longitude), 0, -Math.sin(FIELD.longitude)).projectOnPlane(normal).normalize();
    const forward = new THREE.Vector3().crossVectors(along, normal);
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, normal, forward));
    const scale = FIELD.length / Math.max(size.x, size.z);
    const long = size.x >= size.z ? 0 : Math.PI / 2;
    const object = bendToGlobe(holder, long, scale);
    const position = terrainPoint(FIELD.latitude, FIELD.longitude, FIELD.lift);
    const goals = [-1, 1].map(end => toLatLon(new THREE.Vector3(...position).addScaledVector(along, end * FIELD.length * 0.47)));
    return { object, position, orientation, goals, spots, mastGeometry, housingGeometry, lensGeometry, mastMaterial, housingMaterial, lensMaterial };
  }, [gltf.scene]);
  useFrame(() => {
    const blend = nightState.blend;
    placement.lensMaterial.emissiveIntensity = blend * 3.2;
    placement.spots.forEach(spot => { spot.intensity = blend * 28; });
  });
  useEffect(() => () => {
    placement.mastGeometry.dispose();
    placement.housingGeometry.dispose();
    placement.lensGeometry.dispose();
    placement.mastMaterial.dispose();
    placement.housingMaterial.dispose();
    placement.lensMaterial.dispose();
  }, [placement]);
  useEffect(() => {
    setObstacleGroup('field', placement.goals.map(goal => ({ ...goal, radius: 1.1 })));
    return () => clearObstacleGroup('field');
  }, [placement]);
  return <group position={placement.position} quaternion={placement.orientation}><primitive object={placement.object} /></group>;
}

// A little palm island out in the polar bay (CC BY-NC, see the README): two palms, a dock, a shack, coconuts and
// a life ring, recoloured to the world palette. The model's smooth sand mound is replaced by coast-style ground
// (see islandGround); its water disc, the fisherman with his rod and the circling fish are left out.
// `topAboveWater` sets how far the island's top stands out of the sea (in metres), like a low stretch of coast.
const ISLAND = { latitude: 0.923, longitude: 6.039, width: 8, topAboveWater: 0.45, heading: 2.2, rings: 4, segments: 20 };
const ISLAND_COLORS: Record<string, PaletteKey> = {
  '02_-_Default': 'trunk', '03_-_Default': 'mainTree', '08_-_Default': 'roofWarmBrown', '05_-_Default': 'doorsTrim',
  '15_-_Default': 'roadShoulder', '11_-_Default': 'wallWarmWhite', '10_-_Default': 'roadShoulder', '06_-_Default': 'tires',
  '13_-_Default': 'roofAccent', '14_-_Default': 'carRed',
};
const ISLAND_MOUND = '01_-_Default';
const ISLAND_WATER = '04_-_Default';

// The island's ground in the style of the globe's coasts: a flat, gently faceted top in the land's yellow-green,
// a short bevel and a beige cliff wall dropping straight into the sea. Its outline follows the original mound.
const ISLAND_COAST = {
  topShare: 0.82, bevelShare: 0.12, wobble: 0.05,
  broadBays: 0.12, secondaryBays: 0.07, smallCoves: 0.04,
};

function islandGround(mound: THREE.Mesh, bounds: THREE.Box3) {
  const raycaster = new THREE.Raycaster();
  const centre = bounds.getCenter(new THREE.Vector3());
  const span = bounds.max.y - bounds.min.y || 1;
  const top = bounds.min.y + span * ISLAND_COAST.topShare;
  const bevel = span * ISLAND_COAST.bevelShare;
  // Outline: how far the mound reaches at each angle (where its surface is still above the top level's foot).
  const reachAt = (angle: number) => {
    let reach = 0;
    const maxReach = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.55;
    for (let r = 0; r <= maxReach; r += maxReach / 40) {
      raycaster.set(new THREE.Vector3(centre.x + Math.cos(angle) * r, bounds.max.y + 10, centre.z + Math.sin(angle) * r), new THREE.Vector3(0, -1, 0));
      const hit = raycaster.intersectObject(mound, false)[0];
      if (hit && hit.point.y > bounds.min.y + span * 0.25) reach = r;
    }
    return Math.max(reach, maxReach * 0.4);
  };
  const outline = Array.from({ length: ISLAND.segments }, (_, k) => {
    const angle = k / ISLAND.segments * Math.PI * 2;
    // A few smooth, fixed-frequency lobes break the model's circular mound into broad bays and headlands.
    // Keeping them deterministic means the shore stays aligned with the palms, dock and island pole.
    const coves = 1
      + ISLAND_COAST.broadBays * Math.sin(angle * 2 + 0.65)
      + ISLAND_COAST.secondaryBays * Math.sin(angle * 3 - 1.8)
      + ISLAND_COAST.smallCoves * Math.sin(angle * 5 + 2.1);
    return { angle, reach: reachAt(angle) * coves };
  });
  const point = (k: number, share: number, y: number) => {
    const { angle, reach } = outline[((k % ISLAND.segments) + ISLAND.segments) % ISLAND.segments];
    return new THREE.Vector3(centre.x + Math.cos(angle) * reach * share, y, centre.z + Math.sin(angle) * reach * share);
  };
  const positions: number[] = [];
  const colors: number[] = [];
  // Warm gradient to the edge, like the beaches: land in the middle, a sand-green ring, sand on the bevel.
  const land = new THREE.Color(PALETTE.land), wall = new THREE.Color(PALETTE.coastWall), sand = new THREE.Color(PALETTE.sand);
  const shore = land.clone().lerp(sand, 0.55);
  const face = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const shaded = color.clone().offsetHSL(0, 0, Math.sin(positions.length * 0.71) * 0.02);
    for (let k = 0; k < 3; k++) colors.push(shaded.r, shaded.g, shaded.b);
  };
  const wobble = (k: number, ring: number) => top + span * ISLAND_COAST.wobble * Math.sin(k * 2.3 + ring * 1.7) * (ring === 0 ? 0.5 : 0.3);
  const middle = new THREE.Vector3(centre.x, top + span * ISLAND_COAST.wobble * 0.6, centre.z);
  const seaFloor = bounds.min.y - span * 0.6;
  for (let k = 0; k < ISLAND.segments; k++) {
    const inner0 = point(k, 0.5, wobble(k, 0)), inner1 = point(k + 1, 0.5, wobble(k + 1, 0));
    const rim0 = point(k, 0.94, top), rim1 = point(k + 1, 0.94, top);
    const edge0 = point(k, 1, top - bevel), edge1 = point(k + 1, 1, top - bevel);
    const foot0 = point(k, 1, seaFloor), foot1 = point(k + 1, 1, seaFloor);
    // Faces wound counter-clockwise seen from above / outside.
    face(middle, inner1, inner0, land);
    face(inner0, inner1, rim1, shore); face(inner0, rim1, rim0, shore);
    face(rim0, rim1, edge1, sand); face(rim0, edge1, edge0, sand);
    face(edge0, edge1, foot1, wall); face(edge0, foot1, foot0, wall);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, top };
}

function PalmIsland({ latitude, longitude }: { latitude: number; longitude: number }) {
  const gltf = useLoader(GLTFLoader, islandUrl);
  const object = useMemo(() => {
    const island = gltf.scene.clone(true);
    let mound: THREE.Mesh | null = null;
    const removed: THREE.Object3D[] = [];
    island.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const name = (child.material as THREE.Material).name;
      // Leave out the water disc, the fisherman and fish (the skinned meshes) and his fishing rod.
      if (name === ISLAND_WATER || child instanceof THREE.SkinnedMesh || child.name.startsWith('Fishing_Rod')) { removed.push(child); return; }
      if (name === ISLAND_MOUND) { mound = child; return; }
      child.material = paletteMaterial(ISLAND_COLORS[name] ?? 'roadShoulder', { roughness: 0.9 });
      child.castShadow = true;
      child.receiveShadow = true;
    });
    removed.forEach(child => child.removeFromParent());
    island.updateMatrixWorld(true);
    const holder = new THREE.Group();
    holder.add(island);
    if (!mound) return holder;
    const moundMesh = mound as THREE.Mesh;
    const bounds = new THREE.Box3().setFromObject(moundMesh);
    const ground = islandGround(moundMesh, bounds);
    island.add(ground.mesh);
    moundMesh.removeFromParent();
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    island.position.set(-centre.x, -bounds.min.y, -centre.z);
    const scale = ISLAND.width / Math.max(size.x, size.z);
    holder.scale.setScalar(scale);
    // Seat it so the flat top stands just `topAboveWater` out of the sea.
    holder.position.y = ISLAND.topAboveWater - (ground.top - bounds.min.y) * scale;
    holder.rotation.y = ISLAND.heading;
    return holder;
  }, [gltf]);
  const position = useMemo(() => spherePoint(latitude, longitude, OCEAN_WAVE.lift), [latitude, longitude]);
  const orientation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(...sphereNormal(latitude, longitude))), [latitude, longitude]);
  useEffect(() => () => object.traverse(child => {
    if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose();
  }), [object]);
  return <group position={position} quaternion={orientation}><primitive object={object} /></group>;
}

// A fishing boat out in the open sea to the south-west (CC BY-NC, see the README): keeps its own textures, is sized
// to about 6 m, and rides the same swell as the sea shader, rocking and swaying a little on top of it.
const FISHING_BOAT = { length: 8, heading: 1.1, sink: 1.2, bob: 0.07, roll: 0.13, pitch: 0.07, drift: [0.6, 0.4] as const };

// Boat colours from the island's own palette (warm coral, wood browns, cream, sage), by the texture colour under each face.
function fishingBoatRole({ hue, saturation, lightness }: FaceSample): PaletteKey {
  if (lightness < 0.18) return 'tires';
  if (saturation < 0.18) return lightness > 0.6 ? 'wallWarmWhite' : 'roadShoulder';
  if (hue < 18 || hue >= 340) return 'roofAccent';
  if (hue < 50) return lightness > 0.5 ? 'wallCream' : (lightness < 0.3 ? 'doorsTrim' : 'roofWarmBrown');
  if (hue < 260) return 'wallCream';
  return 'roofAccent';
}

function FishingBoat({ latitude, longitude }: { latitude: number; longitude: number }) {
  const gltf = useLoader(GLTFLoader, fishingBoatUrl);
  const group = useRef<THREE.Group>(null!);
  const model = useMemo(() => {
    const boat = gltf.scene.clone(true);
    boat.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const map = (child.material as THREE.MeshStandardMaterial).map;
      const baked = bakeRoles(child.geometry, map ? textureSampler(map) : (_u, _v, out) => out.set(PALETTE.wallWarmWhite), fishingBoatRole);
      child.geometry = baked.geometry;
      child.material = roleMaterials(baked.roles, role => ({ key: role as PaletteKey }));
    });
    boat.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(boat);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    boat.position.set(-centre.x, -bounds.min.y, -centre.z);
    const holder = new THREE.Group();
    holder.add(boat);
    // Lengthwise along local z (the same convention as the rowboat).
    if (size.x > size.z) holder.rotation.y = Math.PI / 2;
    holder.scale.setScalar(FISHING_BOAT.length / Math.max(size.x, size.z));
    // Sit lower in the water: the hull is mostly under the surface.
    holder.position.y = -FISHING_BOAT.sink;
    holder.traverse(child => {
      if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    return holder;
  }, [gltf]);
  const mooring = useMemo(() => new THREE.Vector3(...sphereNormal(latitude, longitude)), [latitude, longitude]);
  const base = useMemo(() => frameAt(latitude, longitude).orientation, [latitude, longitude]);
  const work = useMemo(() => ({
    forward: new THREE.Vector3(Math.sin(FISHING_BOAT.heading), 0, Math.cos(FISHING_BOAT.heading)).applyQuaternion(base),
    side: new THREE.Vector3(Math.cos(FISHING_BOAT.heading), 0, -Math.sin(FISHING_BOAT.heading)).applyQuaternion(base),
    direction: new THREE.Vector3(), sample: new THREE.Vector3(), centre: new THREE.Vector3(0, -GLOBE_RADIUS, 0),
    tilt: new THREE.Euler(), tiltQuaternion: new THREE.Quaternion(),
  }), [base]);
  useEffect(() => () => model.traverse(child => {
    if (child instanceof THREE.Mesh) (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
  }), [model]);
  useFrame(state => {
    const time = state.clock.elapsedTime;
    const { forward, side, direction, sample, centre, tilt, tiltQuaternion } = work;
    direction.copy(mooring)
      .addScaledVector(forward, Math.sin(time * 0.07) * FISHING_BOAT.drift[0] / GLOBE_RADIUS)
      .addScaledVector(side, Math.sin(time * 0.05 + 1) * FISHING_BOAT.drift[1] / GLOBE_RADIUS)
      .normalize();
    const swellAt = (along: number, across: number) => oceanSwell(sample.copy(direction)
      .addScaledVector(forward, along / GLOBE_RADIUS).addScaledVector(side, across / GLOBE_RADIUS).normalize(), time);
    const bow = swellAt(FISHING_BOAT.length / 2, 0), stern = swellAt(-FISHING_BOAT.length / 2, 0);
    const right = swellAt(0, 0.9), left = swellAt(0, -0.9);
    const height = (bow + stern + right + left + oceanSwell(direction, time)) / 5 + Math.sin(time * 1.3) * FISHING_BOAT.bob;
    group.current.position.copy(direction).multiplyScalar(height).add(centre);
    const pitch = -Math.atan((bow - stern) / FISHING_BOAT.length) * 1.6 + Math.sin(time * 0.9) * FISHING_BOAT.pitch;
    const roll = Math.atan((right - left) / 1.8) * 1.6 + Math.sin(time * 0.8 + 0.4) * FISHING_BOAT.roll;
    tilt.set(pitch, Math.sin(time * 0.06) * 0.08, roll, 'YXZ');
    group.current.quaternion.copy(base).multiply(tiltQuaternion.setFromEuler(tilt));
  });
  return <group ref={group}><primitive object={model} /></group>;
}

// Scattered life for the empty meadows: small rocks, grass tufts and bushes, spread over bare land and kept clear of
// roads, buildings, the coast, the forest and the mountains. Instanced, with palette colours.
const FILLER = { seed: 2024, count: 320, tries: 12000, roadClear: 4.5, buildingClear: 4.5, treeClear: 1.6 };

const cityRegion = REGIONS.find(region => region.id === 'city')!;
const metresBetween = (latitude: number, longitude: number, lat0: number, lon0: number) =>
  Math.hypot(latitude - lat0, Math.atan2(Math.sin(longitude - lon0), Math.cos(longitude - lon0)) * Math.cos(latitude)) * GLOBE_RADIUS;

function fillerSpots() {
  const random = seededRandom(FILLER.seed);
  const buildings: Array<[number, number, number]> = [[WELL.latitude, WELL.longitude, FILLER.buildingClear], [MEADOW_HOUSE.latitude, MEADOW_HOUSE.longitude, FILLER.buildingClear + 1], [FIELD.latitude, FIELD.longitude, FIELD.keepClear]];
  const spots: Array<{ kind: 'rock' | 'tuft' | 'bush'; latitude: number; longitude: number; scale: number; yaw: number; colour: PaletteKey }> = [];
  for (let attempt = 0; attempt < FILLER.tries && spots.length < FILLER.count; attempt++) {
    const latitude = Math.asin(random() * 1.9 - 0.95), longitude = random() * turn;
    if (landInfluence(latitude, longitude) < 0.92) continue;
    if (distanceToRoadNetwork(latitude, longitude) < FILLER.roadClear) continue;
    if (regionInfluence(cityRegion, latitude, longitude) > 0.3) continue;
    if (buildings.some(([lat, lon, clear]) => metresBetween(latitude, longitude, lat, lon) < clear)) continue;
    if (distanceToMountainSites(latitude, longitude) < 5.5 || nearBeach(latitude, longitude) || nearField(latitude, longitude)) continue;
    if (obstacleAt(latitude, longitude, FILLER.treeClear)) continue;
    const roll = random();
    const kind = roll < 0.3 ? 'rock' : roll < 0.7 ? 'tuft' : 'bush';
    const colour: PaletteKey = kind === 'rock' ? (random() < 0.5 ? 'roadShoulder' : 'fieldStone')
      : kind === 'tuft' ? (random() < 0.6 ? 'lightTree' : 'accentTree') : (random() < 0.6 ? 'mainTree' : 'darkTree');
    spots.push({ kind, latitude, longitude, scale: kind === 'rock' ? 0.35 + random() * 0.55 : kind === 'bush' ? 0.5 + random() * 0.5 : 0.55 + random() * 0.45, yaw: random() * Math.PI * 2, colour });
  }
  return spots;
}

function Meadow() {
  const spots = useMemo(fillerSpots, []);
  const geometries = useMemo(() => ({
    rock: new THREE.IcosahedronGeometry(0.5, 0),
    tuft: new THREE.ConeGeometry(0.26, 0.9, 4, 1).translate(0, 0.45, 0),
    bush: new THREE.IcosahedronGeometry(0.5, 1).translate(0, 0.35, 0),
  }), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), []);
  const meshes = useMemo(() => {
    const count = (kind: string) => spots.filter(spot => spot.kind === kind).length;
    const dummy = new THREE.Object3D();
    return (['rock', 'tuft', 'bush'] as const).map(kind => {
      const list = spots.filter(spot => spot.kind === kind);
      const mesh = new THREE.InstancedMesh(geometries[kind], material, Math.max(1, count(kind)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      list.forEach((spot, index) => {
        const surface = terrainPoint(spot.latitude, spot.longitude, kind === 'rock' ? 0.02 : 0);
        const frame = frameAt(spot.latitude, spot.longitude).orientation;
        dummy.position.set(surface[0], surface[1], surface[2]);
        dummy.quaternion.copy(frame).multiply(new THREE.Quaternion().setFromAxisAngle(up, spot.yaw));
        dummy.scale.set(spot.scale, spot.scale * (kind === 'rock' ? 0.7 : 1), spot.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, new THREE.Color(PALETTE[spot.colour]).offsetHSL(0, 0, (Math.sin(index * 7.1) * 0.03)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      return mesh;
    });
  }, [spots, geometries, material]);
  useEffect(() => () => { Object.values(geometries).forEach(geometry => geometry.dispose()); material.dispose(); meshes.forEach(mesh => mesh.dispose()); }, [geometries, material, meshes]);
  return <>{meshes.map((mesh, index) => <primitive key={`meadow-${index}`} object={mesh} />)}</>;
}

// Fireflies: small warm glows drifting over the grass beside the roads, only visible at night. Each one hovers near
// its spot, floats a little, and pulses on its own rhythm (additive, so they glow against the dark).
const FIREFLIES = { count: 150, seed: 77, size: 0.3, colour: '#e6ff9a', hover: [0.7, 1.5] as const, drift: 0.45 };

function Fireflies() {
  const { geometry, bases, normals, phases, colour } = useMemo(() => {
    const random = seededRandom(FIREFLIES.seed);
    const bases: THREE.Vector3[] = [], normals: THREE.Vector3[] = [], phases: number[] = [];
    for (let attempt = 0; attempt < 30000 && bases.length < FIREFLIES.count; attempt++) {
      const latitude = Math.asin(random() * 1.9 - 0.95), longitude = random() * turn;
      if (landInfluence(latitude, longitude) < 0.92) continue;
      const road = distanceToRoadNetwork(latitude, longitude);
      if (road < 2.5 || road > 9) continue;
      if (regionInfluence(cityRegion, latitude, longitude) > 0.3) continue;
      if (nearBeach(latitude, longitude) || nearField(latitude, longitude)) continue;
      bases.push(new THREE.Vector3(...terrainPoint(latitude, longitude, 0)));
      normals.push(new THREE.Vector3(...sphereNormal(latitude, longitude)));
      phases.push(random() * Math.PI * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(bases.length * 3), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(bases.length * 3), 3));
    return { geometry, bases, normals, phases, colour: new THREE.Color(FIREFLIES.colour) };
  }, []);
  const material = useMemo(() => new THREE.PointsMaterial({
    size: FIREFLIES.size, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(state => {
    const time = state.clock.elapsedTime;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = geometry.getAttribute('color') as THREE.BufferAttribute;
    const night = nightState.blend;
    bases.forEach((base, i) => {
      const phase = phases[i];
      const hover = FIREFLIES.hover[0] + (FIREFLIES.hover[1] - FIREFLIES.hover[0]) * (0.5 + 0.5 * Math.sin(time * 0.5 + phase));
      const x = Math.sin(time * 0.7 + phase) * FIREFLIES.drift, z = Math.cos(time * 0.55 + phase * 1.3) * FIREFLIES.drift;
      position.setXYZ(i, base.x + normals[i].x * hover + x, base.y + normals[i].y * hover, base.z + normals[i].z * hover + z);
      const pulse = Math.pow(0.5 + 0.5 * Math.sin(time * 2.2 + phase * 2), 3) * night;
      color.setXYZ(i, colour.r * pulse, colour.g * pulse, colour.b * pulse);
    });
    position.needsUpdate = true;
    color.needsUpdate = true;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// Footpaths: a paved walk from the nearest point of the road to a building, curving gently across the meadow.
// Only built where every stretch is on land; the paving uses the same stone tones as the field's path.
const FOOTPATH = { width: 1.2, lift: 0.07, samples: 40, wiggle: 2.2 };

function nearestRoadDirection(target: THREE.Vector3) {
  const path = ROAD_PATHS[0];
  let best = { t: 0, angle: Infinity };
  for (let i = 0; i < path.segments; i++) {
    const t = i / path.segments;
    const angle = new THREE.Vector3(...sphereNormal(path.latitudeAt(t), path.longitudeAt(t))).angleTo(target);
    if (angle < best.angle) best = { t, angle };
  }
  return new THREE.Vector3(...sphereNormal(path.latitudeAt(best.t), path.longitudeAt(best.t)));
}

function footpathGeometry(target: { latitude: number; longitude: number }) {
  const goal = new THREE.Vector3(...sphereNormal(target.latitude, target.longitude));
  const start = nearestRoadDirection(goal);
  const direction = goal.clone().sub(start);
  const across = new THREE.Vector3().crossVectors(start, direction).normalize();
  const towards = (t: number, lateral: number) => start.clone().lerp(goal, t).addScaledVector(across, lateral / GLOBE_RADIUS).normalize();
  const curve = new THREE.CatmullRomCurve3([
    start, towards(0.33, FOOTPATH.wiggle), towards(0.66, -FOOTPATH.wiggle), goal,
  ].map(point => point.clone()), false, 'centripetal');
  const centres = curve.getSpacedPoints(FOOTPATH.samples).map(point => point.normalize());
  const toLatitude = (v: THREE.Vector3) => Math.asin(THREE.MathUtils.clamp(v.y, -1, 1));
  const toLongitude = (v: THREE.Vector3) => Math.atan2(v.x, v.z);
  // Every centre point must be on land (except where the path leaves the road, which is land too).
  for (const c of centres) if (!isLandAt(toLatitude(c), toLongitude(c)) || landInfluence(toLatitude(c), toLongitude(c)) < 0.8) return null;
  const positions: number[] = [];
  const colors: number[] = [];
  const tones = [PALETTE.pavingLight, PALETTE.pavingDark, PALETTE.fieldStone].map(hex => new THREE.Color(hex));
  const random = seededRandom(909);
  const sides = centres.map((c, i) => {
    const forward = centres[Math.min(i + 1, centres.length - 1)].clone().sub(centres[Math.max(i - 1, 0)]).projectOnPlane(c).normalize();
    const lateral = new THREE.Vector3().crossVectors(c, forward).normalize();
    const edge = (k: number) => {
      const v = c.clone().addScaledVector(lateral, k * FOOTPATH.width * 0.5 / GLOBE_RADIUS).normalize();
      const latitude = toLatitude(v), longitude = toLongitude(v);
      return new THREE.Vector3(...terrainPoint(latitude, longitude, FOOTPATH.lift));
    };
    return [edge(-1), edge(0), edge(1)];
  });
  for (let i = 0; i < sides.length - 1; i++) for (let lane = 0; lane < 2; lane++) {
    const a = sides[i][lane], b = sides[i][lane + 1], c = sides[i + 1][lane + 1], d = sides[i + 1][lane];
    const tone = tones[Math.floor(random() * tones.length)].clone().offsetHSL(0, 0, (random() - 0.5) * 0.05);
    positions.push(...a.toArray(), ...c.toArray(), ...b.toArray(), ...a.toArray(), ...d.toArray(), ...c.toArray());
    for (let k = 0; k < 6; k++) colors.push(tone.r, tone.g, tone.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function Footpaths() {
  const geometries = useMemo(() => [WELL, MEADOW_HOUSE].map(footpathGeometry).filter((g): g is THREE.BufferGeometry => g !== null), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), []);
  useEffect(() => () => { geometries.forEach(geometry => geometry.dispose()); material.dispose(); }, [geometries, material]);
  return <>{geometries.map((geometry, index) => <mesh key={`footpath-${index}`} geometry={geometry} material={material} receiveShadow />)}</>;
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

// Mountains are wide enough that a flat base floats over the curved globe at its edges: each copy's
// vertices are dropped by the sphere's fall-off at their distance from the centre, then sunk a touch
// more so the base also clears the flat land facets.
const MOUNTAIN_SINK = 0.35;

function bendToGlobe(template: THREE.Object3D, rotation: number, scale: number) {
  const wrapper = new THREE.Group();
  wrapper.rotation.y = rotation;
  wrapper.scale.setScalar(scale);
  wrapper.add(template.clone(true));
  wrapper.updateMatrixWorld(true);
  const radius = GLOBE_RADIUS + PLANET_TERRAIN.landHeight;
  const vertex = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  wrapper.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry = child.geometry.clone();
    const position = child.geometry.getAttribute('position') as THREE.BufferAttribute;
    inverse.copy(child.matrixWorld).invert();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      const reach = Math.min(Math.hypot(vertex.x, vertex.z), radius * 0.9);
      vertex.y -= radius - Math.sqrt(radius * radius - reach * reach);
      vertex.applyMatrix4(inverse);
      position.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    child.geometry.computeVertexNormals();
  });
  return wrapper;
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
      object: bendToGlobe(templates[site.variant], site.rotation, site.scale),
      position: terrainPoint(site.latitude, site.longitude, -MOUNTAIN_SINK),
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
    <primitive object={mountain.object} />
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
  { latitude: 0.18, longitude: 1.72, altitude: 9.6, scale: [0.105, 0.076, 0.082], rotation: 2.55 },
  { latitude: 0.92, longitude: 2.92, altitude: 13.2, scale: [0.058, 0.05, 0.066], rotation: 2.1 },
  { latitude: -0.48, longitude: 4.16, altitude: 12.8, scale: [0.055, 0.047, 0.064], rotation: 2.86 },
  { latitude: 0.04, longitude: 5.92, altitude: 13.6, scale: [0.098, 0.072, 0.078], rotation: 2.42 },
] as const;

const CLOUD_DRIFT = { minSpeed: 0.003, speedRange: 0.006, foregroundSpeed: 0.02, foregroundOpacity: 0.85 };
// Lag: the clouds follow the globe's turn a little late (the rate they catch up at, per second). A hand-drag turns the
// globe fast, so the clouds visibly trail it; the slow automatic spin hardly shows any lag.
const CLOUD_LAG = 2.5;
const FOREGROUND_CLOUDS = [
  { position: [0, 40, 72] as const, scale: 0.09 },
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
  const layer = useRef<THREE.Group>(null!);
  const globeTurn = useMemo(() => new THREE.Quaternion(), []);
  const cloudTurn = useMemo(() => new THREE.Quaternion(), []);
  const cloudsStarted = useRef(false);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    // The globe's turn is applied to the layer's parent. The clouds' own turn catches up with it gradually, so they
    // trail the globe when it's turned by hand, about the planet's centre.
    layer.current.parent!.getWorldQuaternion(globeTurn);
    if (!cloudsStarted.current) { cloudTurn.copy(globeTurn); cloudsStarted.current = true; }
    cloudTurn.slerp(globeTurn, 1 - Math.exp(-CLOUD_LAG * dt));
    layer.current.quaternion.copy(globeTurn.clone().invert().multiply(cloudTurn));
    orbits.current.forEach((orbit, index) => { if (orbit) orbit.rotation.y += dt * drift[index]; });
    foreground.current.rotation.y += dt * CLOUD_DRIFT.foregroundSpeed;
    foregroundMaterial.opacity = CLOUD_DRIFT.foregroundOpacity * (1 - zoom.current);
  });
  return <group ref={layer} position={[0, -GLOBE_RADIUS, 0]}><group position={[0, GLOBE_RADIUS, 0]}>
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
  </group></group>;
}

export default function MiniatureWorld({ zoom }: { zoom: RefObject<number> }) {
  return <group>
    <Terrain />
    <JapaneseBridgeGarden />
    <LoopRoad />
    <LowPolyMountains /><Town /><LowPolyTrees /><Coast /><RopeBridge /><Well /><MeadowHouse /><Beach /><StreetFurniture /><StreetWork /><Boat /><BeachFloats /><Boulders /><FootballField /><FieldPath /><Meadow /><Footpaths /><Fireflies /><PalmIsland latitude={ISLAND.latitude} longitude={ISLAND.longitude} /><PalmIsland latitude={-0.54} longitude={2.79} /><FishingBoat latitude={-0.79} longitude={0.54} /><Airplane />
    <CloudLayer zoom={zoom} />
  </group>;
}
